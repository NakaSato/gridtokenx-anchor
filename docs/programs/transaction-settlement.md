# Transaction Settlement

> **Complete Settlement Flows for All Trading Mechanisms**

---

## Overview

GridTokenX implements multiple settlement pathways to support its diverse trading mechanisms. All settlements are **atomic** — either all transfers succeed or the entire transaction reverts.

### Settlement Mechanisms

| Mechanism | Instruction | Settlement Time | Key Accounts |
|-----------|------------|-----------------|-------------|
| **Energy Mint** | `settle_and_mint_tokens` (Registry) | ~400ms | MeterAccount → Energy Token CPI |
| **P2P Match** | `match_orders` + token transfers | ~400ms | Order accounts + TradeRecord |
| **Sharded Match** | `sharded_match_orders` | ~400ms | Order accounts + ZoneShard |
| **Auction** | `clear_auction` + `execute_auction_matches` | ~400ms | Market + ZoneMarket |
| **Off-Chain Match** | `batch_settle_offchain_match` | ~400ms | Nullifiers + Shards |

---

## Energy Generation Settlement

Converts verified meter readings into GRX tokens.

### Flow

```
Oracle Program        Registry Program         Energy Token Program
     │                      │                         │
     │  submit_meter_reading│                         │
     ├─────────────────────▶│                         │
     │                      │  settle_meter_balance   │
     │                      │  (calc: net - settled)  │
     │                      ├────────────────────────▶│
     │                      │  CPI mint_tokens_direct │
     │                      │  (Registry signs as     │
     │                      │   registry_authority)   │
     │                      │◀────────────────────────┤
     │                      │  GRX minted to user     │
```

### Settlement Formula

```
net_generation    = total_generation - total_consumption
unsettled         = net_generation - settled_net_generation
grx_minted        = unsettled (1:1 mapping, 9 decimals)
```

**Example:**
- Generation: 15.5 kWh (15,500,000,000 atomic units)
- Consumption: 5.2 kWh
- Net: 10.3 kWh
- GRX Minted: 10,300,000,000 atomic units

### Key Instructions

| Instruction | Program | Description |
|-------------|---------|-------------|
| `settle_meter_balance` | Registry | Calculates unsettled balance, updates `settled_net_generation`, returns amount |
| `settle_and_mint_tokens` | Registry | Settlement + CPI to `energy_token::mint_tokens_direct` in one transaction |

---

## P2P Trade Settlement

### Settlement Calculation

```
trade_value     = match_amount × clearing_price
market_fee      = trade_value × market_fee_bps / 10000
seller_receives = trade_value - market_fee
```

**Default Fee:** 25 bps (0.25%)

### Atomic Settlement Flow

The `match_orders` instruction creates an immutable `TradeRecord` and updates both order accounts. Actual token transfers are handled by the caller's transaction (escrow-based or direct transfer).

```
┌─────────────────────────────────────────────────────────────┐
│                    P2P SETTLEMENT FLOW                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. ORDER MATCHING                                          │
│     Validate: buy_price ≥ sell_price                        │
│     Clearing price = sell_order.price_per_kwh               │
│     actual_match = min(match_amount, buy_rem, sell_rem)     │
│                                                              │
│  2. STATE UPDATES                                           │
│     buy_order.filled_amount += actual_match                 │
│     sell_order.filled_amount += actual_match                │
│     Update status: Active → PartiallyFilled → Completed     │
│     Create immutable TradeRecord                            │
│     zone_market: volume++, trades++, last_clearing_price    │
│                                                              │
│  3. TOKEN TRANSFERS (caller-managed)                        │
│     Currency (THB/USDC): Buyer → Seller (minus fee)         │
│     Energy (GRX): Seller → Buyer                            │
│                                                              │
│  4. EVENT EMISSION                                          │
│     OrderMatched { sell_order, buy_order, amount, price }   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Sharded Match Settlement

Optimized version of P2P matching that updates zone shards instead of the global ZoneMarket.

### Key Differences from P2P

| Aspect | P2P `match_orders` | Sharded `sharded_match_orders` |
|--------|--------------------|-------------------------------|
| **State Update** | `zone_market` (global write lock) | `zone_shard` (distributed) |
| **Contention** | High — serialized on ZoneMarket | Low — parallel across shards |
| **Volume Tracking** | `zone_market.total_volume` | `zone_shard.volume_accumulated` |
| **Trade Count** | `zone_market.total_trades` | `zone_shard.trade_count` |

### Shard Selection

Shards are selected based on the payer's pubkey:

```rust
fn get_shard_id(authority: &Pubkey, num_shards: u8) -> u8 {
    authority.to_bytes()[0] % num_shards
}
```

---

## Auction Settlement

Two-phase process: price discovery followed by execution.

### Phase 1: `clear_auction`

1. **Sort** sell orders ascending, buy orders descending
2. **Build curves** — cumulative supply/demand at each price
3. **Find clearing point** — intersection where supply meets demand
4. **Generate matches** — emit `OrderMatched` for each pair
5. **Return** `ClearAuctionResult { clearing_price, clearing_volume, total_matches }`

### Phase 2: `execute_auction_matches`

1. For each `AuctionMatch`: calculate `trade_value = amount × clearing_price`
2. Calculate `market_fee = trade_value × fee_bps / 10000`
3. Emit `OrderMatched` events with fee details
4. Update market totals

**Note:** The actual token transfers for auction settlement are managed off-chain or via separate escrow instructions. The `execute_auction_matches` instruction handles accounting and event emission.

---

## Off-Chain Match Settlement

For orders matched by an off-chain matching engine, settlement happens on-chain with full token transfers.

### OffchainOrderPayload

```rust
pub struct OffchainOrderPayload {
    pub order_id: [u8; 16],     // UUID
    pub user: Pubkey,
    pub energy_amount: u64,
    pub price_per_kwh: u64,
    pub side: u8,               // 0 = Buy, 1 = Sell
    pub zone_id: u32,
    pub expires_at: i64,
}
```

### Settlement Flow (`settle_offchain_match`)

```
┌──────────────────────────────────────────────────────────────┐
│              OFF-CHAIN MATCH SETTLEMENT                       │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  1. VALIDATION                                                │
│     match_price ≤ buyer_payload.price_per_kwh (slippage)    │
│     match_price ≥ seller_payload.price_per_kwh (slippage)   │
│     Both orders not expired                                  │
│     match_amount ≤ remaining for both orders                │
│                                                               │
│  2. FEE CALCULATION                                         │
│     total_value = match_amount × match_price                │
│     market_fee = total_value × fee_bps / 10000              │
│     net_seller = total_value - fee - wheeling - loss        │
│                                                               │
│  3. TOKEN TRANSFERS (via Market Authority PDA)              │
│     a. Market fee: buyer_currency → fee_collector            │
│     b. Seller payment: buyer_currency → seller_currency      │
│     c. Energy transfer: seller_energy → buyer_energy         │
│                                                               │
│  4. NULLIFIER UPDATES                                       │
│     buyer_nullifier.filled_amount += match_amount            │
│     seller_nullifier.filled_amount += match_amount           │
│                                                               │
│  5. SHARD UPDATES                                           │
│     market_shard.volume += match_amount                      │
│     zone_shard.volume += match_amount                        │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Batch Settlement (`batch_settle_offchain_match`)

Settles up to **4 matches** in a single transaction using `remaining_accounts`:

**Account Layout** (per match, 6 accounts):
1. Buyer Nullifier
2. Seller Nullifier
3. Buyer Currency Account
4. Seller Currency Account
5. Seller Energy Account
6. Buyer Energy Account

**Total accounts:** 6 × match_count

### Key Design: Order Nullifiers

`OrderNullifier` accounts prevent double-filling of off-chain orders:

**PDA Seeds:** `["nullifier", user_key, order_id]`

| Field | Type | Description |
|-------|------|-------------|
| `order_id` | `[u8; 16]` | Original order UUID |
| `authority` | `Pubkey` | Order creator |
| `filled_amount` | `u64` | Cumulative filled amount |
| `bump` | `u8` | PDA bump |

---

## Fee Structure

| Mechanism | Fee Rate | Recipient | Notes |
|-----------|----------|-----------|-------|
| P2P Match | `market_fee_bps` (default 25) | Platform treasury | Set during market init |
| Auction | `market_fee_bps` (same) | Platform treasury | Applied per match |
| Off-Chain Match | `market_fee_bps` | Platform treasury | Plus wheeling & loss costs |
| Energy Mint | 0% | — | Free energy tokenization |

### Additional Costs (Off-Chain Match)

| Cost | Description |
|------|-------------|
| `wheeling_charge` | Grid operator fee for energy transmission |
| `loss_cost` | Transmission loss compensation |

**Net seller receives:** `total_value - market_fee - wheeling_charge - loss_cost`

---

## Escrow & Authority Model

### Market Authority PDA

For off-chain settlements, a `market_authority` PDA (`["market_authority"]`) holds SPL Token delegations from user accounts, enabling program-managed transfers:

```rust
let authority_seeds = &[b"market_authority".as_ref(), &[authority_bump]];
let signer = &[&authority_seeds[..]];

anchor_spl::token_interface::transfer_checked(
    CpiContext::new_with_signer(token_program, transfer_accounts, signer),
    amount,
    decimals
)?;
```

### Slippage Protection

Off-chain matches validate price against both signed payloads:

```rust
require!(match_price <= buyer_payload.price_per_kwh, SlippageExceeded);
require!(match_price >= seller_payload.price_per_kwh, SlippageExceeded);
```

---

## Error Handling

| Error | Scenario | Recovery |
|-------|----------|----------|
| `InvalidAmount` | Zero amount, exceeds remaining, nullifier mismatch | Correct amount and retry |
| `SlippageExceeded` | Match price outside signed payload bounds | Adjust match price or re-sign |
| `OrderExpired` | Current time ≥ payload `expires_at` | Submit fresh order |
| `PriceMismatch` | `buyer_price < seller_price` | Adjust prices to cross |
| `InvalidOrderSide` | Side not 0 (Buy) or 1 (Sell) | Correct side in payload |
| `BatchTooLarge` | > 4 matches in batch | Split into multiple transactions |

---

## Atomicity Guarantees

All settlement operations are **fully atomic**:

1. **P2P Match** — Order state updates and trade record creation in one instruction
2. **Sharded Match** — Same atomicity, distributed across shards
3. **Auction** — All matches generated in single `clear_auction` call
4. **Off-Chain Match** — All 3 token transfers (fee, currency, energy) succeed or entire transaction reverts
5. **Batch Settlement** — All matches in the batch settle atomically

This prevents:
- Partial fills where one party receives funds but not the counterparty
- Race conditions between settlement steps
- Front-running of settlement transactions

---

## Performance

| Operation | CU Estimate | Notes |
|-----------|-------------|-------|
| `settle_meter_balance` | ~10,000 | Calculation only, no CPI |
| `settle_and_mint_tokens` | ~35,000 | Includes CPI to Energy Token |
| `match_orders` | ~25,000 | State updates + event |
| `sharded_match_orders` | ~20,000 | Reduced contention |
| `clear_auction` (10 orders) | ~50,000 | Sorting + matching |
| `settle_offchain_match` | ~45,000 | 3 token transfers + nullifiers |
| `batch_settle_offchain_match` (4) | ~150,000 | 12 transfers + 4 nullifier updates |

---

**Related:** [Energy Token](./energy-token.md) — GRX minting · [Trading](./trading.md) — Core marketplace · [Auction Clearing](./auction-clearing.md) — Batch auction algorithm
