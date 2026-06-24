# Oracle Epochs — AMI Bridge, Per-Meter PDAs, 15-Min Clearing

> Deep-dive. Oracle program: AMI-gateway bridge, per-meter PDA state, 15-minute market-clearing
> epochs, aggregator `AggregatorEntry` validation (governance types-only, no CPI invoke).
> (Verify against `programs/oracle/src/`.)

---

## 0. TL;DR

The oracle is the **AMI-gateway bridge** — it ingests smart-meter readings on-chain. Each meter
has its **own PDA** (`MeterState`) so readings don't contend (Sealevel). Readings accumulate over
**15-minute market-clearing epochs**; a clearing step folds them for settlement. Node-facing
oracle instructions are authorized by validating an admitted aggregator's **`AggregatorEntry`**
PDA — oracle imports governance's **types + program ID only**, it does **not** CPI-invoke
governance.

---

## 1. Role: bridge real meters to chain

AMI = Advanced Metering Infrastructure (smart meters). The oracle program is where validated
meter readings land on-chain:

```mermaid
graph LR
    METER["smart meter"] --> AGG["aggregator / AMI gateway (off-chain, admitted)"]
    AGG -->|signed reading| ORA["oracle::submit_reading"]
    ORA --> MS["MeterState PDA (per meter)"]
    MS -->|every 15 min| CLEAR["market-clearing epoch fold"]
```

Off-chain aggregators collect + validate meter data (Ed25519-signed, per the Aggregator Bridge
service), then submit on-chain. The oracle program enforces **who** may submit and records the
reading to the meter's PDA.

---

## 2. Per-meter PDA — hot-path parallelism

Each meter's state is a **dedicated PDA** (`MeterState`), keyed by meter identity:

- Different meters → different accounts → submissions run **in parallel** (Sealevel,
  `sealevel-scheduling.md`). 1000 meters reporting don't serialize on a global account.
- **Stale-on-purpose global totals:** aggregate energy totals are reconciled via
  `aggregate_readings` off the hot path (`sharding-aggregation.md`), not bumped per reading.
- **Zero-copy** `MeterState` (`zero-copy-accounts.md`) for cheap in-place writes.

PDA seed uses the meter id; the seed is bounded to **32 bytes**, which is why oracle's
`MeterIdTooLong` require is **dead code** — the 32-byte PDA seed limit fires first (memory:
`oracle-meteridtoolong-dead`).

---

## 3. 15-minute market-clearing epochs

Energy markets clear in **15-minute windows**:

- Readings submitted during an epoch accumulate on `MeterState`.
- At epoch boundary, a **market-clearing** step folds the window's readings into a settlement
  basis (matching generation/consumption, feeding the trading/settlement layer).
- 15 min aligns with the Aggregator Bridge's aggregation windows (superproject: "15-minute
  aggregation windows for energy data before settlement").
- Epoch timing reads the **`Clock` sysvar** (`unix_timestamp` / slot) — and per SKILL invariant
  #5, `Clock::get()` is **hoisted** before `emit!` (commit `29754ad`: "hoist Clock::get out of
  emit!").

```text
|<-- epoch N (15 min) -->|<-- epoch N+1 -->|
   readings accumulate       clear → settle
   on MeterState PDAs        fold window
```

---

## 4. Authorization: AggregatorEntry validation (NOT a CPI)

Node-facing oracle instructions must come from an **admitted aggregator**. The oracle authorizes
by validating a governance-managed **`AggregatorEntry`** PDA:

- Governance admits aggregators (PoA authority) and records each as an `AggregatorEntry` PDA.
- Oracle **derives/reads** that PDA to confirm the submitter is admitted + active.
- **Crucially:** oracle depends on governance for **types + program ID only** — it does **not**
  `invoke` governance (`cpi-flow.md` §6). It re-derives the expected `AggregatorEntry` address
  under governance's program id and checks the passed account matches. A Cargo dependency edge,
  **not** a runtime CPI.

```mermaid
graph TD
    GOV["governance: admits aggregator → AggregatorEntry PDA"]
    ORA["oracle::node-facing ix"] -->|derive expected AggregatorEntry PDA<br/>(governance program id)| CHK{"passed account == derived & active?"}
    CHK -- yes --> OK["authorized: accept submission"]
    CHK -- no --> REJ["reject"]
    GOV -. types + ID only, NO invoke .- ORA
```

The admin gate was recently deduped (commit `29754ad`: "dedup admin gate").

---

## 5. Relation to the wider system

- **Feeds settlement.** Cleared epoch data underpins the trading/settlement layer
  (`off-chain-settlement.md`) and treasury baht-accounting (`treasury-peg-mechanics.md`).
- **Aggregator Bridge service.** The off-chain half (Ed25519 device-signature validation,
  15-min windows, zone-partitioned Redis) lives in `gridtokenx-aggregator-bridge`; the oracle
  program is the on-chain sink.
- **REC tie-in.** Validated generation also gates energy-token minting
  (`spl-token-2022.md` §4) — generation provenance flows from meters → oracle → mint authority.

---

## 6. Pitfalls

- **Expecting an oracle→governance CPI** → there is none; it's type/ID-only validation. Don't add
  an `invoke`.
- **Meter id > 32 bytes** → PDA seed limit rejects first; `MeterIdTooLong` is unreachable dead
  code.
- **`Clock::get()` inside `emit!`** → hoist it (SKILL #5); already fixed (`29754ad`).
- **Writing global totals per reading** → kills parallelism; use per-meter PDAs + periodic
  `aggregate_readings`.
- **Accepting non-admitted aggregators** → must validate the `AggregatorEntry` PDA (admitted +
  active).

---

## 7. One-paragraph recall

The oracle is the **AMI bridge**: admitted off-chain aggregators submit Ed25519-validated meter
readings on-chain, each meter writing its **own `MeterState` PDA** (zero-copy, Sealevel-parallel),
accumulating over **15-minute market-clearing epochs** that fold into settlement (epoch timing via
the `Clock` sysvar, `Clock::get()` hoisted before `emit!` per SKILL #5). Node-facing instructions
are authorized by **deriving/validating** a governance **`AggregatorEntry`** PDA — oracle uses
governance **types + program ID only, NOT a CPI invoke**. The meter-id PDA seed caps at 32 bytes,
making the `MeterIdTooLong` check dead code. Global energy totals are reconciled off the hot path
via `aggregate_readings`.
