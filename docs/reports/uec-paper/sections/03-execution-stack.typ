= 3. The Execution Stack, Top to Bottom

```
┌─────────────────────────────────────────────────────────────┐
│  Off-chain platform (superproject)                          │
│  IAM / Trading / Oracle services → Chain Bridge (only RPC   │
│  client) → JSON-RPC / gRPC                                  │
├─────────────────────────────────────────────────────────────┤
│  Validator node (solana-test-validator on localnet)         │
│  TPU ingest → SigVerify → Banking stage → PoH → ledger      │
├─────────────────────────────────────────────────────────────┤
│  SVM runtime (Sealevel)                                     │
│  Account locks → parallel scheduling → SBF (eBPF-derived)   │
│  bytecode execution → compute-unit metering                 │
├─────────────────────────────────────────────────────────────┤
│  GridTokenX programs (this repo)                            │
│  energy-token │ governance │ oracle │ registry │ trading    │
│  + CPI between them, + SPL Token / Token-2022 programs      │
└─────────────────────────────────────────────────────────────┘
```

Key boundary rule (platform-wide, see superproject docs): *no service holds a
Solana RPC connection except Chain Bridge*. This paper covers everything below the top layer.

== 3.1 The program portfolio

The bottom layer of the stack comprises six deployed programs plus two
benchmark harnesses, each an independent Anchor crate under `programs/` with
its identifier pinned in `Anchor.toml [programs.localnet]`. The table below
summarises each program's role, principal on-chain state, and hot-path write
pattern; "hot-path writes" names the account each program's highest-frequency
instruction mutates — in every case a per-entity PDA, never the program's
global configuration account (§4.2):

#table(
  columns: (auto, auto, auto),
  align: (left, left, left),
  table.header([*Program*], [*Role*], [*Hot-path writes*]),
  [`energy-token`], [energy unit of account], [token accounts of one Token-2022 mint],
  [`oracle`], [AMI telemetry ingest + validation], [per-meter `MeterState` PDA],
  [`registry`], [identity, staking, slashing], [per-user account PDA + 16 counter shards],
  [`trading`], [order book, matching, settlement], [per-order PDA, order shards, per-match nullifier],
  [`governance`], [PoA root of trust, REC certificates], [per-certificate PDA (admin-rate)],
  [`treasury`], [THB-pegged settlement + staking], [per-staker position, 16 settlement shards],
  [`blockbench`, `tpc-benchmark`], [OLTP benchmark harnesses (§9.2)], [synthetic per-run PDAs],
)

*`energy-token`* (`programs/energy-token/src/lib.rs`) owns the platform's single
fungible energy mint: one Token-2022 mint with nine decimals, so one token
represents one kilowatt-hour at 10⁻⁹ kWh resolution (the same mint serves the
GRID energy role and the GRX utility/collateral role — one asset, two labels).
Minting is not discretionary: generation-backed issuance requires the
REC-validator gate (§6.4), and the mint authority is a PDA, so no external key
can sign an issuance.

*`oracle`* (`programs/oracle/src/`) is the on-chain end of the AMI telemetry
path. Its hot instruction, `submit_meter_reading`, writes exclusively to the
submitting meter's `MeterState` PDA (`[b"meter", meter_id]`) and enforces the
validation stack measured in §9.3: gateway authorisation, energy-value range,
monotonic timestamps against the on-chain clock, a 60 s per-meter rate limit,
and the integer cross-multiplied production/consumption anomaly gate
(`instructions/submit_meter_reading.rs`). Global aggregates on `OracleData` are
deliberately stale — reconciled by the admin-rate `aggregate_readings`
instruction — and `trigger_market_clearing` advances the 15-minute market
epoch.

*`registry`* (`programs/registry/src/lib.rs`) holds user and meter identity:
per-user PDAs created at onboarding (via CPI into `energy-token` for the
registration grant, §5.1), fleet counters split across 16 shards selected by
the first byte of the registrant's key, and the validator lifecycle — a GRX
security bond (`MIN_VALIDATOR_STAKE`-gated), with misbehaviour slashed to a
configured destination vault. This registry staking is a security bond, not a
yield product; it is deliberately disjoint from treasury staking below (own
vault, own position account, no rewards).

The 16 counter shards warrant closer examination, because they are the §2.1
partitioning principle applied to the one kind of state that per-entity PDAs
cannot fix: *fleet-wide totals*. A naive design keeps `user_count` /
`meter_count` on the global `Registry` account, which would make every
registration write-lock that account and serialise all onboarding to one
transaction per scheduling round. Instead each total is split across 16
`RegistryShard` PDAs (`[b"registry_shard", shard_id]`) — zero-copy accounts
holding `user_count`, `meter_count`, `active_meter_count`, and their own
stored bump (`programs/registry/src/state.rs:23`). Shard assignment is not a
client choice: the canonical selector is the registrant's first public-key
byte modulo 16 (`shard_for`, `programs/registry/src/lib.rs:80`), and
`register_user` re-derives it and rejects any mismatching `shard_id` argument
(`instructions/register_user.rs:50`) — a caller can neither pick a quiet
shard nor scatter counts onto arbitrary ones, and since Ed25519 public keys
are uniformly distributed in their first byte, load spreads evenly without
any coordination. Sixteen is a deliberate width: 16 divides the 256 values of a byte evenly, the duplicate-detection bitmask fits a `u16`, and 16
independent write-lock domains already exceed the parallelism a single
banking stage extracts per slot. The assigned shard is recorded on the
`UserAccount` (`state.rs:65`) so later lifecycle transitions (meter
deactivation, status changes) debit the same shard they credited. The global
`Registry` totals are then *stale by construction* and reconciled by the
admin-only `aggregate_shards` instruction, which takes the shard set as
`remaining_accounts` and shows the defensive pattern for trustless
aggregation in miniature (`instructions/aggregate_shards.rs`). Each account
must be owned by the registry program; each must re-derive to the canonical
shard PDA, using the stored bump with `create_program_address` (≈1,651 CU)
rather than `find_program_address` (≈12,136 CU); and no `shard_id` may repeat
— a `u16` bitmask rejects duplicates, so a shard passed twice cannot inflate
the totals. Sums use checked arithmetic throughout. The same
sharding idiom recurs at the same width in the trading program's order shards
and the treasury's settlement-recording shards (§9.2), making "16-way
sharded, aggregate on demand" the repository's standard answer to any
global counter on a hot path.

The registry's design decisions carry measurable strengths and honest costs,
worth stating as trade-offs rather than as advantages.

*Strengths:*

+ *Contention-free onboarding.* Registration writes touch only the
  registrant's own PDAs and one of 16 shards, so unrelated onboardings
  parallelise under Sealevel; the enforced key-derived shard binding
  (`register_user.rs:50`) removes both hot-spotting and client shard-gaming
  by construction.
+ *Cheap, verifiable aggregation.* Stored bumps let `aggregate_shards`
  validate each shard PDA with `create_program_address` at ≈1,651 CU instead
  of ≈12,136, and the duplicate bitmask plus checked sums make the
  reconciliation itself tamper-evident.
+ *A clean security-bond model.* Validator staking is isolated from treasury
  yield staking (own vault, own fields on `UserAccount`), and slashing is
  value-conserving by construction: `bond = compensation + fund + remaining`,
  compensation capped at the proven loss to remove bounty-gaming, funds only
  routable to the pre-configured destination
  (`instructions/slash_validator.rs`).
+ *O(1) identity lookups.* Per-user and per-meter PDAs derive directly from
  keys and meter identifiers — no on-chain index or scan is ever needed to
  find an account.

*Limitations:*

+ *Global totals are eventually consistent at best.* `Registry.user_count`
  is only as fresh as the last admin reconciliation, and `aggregate_shards`
  does not require the full shard set: it sums whichever valid shards the
  caller passes (the `u16` bitmask rejects duplicates but no check demands
  all 16 be present, `aggregate_shards.rs:27`), so an admin calling with a
  partial set silently *undercounts*. Consumers needing exact live totals
  must read all 16 shards themselves.
+ *The shard width is baked into addresses.* `shard_for` hardcodes modulo 16
  and the shard index is a PDA seed byte, so widening beyond 16 shards is a
  state migration (new PDAs, re-pointed clients), not a constant change —
  the same seed-immutability economics as §6's account renames.
+ *Assignment is uniform only for honest keys.* A registrant willing to
  grind vanity keypairs can choose its first key byte and thus its shard;
  the payoff is merely co-locating one's own writes with a victim's shard
  (throughput nuisance, no safety impact), but the uniformity argument is
  distributional, not adversarial.
+ *Zero-copy layout rigidity.* Every schema evolution on `UserAccount` /
  `MeterAccount` is a hand-audited padding carve (the `resign_at` and
  `zone_id` fields both reclaimed padding bytes, `state.rs:73`, `state.rs:86`)
  — cheap while spare bytes remain, a full migration once they run out.
+ *Authority centralisation.* Slashing and aggregation are PoA-authority
  instructions; the registry inherits the platform's §8.2 trust model rather
  than adding independent checks — appropriate for a permissioned energy
  market, but a real limitation against the fully trustless reading of the
  same code.

*`trading`* (`programs/trading/src/`) implements the continuous double
auction: order submission to per-order PDAs (sharded variants for parallel
entry), matching, and the settlement path this paper measures throughout —
`settle_offchain_match` (`instructions/settle_offchain.rs`), which verifies
Ed25519 signatures over the match via instruction introspection (§6.3),
guards replay with a per-match `TradeNullifier` PDA, and moves escrowed value
under a market authority PDA. Uniform-price clearing (`clear_auction`) and
buyback tariffs cover the two non-CDA price rules of §9.6.

The trading model rewards deeper analysis, because it is where every
constraint of §4 converges at once. Its central decision is a *two-plane
split*: a *discovery plane* that lives on-chain but moves no value, and a
*settlement plane* that moves value but takes its matching decisions from
off-chain signatures.

*The discovery plane.* Orders are 120-byte zero-copy `Order` PDAs
(`state/order.rs`) submitted either directly or through zone-market shards,
so order entry inherits the registry's parallelism argument — unrelated
submitters never share a write lock, and the writable-account measurement of
§9.2 (sharded order submission scaling where settlement does not) confirms it
holds in practice. On-chain matching (`match_orders`,
`sharded_match_orders`) exists, but its output is deliberately non-binding: the
resulting `TradeRecord` is informational — its `total_value` is raw
`amount × price` with no token movement (`state/order.rs:31`), consumed by
the §9.6 price-rule verifier, never by custody logic. Public price state is
similarly bounded: each geographic zone gets a `ZoneMarket` PDA whose depth
snapshot is capped at `MAX_DEPTH_LEVELS = 10` price levels per side —
sized so `update_depth`'s vector payload (≈336 B) fits the §4.5 packet
(`state/zone_market.rs:7`) — keeping the global `Market` account cold. The
zone account itself is kept off the hot path by a further split: cross-zone
transmission accounting lives in a separate `ZoneCapacity` PDA so that
intra-zone settlements never write `ZoneMarket` at all; only wheeling
settlements, which genuinely consume inter-zone capacity, take the capacity
account `mut` (`state/zone_market.rs:41`). A one-byte `segment` field
(retail vs. wholesale) gates which admitted aggregators may settle in a zone
(`state/zone_market.rs:18`).

*The settlement plane.* Value custody is escrow-first: each user's funds sit
in a PDA token account with seeds `[b"escrow", user, mint]` whose SPL
authority is the global `market_authority` PDA (`instructions/escrow.rs`).
The seed derivation *is* the security argument — since the escrow address is
fully determined by the signed payload's user and mint, a malicious
settlement submission cannot be pointed at a victim's funds; there is no
account-substitution surface to audit because the runtime derives the only
possible address. Settlement then verifies intent, not the identity of the submitter: `settle_offchain_match` requires two inline Ed25519 verify
instructions (buyer's and seller's signatures over the match payload) and
checks them by introspecting the instructions sysvar with a hand-rolled
minimal parser (`instructions/settle_offchain.rs:22`) rather than the SDK
helper. That choice, like several in this file, is forced by the BPF stack
ceiling: the settle context sits at the 4 KiB frame limit, so even the
governance maintenance flag is read by raw byte offset from the config
account (`require_governance_operational`) instead of a typed
Anchor account, which would overflow `try_accounts`. The stack budget is as
real a design force here as the compute and packet budgets of §4.3 and
§4.5.

*Replay defence in depth.* Two nullifiers with different jobs guard the
settlement plane. `OrderNullifier` tracks cumulative filled amount per
off-chain order UUID, capping total settlement against the order's signed
size — but it deliberately cannot detect the *same partial match* being
settled twice while headroom remains. That gap is closed by
`TradeNullifier`, a PDA keyed by the matcher's unique per-match trade
identifier whose *existence* is the guard: created atomically with the first
settle, so any replay — even re-signed with a fresh blockhash, which defeats
transaction-hash deduplication upstream — collides with the program-owned
account and reverts (`state/nullifier.rs:15`). Charge caps and the
`TreasurySettlementRequired` policy (once a market's THBC mint is set, no
settlement may silently omit the treasury recording CPI) complete the
economic guards.

*Trade-offs of the two-plane split.* The benefit is that the
matching engine — price-time priority, partial fills, order-book data
structures — runs off-chain at native speed and can be replaced (CDA,
uniform-price `clear_auction` with its sorted cumulative supply/demand
curves and single crossing point, or regulated buyback tariffs) without
touching custody code; §9.6 exploits exactly this to compare three price
rules over identical fleet data. The cost is a precise trust statement: the
off-chain matcher chooses *which* valid matches exist, and the chain can
verify authorisation (both parties signed), conservation (escrow debits equal
credits plus capped charges), and uniqueness (nullifiers) — but not
*fairness* of the matching itself; a corrupt matcher can reorder or starve
participants, though it can never move a token without both signatures. The
second cost is measured throughput: because every settlement reconciles into
shared collector and treasury accumulator accounts, the settlement plane is
global-write-bound (§9.2's flat ≈0.6 TPS), while the discovery plane it
feeds is embarrassingly parallel — an asymmetry that is the honest price of
auditable, per-match value conservation on-chain.

*`governance`* (`programs/governance/src/`) is the Proof-of-Authority root of trust: a `GovernanceConfig` PDA naming the platform authority (two-step
transfer, §6.2), admission of REC validators, and ERC-1155-style renewable
energy certificates whose issuance backs the `energy-token` mint gate. Other
programs consult it by CPI or PDA read (§5.2); its own write rate is
administrative.

*`treasury`* (`programs/treasury/src/instructions/`) provides the pegged
settlement unit: THBC, a six-decimal THB-pegged stablecoin whose mint
authority is the `[b"treasury"]` PDA. Supply changes through exactly two
instructions. `issue_thbc` mints against fiat received, only while a custodian
reserve attestation is fresh and only up to that attested reserve, and creates
a `[b"deposit", H(bank_ref)]` nullifier in the same instruction so a replayed
bank webhook is rejected at the account level. `confirm_redemption` burns,
completing a redemption that `redeem_thbc_for_fiat` first escrowed under a
timelock — if the issuer does not confirm within it, the holder calls
`reclaim_redemption` and recovers the tokens.

Currency exchange is deliberately *not* one of those two. `exchange_grx_for_thbc`
and `exchange_thbc_for_grx` move THBC between a platform-held inventory vault and
the user, leaving supply and the attested reserve untouched, so GRX never enters
the backing set of a fiat-referenced unit and the peg is not a function of the
admin-set exchange rate. A MasterChef-style accumulator pays GRX staking
yield from a dedicated reward vault, and `record_settlement` (plus its
16-way sharded variant, §9.2) lets the trading program register gross settled
THBC value by CPI without the treasury taking custody. Four PDA vaults keep
the roles disjoint: exchange collateral, staker custody, staker rewards, and the
regulator rebate vault that receives registry slashes; two further vaults hold
the platform's THBC exchange inventory and escrowed redemptions.

The two benchmark crates (`blockbench`, `tpc-benchmark`) are measurement
harnesses only — they implement the SIGMOD BlockBench micro-operations,
SmallBank, and TPC-C against the account model for §9.2, are deployed on the
same localnet, and take no part in the energy protocol.
