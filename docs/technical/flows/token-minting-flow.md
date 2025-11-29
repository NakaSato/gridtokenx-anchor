# Token Minting Flow

> **Technical flow from energy production to GRID token minting**

This document details the token minting process from meter reading to token creation.

---

## Overview

```
Meter Reading → Validation → Settlement → CPI → Token Mint
```

---

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Token Minting Flow                        │
└─────────────────────────────────────────────────────────────┘

┌──────────────────┐
│  Smart Meter     │
│  produces energy │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Oracle Program  │
│  validates data  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Registry        │
│  updates meter   │
│  account state   │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────┐
│  User calls                  │
│  settle_and_mint_tokens()    │
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│  Registry Program            │
│  ├─ Calculate unsettled      │
│  ├─ Update tracker           │
│  └─ CPI to Energy Token      │
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│  Energy Token Program        │
│  ├─ Validate CPI caller      │
│  ├─ Mint tokens              │
│  └─ Update supply            │
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────┐
│  User receives   │
│  GRID tokens     │
└──────────────────┘
```

---

## Step-by-Step Process

### 1. Energy Production

Smart meter records energy generation and consumption:

| Field | Example Value |
|-------|---------------|
| `total_generation` | 1000 kWh |
| `total_consumption` | 300 kWh |
| `net_generation` | 700 kWh |

### 2. Oracle Validation

Oracle validates and forwards reading to Registry:

- Timestamp validation
- Range checks
- Anomaly detection
- Quality scoring

### 3. Meter State Update

Registry updates meter account:

```
Before:
  total_generation: 800 kWh
  total_consumption: 250 kWh
  settled_net_generation: 400 kWh

After reading:
  total_generation: 1000 kWh (+200)
  total_consumption: 300 kWh (+50)
  settled_net_generation: 400 kWh (unchanged)
```

### 4. Settlement Calculation

User triggers settlement:

```
Net Generation = 1000 - 300 = 700 kWh
Previously Settled = 400 kWh
Mintable = 700 - 400 = 300 kWh
```

### 5. CPI Execution

Registry invokes Energy Token via CPI:

- Passes calculated amount (300 kWh)
- Energy Token validates caller
- Mints 300 GRID tokens
- Updates total supply

### 6. Token Receipt

User's token account credited:

```
Before: 0 GRID
Minted: 300 GRID
After: 300 GRID
```

---

## Conversion Formula

```
GRID tokens = Net Surplus (kWh) × 10^9

Example:
  Net surplus: 15.5 kWh
  Base units: 15.5 × 10^9 = 15,500,000,000
  Display: 15.5 GRID
```

---

## Error Conditions

| Condition | Error | Resolution |
|-----------|-------|------------|
| No surplus | `InsufficientBalance` | Wait for more production |
| Meter inactive | `MeterNotActive` | Activate meter first |
| Wrong owner | `Unauthorized` | Use meter owner wallet |
| Minting disabled | `MintingDisabled` | Wait for admin action |

---

## Events Emitted

1. `MeterBalanceSettled` (Registry)
   - meter_id
   - amount_settled
   - new_settled_total

2. `TokensMinted` (Energy Token)
   - recipient
   - amount
   - new_total_supply

---

*For CPI implementation details, see [CPI Implementation](../architecture/cpi-implementation.md)*
