# Solana Wallet Commands Cheatsheet

This document provides quick reference commands for managing Solana wallets in GridTokenX project.

## Wallet Information

### Display Wallet Address
```bash
# Get address from keypair file
solana-keygen pubkey <wallet_file>

# Get address of current configured wallet
solana address

# Get address of specific wallet
export ANCHOR_WALLET=<wallet_file> && solana address
```

### Check SOL Balance
```bash
# Check balance of specific address
solana balance <address>

# Check balance of current configured wallet
solana balance

# Check balance in lamports
solana balance --lamports <address>
```

### Wallet Configuration
```bash
# Set default wallet
solana config set --keypair <wallet_file>

# Check current configuration
solana config get

# Set RPC URL
solana config set --url <url>
```

## Token Operations

### Display Token Information
```bash
# Display token mint details
spl-token display <token_address>

# Display token account details
spl-token account-info <token_account_address>
```

### Check Token Balances
```bash
# List all token accounts
spl-token accounts

# List token accounts for specific owner
spl-token accounts --owner <address>

# Check balance of specific token
spl-token balance <token_address>
```

### Token Minting
```bash
# Create new token mint
spl-token create-token --decimals 9

# Create token account
spl-token create-account <token_address> <recipient>

# Mint tokens to account
spl-token mint <token_address> <amount> <recipient>
```

### Token Transfers
```bash
# Transfer tokens between accounts
spl-token transfer <token_address> <amount> <recipient>

# Check transfer status
solana confirm <transaction_signature>
```

## Test Wallets Quick Commands

### Set Wallet Environment
```bash
# Use development wallet
export ANCHOR_WALLET=dev-wallet.json

# Use test wallet 1
export ANCHOR_WALLET=wallet-1-keypair.json

# Use test wallet 2
export ANCHOR_WALLET=wallet-2-keypair.json
```

### Check All Wallet Balances
```bash
# Check SOL balance for all test wallets
for wallet in dev-wallet.json wallet-1-keypair.json wallet-2-keypair.json; do
  address=$(solana-keygen pubkey $wallet)
  balance=$(solana balance $address | awk '{print $1}')
  echo "$wallet: $address -> $balance SOL"
done

# Check GRX token balance for test wallets
token="9gDi1TDAitfJV13vi3txDiU89vWK9KAH6kJt9temAKGP"
for wallet in wallet-1-keypair.json wallet-2-keypair.json; do
  address=$(solana-keygen pubkey $wallet)
  balance=$(spl-token balance --address $address --token $token 2>/dev/null | awk '{print $1}')
  echo "$wallet: GRX -> $balance tokens"
done
```

## GridTokenX Specific Commands

### Run Performance Test
```bash
# Quick performance test (10 iterations, 0.5 tokens)
ts-node scripts/loop-transfer-test.ts 10 0.5

# Medium load test (50 iterations, 1 token)
ts-node scripts/loop-transfer-test.ts 50 1

# High load test (100 iterations, 0.5 tokens)
ts-node scripts/loop-transfer-test.ts 100 0.5
```

### Setup Test Environment
```bash
# Setup wallets and tokens for testing
bash scripts/setup-loop-test.sh

# Create new GRX token
ts-node scripts/create-grx-token.ts
```

### Wallet Management
```bash
# Create new test wallets
ts-node scripts/grx-wallet-manager.ts setup

# Check all wallet balances
ts-node scripts/grx-wallet-manager.ts balances

# Mint tokens to wallet
ts-node scripts/grx-wallet-manager.ts mint 1 1000
```

## Transaction Operations

### Transaction Information
```bash
# Get transaction details
solana transaction <signature>

# Get transaction with detailed output
solana transaction <signature> -v

# Get transaction with base64 output
solana transaction <signature> --output json-compact
```

### Confirm Transactions
```bash
# Wait for transaction confirmation
solana confirm <signature>

# Confirm with finality
solana confirm <signature> --finality
```

### Account Information
```bash
# Get account information
solana account <address>

# Get account information with details
solana account <address> -v

# Get account information in JSON format
solana account <address> --output json
```

## Validator Operations

### Start Local Validator
```bash
# Start with default settings
solana-test-validator

# Start with custom settings
solana-test-validator --reset --quiet

# Start with account snapshots
solana-test-validator --account-dir <directory>
```

### Validator Health Check
```bash
# Check validator version
solana cluster-version

# Check cluster health
solana cluster-date

# Check transaction count
solana get-transaction-count
```

## Troubleshooting Commands

### Debug Connection Issues
```bash
# Check current RPC URL
solana config get | grep "RPC URL"

# Test connection to RPC
solana cluster-version

# Check if validator is running
ps aux | grep solana-test-validator
```

### Debug Account Issues
```bash
# Check if account exists
solana account <address> --output json

# Check token account
spl-token account-info <token_account>

# Check mint authority
spl-token display <token_address> | grep "Mint authority"
```

### Debug Transaction Issues
```bash
# Get transaction details with error information
solana transaction <signature> -v

# Check if transaction is confirmed
solana confirm <signature>

# Get recent transactions for an account
solana account <address> --output json | jq -r '.transaction'
```

## Performance Monitoring

### Monitor Wallet Activity
```bash
# Monitor recent transactions
solana logs --url localhost --limit 20

# Monitor specific program activity
solana logs --url localhost <program_id>

# Monitor token transfers
solana logs --url localhost | grep -i "transfer"
```

### Performance Metrics
```bash
# Get validator performance metrics
solana ping

# Check recent performance
solana block-production --url localhost

# Monitor slot progress
solana slot
```

## Quick Reset Commands

### Reset Test Environment
```bash
# Reset validator state
pkill -f solana-test-validator
solana-test-validator --reset

# Reset test wallets
rm wallet-1-keypair.json wallet-2-keypair.json
ts-node scripts/setup-loop-test-standalone.ts
```

### Reset Token State
```bash
# Remove token info
rm grx-token-info.json grx-mint-keypair.json

# Create new token
ts-node scripts/create-grx-token.ts

# Mint new test tokens
bash scripts/mint-grx.sh <address> <amount>
```

---

**Wallet Addresses Quick Reference**

| Wallet | File | Address |
|--------|------|----------|
| Default CLI | `~/.config/solana/id.json` | `7QL3CrTn1xwvvGLq4W7d51bBhQA2HWu9KH1ChU1gujD9` |
| Development | `dev-wallet.json` | `AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3` |
| Test-1 | `wallet-1-keypair.json` | `5NsnerukMfPUTDYZeCpxfRxq6RKzSdk9S5gXSv38cXhH` |
| Test-2 | `wallet-2-keypair.json` | `DbyyRkFtxmD1vFSL7MEtDKqz7mW8ZyFYSCDhvFR7UduP` |

**Token Addresses Quick Reference**

| Token | Name | Address |
|-------|-------|----------|
| GRX (Primary) | GridTokenX Test | `9gDi1TDAitfJV13vi3txDiU89vWK9KAH6kJt9temAKGP` |
| Alternative GRX | - | `HgnXQ5jV8Jz1ipxB3RrTgTw2UBCgTb4mSFyswXrxMt6f` |

---

*Document Version: 1.0*  
*GridTokenX Project*