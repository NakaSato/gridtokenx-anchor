# Programs API Reference

Complete API reference for all GridTokenX Anchor programs.

## Program IDs

| Program | ID |
|---------|-----|
| Energy Token | `energy_token` |
| Trading | `trading` |
| Oracle | `oracle` |
| Registry | `registry` |
| Governance | `governance` |

## Energy Token

### Instructions

| Instruction | Description |
|-------------|-------------|
| `initialize` | Initialize token mint |
| `mint_to_wallet` | Mint tokens to user |
| `burn` | Burn tokens |

### Accounts

| Account | Type | Size |
|---------|------|------|
| TokenInfo | PDA | 128 bytes |
| Mint | PDA | 82 bytes |

## Trading

### Instructions

| Instruction | Description |
|-------------|-------------|
| `create_market` | Create trading market |
| `create_buy_order` | Place buy order |
| `create_sell_order` | Place sell order |
| `cancel_order` | Cancel order |
| `match_orders` | Match buy/sell |

### Accounts

| Account | Type | Size |
|---------|------|------|
| Market | PDA | 256 bytes |
| Order | PDA | 192 bytes |
| Trade | PDA | 128 bytes |

## Oracle

### Instructions

| Instruction | Description |
|-------------|-------------|
| `initialize_feed` | Create price feed |
| `update_price` | Update price |

### Accounts

| Account | Type | Size |
|---------|------|------|
| PriceFeed | PDA | 128 bytes |

## Registry

### Instructions

| Instruction | Description |
|-------------|-------------|
| `register_prosumer` | Register prosumer |
| `register_asset` | Register asset |
| `verify_prosumer` | Verify prosumer |

### Accounts

| Account | Type | Size |
|---------|------|------|
| Prosumer | PDA | 256 bytes |
| Asset | PDA | 192 bytes |

## Governance

### Instructions

| Instruction | Description |
|-------------|-------------|
| `create_proposal` | Create proposal |
| `cast_vote` | Vote on proposal |
| `execute_proposal` | Execute passed proposal |

### Accounts

| Account | Type | Size |
|---------|------|------|
| Proposal | PDA | 512 bytes |
| VoteRecord | PDA | 96 bytes |
