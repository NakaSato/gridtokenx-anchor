# GridTokenX — DAO Governance & PoA Authority Design

> **✅ STATUS: IMPLEMENTED.** Design/architecture narrative for the `governance` program's DAO and Proof-of-Authority (PoA) layers (`handlers/dao.rs`, `authority.rs`, `config.rs`, `stats.rs`). Authoritative path:line reference: `docs/programs/governance.md`. Verified against code (Anchor 1.0).

Governance has two distinct layers: a **PoA authority** that holds admin power over the system (held by the utilities), and a **generation-weighted DAO** that lets meter owners adjust per-zone economic parameters by proposal and vote. They are separate mechanisms with separate trust models. Six sections.

---

## 1. Two Governance Layers

- **PoA authority** — a single `authority` pubkey (intended to be a multisig at deployment) that controls issuance policy, ERC limits, maintenance mode, oracle config, and authority succession. It is admin, not democratic.
- **DAO** — meter owners create proposals to change *zone-scoped* parameters and vote with weight derived from their lifetime energy generation. It is bounded: it can only move a fixed set of zone parameters, never the PoA authority's powers.

This mirrors the platform's institutional-trust model: utilities hold admin authority; participants get bounded, parameter-level voice over their own zone.

---

## 2. DAO Proposal Lifecycle

`governance/handlers/dao.rs`:

| Handler | Purpose |
|---|---|
| `create_proposal(target_zone, proposal_id, parameter, new_value, voting_period_seconds)` | Create a zone proposal; proposer must own a registered meter; sets `expires_at = now + voting_period_seconds`. |
| `cast_vote(choice: bool)` | Cast a weighted For/Against vote; one vote per `(proposal, voter)`. |
| `execute_proposal()` | After expiry: finalize, check quorum, apply the change to `ZoneConfig` if passed. |
| `initialize_zone_config(zone_id, incentive_multiplier, wheeling_charge)` | Seed a zone's governable config. |

Flow: **create** (status Active) → **vote** until `expires_at` → **execute** after expiry. Execution checks quorum (`total_votes ≥ poa_config.min_quorum_votes`), passes on simple majority (`votes_for > votes_against`), and on pass writes the new value into `ZoneConfig`. Governable parameters: `IncentiveMultiplier`, `WheelingCharge`, `LossFactor` (must be > 0), `MaintenanceMode`.

---

## 3. Voting Mechanics (generation-weighted)

- **Eligibility**: any account owning a meter registered in the registry program (`meter_account.owner` must equal the signer; `MeterOwnerMismatch`).
- **Weight**: `max(100, meter.total_generation / 1_000)` — every 1,000 kWh of lifetime generation adds 1 weight, with a floor of 100 (`dao.rs:87-105`). This is **generation-stake-weighted, not token-weighted** — voice scales with how much energy you've actually produced.
- **One vote per voter**: enforced by `VoteRecord` PDA uniqueness, seeds `[b"vote", proposal, voter]`; weight is snapshotted at vote time.
- **Quorum/threshold**: global `min_quorum_votes` on `GovernanceConfig`; simple majority decides.
- **Period**: per-proposal `expires_at`; no votes after expiry, no execution before it (`ProposalExpired`/`ProposalNotExpired`).

---

## 4. State Accounts

| Account | Seeds | Key fields |
|---|---|---|
| `Proposal` (89 B) | `[b"proposal", target_zone, proposal_id]` | proposer, target_zone, parameter, new_value, votes_for/against, status (Active/Passed/Rejected/Executed/Cancelled), expires_at |
| `VoteRecord` (90 B) | `[b"vote", proposal, voter]` | proposal, voter, choice, weight, voted_at |
| `ZoneConfig` (46 B) | `[b"zone_config", zone_id]` | zone_id, incentive_multiplier, wheeling_charge, loss_factor, maintenance_mode, last_updated |
| `GovernanceConfig` (singleton) | `[b"poa_config"]` | authority, pending_authority, min_quorum_votes, ERC policy + stats |

The voter's `MeterAccount` is a registry zero-copy account; the DAO reads it via manual `bytemuck` deserialization to avoid the zero-copy loader overhead across the program boundary (`dao.rs:31,95`).

---

## 5. PoA Authority & 2-Step Transfer

Authority succession is a guarded two-step handshake (`handlers/authority.rs`):

1. `propose_authority_change(new_authority)` — current authority nominates a successor; blocked if a change is already pending (`AuthorityChangePending`) or if proposing self. Sets `pending_authority` + a **48-hour** expiry (`AUTHORITY_CHANGE_EXPIRATION`).
2. `approve_authority_change()` — the **proposed** authority must sign (`InvalidPendingAuthority`); rejected if expired (`AuthorityChangeExpired`); atomically clears pending and swaps `authority`.
3. `cancel_authority_change()` — current authority aborts a pending transfer.

`set_oracle_authority(oracle_authority, min_confidence, require_validation)` configures oracle gating. Events: `AuthorityChangeProposed/Approved/Cancelled`.

The two-step + expiry pattern prevents a fat-finger transfer to an unusable key: the successor must actively accept within the window, or it lapses.

---

## 6. Config, Stats & Invariants

- **`config.rs`**: `update_governance_config` (toggle ERC validation / transfers), `set_maintenance_mode`, `update_erc_limits` (min>0, max>min, period ≤ 2 years), `update_authority_info` (contact ≤128 B).
- **`stats.rs`**: `get_governance_stats` returns the full `GovernanceStats` view (ERC counts, energy certified, authority/pending state, quorum, oracle config).
- **Invariants**: vote aggregation uses `checked_add` (`MathOverflow`); proposal expiry uses checked `i64` add; `VoteRecord` PDA uniqueness is the double-vote guard; DAO can only mutate the four whitelisted `ZoneConfig` parameters — never PoA powers.

DAO errors: `InvalidProposalStatus`, `ProposalExpired`, `ProposalNotExpired`, `InvalidTargetZone`, `InvalidParameterType`, `MeterOwnerMismatch`, `MathOverflow`.

---

*Design narrative for the implemented DAO + PoA governance. Authoritative path:line reference: `docs/programs/governance.md`. Verified against code (Anchor 1.0).*
