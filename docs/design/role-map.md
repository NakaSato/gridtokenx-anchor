# Corrected Role Map — GridTokenX Authority Scheme

> **⚠️ STATUS: PROPOSED (design correction, 2026-06-21).** This document re-maps the
> on-chain authority scheme onto Thailand's real energy-sector institutions. It is a
> *target* design: several bindings below differ from current code and are tagged with the
> exact `path:line` that must change. The companion descriptive doc
> [`node-validator.md`](./node-validator.md) and the network model
> [`../proposed/blockchain-node-network.md`](../proposed/blockchain-node-network.md)
> describe the system as built; this doc states where that scheme is institutionally
> mis-mapped and what the corrected mapping is.

**Principle:** separate **regulator** (ERC) from **operators** (EGAT/MEA/PEA) from
**economic actors** (aggregators, prosumers). On-chain authority follows statutory role,
not infrastructure ownership.

---

## 1. Institutions → on-chain roles

| Real institution | Statutory role | On-chain role | Program / field |
|---|---|---|---|
| **ERC / กกพ** (Energy Regulatory Commission) | Independent regulator: licenses, tariffs, REC oversight, enforcement | **Governance authority** — admit/revoke/slash aggregators, set params, maintenance mode | `governance::GovernanceConfig.authority` |
| **EGAT / กฟผ** | Transmission monopoly, Single Buyer, **T-REC registrar** | **REC issuer** (co-signs generation mint) + transmission **wheeling**-tariff signer + consensus node | `energy-token` `rec_validator`; `trading` wheeling charge; Solana cluster |
| **MEA / กฟน**, **PEA / กฟภ** | Distribution utilities (metro / provinces) | Consensus nodes + **per-territory aggregator admission & collateral custody** + distribution **loss**-tariff signer | Solana cluster; delegated `admit_aggregator`; `trading` loss cost |
| **Licensed aggregator** (private, per zone) | Off-chain market-clearing operator | **Bonded validator** — staked, slashable; must be admitted *and* bonded | `registry::register_validator`/`stake_grx` ↔ `governance::AdmittedAggregator` |
| **Prosumer / consumer** | Market participant | **Client** — no stake; swap/redeem only | `treasury` swap/redeem; `trading` orders |
| **Independent reserve custodian / auditor** (bank under BoT alignment) | THBG fiat-reserve attestation | **Attestor** — distinct from param admin | `treasury::update_attestation` |
| **Regulator / consumer-rebate pool** | Penalty beneficiary | **Slash destination** | `registry::slash_destination` |

---

## 2. Corrected on-chain authority bindings (vs current code)

| On-chain role        | Corrected holder                                                  | Current code |
| -------------------- | ----------------------------------------------------------------- | ------------ |
| Governance authority | **ERC council, k-of-n multisig** (ERC chair + EGAT + MEA + PEA)    | single `Pubkey`, 2-step single→single ([`poa_config.rs:7`](../../programs/governance/src/state/poa_config.rs)) |
| REC issuer gate      | **EGAT T-REC** key, **mandatory**                                 | opt-in `if rec_validators_count > 0` ([`energy-token/src/lib.rs:129`](../../programs/energy-token/src/lib.rs)) |
| Aggregator admission | **ERC** (or MEA/PEA delegated per territory)                      | `admit_aggregator` exists but **unlinked** to the bond |
| Validator bond       | **admitted aggregator only**                                      | any 10k GRX holder self-promotes ([`registry/src/lib.rs:743`](../../programs/registry/src/lib.rs)) |
| Slashability         | **Active-at-misbehavior, independent of current stake**           | escapable via unstake→Suspended ([`registry/src/lib.rs:803`](../../programs/registry/src/lib.rs) vs [`:1208`](../../programs/registry/src/lib.rs)) |
| Consensus set        | **EGAT+MEA+PEA (+ERC observer), n ≥ 4**                           | named n=3 → one node down can halt (Tower BFT ≥1/3) |
| Wheeling / loss      | **signed tariff** EGAT (transmission) / MEA-PEA (distribution), **capped vs trade value** | unbounded caller arg ([`settle_offchain.rs:334`](../../programs/trading/src/instructions/settle_offchain.rs)) |
| Settlement gating    | **governance-gated + operator-signed**                            | permissionless `payer`, no `is_operational` ([`settle_offchain.rs:219`](../../programs/trading/src/instructions/settle_offchain.rs), [`:100`](../../programs/trading/src/instructions/settle_offchain.rs)) |
| Reserve attestation  | **independent custodian** key                                     | arbitrary admin scalar ([`treasury/src/lib.rs:447`](../../programs/treasury/src/lib.rs)) |
| Slash destination    | **regulator / consumer-rebate pool**                              | treasury `reward_vault` → yield-stakers |

**Fix (per row):**
1. **Governance authority** — replace the single key with k-of-n (Squads / SPL-governance or native multisig set).
2. **REC issuer gate** — make co-sign mandatory; bind issuer = T-REC registrar. *(done — 0.5)*
3. **Aggregator admission** — link to the validator bond (row 4).
4. **Validator bond** — `register_validator` must verify an active admitted-aggregator entry (CPI / seed check to governance). *(done — 0.1)*
5. **Slashability** — block unstake-below-MIN while Active, or keep slashable regardless of status. *(done — 0.2 + deregister)*
6. **Consensus set** — raise n or run sub-nodes per utility; document k, n.
7. **Wheeling / loss** — require a tariff-authority signer; bound charge ≤ trade value. *(cap done — 0.4; signer pending — 0.4b)*
8. **Settlement gating** — add `governance_config` + `is_operational()`; require admitted-aggregator signer. *(gate done — 0.3; operator signer pending)*
9. **Reserve attestation** — separate `attestor` from param admin (already in code); ideally add on-chain proof.
10. **Slash destination** — repoint to an ERC / consumer-rebate pool (config — 1.2).

---

## 3. The three separations that fix the mismatches

1. **Regulator ≠ operator** — ERC holds governance authority; EGAT/MEA/PEA hold consensus
   + issuance + tariff, but **not** admit/slash/param. (fixes: regulator absent; EGAT
   Single-Buyer conflict)
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
  ├── delegates per-territory admission ─▶ MEA (metro) / PEA (prov)│
  ▼                                                                ▼
EGAT (กฟผ) ── T-REC issuer ─▶ energy-token mint co-sign     licensed aggregator
  └─ transmission wheeling tariff (signed) ─▶ trading        (admitted + bonded,
                                                              slashable, off-chain node)
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

---

*Design correction reference. Bindings tagged with `path:line` are the concrete code deltas
to realign the implementation with Thailand's regulator/operator separation. See
[`node-validator.md`](./node-validator.md) (as-built node spec) and
[`../proposed/blockchain-node-network.md`](../proposed/blockchain-node-network.md)
(network/consensus model).*
</content>
</invoke>
