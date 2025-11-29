# Security Best Practices

> **Security guidelines for GridTokenX development and deployment**

---

## Key Management

### Private Key Security

**DO NOT:**
- Commit private keys to version control
- Store keys in plain text files
- Share keys via unencrypted channels
- Use the same key for dev and production

**DO:**
```bash
# Use environment variables
export WALLET_PRIVATE_KEY="[your-key]"

# Or use Solana CLI keyfile
solana-keygen new --outfile ~/.config/solana/id.json
```

### Keypair Generation

```typescript
import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';

// Generate new keypair
const keypair = Keypair.generate();

// Save securely (encrypt in production)
fs.writeFileSync(
  'keypair.json',
  JSON.stringify(Array.from(keypair.secretKey))
);
```

---

## Program Security

### PDA Validation

Always validate PDA derivation:

```rust
#[derive(Accounts)]
pub struct SecureInstruction<'info> {
    #[account(
        seeds = [b"user", authority.key().as_ref()],
        bump,
        constraint = user_account.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub user_account: Account<'info, UserAccount>,
    
    pub authority: Signer<'info>,
}
```

### Signer Verification

Always require signers for mutations:

```rust
#[account(mut)]
pub authority: Signer<'info>,  // Must sign transaction

// Verify ownership
require!(
    ctx.accounts.account.owner == ctx.accounts.authority.key(),
    ErrorCode::Unauthorized
);
```

### Arithmetic Safety

Use checked math operations:

```rust
// ❌ Unsafe - can overflow
let total = amount1 + amount2;

// ✅ Safe - returns error on overflow
let total = amount1.checked_add(amount2)
    .ok_or(ErrorCode::MathOverflow)?;

// Or use Anchor's require!
require!(amount <= u64::MAX - balance, ErrorCode::Overflow);
```

### Account Validation

Validate all accounts:

```rust
#[derive(Accounts)]
pub struct Transfer<'info> {
    #[account(
        mut,
        has_one = owner @ ErrorCode::InvalidOwner,
        constraint = from_account.amount >= amount @ ErrorCode::InsufficientBalance
    )]
    pub from_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = to_account.mint == from_account.mint @ ErrorCode::MintMismatch
    )]
    pub to_account: Account<'info, TokenAccount>,
    
    pub owner: Signer<'info>,
}
```

---

## CPI Security

### Validate Program IDs

```rust
// Always verify the program being called
require!(
    ctx.accounts.token_program.key() == token::ID,
    ErrorCode::InvalidProgram
);
```

### Use CpiContext

```rust
let cpi_accounts = Transfer {
    from: ctx.accounts.from.to_account_info(),
    to: ctx.accounts.to.to_account_info(),
    authority: ctx.accounts.authority.to_account_info(),
};

let cpi_program = ctx.accounts.token_program.to_account_info();
let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

// With PDA signer
let seeds = &[b"escrow", &[bump]];
let signer_seeds = &[&seeds[..]];
let cpi_ctx_signed = CpiContext::new_with_signer(
    cpi_program,
    cpi_accounts,
    signer_seeds
);
```

---

## Transaction Security

### Replay Protection

Transactions include recent blockhash automatically, providing replay protection.

For additional protection:
```rust
#[account]
pub struct Order {
    pub nonce: u64,  // Unique per user
    // ... other fields
}

// Verify nonce increments
require!(new_nonce > old_nonce, ErrorCode::InvalidNonce);
```

### Atomic Operations

Ensure related operations are atomic:

```rust
// All-or-nothing trade execution
pub fn execute_trade(ctx: Context<ExecuteTrade>) -> Result<()> {
    // 1. Transfer tokens from escrow to buyer
    transfer_tokens_to_buyer()?;
    
    // 2. Transfer payment to seller
    transfer_payment_to_seller()?;
    
    // 3. Update order status
    ctx.accounts.order.status = OrderStatus::Filled;
    
    // If any step fails, entire transaction reverts
    Ok(())
}
```

---

## Access Control

### Role-Based Access

```rust
#[account]
pub struct Config {
    pub admin: Pubkey,
    pub operators: Vec<Pubkey>,
}

// Admin-only instruction
pub fn admin_action(ctx: Context<AdminAction>) -> Result<()> {
    require!(
        ctx.accounts.authority.key() == ctx.accounts.config.admin,
        ErrorCode::AdminOnly
    );
    // ...
}

// Operator or admin
pub fn operator_action(ctx: Context<OperatorAction>) -> Result<()> {
    let config = &ctx.accounts.config;
    let authority = ctx.accounts.authority.key();
    
    require!(
        authority == config.admin || config.operators.contains(&authority),
        ErrorCode::Unauthorized
    );
    // ...
}
```

### Time-Based Controls

```rust
// Timelock for sensitive operations
#[account]
pub struct Proposal {
    pub created_at: i64,
    pub execution_delay: i64,
}

pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let proposal = &ctx.accounts.proposal;
    
    require!(
        now >= proposal.created_at + proposal.execution_delay,
        ErrorCode::TimelockActive
    );
    // ...
}
```

---

## Input Validation

### String Validation

```rust
pub fn register_user(ctx: Context<RegisterUser>, name: String) -> Result<()> {
    // Length check
    require!(name.len() <= 50, ErrorCode::NameTooLong);
    require!(!name.is_empty(), ErrorCode::NameEmpty);
    
    // Character validation (optional)
    require!(
        name.chars().all(|c| c.is_alphanumeric() || c.is_whitespace()),
        ErrorCode::InvalidCharacters
    );
    // ...
}
```

### Numeric Validation

```rust
pub fn create_order(ctx: Context<CreateOrder>, amount: u64, price: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);
    require!(price > 0, ErrorCode::ZeroPrice);
    require!(amount >= MIN_ORDER_SIZE, ErrorCode::OrderTooSmall);
    require!(amount <= MAX_ORDER_SIZE, ErrorCode::OrderTooLarge);
    // ...
}
```

---

## Deployment Security

### Pre-deployment Checklist

- [ ] All tests passing
- [ ] Security audit completed
- [ ] Admin keys secured
- [ ] Upgrade authority set correctly
- [ ] Error handling comprehensive
- [ ] Events emitted for monitoring

### Upgrade Authority

```bash
# Set upgrade authority (careful!)
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <NEW_AUTHORITY>

# Or make immutable (irreversible!)
solana program set-upgrade-authority <PROGRAM_ID> --final
```

---

## Monitoring

### Event Logging

```rust
#[event]
pub struct SuspiciousActivity {
    pub account: Pubkey,
    pub action: String,
    pub timestamp: i64,
}

// Emit for monitoring
emit!(SuspiciousActivity {
    account: ctx.accounts.user.key(),
    action: "multiple_failed_attempts".to_string(),
    timestamp: Clock::get()?.unix_timestamp,
});
```

### Transaction Monitoring

```typescript
// Monitor for anomalies
connection.onLogs(programId, (logs) => {
  if (logs.logs.some(log => log.includes('Error'))) {
    alertAdmin(logs);
  }
});
```

---

## Resources

- [Solana Security Best Practices](https://docs.solana.com/developing/security)
- [Anchor Security Guidelines](https://www.anchor-lang.com/docs/security)
- [Common Vulnerabilities](https://github.com/coral-xyz/sealevel-attacks)

---

**Document Version**: 1.0
