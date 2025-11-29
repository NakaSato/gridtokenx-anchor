# Cross-Program Invocation (CPI) Implementation

## Overview

Successfully implemented one-way CPI from **registry** program to **energy-token** program, enabling seamless meter settlement and automatic token minting in a single transaction.

## 🏗️ Architecture

### CPI Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    CPI Flow Diagram                      │
└─────────────────────────────────────────────────────────┘

User Transaction
     │
     ▼
┌──────────────────────────────────────────┐
│   Registry Program                       │
│                                          │
│   settle_and_mint_tokens()              │
│   ├─ Calculate unsettled balance        │
│   ├─ Update settled_net_generation      │
│   │                                      │
│   └─ CPI Call ────────────────┐        │
│                                 │        │
└─────────────────────────────────┼────────┘
                                  │
                                  │ energy_token::cpi::mint_tokens_direct()
                                  │
                                  ▼
            ┌─────────────────────────────────────┐
            │   Energy Token Program              │
            │                                     │
            │   mint_tokens_direct()              │
            │   ├─ Validate authority             │
            │   ├─ Mint tokens to user            │
            │   └─ Update total supply            │
            └─────────────────────────────────────┘
```

### Program Dependency Structure

```mermaid
graph LR
    A[Registry Program] -->|CPI Dependency| B[Energy Token Program]
    A -->|Calls| C[mint_tokens_direct]
    B -->|Executes| D[SPL Token Mint]
    
    style A fill:#4CAF50
    style B fill:#2196F3
    style C fill:#FF9800
    style D fill:#9C27B0
```

## Implementation Details

### 1. Dependency Configuration

**Registry Program Dependencies:**
- Added `energy-token` with CPI feature enabled
- Path-based dependency pointing to sibling program
- Enables type-safe cross-program calls

**Why One-Way Only?**
- Avoids circular dependency compilation errors
- Logical flow: Settlement precedes token generation
- Registry is the authoritative source for meter data
- Energy-token serves as execution layer for minting operations

### 2. Registry Program - New CPI Function

**Function Name:** `settle_and_mint_tokens`

**Purpose:** Atomically combine meter balance settlement with GRID token minting

**Process Flow:**

1. **Validation Phase**
   - Verify meter status is Active
   - Confirm caller is the meter owner
   - Check authority permissions

2. **Settlement Calculation**
   - Calculate current net generation (production - consumption)
   - Determine unsettled balance since last settlement
   - Validate that tokens are available to mint

3. **State Update**
   - Update `settled_net_generation` tracker
   - Prevents double-minting attacks
   - Emit settlement event for external monitoring

4. **CPI Execution**
   - Package accounts for energy-token program
   - Create CPI context with proper signatures
   - Invoke `mint_tokens_direct` on energy-token program
   - Pass calculated token amount

5. **Completion**
   - Energy-token mints tokens to user account
   - Updates total supply in TokenInfo
   - Emits minting event
   - Transaction completes atomically

### 3. Account Requirements

**Registry Side Accounts:**
- Meter account (mutable, contains settlement data)
- Meter owner (signer, proves ownership)
- Token info PDA (mutable, energy-token program state)
- Mint account (mutable, SPL token mint)
- User token account (mutable, receives tokens)
- Authority (energy-token mint authority)
- Energy-token program (validated during CPI)
- SPL Token program (for minting operations)

**Security Constraints:**
- All mutable accounts validated for proper ownership
- Signer requirements enforced at transaction level
- PDA derivations verified automatically by Anchor
- Program IDs checked during CPI invocation

## Usage Patterns

### Single-Call User Experience

Users can now settle their meter balance and receive tokens in one transaction by calling `settle_and_mint_tokens` on the registry program with all required accounts.

**Account Ordering:**
1. Meter account PDA
2. Meter owner (user wallet, signer)
3. Token info PDA (from energy-token program)
4. Mint public key
5. User's associated token account
6. Mint authority
7. Energy-token program ID
8. SPL Token program ID

### Alternative: Two-Step Approach

For advanced use cases requiring manual control, the original `settle_meter_balance` function remains available. This returns the amount to mint, allowing users to conditionally mint or handle the value differently.

## Benefits of This Approach

### ✅ No Circular Dependencies
- Clean compilation without dependency cycles
- Maintainable code structure
- Easier to reason about program interactions
- Simplified testing and debugging

### ✅ Atomic Operations
- Settlement and minting happen in single transaction
- All-or-nothing execution guarantee
- No risk of partial state updates
- Consistent blockchain state

### ✅ Gas Efficiency
- One transaction instead of two
- Lower total transaction fees
- Reduced network congestion
- Better scalability

### ✅ Better User Experience
- Single function call handles entire flow
- Simpler client-side integration
- Fewer potential user errors
- Reduced cognitive load

### ✅ Enhanced Security
- Settlement logic centralized in registry
- Energy-token focuses solely on minting
- Clear separation of concerns
- Reduced attack surface

## Transaction Flow Comparison

### Before CPI Implementation

**User Actions Required:**
1. Call `registry.settle_meter_balance()`
2. Receive return value (amount to mint)
3. Call `energy_token.mint_tokens(amount)`

**Issues:**
- Two separate transactions required
- User might forget second step
- Higher cumulative gas costs
- Risk of inconsistent state if second call fails
- Poor user experience

### After CPI Implementation

**User Actions Required:**
1. Call `registry.settle_and_mint_tokens()`

**Improvements:**
- ✅ Single transaction
- ✅ Automatic execution
- ✅ Lower gas cost
- ✅ Guaranteed consistency
- ✅ Superior user experience

## Testing Strategy

### Test Scenarios

**Happy Path:**
1. Setup user account and meter registration
2. Update meter readings to create surplus energy
3. Execute `settle_and_mint_tokens`
4. Verify meter's `settled_net_generation` updated correctly
5. Confirm tokens minted to user's account
6. Check that events were emitted

**Edge Cases:**
1. No unsettled balance (should fail gracefully)
2. Inactive meter status (should reject)
3. Unauthorized caller (should reject)
4. Insufficient account permissions (should fail)
5. Invalid token accounts (should fail)

**Security Tests:**
1. Attempt double-minting attack (should fail)
2. Try calling with wrong authority (should fail)
3. Verify PDA validation works correctly
4. Test with malformed accounts (should fail)

## Future Enhancement Opportunities

### Potential Additional CPI Integrations

**Registry → Oracle**
- Verify real-time price feeds during settlement
- Get current energy market valuations
- Calculate optimal settlement amounts

**Registry → Governance**
- Validate meter ownership certificates
- Check renewable energy certification status
- Enforce compliance requirements

**Energy-Token → Trading**
- Auto-create sell orders after minting
- Enable programmatic market-making
- Implement automated trading strategies

**Multi-Program Workflows**
- Chain multiple CPIs in sequence
- Create complex business logic flows
- Build composable DeFi primitives

## Technical Specifications

### Program Versions
- **Registry:** v0.1.0
- **Energy-Token:** v0.1.0
- **Anchor Framework:** 0.32.1

### Build Status
✅ All programs compile successfully
✅ No critical errors
⚠️ Minor Anchor configuration warnings (safe to ignore)

### Deployment Requirements
- Solana localnet/devnet/mainnet
- Anchor 0.32.1 or compatible
- Program authorities configured
- Token mint initialized

## Key Design Decisions

### Why Registry Calls Energy-Token (Not Vice Versa)

**Rationale:**
- Registry owns the source data (meter readings)
- Settlement calculation requires registry state
- Token minting is a consequence of settlement
- Maintains single source of truth principle

### Why Use Anchor CPI Instead of Manual Instructions

**Advantages:**
- Type-safe account validation
- Automatic serialization/deserialization
- Better error messages
- Cleaner code
- Easier maintenance

### Why Keep `settle_meter_balance` Separate

**Flexibility:**
- Some use cases need just the settlement amount
- Advanced integrations may want manual control
- Backwards compatibility with existing code
- Testing and debugging purposes

## Summary

The CPI implementation creates a **production-ready, efficient, and user-friendly** token minting system:

| Aspect | Implementation |
|--------|---------------|
| **Architecture** | One-way CPI from registry to energy-token |
| **User Experience** | Single transaction for settlement + minting |
| **Security** | Atomic execution with double-mint prevention |
| **Performance** | Optimized gas usage, single-call pattern |
| **Maintainability** | Clean separation of concerns, no circular deps |
| **Extensibility** | Foundation for future multi-program workflows |

This pattern establishes best practices for cross-program communication that can be extended to other program interactions as the GridTokenX platform evolves.

---

**Implementation Date:** 2025-11-25  
**Build Status:** ✅ Successful  
**Ready For:** Integration testing and deployment
