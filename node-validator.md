# Design: Aggregator Validator Node

### Permissioned Off-Chain Aggregation & Settlement-Bridge Node for the GridTokenX P2P Energy Platform

*Node specification — coordinates the existing Solana/Anchor on-chain programs*

> An **aggregator-only validator node** is a permissioned off-chain service that ingests
> signed AMI meter readings, aggregates them per 15-minute settlement window, computes net
> generation, and bridges the result on-chain by triggering `mint_generation` **exactly
> once** per meter-and-window. It does **not** participate in Solana consensus — "validator"
> here means a staked, slashable aggregation authority, not a block producer.

---

## Contents

1. [What This Node Is (and Is Not)](#1-what-this-node-is-and-is-not)
2. [Role in the System](#2-role-in-the-system)
3. [The Aggregation Pipeline](#3-the-aggregation-pipeline)
4. [Exactly-Once Minting Bridge](#4-exactly-once-minting-bridge)
5. [Epoch / Settlement-Window Model](#5-epoch--settlement-window-model)
6. [Permissioning, Staking & Identity](#6-permissioning-staking--identity)
7. [Slashing & Accountability](#7-slashing--accountability)
8. [Node State & Configuration](#8-node-state--configuration)
9. [Equations](#9-equations)
10. [Failure Modes & Recovery](#10-failure-modes--recovery)
11. [Interfaces to On-Chain Programs](#11-interfaces-to-on-chain-programs)
12. [Open Items Before Deployment](#12-open-items-before-deployment)

---

## 1. What This Node Is (and Is Not)

| | |
|---|---|
| **Is** | A permissioned off-chain worker that aggregates meter data and submits Solana transactions to the platform's own programs. |
| **Is** | A *staked, slashable* identity — it bonds ≥ 10,000 GRX via `register_validator` and can lose that bond for misbehaviour. |
| **Is not** | A Solana consensus / block-producing validator. It runs no leader schedule and votes on no blocks. |
| **Is not** | A trusted price-setter. Market clearing stays in the `trading` program; the node only feeds verified quantities. |

The word "validator" in this platform is overloaded. This document uses **aggregator node** for the off-chain service and reserves "validator" for the *registered, staked role* it occupies in the `registry`/`governance` programs.

---

## 2. Role in the System

The on-chain programs are deliberately passive: they verify and record, but they do not pull data. Something must (a) collect signed readings from thousands of meters, (b) reduce them to a net figure per participant per window, and (c) submit that to chain in a way that can never double-count. That is this node's entire job.

```
meters → [aggregator node] → oracle.aggregate_readings
                          → energy-token.mint_generation   (exactly once)
                          → trading.trigger_market_clearing (per window)
```

A single platform may run **several** aggregator nodes for liveness and decentralisation. Each is independently staked and permissioned; the exactly-once guard (§4) makes concurrent operation safe — at most one mint per meter-window survives even if two nodes race.

---

## 3. The Aggregation Pipeline

The node processes each 15-minute window through four stages.

### Stage 1 — Ingest & verify
- Receive signed readings from AMI meters (or a regional concentrator).
- **Verify the meter signature** against the meter's registered public key (from the `registry` program).
- **Deduplicate** by `(meter_id, epoch)`; a meter may submit at most one reading per window.
- Reject readings whose timestamp falls outside the current window bounds.

### Stage 2 — Aggregate
- Group verified readings by zone/shard and call the equivalent of `aggregate_readings` and `aggregate_shards`.
- Maintain a per-meter running total of generation and consumption for the window.

### Stage 3 — Net settlement
- Compute net surplus generation `G_net` per meter (see §9).
- Subtract amounts already settled or already claimed via REC, mirroring the on-chain `mint_generation` idempotency fields so the node never *requests* a mint that the chain would reject.

### Stage 4 — Bridge to chain
- For each meter with `M > 0` mintable energy, submit `mint_generation` — guarded by the exactly-once logic in §4.
- Trigger `trigger_market_clearing` once per window after minting completes.

---

## 4. Exactly-Once Minting Bridge

This is the node's most safety-critical function. Minting must be **idempotent**: a meter that generated 5 kWh in window *W* must cause exactly 5 GRX to be minted — never 0 (lost generation), never 10 (double mint), even across node restarts, retries, and concurrent nodes.

The guarantee is **double-locked**:

| Layer | Mechanism | Protects against |
|-------|-----------|------------------|
| Off-chain | Redis `MINTED_SET` — a set keyed by `(meter_id, epoch)` checked before submit and written after confirmation | Local retries, crash-loops, duplicate work within one node |
| On-chain | `GenerationMintRecord` PDA seeded by `(meter, window)` — `mint_generation` is a no-op / error if the record already exists | Two different nodes racing; a forged off-chain state; the ultimate source of truth |

**Submit logic (per meter-window):**

```
key = (meter_id, epoch)
if MINTED_SET.contains(key):        # fast off-chain skip
    return AlreadyMinted
tx = build_mint_generation(meter_id, epoch, amount)
result = submit(tx)
if result == Confirmed or result == AlreadyExistsOnChain:
    MINTED_SET.add(key)             # converge to chain truth
    return Done
else:
    return Retry                    # key NOT added; safe to retry
```

The on-chain PDA is authoritative. The Redis set is only an optimisation that avoids hammering the chain with transactions that would be rejected anyway. If Redis is lost, correctness is preserved — the node simply re-derives the set from the chain (or pays for redundant rejected transactions until it does).

> **Invariant.** For any `(meter_id, epoch)`, total GRX minted across all nodes and all retries equals the meter's net generation for that window — exactly once.

---

## 5. Epoch / Settlement-Window Model

- Windows are **15 minutes** (900 seconds), aligned to wall-clock boundaries — matching the `oracle` program's `epoch % 900 == 0` check.
- The node maintains a state machine per window: `OPEN` (accepting readings) → `CLOSING` (cutoff reached, no new readings) → `AGGREGATING` → `MINTING` → `CLEARING` → `SETTLED`.
- A short **grace period** after cutoff tolerates late-arriving readings before `CLOSING` finalises; readings after grace are deferred to the next window or dropped per policy.
- `last_price_epoch`-style monotonicity: the node never reprocesses a `SETTLED` window. Re-runs are blocked by the same `(meter, epoch)` idempotency.

---

## 6. Permissioning, Staking & Identity

This is a **Proof-of-Authority** role, not open participation.

1. **Allow-list.** The `governance` program maintains the set of admitted aggregator public keys. Only an admitted key's transactions are honoured for aggregation/minting authority.
2. **Bond.** The node calls `register_validator`, locking **≥ 10,000 GRX** (`MIN` stake) as collateral via the `registry` program's `stake_grx`.
3. **Identity.** The node holds a keypair whose pubkey is both the allow-list entry and the staking account owner; every submitted transaction is signed by it, binding actions to the bonded identity.
4. **Rewards.** Honest, live aggregation earns staking rewards (and any aggregator fee the platform defines); these accrue to the staked account.

Admission and removal are governance actions — a node cannot self-admit, and a misbehaving node can be removed by the same authority that admitted it.

---

## 7. Slashing & Accountability

Because the node is staked, misbehaviour has a direct economic cost. Recommended slashable conditions:

| Condition | Detection | Severity |
|-----------|-----------|----------|
| **Double-mint attempt** | A submitted `mint_generation` for an already-recorded `(meter, window)` that is not a benign retry | High |
| **Invalid aggregate** | Submitted net figures inconsistent with the signed readings (challengeable by another node) | High |
| **Equivocation** | Signing two conflicting aggregates for the same window | High |
| **Liveness failure** | Missing required submissions for *N* consecutive windows | Medium → forfeit rewards, then removal |
| **Stale data** | Minting against readings outside window bounds | Medium |

Slashing itself is executed on-chain by the **`unstake`/`slash` path** (the gap the existing `registry` program flagged as `// TODO: Add unstake_grx and slash_validator`, and which the companion `grx_treasury` staking module implements). Slashed bond is redistributed to honest stakers rather than burned.

> A **challenge window** is recommended: another aggregator (or any watcher) can submit proof that a settled aggregate was invalid, triggering the slash. This makes a multi-node deployment self-policing.

---

## 8. Node State & Configuration

### 8.1 Persistent state (Redis / local store)

| Key | Purpose |
|-----|---------|
| `MINTED_SET` | Set of `(meter_id, epoch)` already minted (off-chain fast guard) |
| `readings:{epoch}` | Cache of verified readings for the in-progress window |
| `window_state:{epoch}` | Current state-machine position |
| `cursor` | Last fully-settled epoch (resume point after restart) |

### 8.2 Configuration

| Param | Meaning | Example |
|-------|---------|---------|
| `window_seconds` | Settlement-window length | 900 |
| `grace_seconds` | Late-reading tolerance after cutoff | 30 |
| `min_stake` | Validator bond required | 10,000 GRX |
| `liveness_max_misses` | Consecutive misses before penalty | 3 |
| `rpc_endpoints` | Solana RPC (with failover) | — |
| `node_keypair` | Staked signing identity | — |
| `redis_url` | State store | — |

---

## 9. Equations

**Per-meter net generation for a window:**

$$G_{\text{net}} = \max\!\left(0,\; \text{total\_generation} - \text{total\_consumption}\right)$$

**Mintable amount (mirrors on-chain idempotency):**

$$M = \max\!\left(0,\; G_{\text{net}} - \text{settled\_net\_generation} - \text{claimed\_erc\_generation}\right)$$

$$\text{GRX}_{\text{minted}} = M \times \eta, \qquad \eta = 1 \;\;(\text{1 kWh} = \text{1 GRX})$$

**Window boundary (alignment check):**

$$\text{epoch} \bmod 900 = 0$$

**Exactly-once guarantee (across all nodes } k \text{ and retries } r\text{):**

$$\sum_{k}\sum_{r} \text{mint}_{k,r}(\text{meter}, \text{epoch}) = M(\text{meter}, \text{epoch})$$

**Liveness penalty trigger:**

$$\text{consecutive\_misses} \geq \text{liveness\_max\_misses} \;\Rightarrow\; \text{forfeit rewards / remove}$$

---

## 10. Failure Modes & Recovery

| Failure | Behaviour | Recovery |
|---------|-----------|----------|
| Node crash mid-window | In-flight mints either confirmed on-chain or not; PDA is truth | On restart, resume from `cursor`; re-derive `MINTED_SET` from chain if needed |
| Redis lost | Correctness preserved (on-chain PDA still guards) | Rebuild set from `GenerationMintRecord` PDAs; redundant rejected txns until rebuilt |
| RPC outage | Cannot submit | Failover endpoints; windows queue and process when RPC returns (idempotency makes catch-up safe) |
| Two nodes race same meter | First mint wins; second hits existing PDA → no-op | No double-mint; loser simply records the key |
| Late meter reading | Arrives after grace | Deferred to next window or dropped per policy |
| Meter signature invalid | Reading rejected at Stage 1 | Logged; not aggregated; alert if persistent (possible tampering) |

---

## 11. Interfaces to On-Chain Programs

| Program | Instruction(s) the node calls | Direction |
|---------|------------------------------|-----------|
| `oracle` | `aggregate_readings`, `trigger_market_clearing` | node → chain |
| `energy-token` | `mint_generation` (idempotent via `GenerationMintRecord`) | node → chain |
| `registry` | `register_validator`, `stake_grx`; reads meter pubkeys | node ↔ chain |
| `governance` | reads aggregator allow-list (PoA) | chain → node |
| `trading` | `trigger_market_clearing` after mint | node → chain |
| `grx_treasury` | `slash` (executed by authority on challenge); rewards accrue | chain |

The node submits transactions but holds **no special on-chain privilege beyond its allow-listed, staked identity** — every safety property is enforced by the programs, not assumed of the node.

---

## 12. Open Items Before Deployment

1. **Aggregate-validity proof format.** Define exactly what a challenger submits to prove an invalid aggregate, so `slash` can verify it on-chain.
2. **Reward/fee policy.** Decide the aggregator's compensation (flat per-window fee, share of trading fees, or staking yield only).
3. **Concentrator topology.** Decide whether meters talk to the node directly or via regional concentrators, and where signature verification happens.
4. **Grace-period policy.** Finalise late-reading handling (defer vs drop) and document its settlement impact.
5. **Multi-node coordination.** Optional leader election per window to avoid redundant rejected transactions (purely an efficiency optimisation; correctness already holds without it).
6. **Key management.** HSM / secure storage for the staked node keypair; rotation procedure coordinated with the governance allow-list.
7. **Monitoring & alerting.** Liveness metrics, missed-window alerts, signature-failure anomaly detection.
8. **Backpressure.** Behaviour when reading volume exceeds processing capacity within a 15-minute window (sharding / horizontal scale).

---

*Design reference for the aggregator-only validator node. The node is an off-chain coordinator; all correctness and safety properties are enforced on-chain by the `oracle`, `energy-token`, `registry`, `governance`, and `grx_treasury` programs. Window length, stake minimum, and idempotency fields track the existing codebase (`epoch % 900`, 10,000 GRX `MIN`, `GenerationMintRecord` PDA, Redis `MINTED_SET`).*
