# Program Interfaces & PDAs

This page provides a technical reference for interacting with the GridTokenX smart contracts via `@coral-xyz/anchor`.

## Oracle Program (`oracle`)

### MeterState PDA
The Oracle program stores data in isolated Program Derived Addresses (PDAs) for each meter to prevent global write locks.
- **Seeds:** `[b"meter", meter_id.as_bytes()]`
- **Fields:**
  - `meter_id`: String (max 32 bytes)
  - `energy_produced`: u64 (kWh)
  - `energy_consumed`: u64 (kWh)
  - `last_reading_timestamp`: i64

### Instruction: `submit_meter_reading`
**Parameters:**
- `meter_id` (String)
- `generation` (u64)
- `consumption` (u64)
- `timestamp` (i64)
- `auth_signature` (u64)

---

## Registry Program (`registry`)

### RegistryShard PDA
To aggregate network statistics without hitting compute limits, the registry shards users into `MAX_SHARDS`.
- **Seeds:** `[b"registry_shard", &[shard_id]]`
- **Fields:**
  - `shard_id`: u8
  - `active_meter_count`: u32
  - `total_staked`: u64

### Instruction: `settle_and_mint_tokens`
This is a critical cross-program invocation (CPI) gateway.
**Accounts Required:**
- `registry`
- `meterAccount` (PDA)
- `oracleMeterState` (Oracle PDA)
- `userCurrencyAccount` (ATA)
- `currencyMint` (Energy-Token Program)
- `tokenProgram` (SPL Token-2022)
