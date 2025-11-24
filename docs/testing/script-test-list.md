# GridTokenX Scripts Test List

This document provides a comprehensive testing guide for all scripts in the `/scripts` directory of the GridTokenX project. Each script includes its purpose, prerequisites, test scenarios, and expected outcomes.

## Table of Contents

1. [Token Creation Scripts](#token-creation-scripts)
2. [Wallet Management Scripts](#wallet-management-scripts)
3. [Performance Testing Scripts](#performance-testing-scripts)
4. [Utility Scripts](#utility-scripts)

---

## Token Creation Scripts

### 1. create-grx-token.ts

**Purpose**: Creates a new GRX token mint with metadata using Metaplex Token Metadata program.

**Prerequisites**:
- Solana validator running (`anchor localnet` or `solana-test-validator`)
- Anchor CLI installed
- Solana CLI installed
- `dev-wallet.json` present in project root

**Test Scenarios**:

#### Scenario 1: Basic Token Creation
```bash
ts-node scripts/create-grx-token.ts
```

**Expected Output**:
- Token mint address printed
- Mint info saved to `grx-token-info.json`
- Mint keypair saved to `grx-mint-keypair.json`
- Success message displayed

**Verification**:
```bash
# Check mint info file exists
test -f grx-token-info.json

# Check mint keypair file exists
test -f grx-mint-keypair.json

# Verify mint info content
cat grx-token-info.json | jq .
```

#### Scenario 2: Token with Custom Metadata
```bash
# Modify script to use custom metadata
# Run with custom name, symbol, and URI
ts-node scripts/create-grx-token.ts
```

**Expected Output**:
- Token created with custom metadata
- Metadata account created

### 2. simple-create-token.ts

**Purpose**: Simplified token creation without complex metadata.

**Prerequisites**:
- Solana validator running
- Basic Solana setup

**Test Scenarios**:

#### Scenario 1: Basic Token Creation
```bash
ts-node scripts/simple-create-token.ts
```

**Expected Output**:
- New token mint created
- Mint information displayed

**Verification**:
```bash
# Check if token mint exists
solana account <mint_address>
```

### 3. mint-tokens-simple.ts

**Purpose**: Mints tokens to a specified wallet.

**Prerequisites**:
- Existing token mint
- Target wallet keypair

**Test Scenarios**:

#### Scenario 1: Mint to Specific Wallet
```bash
ts-node scripts/mint-tokens-simple.ts <wallet_public_key> <amount>
```

**Expected Output**:
- Tokens minted successfully
- Transaction signature displayed

**Verification**:
```bash
# Check wallet balance
solana balance <wallet_public_key> --token <mint_address>
```

---

## Wallet Management Scripts

### 1. grx-wallet-manager.ts

**Purpose**: Comprehensive wallet management including creation, transfers, and balance checking.

**Prerequisites**:
- Solana validator running
- Token mint initialized

**Test Scenarios**:

#### Scenario 1: Setup New Wallets
```bash
ts-node scripts/grx-wallet-manager.ts setup
```

**Expected Output**:
- Two new wallets created
- Wallet keypair files saved
- Success message displayed

**Verification**:
```bash
# Check wallet files exist
test -f wallet-1-keypair.json
test -f wallet-2-keypair.json

# Verify wallet content
solana account <wallet_1_public_key>
solana account <wallet_2_public_key>
```

#### Scenario 2: Check Balances
```bash
ts-node scripts/grx-wallet-manager.ts balances
```

**Expected Output**:
- Balances for both wallets displayed
- Token balances shown

#### Scenario 3: Mint Tokens to Wallet
```bash
ts-node scripts/grx-wallet-manager.ts mint 1 1000
ts-node scripts/grx-wallet-manager.ts mint 2 1000
```

**Expected Output**:
- 1000 tokens minted to each wallet
- Transaction signatures displayed

#### Scenario 4: Transfer Between Wallets
```bash
ts-node scripts/grx-wallet-manager.ts transfer 500
```

**Expected Output**:
- 500 tokens transferred from wallet 1 to wallet 2
- Updated balances displayed

#### Scenario 5: Burn Tokens
```bash
ts-node scripts/grx-wallet-manager.ts burn 1 100
```

**Expected Output**:
- 100 tokens burned from wallet 1
- Updated balance displayed

#### Scenario 6: Request Airdrop
```bash
ts-node scripts/grx-wallet-manager.ts airdrop
```

**Expected Output**:
- SOL airdropped to both wallets
- New SOL balances displayed

#### Scenario 7: Run Complete Demo
```bash
ts-node scripts/grx-wallet-manager.ts all
```

**Expected Output**:
- Full demo sequence executed
- All operations completed successfully

---

## Performance Testing Scripts

### 1. loop-transfer-test.ts

**Purpose**: Performance testing for token transfers with latency and throughput measurements.

**Prerequisites**:
- Two wallets with tokens
- Token mint initialized
- Solana validator running

**Test Scenarios**:

#### Scenario 1: Basic Performance Test (10 iterations)
```bash
ts-node scripts/loop-transfer-test.ts 10 0.5
```

**Expected Output**:
- 10 transfer iterations completed
- Performance metrics displayed:
  - Latency (min/max/avg/p95/p99)
  - Throughput (tx/sec)
  - Success rate
- Latency distribution chart

**Performance Benchmarks**:
- Throughput: > 0.5 tx/sec
- Avg Latency: < 5000ms
- P95 Latency: < 10000ms
- Success Rate: > 90%

#### Scenario 2: Medium Load Test (50 iterations)
```bash
ts-node scripts/loop-transfer-test.ts 50 1
```

**Expected Output**:
- 50 transfer iterations completed
- Performance metrics within acceptable ranges
- No "overly long loop turn" errors

#### Scenario 3: High Load Test (100 iterations)
```bash
ts-node scripts/loop-transfer-test.ts 100 0.5
```

**Expected Output**:
- 100 transfer iterations completed
- System stability maintained
- Performance metrics recorded

**Verification**:
```bash
# Check for error logs
grep -i "error" /tmp/solana-test-validator.log

# Monitor validator health
solana cluster-version
```

### 2. setup-loop-test.sh

**Purpose**: Automated setup for loop transfer performance testing.

**Prerequisites**:
- Solana validator running
- Required npm packages installed

**Test Scenarios**:

#### Scenario 1: Complete Test Environment Setup
```bash
bash scripts/setup-loop-test.sh
```

**Expected Output**:
- Validator check passed
- Test wallets created
- Token mint created
- Tokens minted to wallets
- Final balances displayed

**Verification**:
```bash
# Verify wallets have tokens
ts-node scripts/grx-wallet-manager.ts balances

# Run a quick loop test
ts-node scripts/loop-transfer-test.ts 10 0.5
```

### 3. setup-loop-test-standalone.ts

**Purpose**: Standalone setup for loop transfer test without dependencies on other scripts.

**Prerequisites**:
- Solana validator running

**Test Scenarios**:

#### Scenario 1: Independent Environment Setup
```bash
ts-node scripts/setup-loop-test-standalone.ts
```

**Expected Output**:
- Authority account created
- Test wallets generated
- SOL airdrops completed
- Token mint initialized
- Tokens minted to wallets
- Final balances displayed

---

## Utility Scripts



### 2. inspect.ts

**Purpose**: Inspects various aspects of the blockchain and program state.

**Prerequisites**:
- Solana validator running
- Programs deployed

**Test Scenarios**:

#### Scenario 1: Inspect Token Mint
```bash
ts-node scripts/inspect.ts mint <mint_address>
```

**Expected Output**:
- Mint account details
- Supply information
- Authority information

#### Scenario 2: Inspect Token Account
```bash
ts-node scripts/inspect.ts token <token_account_address>
```

**Expected Output**:
- Token account details
- Owner information
- Balance information

#### Scenario 3: Inspect Program Account
```bash
ts-node scripts/inspect.ts program <program_address>
```

**Expected Output**:
- Program account information
- Program state (if applicable)



### 4. quick-setup-token.sh

**Purpose**: Quick setup for token creation and basic configuration.

**Prerequisites**:
- Solana validator running

**Test Scenarios**:

#### Scenario 1: Quick Token Setup
```bash
bash scripts/quick-setup-token.sh
```

**Expected Output**:
- Token mint created
- Mint info saved
- Mint keypair saved
- Success message with next steps

### 5. mint-grx.sh

**Purpose**: Shell script for minting GRX tokens.

**Prerequisites**:
- GRX token mint initialized
- Target wallet specified

**Test Scenarios**:

#### Scenario 1: Mint GRX Tokens
```bash
bash scripts/mint-grx.sh <wallet_address> <amount>
```

**Expected Output**:
- Tokens minted
- Transaction signature
- Success message

---

## Comprehensive Test Sequence

For a complete end-to-end test of the entire system:

1. **Initial Setup**
   ```bash
   # Start validator
   anchor localnet
   
   # Build programs
   anchor build
   


2. **Token Setup**
   ```bash
   # Create token
   ts-node scripts/create-grx-token.ts
   
   # Verify token
   ts-node scripts/inspect.ts mint <mint_address>
   ```

3. **Wallet Setup**
   ```bash
   # Setup test environment
   bash scripts/setup-loop-test.sh
   ```

4. **Performance Testing**
   ```bash
   # Basic performance test
   ts-node scripts/loop-transfer-test.ts 10 0.5
   
   # Medium load test
   ts-node scripts/loop-transfer-test.ts 50 1
   
   # High load test
   ts-node scripts/loop-transfer-test.ts 100 0.5
   ```

5. **Verification**
   ```bash
   # Check final state
   ts-node scripts/grx-wallet-manager.ts balances
   ```

## Troubleshooting

### Common Issues

1. **"Validator not running"**
   - Start validator in separate terminal
   - Check with `solana cluster-version`

2. **"Token accounts not initialized"**
   - Run wallet setup script
   - Mint tokens to wallets

3. **"Overly long loop turn" errors**
   - Increase delay between transactions
   - Check validator resource usage

4. **TypeScript compilation errors**
   - Check Node.js version compatibility
   - Install missing dependencies

### Performance Degradation

1. **High Latency**
   - Check validator logs
   - Verify system resources
   - Reduce transaction load

2. **Low Throughput**
   - Increase batch size
   - Optimize transaction structure
   - Check network conditions

---

## Notes

- All tests should be run against a local validator for consistent results
- Performance metrics will vary based on system capabilities
- Always verify transaction success by checking account states
- Keep test wallets separate from production wallets
- Clean up test accounts after testing to avoid cluttering the ledger