# Corrected Role Map — GridTokenX Authority Scheme

> **⚠️ STATUS: PROPOSED (design correction, 2026-06-21; consensus-node/REC-issuer split
> revised 2026-07-04).** This document re-maps the on-chain authority scheme onto
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
market** (bulk generation/transmission-level settlement, matching its Single-Buyer role),
while **MEA/PEA validate the retail market** (metro/provincial distribution-level
settlement, matching their territory). **ERC moves off consensus entirely** and becomes
the **REC token issuer** (1 REC token = 1 MWh) — separating "who validates trades" from
"who certifies the renewable attribute," on top of its existing regulator/governance role.

---

## 1. Institutions → on-chain roles

| Real institution | Statutory role | On-chain role | Program / field |
|---|---|---|---|
| **ERC / กกพ** (Energy Regulatory Commission) | Independent regulator: licenses, tariffs, REC oversight, enforcement | **Governance authority** (admit/revoke/slash aggregators, set params, maintenance mode) **+ REC token issuer** — mints/co-signs the fungible REC (1 token = 1 MWh); NOT a consensus node | `governance::GovernanceConfig.authority`; `governance` `rec_mint` / `issue_erc` |
| **EGAT / กฟผ** | Transmission monopoly, Single Buyer | **Wholesale-market validator** (consensus node, bulk generation/transmission-level settlement) + transmission **wheeling**-tariff signer | Solana cluster (wholesale segment); `trading` wheeling charge |
| **MEA / กฟน**, **PEA / กฟภ** | Distribution utilities (metro / provinces) | **Retail-market validators** (consensus nodes, metro/provincial distribution-level settlement) + **per-territory aggregator admission & collateral custody** + distribution **loss**-tariff signer | Solana cluster (retail segment); delegated `admit_aggregator`; `trading` loss cost |
| **Licensed aggregator** (private, per zone) | Off-chain market-clearing operator | **Bonded validator** — staked, slashable; must be admitted *and* bonded | `registry::register_validator`/`stake_grx` ↔ `governance::AdmittedAggregator` |
| **Prosumer / consumer** | Market participant | **Client** — no stake; swap/redeem only | `treasury` swap/redeem; `trading` orders |
| **Independent reserve custodian / auditor** (bank under BoT alignment) | THBG fiat-reserve attestation | **Attestor** — distinct from param admin | `treasury::update_attestation` |
| **Regulator / consumer-rebate pool** | Penalty beneficiary | **Slash destination** | `registry::slash_destination` |

> **Open question carried over from the 2026-07-04 revision:** the consensus set is now
> segment-partitioned (EGAT=wholesale, MEA/PEA=retail) rather than one flat n≥4 set. Whether
> wholesale and retail need independent finality/Tower-BFT thresholds, or settle on a single
> shared cluster with segment-tagged transactions, is unresolved — see §5.

---

## 2. Corrected on-chain authority bindings (vs current code)

| On-chain role        | Corrected holder                                                  | Current code |
| -------------------- | ----------------------------------------------------------------- | ------------ |
| Governance authority | **ERC council, k-of-n multisig** (ERC chair + EGAT + MEA + PEA)    | single `Pubkey`, 2-step single→single ([`governance_config.rs:7`](../../programs/governance/src/state/governance_config.rs)) |
| REC issuer gate      | **ERC** key (REC token issuer, 1 token = 1 MWh), **mandatory**    | opt-in `if rec_validators_count > 0` ([`energy-token/src/lib.rs:129`](../../programs/energy-token/src/lib.rs)) |
| Aggregator admission | **ERC** (or MEA/PEA delegated per territory)                      | `admit_aggregator` exists but **unlinked** to the bond |
| Validator bond       | **admitted aggregator only**                                      | any 10k GRX holder self-promotes ([`registry/src/lib.rs:743`](../../programs/registry/src/lib.rs)) |
| Slashability         | **Active-at-misbehavior, independent of current stake**           | escapable via unstake→Suspended ([`registry/src/lib.rs:803`](../../programs/registry/src/lib.rs) vs [`:1208`](../../programs/registry/src/lib.rs)) |
| Consensus set        | **segment-split**: EGAT = wholesale validator, MEA+PEA = retail validators; ERC not a consensus node | named n=3 flat set → one node down can halt (Tower BFT ≥1/3); no wholesale/retail segmentation exists yet |
| Wheeling / loss      | **signed tariff** EGAT (transmission) / MEA-PEA (distribution), **capped vs trade value** | unbounded caller arg ([`settle_offchain.rs:334`](../../programs/trading/src/instructions/settle_offchain.rs)) |
| Settlement gating    | **governance-gated + operator-signed**                            | permissionless `payer`, no `is_operational` ([`settle_offchain.rs:219`](../../programs/trading/src/instructions/settle_offchain.rs), [`:100`](../../programs/trading/src/instructions/settle_offchain.rs)) |
| Reserve attestation  | **independent custodian** key                                     | arbitrary admin scalar ([`treasury/src/lib.rs:447`](../../programs/treasury/src/lib.rs)) |
| Slash destination    | **regulator / consumer-rebate pool**                              | treasury `reward_vault` → yield-stakers |

**Fix (per row):**
1. **Governance authority** — replace the single key with k-of-n (Squads / SPL-governance or native multisig set).
2. **REC issuer gate** — make co-sign mandatory; bind issuer = **ERC** (revised 2026-07-04; was EGAT). *(done — 0.5)*
3. **Aggregator admission** — link to the validator bond (row 4).
4. **Validator bond** — `register_validator` must verify an active admitted-aggregator entry (CPI / seed check to governance). *(done — 0.1)*
5. **Slashability** — block unstake-below-MIN while Active, or keep slashable regardless of status. *(done — 0.2 + deregister)*
6. **Consensus set** — split into wholesale (EGAT) / retail (MEA+PEA) segments per §1; document k, n per segment (see §5 open question on shared-vs-independent finality).
7. **Wheeling / loss** — require a tariff-authority signer; bound charge ≤ trade value. *(cap done — 0.4; signer pending — 0.4b)*
8. **Settlement gating** — add `governance_config` + `is_operational()`; require admitted-aggregator signer. *(gate done — 0.3; operator signer pending)*
9. **Reserve attestation** — separate `attestor` from param admin (already in code); ideally add on-chain proof.
10. **Slash destination** — repoint to an ERC / consumer-rebate pool (config — 1.2).

---

## 3. The three separations that fix the mismatches

1. **Regulator ≠ operator** — ERC holds governance authority **and** REC issuance, but not
   consensus; EGAT/MEA/PEA hold consensus (wholesale/retail split) + tariff signing, but
   **not** admit/slash/param/REC issuance. (fixes: regulator absent; EGAT Single-Buyer
   conflict)
2. **Authority = council, not key** — k-of-n multisig among the named bodies, matching the
   network doc's "k-of-n authority finality." (fixes: code authority is a single key)
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
  └─ transmission wheeling tariff (signed) ─▶ trading        (admitted + bonded,
                                                              slashable, off-chain node)
MEA (กฟน) / PEA (กฟภ) ── retail-market validators (consensus)     │
  └─ distribution loss tariff (signed) ─▶ trading                 │
                                                                   │
prosumer/consumer ── clients (no stake) ── swap/redeem ── orders ──┘
```

---

## 5. Open calls (decide before implementation)

- **Does ERC run a key, or delegate?** ERC may delegate day-to-day admission to a
  secretariat or to EGAT-as-registrar while retaining a slash/param **veto**. If so, model
  ERC = slash/param veto, secretariat = day-to-day admit.
- **THBG issuer** — modelled here as "licensed bank / BoT-aligned custodian." Bind to a
  named partner once chosen.
- **Consensus k, n** — fixed at deployment per the network doc; this map only asserts
  n ≥ 4 for liveness.
- **Wholesale/retail segmentation mechanics** (new, 2026-07-04) — is EGAT's wholesale set
  and MEA/PEA's retail set two independently-finalized clusters (separate Tower BFT
  thresholds, possibly separate `trading::Market`/`ZoneMarket` PDAs per segment), or one
  shared cluster where transactions are merely tagged by segment for routing/reporting?
  The former needs real cross-cluster settlement bridging (new work); the latter is
  closer to today's single-cluster code with an added segment field. Decide before
  touching `trading`/`oracle` zone-config code.

---

*Design correction reference. Bindings tagged with `path:line` are the concrete code deltas
to realign the implementation with Thailand's regulator/operator separation. See
[`node-validator.md`](./node-validator.md) (as-built node spec) and
[`../proposed/blockchain-node-network.md`](../proposed/blockchain-node-network.md)
(network/consensus model).*
</content>
</invoke>
