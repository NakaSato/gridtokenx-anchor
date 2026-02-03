# AMM & Bonding Curves: Deep Dive

> **Technical Analysis of Energy-Specific Automated Market Makers**

---

## 1. Executive Summary

The GridTokenX AMM module implements a novel **energy source-specific bonding curve system** that provides instant liquidity for energy trading. Unlike generic constant-product (x*y=k) AMMs, our implementation uses **linear bonding curves with configurable slopes** tailored to the volatility characteristics of different renewable energy sources.

**Key Innovations:**
- First implementation of energy-type-aware bonding curves on Solana
- Solar, Wind, and Battery storage have different price dynamics
- Zero-copy account access for high-throughput swaps
- Integration with Time-of-Use pricing module

---

## 2. Mathematical Foundation

### 2.1 Linear Bonding Curve Model

The AMM uses a linear price function where the price increases linearly with supply:

$$
P(x) = b + mx
$$

Where:
- $P(x)$ = Price at supply level $x$
- $b$ = Base price (y-intercept)
- $m$ = Slope (price sensitivity to supply changes)
- $x$ = Current energy reserve in pool

### 2.2 Cost Integration Formula

When purchasing $\Delta$ units of energy starting from supply $x$, the total cost is the integral:

$$
\text{Cost}(x, \Delta) = \int_{x}^{x+\Delta} P(s) \, ds = \int_{x}^{x+\Delta} (b + ms) \, ds
$$

Solving the integral:

$$
\text{Cost}(x, \Delta) = b\Delta + \frac{m}{2}\left[(x+\Delta)^2 - x^2\right]
$$

Expanding:

$$
\text{Cost}(x, \Delta) = b\Delta + \frac{m}{2}\left[2x\Delta + \Delta^2\right]
$$

**Final Formula:**
$$
\boxed{\text{Cost}(x, \Delta) = b\Delta + m\left(x\Delta + \frac{\Delta^2}{2}\right)}
$$

### 2.3 Implementation in Rust

```rust
/// Calculate cost for buying `delta` energy at current supply `x`
/// All values in atomic units (9 decimals)
fn calculate_buy_cost(
    base: u64,           // b: base price
    slope: u64,          // m: slope (scaled by 1000)
    current_supply: u64, // x: current energy reserve
    delta: u64,          // Δ: amount to purchase
) -> u64 {
    // Use u128 for intermediate calculations to prevent overflow
    let base = base as u128;
    let slope = slope as u128;
    let x = current_supply as u128;
    let d = delta as u128;
    
    // Cost = b*Δ + (m/2000) * (2xΔ + Δ²)
    // Note: slope is pre-scaled by 1000, so we divide by 2000 (not 2)
    let base_cost = base.checked_mul(d).unwrap();
    let slope_term = slope
        .checked_mul(2u128.checked_mul(x).unwrap().checked_mul(d).unwrap()
            .checked_add(d.checked_mul(d).unwrap()).unwrap())
        .unwrap()
        .checked_div(2000)
        .unwrap();
    
    base_cost.checked_add(slope_term).unwrap() as u64
}
```

---

## 3. Energy Source-Specific Curves

### 3.1 Curve Type Definitions

```rust
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CurveType {
    LinearSolar = 0,   // Standard slope
    SteepWind = 1,     // 2x slope multiplier (high volatility)
    FlatBattery = 2,   // 0.5x slope multiplier (stable storage)
}
```

### 3.2 Slope Multipliers

| Curve Type | Slope Multiplier | Rationale |
|------------|------------------|-----------|
| **LinearSolar** | 1.0x | Baseline. Solar production is predictable with weather forecasts. |
| **SteepWind** | 2.0x | Wind is intermittent. Rapid price response incentivizes demand-side flexibility. |
| **FlatBattery** | 0.5x | Battery storage provides consistent output. Lower volatility = flatter curve. |

### 3.3 Visual Comparison

```
Price (THB/kWh)
│
│                                          ╱ SteepWind (2x slope)
│                                        ╱
│                                      ╱
│                                    ╱
│                                  ╱      ╱ LinearSolar (1x slope)
│                                ╱      ╱
│                              ╱      ╱
│                            ╱      ╱
│                          ╱      ╱      ╱ FlatBattery (0.5x slope)
│                        ╱      ╱      ╱
│                      ╱      ╱      ╱
│                    ╱      ╱      ╱
│                  ╱      ╱      ╱
│                ╱      ╱      ╱
│              ╱      ╱      ╱
│            ╱      ╱      ╱
│__________╱______╱______╱_________________________ Energy Supply
│          base
└──────────────────────────────────────────────────────────►
```

### 3.4 Adjusted Slope Calculation

```rust
fn get_adjusted_slope(curve_type: CurveType, base_slope: u64) -> u64 {
    match curve_type {
        CurveType::LinearSolar => base_slope,
        CurveType::SteepWind => base_slope.saturating_mul(2),
        CurveType::FlatBattery => base_slope / 2,
    }
}
```

---

## 4. Pool State Architecture

### 4.1 Account Structure

```rust
#[account]
pub struct AmmPool {
    pub market: Pubkey,           // 32 bytes - Parent market
    pub energy_mint: Pubkey,      // 32 bytes - GRX token mint
    pub currency_mint: Pubkey,    // 32 bytes - USDC/THB mint
    pub energy_reserve: u64,      // 8 bytes  - Current energy in pool
    pub currency_reserve: u64,    // 8 bytes  - Current currency in pool
    pub curve_type: CurveType,    // 1 byte   - Curve classification
    pub bonding_slope: u64,       // 8 bytes  - Base slope (m)
    pub bonding_base: u64,        // 8 bytes  - Base price (b)
    pub fee_bps: u16,             // 2 bytes  - Swap fee (basis points)
    pub bump: u8,                 // 1 byte   - PDA bump seed
}

// Total: 8 (discriminator) + 132 = 140 bytes
```

### 4.2 PDA Derivation

```rust
// Pool PDA is derived from market + curve type
// This allows ONE pool per energy source type per market
let (pool_pda, bump) = Pubkey::find_program_address(
    &[
        b"amm_pool",
        market.key().as_ref(),
        &[curve_type as u8],
    ],
    &program_id
);
```

**Design Decision:** Using `curve_type` in seeds ensures each market can have exactly 3 pools (Solar, Wind, Battery), preventing duplicate pools and simplifying routing.

---

## 5. Swap Mechanics

### 5.1 Buy Energy Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SWAP BUY ENERGY                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. User Request: "Buy 100 kWh with max 500 THB"                       │
│                                                                         │
│  2. Calculate Cost:                                                     │
│     ┌─────────────────────────────────────────────────────────────┐    │
│     │ current_supply = pool.energy_reserve = 1000 kWh             │    │
│     │ base = 4.00 THB/kWh                                         │    │
│     │ slope = 0.002 (adjusted for LinearSolar)                    │    │
│     │                                                             │    │
│     │ cost = 4.00 × 100 + 0.002 × (1000×100 + 100²/2)            │    │
│     │      = 400 + 0.002 × (100,000 + 5,000)                      │    │
│     │      = 400 + 210                                            │    │
│     │      = 410 THB                                              │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  3. Apply Fee (0.3%):                                                   │
│     fee = 410 × 0.003 = 1.23 THB                                       │
│     total_cost = 411.23 THB                                            │
│                                                                         │
│  4. Slippage Check:                                                     │
│     require!(411.23 <= 500, SlippageExceeded) ✓                        │
│                                                                         │
│  5. Atomic Transfer:                                                    │
│     ┌──────────────────┐        ┌──────────────────┐                   │
│     │   User Wallet    │        │    AMM Pool      │                   │
│     │                  │        │                  │                   │
│     │ THB: 500 → 88.77 │───────►│ THB: += 411.23   │                   │
│     │ GRX: 0   → 100   │◄───────│ GRX: -= 100      │                   │
│     └──────────────────┘        └──────────────────┘                   │
│                                                                         │
│  6. Update State:                                                       │
│     pool.energy_reserve = 1000 - 100 = 900 kWh                         │
│     pool.currency_reserve += 411.23 THB                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Sell Energy Flow

When selling energy back to the pool, the price is calculated at the **current supply level** (lower price than buying at that level, creating the bid-ask spread):

$$
\text{Revenue}(x, \Delta) = b\Delta + m\left((x-\Delta)\Delta + \frac{\Delta^2}{2}\right)
$$

```rust
fn calculate_sell_revenue(
    base: u64,
    slope: u64,
    current_supply: u64,
    delta: u64,
) -> u64 {
    let base = base as u128;
    let slope = slope as u128;
    let x = current_supply as u128;
    let d = delta as u128;
    
    // Revenue = b*Δ + (m/2000) * (2(x-Δ)Δ + Δ²)
    let new_supply = x.saturating_sub(d);
    let base_revenue = base.checked_mul(d).unwrap();
    let slope_term = slope
        .checked_mul(2u128.checked_mul(new_supply).unwrap().checked_mul(d).unwrap()
            .checked_add(d.checked_mul(d).unwrap()).unwrap())
        .unwrap()
        .checked_div(2000)
        .unwrap();
    
    base_revenue.checked_add(slope_term).unwrap() as u64
}
```

---

## 6. Fee Structure

### 6.1 Fee Calculation

```rust
pub fn apply_fee(amount: u64, fee_bps: u16) -> (u64, u64) {
    let fee = (amount as u128)
        .checked_mul(fee_bps as u128)
        .unwrap()
        .checked_div(10_000)
        .unwrap() as u64;
    
    let net_amount = amount.saturating_sub(fee);
    (net_amount, fee)
}
```

### 6.2 Fee Distribution

| Recipient | Percentage | Purpose |
|-----------|------------|---------|
| Protocol Treasury | 50% | Platform operations, development |
| Liquidity Providers | 30% | Incentivize pool deposits |
| Carbon Offset Fund | 20% | Environmental sustainability |

---

## 7. Security Considerations

### 7.1 Overflow Protection

All arithmetic uses **saturating operations** and **checked math** with u128 intermediates:

```rust
// BAD: Can overflow on large values
let result = a * b / c;

// GOOD: Checked arithmetic with explicit error handling
let result = (a as u128)
    .checked_mul(b as u128)
    .ok_or(ErrorCode::MathOverflow)?
    .checked_div(c as u128)
    .ok_or(ErrorCode::DivisionByZero)? as u64;
```

### 7.2 Slippage Protection

Users specify `max_currency` (for buys) or `min_currency` (for sells) to protect against front-running:

```rust
require!(
    total_cost <= max_currency,
    AmmError::SlippageExceeded
);
```

### 7.3 Re-entrancy Guard

Pool operations use Anchor's `#[account(mut)]` checks, and all state updates happen **after** token transfers:

```rust
// 1. Calculate amounts (read-only)
// 2. Transfer tokens (CPI)
// 3. Update pool state (LAST - prevents re-entrancy)
```

### 7.4 Price Manipulation Resistance

The linear bonding curve naturally resists manipulation:
- Large trades cause significant price impact (disincentivizes whales)
- No discrete price levels (unlike order books) eliminates "cliff" attacks
- Time-of-Use integration adds external price anchoring

---

## 8. Compute Unit Profile

| Operation | CU Cost | Bottleneck |
|-----------|---------|------------|
| `initialize_amm_pool` | ~15,000 | Account creation |
| `swap_buy_energy` | ~35,000 | Token CPI calls |
| `swap_sell_energy` | ~35,000 | Token CPI calls |
| Bonding curve calculation | ~2,000 | Integer math |

**Optimization Tip:** Batch multiple swaps using lookup tables (ALTs) to reduce per-swap overhead.

---

## 9. Integration Example

### 9.1 TypeScript Client

```typescript
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import { Trading } from '../target/types/trading';

async function buyEnergy(
  program: Program<Trading>,
  poolAddress: PublicKey,
  amountKwh: number,
  maxThb: number,
) {
  const amountMilli = Math.floor(amountKwh * 1_000_000_000); // 9 decimals
  const maxCurrency = Math.floor(maxThb * 1_000_000); // 6 decimals
  
  await program.methods
    .swapBuyEnergy(new BN(amountMilli), new BN(maxCurrency))
    .accounts({
      pool: poolAddress,
      userEnergyAccount: userGrxAta,
      userCurrencyAccount: userThbAta,
      poolEnergyVault: poolGrxVault,
      poolCurrencyVault: poolThbVault,
      energyMint: grxMint,
      currencyMint: thbMint,
      user: wallet.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .rpc();
}
```

---

## 10. Research Applications

### 10.1 Economic Simulations

The bonding curve parameters can be tuned for research:

```rust
// High-volatility scenario (stress test)
let steep_pool = AmmPool {
    bonding_slope: 5000,  // 5x normal
    bonding_base: 2_000_000,
    curve_type: CurveType::SteepWind,
    ..Default::default()
};

// Subsidy scenario (government incentive)
let subsidized_pool = AmmPool {
    bonding_slope: 100,   // Near-flat curve
    bonding_base: 1_000_000,  // Below market rate
    curve_type: CurveType::FlatBattery,
    ..Default::default()
};
```

### 10.2 Comparative Analysis

| Metric | GridTokenX AMM | Uniswap V2 | Curve Finance |
|--------|----------------|------------|---------------|
| Curve Type | Linear | Constant Product | StableSwap |
| Price Impact | Predictable | Hyperbolic | Low (stable pairs) |
| Capital Efficiency | High | Low | Very High |
| Energy-Specific | ✅ | ❌ | ❌ |

---

## 11. Future Enhancements

1. **Concentrated Liquidity**: Allow LPs to specify price ranges (similar to Uniswap V3)
2. **Dynamic Fee Tiers**: Adjust fees based on volatility and market conditions
3. **Multi-hop Routing**: Swap through multiple pools for better pricing
4. **Oracle Integration**: Use Pyth/Switchboard for external price validation

---

## References

1. Bancor Protocol Whitepaper - Original bonding curve concept
2. Solana Program Library - Token program specifications
3. GridTokenX ALGORITHMS.md - Platform algorithm documentation
