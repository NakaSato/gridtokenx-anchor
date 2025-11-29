# Troubleshooting Guide

> **Common issues and solutions for GridTokenX development**

---

## Build Issues

### Anchor Build Fails

**Error**: `anchor build` fails with version mismatch

```
Error: Anchor version mismatch
```

**Solution**:
```bash
# Check Anchor version
anchor --version

# Update Anchor
avm install 0.30.1
avm use 0.30.1

# Clean and rebuild
anchor clean
anchor build
```

---

### Rust Compilation Errors

**Error**: `error[E0433]: failed to resolve`

**Solution**:
```bash
# Update Rust toolchain
rustup update stable

# Use Solana's BPF toolchain
solana-install update

# Rebuild
cargo clean
anchor build
```

---

### Missing BPF SDK

**Error**: `Cannot find -lsolana_program`

**Solution**:
```bash
# Install Solana tools
sh -c "$(curl -sSfL https://release.solana.com/v1.18.0/install)"

# Add to PATH
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
```

---

## Test Issues

### Test Timeout

**Error**: Tests timeout waiting for transactions

**Solution**:
```typescript
// Increase timeout in test config
describe('Tests', () => {
  // Set higher timeout
  jest.setTimeout(60000);
  
  // Or use retry logic
  it('should work', async () => {
    await retry(async () => {
      // test code
    }, { retries: 3 });
  });
});
```

---

### Insufficient Funds

**Error**: `Transaction simulation failed: Attempt to debit an account but found no record of a prior credit`

**Solution**:
```bash
# Airdrop SOL to test wallet
solana airdrop 5 <WALLET_ADDRESS> --url devnet

# Or in tests
const airdropSig = await connection.requestAirdrop(
  wallet.publicKey,
  5 * LAMPORTS_PER_SOL
);
await connection.confirmTransaction(airdropSig);
```

---

### Account Not Found

**Error**: `Account does not exist`

**Solution**:
```typescript
// Ensure account is initialized before use
const account = await program.account.userAccount.fetchNullable(pda);

if (!account) {
  // Initialize first
  await program.methods
    .initialize()
    .accounts({ ... })
    .rpc();
}
```

---

## Transaction Errors

### Transaction Too Large

**Error**: `Transaction too large`

**Solution**:
```typescript
// Split into multiple transactions
const tx1 = new Transaction().add(instruction1);
const tx2 = new Transaction().add(instruction2);

await sendAndConfirmTransaction(connection, tx1, [wallet]);
await sendAndConfirmTransaction(connection, tx2, [wallet]);
```

---

### Blockhash Expired

**Error**: `Blockhash not found`

**Solution**:
```typescript
// Get fresh blockhash before sending
const { blockhash, lastValidBlockHeight } = 
  await connection.getLatestBlockhash('confirmed');

transaction.recentBlockhash = blockhash;
transaction.lastValidBlockHeight = lastValidBlockHeight;
```

---

### Custom Program Error

**Error**: `Program returned error: custom program error: 0x1770`

**Solution**:
```typescript
// Decode error code (0x1770 = 6000 in decimal)
// Check program error definitions

// In Anchor programs:
// 6000-6099: Registry errors
// 6100-6199: Oracle errors
// 6200-6299: Energy Token errors
// 6300-6399: Trading errors
// 6400-6499: Governance errors

// Example error handling
try {
  await program.methods.someInstruction().rpc();
} catch (error) {
  if (error instanceof AnchorError) {
    console.log('Error code:', error.error.errorCode.number);
    console.log('Error message:', error.error.errorMessage);
  }
}
```

---

## Common Error Codes

### Registry Program (6000-6099)

| Code | Name | Solution |
|------|------|----------|
| 6000 | `UserAlreadyRegistered` | User already exists |
| 6001 | `UserNotRegistered` | Register user first |
| 6002 | `MeterAlreadyRegistered` | Meter serial exists |
| 6003 | `MeterNotFound` | Check meter PDA |
| 6004 | `Unauthorized` | Check signer |

### Trading Program (6300-6399)

| Code | Name | Solution |
|------|------|----------|
| 6300 | `InsufficientBalance` | Check token balance |
| 6301 | `OrderNotActive` | Order already filled/cancelled |
| 6302 | `SelfTradingNotAllowed` | Cannot match own order |
| 6303 | `OrderExpired` | Create new order |

---

## Network Issues

### RPC Rate Limiting

**Error**: `429 Too Many Requests`

**Solution**:
```typescript
// Use rate limiting
import pThrottle from 'p-throttle';

const throttle = pThrottle({
  limit: 10,
  interval: 1000,
});

const throttledFetch = throttle(async (pda) => {
  return program.account.someAccount.fetch(pda);
});
```

---

### Connection Timeout

**Error**: Connection timeout errors

**Solution**:
```typescript
// Configure connection with timeout
const connection = new Connection(rpcUrl, {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 60000,
});
```

---

## Getting Help

1. Check [GitHub Issues](https://github.com/NakaSato/gridtokenx-anchor/issues)
2. Review [Anchor Documentation](https://www.anchor-lang.com/docs)
3. Join [Solana Discord](https://discord.gg/solana)

---

**Document Version**: 1.0
