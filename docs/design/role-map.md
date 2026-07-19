# Corrected Role Map — GridTokenX Authority Scheme

> **⚠️ STATUS: PROPOSED (design correction, 2026-06-21; consensus-node/REC-issuer split
> revised 2026-07-04; all 10 §2 fix-list rows implemented or resolved-as-structural
> 2026-07-04).** Still "proposed" in the sense that EGAT/MEA/PEA/ERC aren't real
> integration partners yet (local/dev keys stand in for them) — the on-chain code side
> of every binding below now matches the target mapping. This document re-maps the
> on-chain authority scheme onto
> Thailand's real energy-sector institutions. It is a *target* design: several bindings
> below differ from current code and are tagged with the exact `path:line` that must
> change. The companion descriptive doc [`node-validator.md`](./node-validator.md) and the
> network model [`../proposed/blockchain-node-network.md`](../proposed/blockchain-node-network.md)
> describe the system as built; this doc states where that scheme is institutionally
> mis-mapped and what the corrected mapping is. For the real-world market backing this
> mapping (PDP2026, ESB structure, EGAT/MEA/PEA/ERC's actual current roles), see
> [`thailand-market-context.md`](./thailand-market-context.md).

**Principle:** separate **regulator** (ERC) from **operators** (EGAT/MEA/PEA) from
**economic actors** (aggregators, prosumers). On-chain authority follows statutory role,
not infrastructure ownership.

**Market-segment split (2026-07-04 revision):** the consensus/validator set is split by
market segment, not treated as one undifferentiated pool — **EGAT validates the wholesale
market** (bulk generation/transmission-level settlement, matching its Single-Buyer role) and
runs the **wholesale generation auction** for bulk sellers clearing at that level, while
**MEA/PEA validate the retail market** (metro/provincial distribution-level settlement,
matching their territory) and hold **both** tariff-signer roles for retail P2P trades —
this platform's trades move energy only across the local distribution grid, never the
national transmission grid, so both wheeling (network usage) and loss (line-loss cost) are
MEA/PEA-signed. **ERC moves off consensus entirely** and becomes the **REC token issuer**
(1 REC token = 1 MWh) — separating "who validates trades" from "who certifies the
renewable attribute," on top of its existing regulator/governance role.

> **Revised 2026-07-04 (2nd pass):** wheeling was originally mapped to EGAT (transmission
> monopoly) on the generic utility-industry convention that the transmission owner charges
> wheeling. That doesn't hold for *this* platform: P2P trades here settle prosumer↔consumer
> within one distribution territory (MEA or PEA), never crossing onto EGAT's national
> transmission grid — so the wheeling fee this platform actually charges is a distribution
> network-usage fee, MEA/PEA's domain, same as loss. EGAT's on-chain role is the wholesale
> generation auction (bulk sellers, a separate, not-yet-built market segment) — it has no
> tariff-signer role in the retail trading flow at all.

---

## 1. Institutions → on-chain roles

| Real institution | Statutory role | On-chain role | Program / field |
|---|---|---|---|
| **ERC / กกพ** (Energy Regulatory Commission) | Independent regulator: licenses, tariffs, REC oversight, enforcement | **Governance authority** (admit/revoke/slash aggregators, set params, maintenance mode) **+ REC token issuer** — mints/co-signs the fungible REC (1 token = 1 MWh); NOT a consensus node | `governance::GovernanceConfig.authority`; `governance` `rec_mint` / `issue_erc` |
| **EGAT / กฟผ** | Transmission monopoly, Single Buyer | **Wholesale-market validator** (consensus node, bulk generation/transmission-level settlement) + **wholesale generation-auction operator** (bulk sellers clear here — separate, not-yet-built segment; no tariff-signer role in retail trading) | Solana cluster (wholesale segment); no `trading` tariff field |
| **MEA / กฟน**, **PEA / กฟภ** | Distribution utilities (metro / provinces) | **Retail-market validators** (consensus nodes, metro/provincial distribution-level settlement) + **per-territory aggregator admission & collateral custody** + distribution **wheeling and loss**-tariff signer (retail trades never leave the local distribution grid) | Solana cluster (retail segment); delegated `admit_aggregator`; `trading` wheeling + loss cost |
| **Licensed aggregator** (private, per zone) | Off-chain market-clearing operator | **Bonded validator** — staked, slashable; must be admitted *and* bonded | `registry::register_validator`/`stake_grx` ↔ `governance::AdmittedAggregator` |
| **Prosumer / consumer** | Market participant | **Client** — no stake; swap/redeem only | `treasury` swap/redeem; `trading` orders |
| **Independent reserve custodian / auditor** (bank under BoT alignment) | THBC fiat-reserve attestation | **Attestor** — distinct from param admin | `treasury::update_attestation` |
| **Regulator / consumer-rebate pool** | Penalty beneficiary | **Slash destination** | `registry::slash_destination` |

> **Open question carried over from the 2026-07-04 revision:** the consensus set is now
> segment-partitioned (EGAT=wholesale, MEA/PEA=retail) rather than one flat n≥4 set. Whether
> wholesale and retail need independent finality/Tower-BFT thresholds, or settle on a single
> shared cluster with segment-tagged transactions, is unresolved — see §5.

---

## 2. Corrected on-chain authority bindings (vs current code)

| On-chain role        | Corrected holder                                                  | Current code |
| -------------------- | ----------------------------------------------------------------- | ------------ |
| Governance authority | **ERC council, k-of-n multisig** (ERC chair + EGAT + MEA + PEA)    | field is a single `Pubkey`, but the `Signer<'info>` check (`contexts.rs`) doesn't distinguish a keypair from a PDA signing via `invoke_signed` — no code change needed, only pointing `authority` at a real external multisig vault (Squads etc.) via the on-chain 2-step transfer (`transfer_authority` → `approve_authority_change`; the former driver script was removed) |
| REC issuer gate      | **ERC** key (REC token issuer, 1 token = 1 MWh), **mandatory**    | opt-in `if rec_validators_count > 0` ([`energy-token/src/lib.rs:129`](../../programs/energy-token/src/lib.rs)) |
| Aggregator admission | **ERC** (or MEA/PEA delegated per territory)                      | linked to the bond — `register_validator` raw-validates an active `governance::AggregatorEntry` for the caller (`db1caa8`; [`registry/src/lib.rs:792-844`](../../programs/registry/src/lib.rs)) |
| Validator bond       | **admitted aggregator only**                                      | any 10k GRX holder self-promotes ([`registry/src/lib.rs:743`](../../programs/registry/src/lib.rs)) |
| Slashability         | **Active-at-misbehavior, independent of current stake**           | escapable via unstake→Suspended ([`registry/src/lib.rs:803`](../../programs/registry/src/lib.rs) vs [`:1208`](../../programs/registry/src/lib.rs)) |
| Consensus set        | **segment-split**: EGAT = wholesale validator, MEA+PEA = retail validators; ERC not a consensus node | resolved as an **application-layer** split (see §5): `ZoneMarket.segment` (0=Retail,1=Wholesale) + `AggregatorEntry.segment` gate which operators may settle in which zones. Actual Solana Tower BFT consensus stays one shared cluster — this program layer cannot split *that* (infra decision, out of scope) |
| Wheeling / loss      | **signed tariff, both MEA-PEA** (distribution — retail trades never reach EGAT's transmission grid), **capped vs trade value** | on-chain `TariffConfig` — `wheeling_bps` settable only by `wheeling_authority` (MEA/PEA), `loss_bps` only by `loss_authority` (MEA/PEA); computed at settle time, no longer a caller-supplied arg ([`state/tariff_config.rs`](../../programs/trading/src/state/tariff_config.rs), [`instructions/tariff.rs`](../../programs/trading/src/instructions/tariff.rs)) |
| Settlement gating    | **governance-gated + operator-signed**                            | `payer` on `settle_offchain_match`/`batch_settle_offchain_match` must be a governance-admitted, active aggregator (`require_admitted_aggregator`, [`settle_offchain.rs`](../../programs/trading/src/instructions/settle_offchain.rs)); `execute_atomic_settlement` (custodial trading-service path) intentionally out of scope — its `market_authority` signer already ties to `market.authority` |
| Reserve attestation  | **independent custodian** key                                     | arbitrary admin scalar ([`treasury/src/lib.rs:447`](../../programs/treasury/src/lib.rs)) |
| Slash destination    | **regulator / consumer-rebate pool**                              | treasury `rebate_vault` — a dedicated 4th GRX vault, separate from `reward_vault`/yield-stakers ([`treasury/src/lib.rs`](../../programs/treasury/src/lib.rs) `initialize_rebate_vault`) |

**Fix (per row):**
1. **Governance authority** — replace the single key with k-of-n (Squads / SPL-governance or native multisig set). *(done — structurally, not by new code: `Signer<'info>` accepts a PDA-via-CPI identically to a keypair, same pattern this repo already uses for `market_authority`. Call the on-chain `transfer_authority(<multisig-vault>)` once a real k-of-n multisig is deployed (the former driver script was removed); the second step (`approve_authority_change`) is executed by that multisig's own proposal-execution flow, not this repo.)*
2. **REC issuer gate** — make co-sign mandatory; bind issuer = **ERC** (revised 2026-07-04; was EGAT). *(done — 0.5)*
3. **Aggregator admission** — link to the validator bond (row 4). *(done — `db1caa8`)*
4. **Validator bond** — `register_validator` must verify an active admitted-aggregator entry (CPI / seed check to governance). *(done — 0.1)*
5. **Slashability** — block unstake-below-MIN while Active, or keep slashable regardless of status. *(done — 0.2 + deregister)*
6. **Consensus set** — split into wholesale (EGAT) / retail (MEA+PEA) segments per §1. *(done, application-layer — §5's "shared cluster + segment tag" branch: `ZoneMarket.segment` + `AggregatorEntry.segment`, gated in `require_admitted_aggregator`, `settle_offchain.rs`. §5's other branch — independently-finalized Tower BFT clusters — is genuinely out of this repo's scope: Solana consensus membership is pure cluster/genesis config, no Anchor program touches it.)*
7. **Wheeling / loss** — require a tariff-authority signer; bound charge ≤ trade value. Both rates MEA/PEA-signed (retail P2P trades stay on the distribution grid; wheeling was reassigned from EGAT to MEA/PEA on 2nd-pass revision, 2026-07-04). *(done — 0.4 cap + 0.4b on-chain `TariffConfig`, key-gated not live-signed — see §2 rationale)*
8. **Settlement gating** — add `governance_config` + `is_operational()`; require admitted-aggregator signer. *(done — 0.3 gate; 0.4b operator gate on the off-chain-signed settle paths; `execute_atomic_settlement` scoped out, see §2 rationale)*
9. **Reserve attestation** — separate `attestor` from param admin (already in code); ideally add on-chain proof.
10. **Slash destination** — repoint to an ERC / consumer-rebate pool. *(done — new `treasury::rebate_vault`, `init-treasury.ts` wires `registry::set_slash_destination` to it)*

---

## 3. The three separations that fix the mismatches

1. **Regulator ≠ operator** — ERC holds governance authority **and** REC issuance, but not
   consensus; EGAT/MEA/PEA hold consensus (wholesale/retail split), and MEA/PEA additionally
   hold both retail tariff-signer roles (wheeling + loss — EGAT's role is the separate
   wholesale generation auction, no tariff signing), but neither holds
   admit/slash/param/REC issuance. (fixes: regulator absent; EGAT Single-Buyer conflict)
2. **Authority = council, not key** — k-of-n multisig among the named bodies, matching the
   network doc's "k-of-n authority finality." (structurally already possible — the field
   stores a `Pubkey` checked only via `Signer<'info>`, which is satisfied identically by a
   keypair or a multisig vault PDA signing via CPI; see §2 row 1)
3. **Admission ⇒ bond, bond ⇒ admission** — `register_validator` and `admit_aggregator`
   mutually reference; penalty flows to the harmed side, not speculators. (fixes:
   self-granted bond; mis-routed slash)
   - plus the enforcement legs: build the challenge/fraud-proof layer, close the
     slash-escape, raise the consensus node count.

---

## 4. Authority delegation graph (target)

```
ERC (กกพ) ── governance authority (k-of-n council) ───────────────┐
  │  admit/revoke/slash/params                                    │
  ├── REC token issuer (1 token = 1 MWh) ─▶ energy-token mint co-sign
  ├── delegates per-territory admission ─▶ MEA (metro) / PEA (prov)│
  ▼                                                                ▼
EGAT (กฟผ) ── wholesale-market validator (consensus)        licensed aggregator
  └─ wholesale generation auction (bulk sellers,             (admitted + bonded,
     separate segment, not yet built)                        slashable, off-chain node)
MEA (กฟน) / PEA (กฟภ) ── retail-market validators (consensus)     │
  ├─ distribution wheeling tariff (signed) ─▶ trading             │
  └─ distribution loss tariff (signed) ─▶ trading                 │
                                                                   │
prosumer/consumer ── clients (no stake) ── swap/redeem ── orders ──┘
```

---

## 5. Open calls (decide before implementation)

- **Does ERC run a key, or delegate?** ERC may delegate day-to-day admission to a
  secretariat or to EGAT-as-registrar while retaining a slash/param **veto**. If so, model
  ERC = slash/param veto, secretariat = day-to-day admit.
- **THBC issuer** — modelled here as "licensed bank / BoT-aligned custodian." Bind to a
  named partner once chosen.
- **Consensus k, n** — fixed at deployment per the network doc; this map only asserts
  n ≥ 4 for liveness.
- **Wholesale/retail segmentation mechanics** (resolved 2026-07-04) — **decided: one shared
  cluster, segment-tagged.** The "two independently-finalized Tower BFT clusters" branch
  isn't actually a choice available to this repo: Solana consensus membership (who runs
  `solana-validator`, vote thresholds) is pure cluster/genesis config that no Anchor
  program can create or split — running two real clusters would be a separate
  infrastructure decision, not a code change here. What's implemented instead:
  `ZoneMarket.segment: u8` (0=Retail,1=Wholesale, `trading/src/state/zone_market.rs`) tags
  each zone, and `AggregatorEntry.segment` (`governance/src/state/aggregator.rs`) tags each
  admitted aggregator; `require_admitted_aggregator` in `settle_offchain.rs` requires a
  Wholesale zone's settlement payer be Wholesale-admitted, while Retail zones (the
  default) accept any admitted aggregator unchanged — additive and backward compatible
  with every already-admitted entry.

---

*Design correction reference. Bindings tagged with `path:line` are the concrete code deltas
to realign the implementation with Thailand's regulator/operator separation. See
[`node-validator.md`](./node-validator.md) (as-built node spec) and
[`../proposed/blockchain-node-network.md`](../proposed/blockchain-node-network.md)
(network/consensus model).*
</content>
</invoke>
