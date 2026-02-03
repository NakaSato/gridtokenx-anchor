# GridTokenX Entity Relationship Diagrams

**Version:** 2.0.0  
**Last Updated:** February 2, 2026

---

## 1. Complete Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                          GRIDTOKENX ACCOUNT ENTITY RELATIONSHIPS                            │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              REGISTRY PROGRAM                                        │   │
│  │                                                                                      │   │
│  │   ┌───────────────────┐         1:N         ┌───────────────────┐                   │   │
│  │   │     Registry      │─────────────────────│   UserAccount     │                   │   │
│  │   │    (Singleton)    │                     │      (PDA)        │                   │   │
│  │   ├───────────────────┤                     ├───────────────────┤                   │   │
│  │   │ PK: seeds=        │                     │ PK: seeds=        │                   │   │
│  │   │     ["registry"]  │                     │  ["user", wallet] │                   │   │
│  │   ├───────────────────┤                     ├───────────────────┤                   │   │
│  │   │ authority: Pubkey │                     │ authority: Pubkey │──┐               │   │
│  │   │ oracle_authority  │                     │ user_type: enum   │  │               │   │
│  │   │ user_count: u64   │                     │ lat/long: f64     │  │               │   │
│  │   │ meter_count: u64  │                     │ status: enum      │  │               │   │
│  │   │ active_meters: u64│                     │ registered_at: i64│  │               │   │
│  │   └───────────────────┘                     │ meter_count: u32  │  │               │   │
│  │                                             └─────────┬─────────┘  │               │   │
│  │                                                       │            │               │   │
│  │                                                  1:N  │            │               │   │
│  │                                                       │            │               │   │
│  │                                             ┌─────────▼─────────┐  │               │   │
│  │                                             │   MeterAccount    │  │               │   │
│  │                                             │      (PDA)        │  │               │   │
│  │                                             ├───────────────────┤  │               │   │
│  │                                             │ PK: seeds=        │  │               │   │
│  │                                             │ ["meter", owner,  │  │               │   │
│  │                                             │  meter_id]        │  │               │   │
│  │                                             ├───────────────────┤  │               │   │
│  │                                             │ meter_id: [u8;32] │  │               │   │
│  │                                             │ owner: Pubkey     │──┘ FK            │   │
│  │                                             │ meter_type: enum  │                   │   │
│  │                                             │ status: enum      │                   │   │
│  │                                             │ total_generation  │──────────┐       │   │
│  │                                             │ total_consumption │          │       │   │
│  │                                             │ settled_net_gen   │          │       │   │
│  │                                             │ claimed_erc_gen   │──────────┼───┐   │   │
│  │                                             └───────────────────┘          │   │   │   │
│  │                                                                            │   │   │   │
│  └────────────────────────────────────────────────────────────────────────────┼───┼───┘   │
│                                                                               │   │       │
│  ┌────────────────────────────────────────────────────────────────────────────┼───┼───┐   │
│  │                              GOVERNANCE PROGRAM                            │   │   │   │
│  │                                                                            │   │   │   │
│  │   ┌───────────────────┐         1:N         ┌───────────────────┐         │   │   │   │
│  │   │    PoAConfig      │─────────────────────│  ErcCertificate   │◄────────┼───┘   │   │
│  │   │    (Singleton)    │                     │      (PDA)        │         │       │   │
│  │   ├───────────────────┤                     ├───────────────────┤         │       │   │
│  │   │ PK: seeds=        │                     │ PK: seeds=        │         │       │   │
│  │   │ ["poa_config"]    │                     │ ["erc_certificate"│         │       │   │
│  │   ├───────────────────┤                     │  certificate_id]  │         │       │   │
│  │   │ authority: Pubkey │                     ├───────────────────┤         │       │   │
│  │   │ authority_name    │                     │ certificate_id    │         │       │   │
│  │   │ emergency_paused  │                     │ authority: Pubkey │ FK      │       │   │
│  │   │ maintenance_mode  │                     │ owner: Pubkey     │────┐    │       │   │
│  │   │ erc_validation_en │                     │ energy_amount: u64│◄───┼────┘       │   │
│  │   │ min_energy_amount │                     │ renewable_source  │    │ References │   │
│  │   │ max_erc_amount    │                     │ validation_data   │    │ Meter's    │   │
│  │   │ erc_validity_prd  │                     │ issued_at: i64    │    │ unclaimed  │   │
│  │   │ total_ercs_issued │                     │ expires_at: i64   │    │ generation │   │
│  │   │ pending_authority │                     │ status: enum      │    │            │   │
│  │   └───────────────────┘                     │ validated_trading │    │            │   │
│  │                                             │ transfer_count    │    │            │   │
│  │                                             └───────────────────┘    │            │   │
│  │                                                                      │            │   │
│  └──────────────────────────────────────────────────────────────────────┼────────────┘   │
│                                                                         │                │
│  ┌──────────────────────────────────────────────────────────────────────┼────────────┐   │
│  │                              ORACLE PROGRAM                          │            │   │
│  │                                                                      │            │   │
│  │   ┌───────────────────┐                                             │            │   │
│  │   │    OracleData     │                                             │            │   │
│  │   │    (Singleton)    │                                             │            │   │
│  │   ├───────────────────┤                                             │            │   │
│  │   │ PK: seeds=        │                                             │            │   │
│  │   │ ["oracle_data"]   │                                             │            │   │
│  │   ├───────────────────┤                                             │            │   │
│  │   │ authority: Pubkey │                                             │            │   │
│  │   │ api_gateway       │                                             │            │   │
│  │   │ backup_oracles[10]│                                             │            │   │
│  │   │ total_readings    │─────────────────────────────────────────────┘            │   │
│  │   │ last_reading_ts   │  Submits readings that update                            │   │
│  │   │ min/max_energy    │  MeterAccount.total_generation                           │   │
│  │   │ anomaly_detection │                                                          │   │
│  │   │ consensus_thresh  │                                                          │   │
│  │   └───────────────────┘                                                          │   │
│  │                                                                                   │   │
│  └───────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              ENERGY TOKEN PROGRAM                                  │   │
│  │                                                                                    │   │
│  │   ┌───────────────────┐         1:1         ┌───────────────────┐                 │   │
│  │   │    TokenInfo      │─────────────────────│    GRX Mint       │                 │   │
│  │   │      (PDA)        │                     │   (Token-2022)    │                 │   │
│  │   ├───────────────────┤                     ├───────────────────┤                 │   │
│  │   │ PK: seeds=        │                     │ PK: mint_address  │                 │   │
│  │   │ ["token_info_2022"]                     ├───────────────────┤                 │   │
│  │   ├───────────────────┤                     │ decimals: 9       │                 │   │
│  │   │ authority: Pubkey │                     │ supply: variable  │                 │   │
│  │   │ registry_program  │                     │ mint_authority:   │                 │   │
│  │   │ mint: Pubkey      │─────────────────────│   TokenInfo PDA   │                 │   │
│  │   │ total_supply: u64 │                     └─────────┬─────────┘                 │   │
│  │   │ rec_validators[5] │                               │                           │   │
│  │   └───────────────────┘                          1:N  │                           │   │
│  │                                                       │                           │   │
│  │                                             ┌─────────▼─────────┐                 │   │
│  │                                             │  Token Account    │                 │   │
│  │                                             │  (ATA per user)   │                 │   │
│  │                                             ├───────────────────┤                 │   │
│  │                                             │ owner: Pubkey     │◄────────────┐   │   │
│  │                                             │ mint: Pubkey      │             │   │   │
│  │                                             │ amount: u64       │             │   │   │
│  │                                             └───────────────────┘             │   │   │
│  │                                                                               │   │   │
│  └───────────────────────────────────────────────────────────────────────────────┼───┘   │
│                                                                                  │       │
│  ┌───────────────────────────────────────────────────────────────────────────────┼───┐   │
│  │                              TRADING PROGRAM                                  │   │   │
│  │                                                                               │   │   │
│  │   ┌───────────────────┐         1:N         ┌───────────────────┐            │   │   │
│  │   │      Market       │─────────────────────│      Order        │            │   │   │
│  │   │    (Singleton)    │                     │      (PDA)        │            │   │   │
│  │   ├───────────────────┤                     ├───────────────────┤            │   │   │
│  │   │ PK: seeds=        │                     │ PK: seeds=        │            │   │   │
│  │   │ ["market"]        │                     │ ["order", seller, │            │   │   │
│  │   ├───────────────────┤                     │  order_id]        │            │   │   │
│  │   │ authority: Pubkey │                     ├───────────────────┤            │   │   │
│  │   │ active_orders: u32│                     │ seller: Pubkey    │────────────┘   │   │
│  │   │ total_volume: u64 │                     │ buyer: Pubkey     │                │   │
│  │   │ total_trades: u32 │                     │ order_id: u64     │                │   │
│  │   │ market_fee_bps    │                     │ amount: u64       │                │   │
│  │   │ clearing_enabled  │                     │ filled_amount     │                │   │
│  │   │ batch_config      │                     │ price_per_kwh     │                │   │
│  │   │ buy_side_depth[20]│                     │ order_type: enum  │                │   │
│  │   │ sell_side_depth[20]                     │ status: enum      │                │   │
│  │   │ price_history[24] │                     │ created_at: i64   │                │   │
│  │   └─────────┬─────────┘                     │ expires_at: i64   │                │   │
│  │             │                               └───────────────────┘                │   │
│  │             │                                                                    │   │
│  │        1:N  │         ┌───────────────────┐         1:N         ┌────────────┐  │   │
│  │             │         │   TradeRecord     │─────────────────────│ MarketShard│  │   │
│  │             │         │      (PDA)        │                     │   (PDA)    │  │   │
│  │             │         ├───────────────────┤                     ├────────────┤  │   │
│  │             │         │ sell_order: Pubkey│                     │ shard_id   │  │   │
│  │             │         │ buy_order: Pubkey │                     │ market     │  │   │
│  │             │         │ seller: Pubkey    │                     │ volume     │  │   │
│  │             └────────▶│ buyer: Pubkey     │                     │ order_count│  │   │
│  │                       │ amount: u64       │                     │ last_update│  │   │
│  │                       │ price_per_kwh     │                     └────────────┘  │   │
│  │                       │ total_value       │                                     │   │
│  │                       │ fee_amount        │                                     │   │
│  │                       │ executed_at       │                                     │   │
│  │                       └───────────────────┘                                     │   │
│  │                                                                                 │   │
│  │   ┌───────────────────┐                     ┌───────────────────┐               │   │
│  │   │     AmmPool       │                     │   AuctionState    │               │   │
│  │   │      (PDA)        │                     │      (PDA)        │               │   │
│  │   ├───────────────────┤                     ├───────────────────┤               │   │
│  │   │ PK: seeds=        │                     │ PK: seeds=        │               │   │
│  │   │ ["amm_pool"]      │                     │ ["auction"]       │               │   │
│  │   ├───────────────────┤                     ├───────────────────┤               │   │
│  │   │ grx_reserve: u64  │                     │ batch_orders[32]  │               │   │
│  │   │ thb_reserve: u64  │                     │ clearing_price    │               │   │
│  │   │ lp_tokens_supply  │                     │ start_time: i64   │               │   │
│  │   │ fee_numerator     │                     │ end_time: i64     │               │   │
│  │   │ total_volume      │                     │ status: enum      │               │   │
│  │   │ last_price        │                     │ total_buy_vol     │               │   │
│  │   └───────────────────┘                     │ total_sell_vol    │               │   │
│  │                                             └───────────────────┘               │   │
│  │                                                                                 │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Relationship Cardinality Summary

| From | Relationship | To | Cardinality | Notes |
|------|--------------|-----|-------------|-------|
| Registry | has | UserAccount | 1:N | Registry tracks count |
| UserAccount | owns | MeterAccount | 1:N | User can own multiple meters |
| PoAConfig | issues | ErcCertificate | 1:N | Authority issues certificates |
| MeterAccount | backs | ErcCertificate | 1:N | Meter generation backs RECs |
| TokenInfo | controls | GRX Mint | 1:1 | PDA is mint authority |
| GRX Mint | has | Token Account | 1:N | Per-user associated accounts |
| Market | contains | Order | 1:N | Orders reference market |
| Market | records | TradeRecord | 1:N | Trade history |
| Market | uses | MarketShard | 1:N | Parallel write shards |
| Order | creates | TradeRecord | 2:1 | Sell + Buy → Trade |
| ErcCertificate | validates | Order | 1:N | Sell orders require ERC |

---

## 3. PDA Seed Derivation Reference

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              PDA SEED DERIVATION                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  REGISTRY PROGRAM:                                                              │
│  ─────────────────                                                              │
│  Registry:     ["registry"]                                                     │
│  UserAccount:  ["user", user_authority.key()]                                   │
│  MeterAccount: ["meter", owner.key(), meter_id.as_bytes()]                     │
│                                                                                 │
│  ORACLE PROGRAM:                                                                │
│  ──────────────                                                                 │
│  OracleData:   ["oracle_data"]                                                  │
│                                                                                 │
│  GOVERNANCE PROGRAM:                                                            │
│  ──────────────────                                                             │
│  PoAConfig:       ["poa_config"]                                                │
│  ErcCertificate:  ["erc_certificate", certificate_id.as_bytes()]               │
│                                                                                 │
│  ENERGY TOKEN PROGRAM:                                                          │
│  ────────────────────                                                           │
│  TokenInfo:    ["token_info_2022"]                                              │
│                                                                                 │
│  TRADING PROGRAM:                                                               │
│  ───────────────                                                                │
│  Market:       ["market"]                                                       │
│  Order:        ["order", seller.key(), order_id.to_le_bytes()]                 │
│  TradeRecord:  ["trade", trade_id.to_le_bytes()]                               │
│  MarketShard:  ["shard", shard_id.to_le_bytes()]                               │
│  AmmPool:      ["amm_pool"]                                                     │
│  AuctionState: ["auction"]                                                      │
│  Escrow:       ["escrow", order.key()]                                         │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Account Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           DATA FLOW BETWEEN ACCOUNTS                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│                                                                                 │
│  ┌─────────────┐                              ┌─────────────┐                  │
│  │   SMART     │                              │  PROSUMER   │                  │
│  │   METER     │                              │   WALLET    │                  │
│  │  (Physical) │                              │  (Phantom)  │                  │
│  └──────┬──────┘                              └──────┬──────┘                  │
│         │                                            │                          │
│         │ kWh reading                                │ Register                 │
│         ▼                                            ▼                          │
│  ┌─────────────┐      CPI: update_reading     ┌─────────────┐                  │
│  │   ORACLE    │─────────────────────────────▶│  REGISTRY   │                  │
│  │   DATA      │                              │             │                  │
│  └─────────────┘                              │ UserAccount │                  │
│                                               │ MeterAccount│                  │
│                                               └──────┬──────┘                  │
│                                                      │                          │
│                            ┌─────────────────────────┼─────────────────────┐   │
│                            │                         │                     │   │
│                            │ total_generation        │ unclaimed_gen       │   │
│                            ▼                         ▼                     │   │
│                     ┌─────────────┐           ┌─────────────┐              │   │
│                     │  ENERGY     │           │ GOVERNANCE  │              │   │
│                     │  TOKEN      │           │             │              │   │
│                     │             │           │ PoAConfig   │              │   │
│                     │ TokenInfo   │           │ ErcCertif.  │              │   │
│                     │ GRX Mint    │           └──────┬──────┘              │   │
│                     └──────┬──────┘                  │                     │   │
│                            │                         │ validated_trading   │   │
│                            │ GRX tokens              │                     │   │
│                            ▼                         ▼                     │   │
│                     ┌────────────────────────────────────────────────────┐ │   │
│                     │                    TRADING                         │ │   │
│                     │                                                    │ │   │
│                     │  ┌──────────┐  ┌──────────┐  ┌──────────┐        │ │   │
│                     │  │  Market  │  │  Orders  │  │  Trades  │        │ │   │
│                     │  └────┬─────┘  └────┬─────┘  └────┬─────┘        │ │   │
│                     │       │             │             │               │ │   │
│                     │       └─────────────┼─────────────┘               │ │   │
│                     │                     │                             │ │   │
│                     │  ┌──────────┐  ┌────┴─────┐  ┌──────────┐        │ │   │
│                     │  │ AmmPool  │  │  Escrow  │  │ Auction  │        │ │   │
│                     │  └──────────┘  └──────────┘  └──────────┘        │ │   │
│                     │                                                    │ │   │
│                     └────────────────────────────────────────────────────┘ │   │
│                                          │                                 │   │
│                                          │ THB/GRX transfers               │   │
│                                          ▼                                 │   │
│                                   ┌─────────────┐                          │   │
│                                   │  CONSUMER   │                          │   │
│                                   │   WALLET    │                          │   │
│                                   │  (Token     │                          │   │
│                                   │   Accounts) │                          │   │
│                                   └─────────────┘                          │   │
│                                                                             │   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Account Size Reference Table

| Program | Account | Size (bytes) | Rent (SOL) | Storage Type |
|---------|---------|--------------|------------|--------------|
| **Registry** |
| | Registry | 105 | 0.00144 | zero_copy |
| | UserAccount | 70 | 0.00113 | zero_copy |
| | MeterAccount | 138 | 0.00160 | zero_copy |
| **Oracle** |
| | OracleData | 560 | 0.00390 | zero_copy |
| **Governance** |
| | PoAConfig | ~650 | 0.00492 | standard |
| | ErcCertificate | ~630 | 0.00478 | standard |
| **Energy Token** |
| | TokenInfo | 200 | 0.00227 | zero_copy |
| **Trading** |
| | Market | ~4,000 | 0.02850 | zero_copy |
| | Order | 128 | 0.00156 | zero_copy |
| | TradeRecord | 145 | 0.00165 | standard |
| | MarketShard | 57 | 0.00100 | standard |
| | AmmPool | 104 | 0.00142 | standard |
| | AuctionState | ~1,200 | 0.00920 | zero_copy |

---

## 6. Enum Type Reference

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              ENUM DEFINITIONS                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  REGISTRY ENUMS:                                                                │
│  ───────────────                                                                │
│  UserType:      { Prosumer, Consumer }                                          │
│  UserStatus:    { Active, Suspended, Inactive }                                 │
│  MeterType:     { Solar, Wind, Battery, Grid }                                  │
│  MeterStatus:   { Active, Inactive, Maintenance }                               │
│                                                                                 │
│  GOVERNANCE ENUMS:                                                              │
│  ────────────────                                                               │
│  ErcStatus:     { Valid, Expired, Revoked, Pending }                            │
│                                                                                 │
│  TRADING ENUMS:                                                                 │
│  ──────────────                                                                 │
│  OrderType:     { Sell, Buy }                                                   │
│  OrderStatus:   { Active, PartiallyFilled, Completed, Cancelled, Expired }      │
│  AuctionStatus: { Open, Clearing, Closed }                                      │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Related Documentation

- [Architecture Diagrams](./architecture.md) - System overview
- [Sequence Diagrams](./sequences.md) - Transaction flow sequences
- [Network Topology](./network-topology.md) - Infrastructure layout
- [State Machines](./state-machines.md) - Account state transitions
