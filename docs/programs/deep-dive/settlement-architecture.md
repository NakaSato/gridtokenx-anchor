# Settlement Architecture: Deep Dive

> **Atomic Settlement and Payment Finality for Energy Trading**

---

## 1. Executive Summary

The GridTokenX Settlement Architecture ensures **atomic, trustless exchange** of energy tokens and payment currencies. The system guarantees that either both parties receive their assets or neither does - eliminating counterparty risk inherent in traditional energy trading.

**Key Properties:**
- **Atomicity**: All-or-nothing execution of trades
- **Finality**: Irreversible once confirmed on-chain
- **Fairness**: Same price for all participants in batch settlements
- **Flexibility**: Support for multiple payment methods (USDC, THB, cross-chain)

---

## 2. Settlement Models

### 2.1 Supported Settlement Types

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       SETTLEMENT MODEL COMPARISON                        │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. INSTANT (P2P Direct)                                                │
│     ┌─────────┐         ┌─────────┐                                     │
│     │  Buyer  │────────►│ Seller  │                                     │
│     │  (THB)  │◄────────│  (GRX)  │                                     │
│     └─────────┘         └─────────┘                                     │
│     • Real-time execution                                                │
│     • Both parties must be online                                        │
│     • Price agreed upon matching                                         │
│                                                                          │
│  2. ESCROW (Delayed Settlement)                                         │
│     ┌─────────┐    ┌──────────┐    ┌─────────┐                         │
│     │  Buyer  │───►│  Escrow  │◄───│ Seller  │                         │
│     │  (THB)  │    │   PDA    │    │  (GRX)  │                         │
│     └─────────┘    └────┬─────┘    └─────────┘                         │
│                         │                                                │
│                    Settlement                                            │
│                      Trigger                                             │
│                         │                                                │
│     ┌─────────┐    ┌────▼─────┐    ┌─────────┐                         │
│     │  Buyer  │◄───│  Escrow  │───►│ Seller  │                         │
│     │  (GRX)  │    │   PDA    │    │  (THB)  │                         │
│     └─────────┘    └──────────┘    └─────────┘                         │
│     • Asynchronous execution                                             │
│     • Parties can be offline                                             │
│     • Supports dispute resolution                                        │
│                                                                          │
│  3. BATCH (Periodic Auction)                                            │
│     ┌────────────────────────────────────────┐                          │
│     │    Batch Clearing Account              │                          │
│     │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ │                          │
│     │  │Buy #1│ │Buy #2│ │Sel #1│ │Sel #2│ │                          │
│     │  └──────┘ └──────┘ └──────┘ └──────┘ │                          │
│     └───────────────────┬────────────────────┘                          │
│                         │ Uniform Price                                  │
│                         ▼                                                │
│     All trades at single Market Clearing Price (MCP)                    │
│     • Optimal price discovery                                            │
│     • Reduced transaction costs                                          │
│     • Fair execution for all                                             │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Instant Settlement (P2P Direct)

### 3.1 Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      INSTANT P2P SETTLEMENT                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Transaction Contents (Single Atomic TX):                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Instruction 1: Transfer THB from Buyer to Seller               │    │
│  │    • from: buyer_thb_ata                                        │    │
│  │    • to: seller_thb_ata                                         │    │
│  │    • amount: energy_amount × price + fee                        │    │
│  │    • authority: buyer (signer)                                  │    │
│  ├─────────────────────────────────────────────────────────────────┤    │
│  │  Instruction 2: Transfer GRX from Seller to Buyer               │    │
│  │    • from: seller_grx_ata                                       │    │
│  │    • to: buyer_grx_ata                                          │    │
│  │    • amount: energy_amount                                      │    │
│  │    • authority: seller (signer)                                 │    │
│  ├─────────────────────────────────────────────────────────────────┤    │
│  │  Instruction 3: Update Order State                              │    │
│  │    • buy_order.filled_amount += energy_amount                   │    │
│  │    • sell_order.filled_amount += energy_amount                  │    │
│  │    • market.total_volume += energy_amount                       │    │
│  │    • market.total_trades += 1                                   │    │
│  ├─────────────────────────────────────────────────────────────────┤    │
│  │  Instruction 4: Emit Trade Event                                │    │
│  │    • TradeExecuted { buyer, seller, amount, price, fee }       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  Atomicity Guarantee:                                                   │
│  • If ANY instruction fails, ENTIRE transaction reverts                 │
│  • Both transfers succeed or neither does                               │
│  • No partial state changes possible                                    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Implementation

```rust
pub fn process_settle_instant(
    ctx: Context<SettleInstant>,
    settlement_amount: u64,
) -> Result<()> {
    let market = &mut ctx.accounts.market.load_mut()?;
    let buy_order = &mut ctx.accounts.buy_order.load_mut()?;
    let sell_order = &mut ctx.accounts.sell_order.load_mut()?;
    let clock = Clock::get()?;
    
    // Validate orders
    require!(
        buy_order.status == OrderStatus::Active as u8 ||
        buy_order.status == OrderStatus::PartiallyFilled as u8,
        TradingError::OrderNotActive
    );
    require!(
        sell_order.status == OrderStatus::Active as u8 ||
        sell_order.status == OrderStatus::PartiallyFilled as u8,
        TradingError::OrderNotActive
    );
    
    // Validate price crossing (buy price >= sell price)
    require!(
        buy_order.price_per_kwh >= sell_order.price_per_kwh,
        TradingError::PricesDoNotCross
    );
    
    // Calculate clearing price (midpoint or VWAP)
    let clearing_price = calculate_clearing_price(
        market,
        buy_order.price_per_kwh,
        sell_order.price_per_kwh,
        settlement_amount,
    );
    
    // Calculate payment
    let gross_payment = clearing_price
        .checked_mul(settlement_amount)
        .ok_or(TradingError::Overflow)?
        / PRICE_DECIMALS;  // Normalize decimals
    
    let fee = gross_payment
        .checked_mul(market.market_fee_bps as u64)
        .ok_or(TradingError::Overflow)?
        / 10_000;
    
    let seller_payment = gross_payment.checked_sub(fee)
        .ok_or(TradingError::Underflow)?;
    
    // ATOMIC TRANSFERS
    
    // 1. Payment: Buyer → Seller
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.buyer_payment_account.to_account_info(),
                to: ctx.accounts.seller_payment_account.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        seller_payment,
    )?;
    
    // 2. Fee: Buyer → Treasury
    if fee > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_payment_account.to_account_info(),
                    to: ctx.accounts.fee_vault.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            fee,
        )?;
    }
    
    // 3. Energy: Seller → Buyer
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.seller_energy_account.to_account_info(),
                to: ctx.accounts.buyer_energy_account.to_account_info(),
                authority: ctx.accounts.seller.to_account_info(),
            },
        ),
        settlement_amount,
    )?;
    
    // Update order states
    buy_order.filled_amount = buy_order.filled_amount
        .checked_add(settlement_amount)
        .ok_or(TradingError::Overflow)?;
    sell_order.filled_amount = sell_order.filled_amount
        .checked_add(settlement_amount)
        .ok_or(TradingError::Overflow)?;
    
    // Update order status
    update_order_status(buy_order);
    update_order_status(sell_order);
    
    // Update market statistics
    market.total_volume = market.total_volume
        .checked_add(settlement_amount)
        .ok_or(TradingError::Overflow)?;
    market.total_trades += 1;
    market.last_clearing_price = clearing_price;
    
    // Update price history
    update_price_history(market, clearing_price, settlement_amount, clock.unix_timestamp);
    
    emit!(TradeExecuted {
        buy_order: ctx.accounts.buy_order.key(),
        sell_order: ctx.accounts.sell_order.key(),
        buyer: ctx.accounts.buyer.key(),
        seller: ctx.accounts.seller.key(),
        amount: settlement_amount,
        price: clearing_price,
        fee,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

fn update_order_status(order: &mut Order) {
    if order.filled_amount >= order.amount {
        order.status = OrderStatus::Completed as u8;
    } else if order.filled_amount > 0 {
        order.status = OrderStatus::PartiallyFilled as u8;
    }
}
```

---

## 4. Escrow Settlement

### 4.1 Escrow Account Structure

```rust
#[account]
pub struct EscrowAccount {
    pub bump: u8,                    // 1
    pub trade_id: u64,               // 8
    
    // Parties
    pub buyer: Pubkey,               // 32
    pub seller: Pubkey,              // 32
    
    // Asset details
    pub energy_amount: u64,          // 8
    pub payment_amount: u64,         // 8
    pub energy_mint: Pubkey,         // 32
    pub payment_mint: Pubkey,        // 32
    
    // Status
    pub status: EscrowStatus,        // 1
    pub created_at: i64,             // 8
    pub expires_at: i64,             // 8
    pub settled_at: Option<i64>,     // 9
    
    // Deposits
    pub energy_deposited: bool,      // 1
    pub payment_deposited: bool,     // 1
    
    // Dispute
    pub disputed: bool,              // 1
    pub dispute_reason: Option<String>, // 36 (Option<4 + 32>)
    
    pub _reserved: [u8; 16],         // 16
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum EscrowStatus {
    Pending = 0,      // Waiting for deposits
    Funded = 1,       // Both parties deposited
    Settled = 2,      // Successfully completed
    Disputed = 3,     // Under dispute
    Expired = 4,      // Timed out
    Cancelled = 5,    // Cancelled by agreement
    Refunded = 6,     // Assets returned
}
```

### 4.2 Escrow Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         ESCROW SETTLEMENT FLOW                           │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. CREATE ESCROW                                                       │
│     ┌─────────────────────────────────────────────────────────────┐    │
│     │  create_escrow(buyer, seller, amount, price, expiry)        │    │
│     │  • Initialize EscrowAccount PDA                             │    │
│     │  • Create energy vault (PDA-owned ATA)                      │    │
│     │  • Create payment vault (PDA-owned ATA)                     │    │
│     │  • Status: Pending                                          │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  2. DEPOSIT PHASE (can happen in any order)                            │
│     ┌─────────────┐                              ┌─────────────┐        │
│     │   SELLER    │                              │    BUYER    │        │
│     │  deposits   │                              │  deposits   │        │
│     │    GRX      │                              │    THB      │        │
│     └──────┬──────┘                              └──────┬──────┘        │
│            │                                            │                │
│            ▼                                            ▼                │
│     ┌─────────────────────────────────────────────────────────────┐    │
│     │                     ESCROW VAULTS                           │    │
│     │     Energy Vault: 100 GRX    Payment Vault: 500 THB        │    │
│     │                     Status: Funded ✓                        │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  3. SETTLEMENT (automatic when both deposited)                         │
│     ┌─────────────────────────────────────────────────────────────┐    │
│     │  settle_escrow()                                            │    │
│     │  • Verify both deposits complete                            │    │
│     │  • Transfer GRX from vault → buyer                          │    │
│     │  • Transfer THB from vault → seller                         │    │
│     │  • Collect fee                                              │    │
│     │  • Status: Settled                                          │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ALTERNATIVE PATHS:                                                     │
│                                                                          │
│  4a. EXPIRY (if deposits incomplete before expires_at)                 │
│      └── refund_escrow() → Return any deposited assets                 │
│                                                                          │
│  4b. DISPUTE (if party claims issue)                                   │
│      └── dispute_escrow(reason) → Freeze, await resolution             │
│                                                                          │
│  4c. CANCEL (by mutual agreement)                                      │
│      └── cancel_escrow() → Return assets to original owners            │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Implementation

```rust
pub fn process_create_escrow(
    ctx: Context<CreateEscrow>,
    trade_id: u64,
    energy_amount: u64,
    payment_amount: u64,
    expiry_seconds: i64,
) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;
    let clock = Clock::get()?;
    
    escrow.bump = ctx.bumps.escrow;
    escrow.trade_id = trade_id;
    escrow.buyer = ctx.accounts.buyer.key();
    escrow.seller = ctx.accounts.seller.key();
    escrow.energy_amount = energy_amount;
    escrow.payment_amount = payment_amount;
    escrow.energy_mint = ctx.accounts.energy_mint.key();
    escrow.payment_mint = ctx.accounts.payment_mint.key();
    escrow.status = EscrowStatus::Pending;
    escrow.created_at = clock.unix_timestamp;
    escrow.expires_at = clock.unix_timestamp + expiry_seconds;
    escrow.energy_deposited = false;
    escrow.payment_deposited = false;
    escrow.disputed = false;
    
    emit!(EscrowCreated {
        escrow: ctx.accounts.escrow.key(),
        buyer: escrow.buyer,
        seller: escrow.seller,
        energy_amount,
        payment_amount,
        expires_at: escrow.expires_at,
    });
    
    Ok(())
}

pub fn process_deposit_energy(ctx: Context<DepositEnergy>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;
    
    require!(
        escrow.status == EscrowStatus::Pending,
        EscrowError::InvalidStatus
    );
    require!(
        !escrow.energy_deposited,
        EscrowError::AlreadyDeposited
    );
    require!(
        Clock::get()?.unix_timestamp < escrow.expires_at,
        EscrowError::Expired
    );
    
    // Transfer energy to escrow vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.seller_energy_account.to_account_info(),
                to: ctx.accounts.energy_vault.to_account_info(),
                authority: ctx.accounts.seller.to_account_info(),
            },
        ),
        escrow.energy_amount,
    )?;
    
    escrow.energy_deposited = true;
    
    // Check if escrow is fully funded
    if escrow.energy_deposited && escrow.payment_deposited {
        escrow.status = EscrowStatus::Funded;
        emit!(EscrowFunded { escrow: ctx.accounts.escrow.key() });
    }
    
    Ok(())
}

pub fn process_settle_escrow(ctx: Context<SettleEscrow>) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    let clock = Clock::get()?;
    
    require!(
        escrow.status == EscrowStatus::Funded,
        EscrowError::NotFunded
    );
    require!(
        !escrow.disputed,
        EscrowError::UnderDispute
    );
    
    // Calculate fee
    let fee = escrow.payment_amount
        .checked_mul(ctx.accounts.market.load()?.market_fee_bps as u64)
        .ok_or(EscrowError::Overflow)?
        / 10_000;
    let seller_payment = escrow.payment_amount - fee;
    
    // Escrow PDA signer seeds
    let seeds = &[
        b"escrow".as_ref(),
        &escrow.trade_id.to_le_bytes(),
        &[escrow.bump],
    ];
    let signer = &[&seeds[..]];
    
    // Transfer energy to buyer
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.energy_vault.to_account_info(),
                to: ctx.accounts.buyer_energy_account.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            },
            signer,
        ),
        escrow.energy_amount,
    )?;
    
    // Transfer payment to seller
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.payment_vault.to_account_info(),
                to: ctx.accounts.seller_payment_account.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            },
            signer,
        ),
        seller_payment,
    )?;
    
    // Transfer fee to treasury
    if fee > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payment_vault.to_account_info(),
                    to: ctx.accounts.fee_vault.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer,
            ),
            fee,
        )?;
    }
    
    // Update escrow status
    ctx.accounts.escrow.status = EscrowStatus::Settled;
    ctx.accounts.escrow.settled_at = Some(clock.unix_timestamp);
    
    emit!(EscrowSettled {
        escrow: ctx.accounts.escrow.key(),
        buyer: escrow.buyer,
        seller: escrow.seller,
        energy_amount: escrow.energy_amount,
        payment_amount: seller_payment,
        fee,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}
```

---

## 5. Batch Settlement

### 5.1 Batch Structure

```rust
#[account(zero_copy)]
#[repr(C)]
pub struct SettlementBatch {
    pub batch_id: u64,                  // 8
    pub market: Pubkey,                 // 32
    pub clearing_price: u64,            // 8
    pub total_energy: u64,              // 8
    pub total_payment: u64,             // 8
    pub settlement_count: u32,          // 4
    pub status: u8,                     // 1
    pub created_at: i64,                // 8
    pub settled_at: i64,                // 8
    pub _padding: [u8; 3],              // 3
    pub settlements: [Settlement; 50],  // 50 × 88 = 4400
}

#[derive(Clone, Copy, Default, Pod, Zeroable)]
#[repr(C)]
pub struct Settlement {
    pub buyer: Pubkey,                  // 32
    pub seller: Pubkey,                 // 32
    pub energy_amount: u64,             // 8
    pub payment_amount: u64,            // 8
    pub settled: u8,                    // 1
    pub _padding: [u8; 7],              // 7
}
```

### 5.2 Batch Settlement Process

```rust
pub fn process_execute_batch_settlement(
    ctx: Context<ExecuteBatchSettlement>,
    start_index: u32,
    count: u32,
) -> Result<()> {
    let batch = &mut ctx.accounts.batch.load_mut()?;
    let clock = Clock::get()?;
    
    require!(
        batch.status == BatchStatus::Cleared as u8,
        SettlementError::BatchNotCleared
    );
    
    let end_index = (start_index + count).min(batch.settlement_count);
    
    for i in start_index..end_index {
        let settlement = &mut batch.settlements[i as usize];
        
        if settlement.settled == 1 {
            continue; // Skip already settled
        }
        
        // Execute individual settlement
        // Note: In practice, accounts would be passed via remaining_accounts
        execute_single_settlement(
            settlement,
            batch.clearing_price,
            &ctx.remaining_accounts,
            ctx.accounts.token_program.to_account_info(),
        )?;
        
        settlement.settled = 1;
    }
    
    // Check if all settled
    let all_settled = batch.settlements[0..batch.settlement_count as usize]
        .iter()
        .all(|s| s.settled == 1);
    
    if all_settled {
        batch.status = BatchStatus::Settled as u8;
        batch.settled_at = clock.unix_timestamp;
        
        emit!(BatchSettled {
            batch_id: batch.batch_id,
            settlement_count: batch.settlement_count,
            total_energy: batch.total_energy,
            total_payment: batch.total_payment,
            timestamp: clock.unix_timestamp,
        });
    }
    
    Ok(())
}
```

---

## 6. Payment Methods

### 6.1 Supported Payment Tokens

| Token | Type | Decimals | Use Case |
|-------|------|----------|----------|
| USDC | SPL Token | 6 | International |
| USDT | SPL Token | 6 | International |
| THB (Mock) | SPL Token | 6 | Domestic testing |
| Wrapped ETH | SPL Token | 8 | Cross-chain |
| GRX | SPL Token-2022 | 9 | Internal |

### 6.2 Stablecoin Integration

```rust
#[account]
pub struct PaymentConfig {
    pub market: Pubkey,
    pub accepted_tokens: [AcceptedToken; 5],
    pub token_count: u8,
    pub default_token: Pubkey,
}

#[derive(Clone, Copy)]
pub struct AcceptedToken {
    pub mint: Pubkey,
    pub oracle: Pubkey,        // Price oracle for conversion
    pub min_amount: u64,
    pub max_amount: u64,
    pub enabled: bool,
}
```

---

## 7. Fee Collection

### 7.1 Fee Structure

```rust
#[account]
pub struct FeeConfig {
    pub market: Pubkey,
    
    // Fee rates (basis points)
    pub maker_fee_bps: u16,        // Liquidity providers
    pub taker_fee_bps: u16,        // Liquidity takers
    pub settlement_fee_bps: u16,   // Settlement processing
    
    // Fee distribution
    pub treasury_share_bps: u16,   // Platform treasury
    pub staker_share_bps: u16,     // GRX stakers
    pub burn_share_bps: u16,       // Token burn
    
    // Fee vaults
    pub fee_vault: Pubkey,
    pub total_fees_collected: u64,
}
```

### 7.2 Fee Distribution

```
Fee Collected: 100 THB
    │
    ├── Treasury (50%): 50 THB
    │   └── Operations, development
    │
    ├── Stakers (30%): 30 THB
    │   └── Distributed pro-rata to GRX stakers
    │
    └── Burn (20%): 20 THB worth of GRX
        └── Deflationary mechanism
```

---

## 8. Settlement Finality

### 8.1 Confirmation Levels

| Level | Confirmations | Time | Guarantee |
|-------|---------------|------|-----------|
| Optimistic | 0 | Instant | ~95% finality |
| Safe | 1 | ~400ms | ~99% finality |
| Finalized | 32 | ~13s | Irreversible |

### 8.2 Finality in Trading

```rust
// For high-value trades, wait for finalized confirmation
pub fn check_settlement_finality(
    ctx: Context<CheckFinality>,
    settlement_slot: u64,
) -> Result<bool> {
    let current_slot = Clock::get()?.slot;
    let confirmations = current_slot.saturating_sub(settlement_slot);
    
    const FINALITY_THRESHOLD: u64 = 32;
    
    let is_final = confirmations >= FINALITY_THRESHOLD;
    
    emit!(FinalityChecked {
        settlement_slot,
        current_slot,
        confirmations,
        is_final,
    });
    
    Ok(is_final)
}
```

---

## 9. Error Handling

### 9.1 Settlement Errors

```rust
#[error_code]
pub enum SettlementError {
    #[msg("Orders do not have crossing prices")]
    PricesDoNotCross,
    
    #[msg("Insufficient balance for settlement")]
    InsufficientBalance,
    
    #[msg("Settlement amount exceeds available")]
    AmountExceedsAvailable,
    
    #[msg("Order is not in settleable state")]
    OrderNotSettleable,
    
    #[msg("Escrow has expired")]
    EscrowExpired,
    
    #[msg("Escrow is under dispute")]
    EscrowDisputed,
    
    #[msg("Batch is not cleared for settlement")]
    BatchNotCleared,
    
    #[msg("Invalid settlement index")]
    InvalidSettlementIndex,
    
    #[msg("Arithmetic overflow")]
    Overflow,
}
```

---

## 10. Compute Unit Profile

| Operation | CU Cost | Notes |
|-----------|---------|-------|
| `settle_instant` | ~45,000 | 2 token transfers |
| `create_escrow` | ~20,000 | Account init + vaults |
| `deposit_energy` | ~25,000 | Token transfer |
| `deposit_payment` | ~25,000 | Token transfer |
| `settle_escrow` | ~50,000 | 3 token transfers |
| `batch_settlement` (per item) | ~40,000 | Bulk optimization |

---

## 11. Security Checklist

```
✅ Atomicity
   □ All transfers in single instruction
   □ State changes after transfers
   □ No partial settlement possible

✅ Authorization
   □ Only order owners can settle
   □ Escrow requires party signatures
   □ Batch requires market authority

✅ Validation
   □ Price crossing verified
   □ Amounts within order limits
   □ Expiry checked before settlement

✅ Funds Safety
   □ Escrow vaults are PDA-owned
   □ No direct vault access
   □ Refund mechanism for failures

✅ Audit Trail
   □ All settlements emit events
   □ Trade records stored
   □ Fee collection logged
```

---

## 12. References

1. Solana. "Atomic Transactions and Partial Signing"
2. Serum DEX. "Settlement Engine Design"
3. Lightning Network. "HTLC-based Atomic Swaps"
