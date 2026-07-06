// gridtokenx-anchor — Runtime Architecture (Typst)
// Full document in Typst. Compile: typst compile UEC-paper.typ UEC-paper.pdf

#set page(paper: "a4", margin: 2cm, numbering: "1")
#set text(size: 10pt)
#set par(justify: true)
#set heading(numbering: none)
#show raw.where(block: true): it => block(
  fill: luma(245), inset: 8pt, radius: 3pt, width: 100%,
  text(size: 7.5pt, it),
)
#show link: it => underline(text(fill: blue.darken(20%), it))
#set math.equation(numbering: "(1)")

#align(center)[
  #text(size: 16pt, weight: "bold")[An On-Chain Settlement Layer for Peer-to-Peer
  Energy Trading under Thailand's Enhanced Single Buyer Model]
  #v(0.3em)
  #text(size: 10pt)[GridTokenX: Solana/Anchor Programs and Runtime Architecture]
]

#block(inset: (left: 2em, right: 2em), above: 1em, below: 1em)[
  #text(size: 9.5pt)[
    *Abstract* — The growing adoption of renewable energy has yielded participants
    with surplus generation capacity who currently cannot engage in peer-to-peer
    (P2P) trading under Thailand's Enhanced Single Buyer model. This article
    presents an on-chain settlement layer for P2P energy trading in which
    transaction settlement executes on a Solana cluster. The system features a
    consortium governance structure mapped to Thailand's grid operators (EGAT, MEA,
    PEA), an application layer built via an Anchor smart-contract program, and
    consensus and finality driven by Solana's PoH/Tower-BFT engine. The market
    design incorporates a hybrid continuous double auction (CDA) that matches the
    on-chain order book in real time for immediate trades, such as BESS reserve
    dispatch, alongside a uniform-price auction that establishes a single clearing
    price over 15-minute intervals. We evaluate the smart-contract programs using a
    transaction-level benchmark on a single-node validator (Apple M2, Agave
    3.1.10). Across a TPC-C concurrency sweep (500 transactions, 50% NewOrder / 50%
    Payment), all transactions confirmed with zero failures. Throughput scaled
    super-linearly with in-flight concurrency, reaching ≈74 tx·s#super[−1] at a
    concurrency of 40 with no saturation knee across the swept range. Compute cost
    remained flat at ≈23 k CU·tx#super[−1] across all levels, indicating that the
    performance ceiling is dictated by single-node block production and write-lock
    serialisation rather than on-chain execution. That serialisation dominates any
    path funnelled through a single write-locked account: single-signer mint
    issuance holds at only ≈5.33 mint·s#super[−1] regardless of device count, and
    single-fee-payer settlement at ≈0.6 tx·s#super[−1]. We identify multi-signer
    fee-payer pooling, together with sharded collector accounts, as the primary
    lever for issuance- and settlement-side throughput.

    #v(0.4em)
    *Keywords* — peer-to-peer energy trading; blockchain settlement; Solana;
    continuous double auction; uniform-price auction; Thailand Enhanced Single
    Buyer.
  ]
]

#line(length: 100%, stroke: 0.5pt)

= 1. Introduction

Peer-to-peer (P2P) energy trading lets prosumers — households and firms that both
produce and consume electricity — settle surplus generation directly with one
another rather than solely through a utility. In Thailand this exchange is
currently foreclosed: under the Enhanced Single Buyer (ESB) model all wholesale
electricity is procured through a single national off-taker, leaving prosumers
with surplus generation no direct route to trade with one another. Realising such
an exchange on a public ledger raises three requirements that a general-purpose
blockchain does not satisfy out of the box: (i) *throughput*, because metering
telemetry and order flow arrive continuously from many independent devices; (ii)
*settlement integrity*, because a trade must be provably authorised by both
counterparties yet cannot be allowed to replay; and (iii) *physical backing*,
because a token that claims to represent a kilowatt-hour must be tied to an
attested, real-world measurement rather than minted at will.

This paper describes GridTokenX, an on-chain energy-trading platform built as a
set of Anchor programs on a permissioned Proof-of-Authority (PoA) Solana cluster.
The design exploits the Solana Virtual Machine (SVM) execution model directly: it
partitions all hot-path state into per-entity program-derived accounts (PDAs) so
that unrelated meters, orders, and registrations never contend for the same write
lock and therefore execute in parallel under Sealevel. The market runs a hybrid
double auction: a continuous double auction (CDA) maintains an on-chain order book
and matches compatible orders in real time (`sharded_match_orders`) for immediate
trades, such as battery-energy-storage reserve dispatch, while a uniform-price
auction clears accumulated bids at a single price over 15-minute epochs
coordinated by the oracle's market-clearing trigger. Matches produced by the
off-chain engine settle on-chain through native Ed25519 signature verification and
per-order replay nullifiers, so the chain never holds custody of the matching
engine yet still enforces authorisation and single-use settlement. Token minting
is gated behind a registered set of Renewable Energy Certificate (REC) validators,
binding issuance to attested generation. An accompanying treasury program provides
a Thai-baht-pegged stablecoin (THBG) with reserve-attested peg invariants and a
MasterChef-style staking accumulator, giving the market a baht-denominated
settlement unit.

Governance follows a permissioned consortium model. The platform authority named
in the governance program is intended to be held jointly by Thailand's grid
operators — the Electricity Generating Authority (EGAT), the Metropolitan
Electricity Authority (MEA), and the Provincial Electricity Authority (PEA) —
under a two-step authority-transfer discipline (§6.2), so that protocol
administration rests with the same institutions that operate the physical grid,
while block production runs on a permissioned Proof-of-Authority validator set
(§8).

The contributions of this work are:

+ A Sealevel-parallel account architecture in which every high-frequency write —
  meter telemetry, order placement, settlement — targets a per-entity PDA, with
  global aggregates kept deliberately stale and reconciled by periodic admin
  instructions (§4.2).
+ An off-chain-matched, on-chain-settled trade protocol that verifies buyer and
  seller Ed25519 signatures through instruction-sysvar introspection and prevents
  replay with per-order nullifier PDAs (§6.3).
+ A REC-validator gating scheme that ties token minting to attested physical
  energy (§6.4), together with a two-step authority-transfer mechanism for
  application-layer PoA governance (§6.2).
+ A treasury design with formally stated peg and collateral invariants and a
  precise, integer-only economic model for settlement, fees, wheeling charges,
  and staking rewards (§11).

The remainder of the paper is organised as follows. Section 2 states the
methodology — the design principles, the implementation stack, and the evaluation
approach. Section 3 presents the execution stack from off-chain services down to
the deployed programs. Section 4 develops the SVM execution model — the
account/lock discipline, the compute budget, and zero-copy state. Section 5
describes cross-program invocation between the programs. Section 6 sets out the
security and trust model. Section 7 traces an end-to-end market cycle, and
Section 8 covers the consensus and validator topology. Section 9 reports the key
empirical results and discusses their implications. Section 10 is a reading map to
the wider documentation, and Section 11 gives the formal settlement and economic
equations, each cited to its implementing source line.

= 2. Methodology

This work follows a *design-and-measure* method: the platform is constructed as a
set of on-chain programs whose structure is dictated by the execution semantics of
the target runtime, and every architectural claim is grounded in the implementing
source and, where behavioural, in a reproducible measurement. This section states
the design principles that constrain the implementation (§2.1), the implementation
stack itself (§2.2), and the evaluation harnesses used to verify functional
correctness and quantify runtime cost (§2.3).

== 2.1 Design principles

The design is governed by four principles, each a direct consequence of the SVM
account model rather than a stylistic preference.

+ *Execution-model-first partitioning.* Because the runtime serialises any two
  transactions that write the same account, all high-frequency state is placed in
  per-entity PDAs, and shared configuration is treated as read-only on hot paths.
  Parallelism is therefore a property of the data layout, not of an added
  concurrency mechanism (developed in §4.2).
+ *State in accounts, logic in stateless programs.* Programs hold no mutable
  state; all protocol state lives in program-owned accounts, which keeps
  authorisation reducible to the runtime ownership rule.
+ *Defensive integer arithmetic.* All value-bearing computations use checked or
  saturating integer operations over `u128` intermediates, and every program
  enables `overflow-checks = true` in its release profile, so an arithmetic
  overflow aborts the transaction rather than wrapping silently.
+ *Cite, do not assert.* Each architectural statement in this paper is anchored to
  a specific source location (`path:line`); a claim without such an anchor is
  treated as a hypothesis rather than a result.

== 2.2 Implementation

The platform is implemented in Rust and compiled to SBF bytecode with the Anchor
framework (`anchor-lang` and `anchor-spl` version 1.0.0). It comprises five core
programs — `energy-token`, `governance`, `oracle`, `registry`, and `trading` — a
`treasury` program providing the pegged settlement unit, and two benchmark crates
(`blockbench` and `tpc-benchmark`); shared functionality is factored into `core`
and `compute-debug` crates. Each program is an independent crate rather than a
member of a single workspace, and the canonical program identifiers are declared
in `Anchor.toml [programs.localnet]`. Fungible energy and Renewable Energy
Certificate balances are held in Token-2022 mints. State structs are declared
zero-copy (`#[account(zero_copy)] #[repr(C)]`) and accessed in place through
`AccountLoader`, avoiding full deserialisation of large accounts. Compute-unit
consumption is profiled non-invasively by wrapping each handler body in the
`compute_fn!` macro (`shared/compute-debug/src/lib.rs:78`), which reports remaining
budget on localnet and compiles to a no-op in release builds.

== 2.3 Evaluation approach

Functional correctness and runtime cost are assessed with a layered set of
harnesses, chosen so that most properties can be verified without a validator.
In-process suites built on LiteSVM exercise program guards and profile
compute-unit cost, with the profiling suites asserting that each instruction
remains below the 200,000-CU default budget. Integration suites run under a live
validator (`anchor test`, or the standalone runner) to confirm cross-program
invocation and settlement end to end, and a Surfpool-based simulation reproduces a
mainnet-like environment without a local validator. Throughput and cost under load
are characterised with a Criterion micro-benchmark of the matching engine and with
the BlockBench and TPC-C workloads; the canonical results are recorded in
#link("BENCHMARKS.md")[`BENCHMARKS.md`]. A methodological caveat applies to all
on-chain measurements: the development topology is a single-node localnet, so
reported figures characterise SVM and runtime behaviour (account locking, compute
metering, instruction cost) and not consensus throughput, which would require a
multi-validator deployment (§8.3).

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
Solana RPC connection except Chain Bridge*. Everything below the top layer is
what this document covers.

= 4. SVM Execution Model

== 4.1 Programs are stateless; state lives in accounts

Each program in `programs/*` compiles to SBF bytecode (`anchor build` →
`target/deploy/*.so`) and is deployed at a fixed address (`declare_id!`). A
program owns accounts; only the owning program may mutate an account's data. All
protocol state — token supply, meter readings, orders, governance config — lives
in accounts, not in the programs.

== 4.2 Transactions declare their account set in advance

A Solana transaction lists every account it will touch and whether each is
read-only or writable. The runtime uses this to take *per-account read/write
locks* before execution. Two transactions that touch disjoint writable account
sets execute *in parallel* on different cores (Sealevel). Two transactions that
both write the same account serialize.

This is the most fundamental constraint on the repository's design. Every
hot-path write goes to a *per-entity PDA* so that unrelated users/meters/orders
never contend:

#table(
  columns: 4,
  align: (left, left, left, left),
  table.header([*Hot path*], [*Per-entity account*], [*Seeds*], [*Where*]),
  [Meter telemetry], [`MeterState`], [`[b"meter", meter_id]`], [`programs/oracle/src/lib.rs:473`],
  [Order placement], [`Order`], [`[b"order", authority, order_id]`], [`programs/trading/src/lib.rs:1435`],
  [Settlement replay guard], [`OrderNullifier`], [`[b"nullifier", user, order_id]`], [`.../settle_offchain.rs:112`],
  [User registration counters], [`RegistryShard` ×16], [`[b"registry_shard", shard_id]`], [`programs/registry/src/lib.rs:770`],
  [Settlement escrow], [escrow PDA], [`[b"escrow", user, currency_mint]`], [`.../settle_offchain.rs:140`],
)

Shard selection is deterministic from the signer: `key.to_bytes()[0] % 16`
(`programs/registry/src/lib.rs:46`), so a given user always lands on the same
shard but the 16 shards absorb concurrent registrations without a global write
lock.

The corollary: *global accounts (config, totals) are read-only on hot paths and
stale on purpose*. Periodic admin instructions (`aggregate_readings` in oracle,
`aggregate_shards` in registry) fold per-entity state back into global totals.

== 4.3 Compute budget

Every instruction executes under a compute-unit meter (200k CU default per
instruction, 1.4M per transaction ceiling). Exceeding it aborts the transaction.
This repository profiles CU cost with the `compute_fn!` macro
(`shared/compute-debug/src/lib.rs:78`), which logs remaining CU around each
handler body on localnet and compiles to a no-op in release. Checkpoints inside
long handlers use `compute_checkpoint!` (`shared/compute-debug/src/lib.rs:143`)
— e.g. around the registry→energy-token CPI.

== 4.4 Zero-copy account access

State structs are `#[account(zero_copy)] #[repr(C)]` and accessed through
`AccountLoader` (`load()` / `load_mut()` / `load_init()`). Instead of
deserializing the whole account into heap objects (Borsh), the program casts the
account's byte buffer in place — large accounts (sharded order books, meter
state) incur low compute-unit cost. The cost is manual layout discipline:
explicit padding
fields, no `String` (fixed `[u8; N]` + length byte instead). See invariants 1–2
in #link("ARCHITECTURE.md")[`ARCHITECTURE.md`].

= 5. Cross-Program Invocation (CPI)

Programs call each other synchronously inside one transaction; the callee
inherits the transaction's account locks and compute budget. Two production CPI
edges exist:

== 5.1 registry → energy-token (registration grant)

When a new user registers, the registry program mints the 10 GRX grant by CPI
into energy-token. The registry signs the CPI *as its own PDA* using
`CpiContext::new_with_signer` with the `[b"registry", bump]` seeds
(`programs/registry/src/lib.rs:298`), then calls
`energy_token::cpi::mint_tokens_direct` (`programs/registry/src/lib.rs:305`).
This is the canonical PDA-signing pattern: no private key exists for the registry
PDA; the runtime grants it signer status because the calling program proved the
seeds derive to that address.

== 5.2 trading → governance (PoA config + ERC certificates)

Trading depends on governance with `features = ["cpi"]` and re-exports its types
directly: `pub use governance::{ErcCertificate, ErcStatus, GovernanceConfig}`
(`programs/trading/src/lib.rs:18`). Settlement validates governance-owned
accounts (deserialize + owner check) rather than invoking governance
instructions — a read-side coupling, cheaper than a full CPI call.

Both edges are path dependencies in `Cargo.toml`, so Anchor builds callee CPI
client code (typed `cpi::` modules) at compile time — no runtime IDL lookup.

= 6. Security Model

Solana's runtime gives three primitives: *ownership* (only the owning program
mutates an account), *signatures* (the runtime verifies tx signers before
execution), and *PDAs* (addresses no private key can sign for, derivable only via
the owning program). Everything else is program-level policy. This repository
adds four mechanisms atop these primitives:

== 6.1 Anchor constraint checks (account validation)

Account structs declare constraints that Anchor verifies before the handler runs:
`Signer<'info>` for required signers, `has_one = authority` for stored-authority
matching, `seeds = [...]` + `bump` for PDA address verification. Governance gates
every privileged instruction this way — e.g.
`has_one = authority @ GovernanceError::UnauthorizedAuthority` on `IssueErc`
(`programs/governance/src/contexts.rs:31`), `ValidateErc`
(`programs/governance/src/contexts.rs:90`), `RevokeErc`
(`programs/governance/src/contexts.rs:108`), and `UpdateGovernanceConfig`
(`programs/governance/src/contexts.rs:149`).

== 6.2 Application-layer PoA with 2-step authority transfer

The governance program holds a `GovernanceConfig` account naming the platform
authority. Authority rotation is two-phase to tolerate accidental key-entry
errors:

+ `propose_authority_change` (`programs/governance/src/handlers/authority.rs:13`)
  — current authority writes `pending_authority` (`authority.rs:34`), guarded
  against an already-pending proposal (`authority.rs:22`).
+ `approve_authority_change` (`programs/governance/src/handlers/authority.rs:53`)
  — the *new* key must sign to accept, and only then does `poa_config.authority`
  flip (`authority.rs:78`).

An incorrectly entered new authority therefore cannot render the protocol
inoperable — the incorrect key never signs the approval.

== 6.3 Off-chain-signed settlement: Ed25519 instruction introspection

The CDA matching engine runs off-chain (Trading Service). Matches settle on-chain
via `settle_offchain.rs` without the buyer/seller being transaction signers.
Instead:

- The off-chain engine collects *Ed25519 signatures from buyer and seller over
  the order payload* and places them in the transaction as instructions to
  Solana's native Ed25519 verification program (which the validator executes —
  and rejects the tx if invalid — before the trading instruction runs).
- The trading handler then *introspects the transaction* via the instructions
  sysvar: `verify_ed25519_signature` (`.../settle_offchain.rs:651`) calls
  `load_instruction_at_checked` (`settle_offchain.rs:657`), asserts the
  instruction targets the Ed25519 program (`settle_offchain.rs:660`), and asserts
  the pubkey embedded in the verified instruction matches the expected order owner
  (`settle_offchain.rs:669`). Buyer and seller are checked at instruction indexes
  0 and 1 (`settle_offchain.rs:310`, `settle_offchain.rs:314`).

This is the standard Solana pattern for "verify an arbitrary off-chain signature
on-chain" — the expensive curve math runs in the native program; the application
program only proves the verification happened in the same transaction, against
the right key and message.

*Replay protection* comes from `OrderNullifier` PDAs seeded per `(user, order_id)`
(`settle_offchain.rs:112`). Each nullifier tracks `filled_amount`; a settlement
may only consume the unfilled remainder (`settle_offchain.rs:344`) and increments
the fill saturatingly (`settle_offchain.rs:428`), with the nullifier's stored
authority re-checked against the payload (`settle_offchain.rs:539`). The same
signed order can therefore be partially filled across transactions but never
over-filled or replayed.

== 6.4 REC-validator gating on mint

GRID tokens represent physical energy (1 kWh = 1 GRID), so minting is gated
behind registered REC validators in energy-token. Validators are added/removed by
the admin (`programs/energy-token/src/lib.rs:280`, `lib.rs:313`); when any
validator is registered (`rec_validators_count > 0`, `lib.rs:119`), mint paths
require the signing key to appear in the validator set (`lib.rs:127`–`128`), with
the same gate on the generation-mint path (`lib.rs:203`).

== 6.5 Trust boundary summary

#table(
  columns: 2,
  align: (left, left),
  table.header([*Boundary*], [*Enforced by*]),
  [Who may mutate an account], [Runtime ownership rule (program-owned accounts)],
  [Who may invoke privileged instructions], [Anchor `Signer` + `has_one` against `GovernanceConfig` / stored authorities],
  [Whether a trade was authorized], [Ed25519 native-program verification + sysvar introspection],
  [Whether a trade can be replayed], [`OrderNullifier` PDA per (user, order)],
  [Whether energy backing is real], [REC validator set in energy-token],
  [Who may even reach the RPC port], [Off-chain: Chain Bridge mTLS + RBAC (superproject concern)],
)

= 7. Protocol Flow (end-to-end runtime view)

A full market cycle touches all five programs:

```
1. Registration   registry: create user PDA on shard (key[0] % 16)
                  └─CPI→ energy-token: mint 10 GRX grant (PDA-signed)
2. Telemetry      oracle: AMI gateway submits readings → per-meter MeterState PDA
                  (parallel across meters; 15-min market-clearing epochs)
3. Order entry    trading: submit_order → per-order PDA on order shard
4. Matching       OFF-CHAIN: Trading Service CDA engine matches buy/sell,
                  collects buyer+seller Ed25519 signatures
5. Settlement     trading: settle_offchain_match — ed25519 ix at index 0/1,
                  introspection check, nullifier fill update, escrow transfer
                  (reads governance GovernanceConfig / ERC certificates)
6. Token movement energy-token / SPL: GRID + GRX transfers, REC-gated mint/settle
7. Reconciliation admin: aggregate_readings / aggregate_shards fold shard + meter
                  state into global totals (deliberately stale between runs)
```

Steps 2 and 3 are the throughput-critical paths and are exactly the ones designed
for Sealevel parallelism (§4.2). Step 5 is the security-critical path (§6.3).

= 8. Consensus & Validator Topology

== 8.1 What Solana consensus provides

On any Solana cluster, ordering and finality come from *Proof of History* (a
verifiable delay function giving each entry a position in time) feeding *Tower
BFT* (a PoH-timestamped variant of practical BFT voting in which validators
commit to forks with exponentially growing lockouts). Block production rotates
across a leader schedule weighted by stake. The programs in this repository are
consensus-agnostic: they see only the SVM account model and cannot tell which
consensus produced the block.

== 8.2 What "permissioned PoA" means here

GridTokenX targets a *permissioned cluster*: the validator set is a closed list
of known operators (utility / market-operator nodes) rather than open
stake-weighted entry. Solana does not have a separate "PoA mode" — permissioning
is operational (who is allowed to run a validator and receive stake delegation),
and the *application-layer* PoA lives in the governance program's
`GovernanceConfig` (§6.2), which gates protocol administration regardless of who
validates blocks. The two layers must be kept distinct:

#table(
  columns: 3,
  align: (left, left, left),
  table.header([*Layer*], [*Authority*], [*Mechanism*]),
  [Block production / finality], [Permissioned validator operators], [PoH + Tower BFT among allowlisted nodes],
  [Protocol administration], [`GovernanceConfig.authority`], [Governance program checks (§6.1–6.2)],
  [Energy attestation], [REC validator set], [energy-token gating (§6.4)],
)

== 8.3 Development topologies

#table(
  columns: 4,
  align: (left, left, left, left),
  table.header([*Mode*], [*Nodes*], [*Consensus reality*], [*How*]),
  [`anchor test` / localnet], [1 × `solana-test-validator`], [None — single node self-produces blocks; PoH runs but no voting quorum], [`anchor test`, or superproject `just solana-up`],
  [Surfpool simnet], [0 local validators], [Simulated against mainnet state], [`npm run simnet` / `npm run simnet:ci`],
  [Target deployment], [N permissioned validators], [Real Tower BFT among allowlisted operators], [Out of scope for this repository],
)

The single-node localnet means dev/test never exercises fork choice, leader
rotation, or vote lockouts — only the SVM semantics (§4) are faithfully
reproduced. Performance numbers from #link("BENCHMARKS.md")[`BENCHMARKS.md`] are
therefore SVM/runtime measurements, not consensus-throughput measurements.

= 9. Key Results and Discussion

This section reports the principal empirical findings and interprets them against
the design goals of §2.1. All figures are drawn from the canonical benchmark
report #link("BENCHMARKS.md")[`BENCHMARKS.md`]. The compute-unit (CU) values are
machine-independent and are reproduced from the in-process LiteSVM profiles,
whereas the throughput figures are qualified by the single-node caveat of §2.3.

Table 0 summarises the headline findings; each is developed and cited in the
subsections that follow. Two throughput limits are reported separately and must
not be conflated: the matching/OLTP path scales super-linearly to the swept
ceiling, whereas any path that funnels through one write-locked account (mint
issuance, single-fee-payer settlement, single-gateway meter ingest) is bounded by
that serialisation, not by execution.

#figure(
  caption: [Headline empirical results. All values are drawn from the canonical
    benchmark report #link("BENCHMARKS.md")[`BENCHMARKS.md`] (`3cb3388`,
    Solana 3.1.10, Apple M2, 2026-07-06). CU figures are machine-independent;
    absolute throughput is qualified by the single-node caveat (§2.3, §8.3).],
  table(
    columns: (auto, auto, auto),
    align: (left, left, left),
    table.header([*Metric*], [*Measured value*], [*Bottleneck source*]),
    [Peak throughput (TPC-C proxy, c=40)], [≈74.25 tx·s#super[−1]], [block-time + write-lock on shared accounts],
    [Scaling (c=5→c=40)], [super-linear (9.4× over 8×), no saturation knee], [— (execution is load-independent)],
    [Per-tx compute (all loads)], [flat ≈22–24 k CU], [load-independent (not execution-bound)],
    [Single-signer mint issuance], [≈5.33 mint·s#super[−1]], [shared `mint` write-lock (device-count independent)],
    [Batch-settle (single fee-payer)], [≈0.6 tx·s#super[−1]], [global collectors + `treasury_state` accumulator write-lock],
    [Meter ingest, 100,000 meters], [0.81% loss, ≈13.5 k CU flat], [single gateway payer write-lock (not per-meter)],
    [Transaction failure rate (TPC-C sweep)], [0% at all concurrency levels], [—],
    [Settlement compute cost], [121,813 CU·match#super[−1] (≈61% budget)], [Ed25519 verify + dual-mint escrow],
  ),
)

== 9.1 Compute-unit cost of on-chain operations

Table 1 summarises the measured CU cost of representative instructions and their
share of the 200,000-CU default per-instruction budget. Two facts stand out.
First, every control, telemetry, and settlement-recording path costs no more than
approximately sixteen thousand CU — at most about eight per cent of the budget —
so the high-frequency operations retain ample headroom. Second, the off-chain-match
settlement instruction, `settle_offchain_match`, is by a wide margin the most
expensive operation at roughly 122,000 CU (about 61% of the budget); its cost is
dominated by the native Ed25519 signature verification and instruction-sysvar
introspection that authorise the trade (§6.3), not by the settlement arithmetic
itself.

#figure(
  caption: [Measured compute-unit cost of representative instructions and their
    share of the 200,000-CU default budget. Source: #link("BENCHMARKS.md")[`BENCHMARKS.md`] §1, §4, §5, §5b.],
  table(
    columns: (auto, auto, auto),
    align: (left, right, right),
    table.header([*Instruction*], [*CU*], [*% of 200k*]),
    [`do_nothing` (dispatch + signature-verify floor)], [769], [0.4%],
    [`treasury.record_settlement`], [3,301], [1.7%],
    [`governance.approve_authority_change`], [5,784], [2.9%],
    [`treasury.record_settlement_sharded`], [5,374], [2.7%],
    [`oracle.trigger_market_clearing`], [8,390], [4.2%],
    [`oracle.submit_meter_reading` (steady-state)], [13,376], [6.7%],
    [`oracle.submit_meter_reading` (first, inits PDA)], [16,050], [8.0%],
    [`trading.settle_offchain_match`], [122,000], [61.0%],
  ),
)

The hot telemetry write, `submit_meter_reading`, costs about 16,050 CU on the
first submission for a meter — which initialises the meter PDA — and about
13,376 CU in steady state, confirming that the dominant recurring on-chain write
sits comfortably inside budget. The governance and oracle control instructions all
fall between roughly 5,800 and 11,100 CU.

== 9.2 Parallelism and throughput under load

Under the TPC-C concurrency sweep, aggregate throughput rises from 7.87
transactions per second (TPS) at concurrency 5 to 74.25 TPS at concurrency 40 —
a 9.4-fold increase over an 8-fold rise in concurrency — climbing monotonically
with no saturation knee within the swept range. Crucially, the per-transaction CU
cost remains flat at approximately 22,000–24,000 CU across all concurrency
levels, which shows that on-chain execution cost is independent of load. The
throughput ceiling is therefore imposed by consensus block time and by write-lock
serialisation on the few genuinely shared accounts, not by program execution.

The single-node development topology bounds absolute write throughput at
approximately 2.0 TPS for any operation that requires a block, because latency is
dominated by the ~400–600 ms block time rather than by compute. By contrast, a
read served directly by the RPC node returns in under a millisecond
(≈1,454 TPS), three orders of magnitude faster, as it involves no consensus
round-trip. These absolute rates are properties of the single-node harness, not of
the protocol, and must not be read as consensus-throughput results (§2.3, §8.3).

A distinct serialisation limit governs token issuance. Settlement mints GRID
against a matched trade, and because every settle write-locks the same treasury
accumulator and the shared fee, wheeling, and loss collector accounts, issuance
does not parallelise across the contributing devices: an open-loop sweep in which
a single fee-payer submits settlements holds at approximately 0.6 mint·s⁻¹
irrespective of in-flight concurrency and of whether the offered load originates
from one device or many. The bottleneck is the shared accumulator, not the signer
or the device population — the direct-mint path, by contrast, packs many mints
into a single slot from one signer, confirming that raw issuance is limited by the
confirmation round-trip rather than by on-chain contention. Two complementary
remedies restore parallelism: sharding the collector and accumulator accounts so
that concurrent settlements touch disjoint writable state (§9.4), and pooling
multiple fee-payers so that submission is not funnelled through a single account.
In a Tier-A prototype combining both, per-slot settlement packing rises to
approximately 7.5 mint·s⁻¹. We therefore identify multi-signer fee-payer pooling,
together with per-shard collector accounts, as the primary lever for
settlement-side throughput.

== 9.3 Meter-telemetry ingest scaling to 100,000 meters

The concurrency sweep above uses a generic-OLTP proxy. To characterise the *actual*
telemetry hot path at fleet scale, we drove `oracle.submit_meter_reading` from 80 up
to 100,000 distinct meters against a live single-node validator, each meter writing
its own `MeterState` PDA (Sealevel-disjoint). Each run submits two epochs at least
61 seconds apart — the first initialises every meter PDA, the second is the
recurring steady-state write — with compute units sampled post-hoc from transaction
metadata. Two client transports were required: up to 10,000 meters, each transaction
is confirmed individually over a websocket subscription (300 in flight); beyond that
this transport collapses under the pending-confirmation backlog, so the 50,000- and
100,000-meter runs pre-sign transactions locally against a cached blockhash, submit
them raw, and confirm by bulk signature-status polling under a 3,000-transaction
in-flight window. The transport changes measured throughput and latency granularity
(±1.5 s poll quantisation), never the on-chain cost. Table 2 reports the result.

#figure(
  caption: [Oracle meter-telemetry ingest scaled from 80 to 100,000 meters on a live
    single-node validator. Steady-state CU is the recurring per-meter write; the base
    path (`CU min`) is the value to cite. Runs at ≥50,000 meters use the raw-send +
    bulk-status transport. Source: #link("BENCHMARKS.md")[`BENCHMARKS.md`] §9.],
  table(
    columns: 5,
    align: (right, right, right, right, right),
    table.header(
      [*Meters*], [*Confirmed / total*], [*Loss %*], [*Steady CU min*], [*TPS (steady)*],
    ),
    [80], [400 / 400], [0.00], [13,468], [135],
    [1,000], [1,992 / 2,000], [0.40], [13,525], [120],
    [5,000], [9,952 / 10,000], [0.48], [13,525], [188],
    [10,000], [19,908 / 20,000], [0.46], [13,560], [217],
    [50,000], [99,261 / 100,000], [0.74], [13,634], [359],
    [100,000], [198,383 / 200,000], [0.81], [13,634], [329],
  ),
) <tab-meter-scaling>

Two results stand out. First, the steady-state base write cost holds at
13.5–13.6 thousand CU across a 1,250-fold increase in meter count (13,468 CU at 80
meters to 13,634 CU at 50,000 and 100,000), matching the 13,376 CU litesvm figure of
§9.1: the per-meter write is $O(1)$ in fleet size, exactly as the per-entity-PDA
partitioning predicts, with the residual drift attributable to meter-identifier byte
length rather than fleet size. Second, delivery remains near-lossless — 0.81% dropped
transactions at 100,000 concurrently submitting meters (200,000 transactions), with
95th-percentile confirmation latency below three seconds. Throughput, by contrast,
does not grow with meter count: it is flat within each transport (120–220 TPS on
per-transaction confirmation, 330–360 TPS on raw submission, and essentially
unchanged as the fleet doubles from 50,000 to 100,000), because every submission is
signed by the single gateway fee-payer, which is write-locked on each transaction —
as with settlement in §9.2, the ceiling is a shared-account serialisation limit, not
per-meter contention. The flat CU confirms the on-chain write itself is already
scale-free; converting the disjoint per-meter PDAs into proportional throughput
requires the same remedy identified for settlement, namely pooling multiple gateway
fee-payers so ingress is not funnelled through one signer.

== 9.4 Discussion

The measurements support the central design claim of §2.1: partitioning
high-frequency state into per-entity PDAs removes execution-side contention, so
the residual scaling limit is consensus and lock serialisation rather than
compute. The flat CU-versus-concurrency profile is the direct evidence — had hot
paths shared a writable account, compute cost or failure rate would have risen
with load; neither does. The sharded settlement-recording path reinforces this:
`record_settlement_sharded` writes a per-shard PDA at about 5,374 CU instead of
contending on a single global counter, converting a would-be serialisation point
into an embarrassingly parallel one, at the cost of a periodic off-hot-path
aggregation.

Settlement is the natural cost centre, and the 122,000-CU figure quantifies the
price of trustless authorisation: verifying two counterparty signatures on-chain
and proving that verification through sysvar introspection. This remains a single
transaction well within the per-transaction budget, but it explains why batch
settlement processes one match per transaction — the Ed25519 signature data for
each match cannot be compressed through an address-lookup table — so batching
amortises account-setup overhead rather than signature cost. Reducing this figure,
for example through succinct proof aggregation over many matches, is the clearest
avenue for further compute savings.

The principal limitation of this evaluation is topological. Because all on-chain
measurements are taken on a single self-producing validator, they faithfully
characterise SVM semantics — account locking, compute metering, and per-instruction
cost — but say nothing about consensus throughput, fork choice, or leader
rotation, which would require a multi-validator permissioned deployment (§8.3).
Establishing sustained end-to-end throughput on such a deployment, and locating the
true saturation point above concurrency 40, are left to future work.

= 10. Reading Map

#table(
  columns: 2,
  align: (left, left),
  table.header([*Question*], [*Read*]),
  [What are the programs / IDs / invariants?], [#link("ARCHITECTURE.md")[`ARCHITECTURE.md`]],
  [Zero-copy layout, sharding, CU profiling detail], [`SKILL.md` (versions/IDs stale — trust `Anchor.toml`)],
  [Benchmark methodology + results], [#link("BENCHMARKS.md")[`BENCHMARKS.md`]],
  [Settlement math / clearing], [`programs/trading/src/instructions/settle_offchain.rs`],
  [Platform-wide rules (Chain Bridge, gateways)], [superproject `../CLAUDE.md`, `../ARCHITECTURE.md`],
)

#line(length: 100%, stroke: 0.5pt)

= 11. Formal Model: Settlement & Economic Equations

All on-chain money math uses integer `checked_mul` with `u128` intermediates —
overflow *rejects* the transaction, never clamps. $floor(dot)$ denotes the
integer floor division the SBF program performs.

== 11.1 Notation

#table(
  columns: (auto, auto, auto),
  align: (left, left, left),
  table.header([*Symbol*], [*Meaning*], [*Scale*]),
  [$q$],        [matched energy quantity (`match_amount`)], [9-dec, $1 "kWh" = 10^9$],
  [$p$],        [clearing price (`match_price`)],           [6-dec THBG/kWh],
  [$V$],        [trade gross value],                        [6-dec THBG],
  [$phi_m$],    [market fee (`market_fee_bps`)],            [bps],
  [$w$],        [wheeling rate (`wheeling_rate_per_kwh`)],  [6-dec THBG/kWh],
  [$ell$],      [loss rate (`loss_bps`)],                   [bps],
  [$r$],        [peg rate (`grx_per_thbg_rate`)],           [THBG-minor / whole GRX],
  [$phi_s$],    [swap fee (`swap_fee_bps`)],                [bps],
  [$A$],        [staking accumulator (`acc_reward_per_share`)], [$times 10^12$],
  [$T$],        [total staked GRX (`total_staked`)],        [atoms],
)

== 11.2 Trade settlement

Gross value — rescale the $10^15$-scaled product (9-dec energy $times$ 6-dec
price) back to 6-dec currency by the energy divisor $D_E = 10^9$
(`settle_offchain.rs:1145`):

$ V = floor(frac(q dot p, 10^9)) $ <eq-value>

Market fee (`settle_offchain.rs:788`):

$ F_m = floor(frac(V dot phi_m, 10^4)) $ <eq-fee>

Wheeling — flat per-kWh, *not* ad-valorem; same energy rescale as @eq-value
(`settle_offchain.rs:1160`):

$ C_w = floor(frac(q dot w, 10^9)) $ <eq-wheel>

Line loss (`settle_offchain.rs:1189`):

$ C_ell = floor(frac(V dot ell, 10^4)) $ <eq-loss>

Network charge and its cap invariant, $Theta = 2000$ bps (20%);
`ChargesExceedCap` if violated (`settle_offchain.rs:116`):

$ C_"net" = C_w + C_ell, quad C_"net" <= floor(frac(V dot Theta, 10^4)) $ <eq-cap>

Seller net proceeds, with feasibility $F_m + C_"net" <= V$ enforced
(`ChargesExceedValue`, `settle_offchain.rs:123`):

$ N_"seller" = V - F_m - C_"net" $ <eq-net>

== 11.3 Treasury peg (GRX $arrow.l.r$ THBG)

Swap GRX $arrow.r$ THBG, divisor $D_G = 10^9$ atoms/whole-GRX
(`treasury/src/lib.rs:58`):

$ G = floor(frac(g_"in" dot r, 10^9)), quad
  F = floor(frac(G dot phi_s, 10^4)), quad
  n = G - F $ <eq-swap>

Peg invariants — reserve attestation freshness and full backing
(`PegBreach`, `treasury/src/lib.rs:70`):

$ t_"now" - t_"att" <= tau_"ttl", quad S_"thbg" + n <= R_"att" $ <eq-peg>

Redeem THBG $arrow.r$ GRX with collateral guards $a_"in" <= S_"thbg"$
(`SupplyUnderflow`) and $g_"out" <= V_"swap"$ (`InsufficientVault`)
(`treasury/src/lib.rs:91`):

$ g_"out" = floor(frac(a_"in" dot 10^9, r)) $ <eq-redeem>

== 11.4 MasterChef staking (GRX yield)

Accumulator update on `fund_rewards`, precision $Pi = 10^12$, requires $T > 0$
(`treasury/src/lib.rs:975`):

$ A <- A + floor(frac(a dot 10^12, T)) $ <eq-acc>

Pending reward and debt baseline for a position of size $s$; $Pi$ absorbs the
division loss (exactness unit-tested, `lib.rs:126`):

$ rho = max(0, floor(frac(s dot A, 10^12)) - d), quad
  d = floor(frac(s dot A, 10^12)) $ <eq-reward>

== 11.5 Oracle validation (15-min epoch)

Anomaly gate — integer cross-multiplication avoids float division, $kappa$ =
`max_production_consumption_ratio` (`oracle/src/lib.rs:462`):

$ E_"prod" dot 100 <= kappa dot E_"cons" $ <eq-anomaly>

Reading quality score (`oracle/src/lib.rs:370`):

$ Q = min(100, floor(frac(100 dot n_"valid", n_"valid" + n_"reject"))) $ <eq-quality>

Range admission: $E_"min" <= E <= E_"max"$.

== 11.6 Registry sharding & slashing

Deterministic shard from the first byte of the authority key $k$
(`registry/src/lib.rs:71`):

$ sigma(k) = k[0] mod 16 $ <eq-shard>

Validator-active predicate, $beta_"min" = 10^13$ atoms $= 10{,}000$ GRX
(`registry/src/lib.rs:35`):

$ "active" <==> s_"grx" >= beta_"min" $ <eq-active>

== 11.7 Parameters (data)

#table(
  columns: (auto, auto, auto),
  align: (left, right, left),
  table.header([*Parameter*], [*Value*], [*Meaning*]),
  [$D_E$, $D_G$], [$10^9$],       [energy / GRX atomic divisor],
  [$Pi$],         [$10^12$],      [staking accumulator precision],
  [$Theta$],      [$2000$ bps],   [max network-charge cap (20%)],
  [$beta_"min"$], [$10^13$ atoms],[min validator stake (10k GRX)],
  [shards],       [$16$],         [registry counter shards],
  [epoch],        [$900$ s],      [oracle market-clearing window],
  [GRID/GRX dec], [$9$],          [$1 "kWh" = 10^9$ atoms],
  [THBG dec],     [$6$],          [$1 "THB" = 10^6$ minor],
  [REC dec],      [$6$],          [$1$ token $= 1 "MWh"$],
)
