# Solana Block Anatomy + GridTokenX Programs

Solana has **no Bitcoin-style block header**. A "block" = the entries produced for one
**slot**, ordered by **Proof of History (PoH)**. The closest thing to a "header" at the
account level is Anchor's **8-byte discriminator** that prefixes every account's data.

---

## 1. Block / Slot structure (the "header" fields live in the slot metadata)

```mermaid
graph TD
    subgraph BLOCK["BLOCK (one SLOT)"]
        direction TB
        H["SLOT METADATA  (the closest thing to a 'header')<br/>
        • slot number (height)<br/>
        • blockhash (= last PoH hash)<br/>
        • previous_blockhash (parent)<br/>
        • parent_slot<br/>
        • block_time (unix ts)<br/>
        • block_height"]
        POH["PoH SEQUENCE<br/>recursive sha256: hash = sha256(prev_hash || mixin)<br/>proves ordering + passage of time"]
        E1["Entry 0 → [tx, tx, ...]"]
        E2["Entry 1 → [tx, tx, ...]"]
        EN["Entry N → [tx, tx, ...]"]
        H --> POH --> E1 --> E2 --> EN
    end
    PARENT["parent block (parent_slot)"] -. previous_blockhash .-> H
```

Key point: ordering/time come from **PoH**, not a nonce/difficulty header.
There is no mining header, no merkle-root-of-tx in a fixed header struct.

---

## 2. Transaction → invokes Programs (where YOUR code runs)

```mermaid
graph LR
    TX["TRANSACTION<br/>• recent_blockhash (TTL ~150 slots)<br/>• fee payer<br/>• signatures<br/>• message: instructions + account keys"]
    TX --> IX["Instruction<br/>{ program_id, accounts[], data }"]
    IX --> PROG["PROGRAM (executable account, BPF/SBF .so)"]
    PROG --> ACC["mutates DATA ACCOUNTS / PDAs"]
```

---

## 3. Account "header" — Anchor 8-byte discriminator

Every account this repo creates is prefixed by an 8-byte discriminator, then the struct.
Zero-copy state in this repo: `space = 8 + size_of::<T>()`.

```text
 ┌──────────────┬───────────────────────────────────────────┐
 │ 8-byte disc  │  account data (zero_copy #[repr(C)] Pod)   │
 │ sha256(...)  │  fields + manual _paddingN for alignment   │
 └──────────────┴───────────────────────────────────────────┘
   ^ the real "header"        ^ MeterState / Order / UserAccount / *Shard ...
```

---

## 4. GridTokenX programs in this repo (7) + CPI graph

5 core programs + 2 benchmark crates. IDs in `Anchor.toml [programs.localnet]`.

```mermaid
graph TD
    REG["registry<br/>users, meters, 16-shard counter, staking/validator bond"]
    ET["energy-token<br/>single 9-dec SPL mint (GRID=GRX), REC-gated mint/settle"]
    GOV["governance<br/>PoA authority, ERC-1155 RECs, 2-step authority xfer"]
    ORA["oracle<br/>AMI gateway, per-meter PDA, 15-min clearing epochs"]
    TRD["trading<br/>order book + CDA, sharded submit, off-chain match settle"]
    TRE["treasury<br/>GRX↔THBG swap, yield staking, baht settlement"]

    REG -->|CPI| ET
    TRD -->|CPI| GOV
    TRD -->|CPI optional record_settlement| TRE
    ORA -.->|types+ID only, no invoke| GOV

    subgraph BENCH["benchmark crates (not core)"]
        BB["blockbench"]
        TPC["tpc-benchmark"]
    end
```

CPI edges (path deps, `features=["cpi"]`):
- `registry → energy-token`
- `trading → governance`
- `trading → treasury` (optional, fires only when treasury accounts passed)
- `oracle → governance` (validates AggregatorEntry PDA; **no** CPI invoke)

---

## 5. Hot-path parallelism (why per-entity PDAs, not global config)

```mermaid
graph TD
    HOT["hot writes: meter readings, trades"] --> PDA["per-entity PDAs<br/>MeterState / Order / OrderNullifier / *Shard"]
    GLOBAL["global config / totals"] -. read-only on hot path .-> HOT
    PDA -->|periodic admin| RECON["aggregate_readings / aggregate_shards"]
    GLOBAL -. stale on purpose, reconciled later .- RECON
```

Shard select: `authority.to_bytes()[0] % num_shards` (16 in registry).
Sealevel runs non-overlapping account sets in parallel → never funnel hot writes to one global account.
