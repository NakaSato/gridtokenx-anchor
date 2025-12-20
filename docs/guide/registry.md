# Registry Program

The Registry program manages prosumer registration and asset management.

## Overview

| Property | Value |
|----------|-------|
| Program ID | `registry` |
| Purpose | Prosumer & asset management |
| Verification | On-chain identity |

## Instructions

### `register_prosumer`

Register a new prosumer.

```rust
pub fn register_prosumer(
    ctx: Context<RegisterProsumer>,
    name: String,
    prosumer_type: ProsumerType
) -> Result<()>
```

**Accounts:**
- `prosumer` - Prosumer PDA
- `owner` - Wallet owner
- `payer` - Transaction fee payer

### `register_asset`

Register an energy asset (solar panel, battery, etc).

```rust
pub fn register_asset(
    ctx: Context<RegisterAsset>,
    asset_type: AssetType,
    capacity: u64
) -> Result<()>
```

### `verify_prosumer`

Mark prosumer as verified (admin only).

```rust
pub fn verify_prosumer(ctx: Context<VerifyProsumer>) -> Result<()>
```

## Account Structures

### Prosumer

```rust
#[account]
pub struct Prosumer {
    pub owner: Pubkey,
    pub name: String,
    pub prosumer_type: ProsumerType,
    pub is_verified: bool,
    pub total_produced: u64,
    pub total_consumed: u64,
    pub created_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub enum ProsumerType {
    Consumer,
    Producer,
    Prosumer,
}
```

### Asset

```rust
#[account]
pub struct Asset {
    pub owner: Pubkey,
    pub asset_type: AssetType,
    pub capacity: u64,
    pub is_active: bool,
    pub meter_id: String,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub enum AssetType {
    SolarPanel,
    WindTurbine,
    Battery,
    SmartMeter,
}
```

## PDAs

| PDA | Seeds | Purpose |
|-----|-------|---------|
| Prosumer | `["prosumer", owner]` | Prosumer profile |
| Asset | `["asset", owner, id]` | Asset record |

## Events

```rust
#[event]
pub struct ProsumerRegistered {
    pub prosumer: Pubkey,
    pub owner: Pubkey,
    pub name: String,
}

#[event]
pub struct AssetRegistered {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub asset_type: AssetType,
}
```
