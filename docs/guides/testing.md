# Testing Guide

> **Run tests and validate GridTokenX program behavior**

This guide covers the testing strategy, test structure, and how to run various test suites.

---

## Test Structure

```
tests/
├── registry.test.ts       # Registry program tests
├── oracle.test.ts         # Oracle program tests
├── energy-token.test.ts   # Energy Token tests
├── trading.test.ts        # Trading program tests
├── governance.test.ts     # Governance tests
├── setup.ts               # Test utilities
├── integration/           # Integration tests
├── edge-cases/            # Edge case tests
├── security/              # Security tests
├── performance/           # Performance benchmarks
└── utils/                 # Test helpers
```

---

## Running Tests

### All Tests

```bash
# Run all tests
anchor test

# Run without redeploying
anchor test --skip-deploy
```

### Specific Test File

```bash
# Run single test file
anchor test --skip-deploy tests/registry.test.ts
```

### Specific Test

```bash
# Run tests matching pattern
anchor test --skip-deploy -- --grep "register user"
```

### With Coverage

```bash
# Generate coverage report
pnpm test:coverage
```

---

## Test Categories

### Unit Tests

Test individual instructions in isolation:

- Input validation
- State changes
- Error conditions
- Event emission

### Integration Tests

Test cross-program interactions:

- CPI flows (Registry → Energy Token)
- Multi-step workflows
- State consistency

### Security Tests

Validate security measures:

- Authorization checks
- Double-spend prevention
- Overflow protection
- Reentrancy guards

### Performance Tests

Measure performance characteristics:

- Transaction latency
- Throughput (TPS)
- Compute unit consumption
- Account rent costs

---

## Writing Tests

### Test Template

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Registry } from "../target/types/registry";
import { expect } from "chai";

describe("registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Registry as Program<Registry>;

  it("initializes registry", async () => {
    // Arrange
    const [registryPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("registry")],
      program.programId
    );

    // Act
    const tx = await program.methods
      .initializeRegistry()
      .accounts({
        registry: registryPda,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Assert
    const registry = await program.account.registry.fetch(registryPda);
    expect(registry.authority.toString()).to.equal(
      provider.wallet.publicKey.toString()
    );
  });

  it("fails with unauthorized caller", async () => {
    // Test error conditions
    try {
      await program.methods
        .restrictedOperation()
        .accounts({ /* wrong authority */ })
        .rpc();
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err.message).to.include("Unauthorized");
    }
  });
});
```

### Best Practices

1. **Arrange-Act-Assert**: Structure tests clearly
2. **Isolation**: Each test should be independent
3. **Descriptive names**: Clear test descriptions
4. **Error testing**: Test failure cases
5. **Event verification**: Check emitted events

---

## Test Utilities

### Setup Helpers

```typescript
// tests/setup.ts
export async function createTestUser(provider, program) {
  const user = anchor.web3.Keypair.generate();
  
  // Airdrop SOL
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(
      user.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    )
  );

  return user;
}

export async function registerMeter(provider, program, owner, meterId) {
  const [meterPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("meter"), Buffer.from(meterId)],
    program.programId
  );

  await program.methods
    .registerMeter(meterId, "Solar", "Test Location", new anchor.BN(100))
    .accounts({
      meter: meterPda,
      owner: owner.publicKey,
      // ... other accounts
    })
    .signers([owner])
    .rpc();

  return meterPda;
}
```

### Account Helpers

```typescript
export async function getAccount(program, accountType, pda) {
  return await program.account[accountType].fetch(pda);
}

export function expectError(error, expectedCode) {
  expect(error.error.errorCode.code).to.equal(expectedCode);
}
```

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Solana
        run: |
          sh -c "$(curl -sSfL https://release.solana.com/v1.17.0/install)"
          echo "$HOME/.local/share/solana/install/active_release/bin" >> $GITHUB_PATH
      
      - name: Install Anchor
        run: |
          cargo install --git https://github.com/coral-xyz/anchor avm --locked
          avm install latest && avm use latest
      
      - name: Install Dependencies
        run: pnpm install
      
      - name: Build
        run: anchor build
      
      - name: Test
        run: anchor test
```

---

## Debugging Tests

### Verbose Output

```bash
# Enable debug logging
RUST_LOG=debug anchor test
```

### Transaction Logs

```typescript
// Get transaction logs
const tx = await program.methods.someInstruction().rpc();
const logs = await provider.connection.getTransaction(tx);
console.log(logs.meta.logMessages);
```

### Account Inspection

```typescript
// Inspect account data
const account = await program.account.registry.fetch(pda);
console.log(JSON.stringify(account, null, 2));
```

---

## Common Issues

### "Account not found"

```bash
# Ensure programs are deployed
anchor deploy
```

### "Insufficient funds"

```bash
# Airdrop more SOL
solana airdrop 5
```

### "Invalid PDA"

- Verify seed construction matches program
- Check bump seed derivation

### "Unauthorized"

- Verify signer is included
- Check authority matches expected

---

*For performance testing, see [Performance Testing](./performance-testing.md)*
