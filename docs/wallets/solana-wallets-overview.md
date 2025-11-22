# Solana Wallets Overview - GridTokenX Project

This document provides a comprehensive overview of all Solana wallets used in the GridTokenX project, including their purposes, balances, and associated tokens.

## Table of Contents

1. [System Wallets](#system-wallets)
2. [Test Wallets](#test-wallets)
3. [Token Mints](#token-mints)
4. [Wallet Usage Guide](#wallet-usage-guide)
5. [Security Considerations](#security-considerations)

---

## System Wallets

### Default Solana CLI Wallet

**Address**: `7QL3CrTn1xwvvGLq4W7d51bBhQA2HWu9KH1ChU1gujD9`  
**File Path**: `~/.config/solana/id.json`  
**SOL Balance**: `499,999,999.994360268 SOL`  
**Status**: System wallet with massive balance (local validator faucet)  

**Description**: This is the default wallet configured in Solana CLI, automatically used when no specific wallet is specified. It has an extremely high balance typical of local validator environments where SOL is readily available for testing.

**Use Cases**:
- Default authority for program deployments
- System-wide operations
- Mint authority for GRX tokens
- Faucet operations for test wallets

---

### Development Wallet

**File**: `dev-wallet.json`  
**Address**: `AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3`  
**SOL Balance**: `88.75907216 SOL`  
**Role**: Development and testing wallet  

**Description**: The primary development wallet used for testing and debugging project functionality. Contains a substantial SOL balance for development operations.

**Token Holdings**:
- Token `DYXurk47FxGZyzrGJ1pcDM3djZSg3XBFJn9hTzsjx5MM`: 7.68243269 tokens
- Token `2qBiLbyHQtfWQquLUshSZzNKfVNe8V6w4uEsxedPN1dJ`: 1.5 tokens

**Use Cases**:
- Development testing
- Debugging token operations
- Testing program interactions
- Mint authority for test tokens

---

## Test Wallets

### Wallet 1

**File**: `wallet-1-keypair.json`  
**Address**: `5NsnerukMfPUTDYZeCpxfRxq6RKzSdk9S5gXSv38cXhH`  
**SOL Balance**: `3.999725 SOL`  
**Role**: Primary test wallet for performance testing  

**Description**: First test wallet specifically configured for performance testing and automated scripts. Maintains a consistent SOL balance for transaction fees.

**Token Holdings**:
- Token `9gDi1TDAitfJV13vi3txDiU89vWK9KAH6kJt9temAKGP` (GRX): 4000 tokens

**Use Cases**:
- Performance testing (loop transfers)
- Load testing
- Transaction latency measurements
- Automated test scenarios

---

### Wallet 2

**File**: `wallet-2-keypair.json`  
**Address**: `DbyyRkFtxmD1vFSL7MEtDKqz7mW8ZyFYSCDhvFR7UduP`  
**SOL Balance**: `3.999725 SOL`  
**Role**: Secondary test wallet for performance testing  

**Description**: Second test wallet paired with Wallet 1 for performance testing scenarios. Maintains identical SOL and token balances for consistent testing conditions.

**Token Holdings**:
- Token `9gDi1TDAitfJV13vi3txDiU89vWK9KAH6kJt9temAKGP` (GRX): 4000 tokens

**Use Cases**:
- Performance testing (as transfer destination)
- Load testing scenarios
- Multi-user transaction testing
- Automated test scenarios

---

## Token Mints

### GRX Token (Primary Test Mint)

**File**: `grx-mint-keypair.json`  
**Address**: `9gDi1TDAitfJV13vi3txDiU89vWK9KAH6kJt9temAKGP`  
**Name**: GridTokenX Test  
**Symbol**: GRX  
**Decimals**: 9  
**Total Supply**: 8,000,000,000 (8,000 tokens)  

**Program Details**:
- Program ID: `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` (Token 2022)
- Mint Authority: `7QL3CrTn1xwvvGLq4W7d51bBhQA2HWu9KH1ChU1gujD9` (System Wallet)
- Freeze Authority: `7QL3CrTn1xwvvGLq4W7d51bBhQA2HWu9KH1ChU1gujD9` (System Wallet)

**Distribution**:
- Wallet 1: 4000 tokens
- Wallet 2: 4000 tokens

**Use Cases**:
- Primary token for GridTokenX testing
- Performance testing transfers
- Token operation testing
- Protocol demonstration

---

### Alternative GRX Token

**File**: `test-mint-keypair.json`  
**Address**: `HgnXQ5jV8Jz1ipxB3RrTgTw2UBCgTb4mSFyswXrxMt6f`  
**Role**: Alternative test mint  

**Description**: Secondary GRX token mint, likely created for testing purposes but not actively used in current test scenarios.

---

### Unknown Token 1

**Address**: `DYXurk47FxGZyzrGJ1pcDM3djZSg3XBFJn9hTzsjx5MM`  
**Total Supply**: 7,996,132,690 (7,996.13269 tokens)  
**Decimals**: 9  

**Program Details**:
- Program ID: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` (Original Token Program)
- Mint Authority: `68hhPSVvhePC3ioUe2jRhUru9NW5PKFjf3W8pU7ybz82`
- Freeze Authority: Not set

**Distribution**:
- Development Wallet: 7.68243269 tokens

**Use Cases**:
- Legacy token testing
- Program compatibility testing

---

### Unknown Token 2

**Address**: `2qBiLbyHQtfWQquLUshSZzNKfVNe8V6w4uEsxedPN1dJ`  
**Total Supply**: 3,500,000,000 (3,500 tokens)  
**Decimals**: 9  

**Program Details**:
- Program ID: `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` (Token 2022)
- Mint Authority: `AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3` (Development Wallet)
- Freeze Authority: Not set

**Distribution**:
- Development Wallet: 1.5 tokens

**Use Cases**:
- Token 2022 feature testing
- Development experimentation

---

## Wallet Usage Guide

### For Development

1. **Setting Environment Variables**:
   ```bash
   export ANCHOR_WALLET=dev-wallet.json
   ```

2. **Checking Balances**:
   ```bash
   solana balance AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3
   spl-token accounts --owner AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3
   ```

3. **Minting Tokens**:
   ```bash
   spl-token mint <TOKEN_MINT_ADDRESS> <AMOUNT> AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3
   ```

### For Testing

1. **Performance Testing**:
   ```bash
   # Using wallet-1 and wallet-2 automatically
   ts-node scripts/loop-transfer-test.ts 100 0.5
   ```

2. **Manual Transfers**:
   ```bash
   # From wallet-1 to wallet-2
   export ANCHOR_WALLET=wallet-1-keypair.json
   spl-token transfer 9gDi1TDAitfJV13vi3txDiU89vWK9KAH6kJt9temAKGP 500 DbyyRkFtxmD1vFSL7MEtDKqz7mW8ZyFYSCDhvFR7UduP
   ```

3. **Checking Test Results**:
   ```bash
   # Check wallet-1 balance
   export ANCHOR_WALLET=wallet-1-keypair.json
   spl-token balance 9gDi1TDAitfJV13vi3txDiU89vWK9KAH6kJt9temAKGP
   
   # Check wallet-2 balance
   export ANCHOR_WALLET=wallet-2-keypair.json
   spl-token balance 9gDi1TDAitfJV13vi3txDiU89vWK9KAH6kJt9temAKGP
   ```

### For Token Management

1. **Creating New Tokens**:
   ```bash
   export ANCHOR_WALLET=dev-wallet.json
   ts-node scripts/create-grx-token.ts
   ```

2. **Token Information**:
   ```bash
   spl-token display 9gDi1TDAitfJV13vi3txDiU89vWK9KAH6kJt9temAKGP
   ```

3. **Token Supply Management**:
   ```bash
   spl-token supply 9gDi1TDAitfJV13vi3txDiU89vWK9KAH6kJt9temAKGP
   ```

---

## Security Considerations

### Private Key Security

1. **Never Commit Private Keys**: All wallet files are already excluded in `.gitignore`
2. **Test Environment Only**: These wallets are for testing purposes only
3. **Regular Key Rotation**: Consider regenerating test keys periodically
4. **Access Control**: Limit access to wallet files to authorized developers

### Production Deployment

1. **Separate Environments**: Use completely different wallets for production
2. **Hardware Security**: Use hardware wallets for production operations
3. **Multi-Sig Implementation**: Consider multi-signature wallets for production
4. **Access Logging**: Implement logging for all production wallet operations

### Key Backup Procedures

1. **Development Wallets**:
   ```bash
   # Backup development wallet
   cp dev-wallet.json backup/dev-wallet-$(date +%Y%m%d).json
   
   # Backup test wallets
   cp wallet-1-keypair.json backup/wallet-1-$(date +%Y%m%d).json
   cp wallet-2-keypair.json backup/wallet-2-$(date +%Y%m%d).json
   ```

2. **Mint Authority Backup**:
   ```bash
   # Backup mint authority
   cp grx-mint-keypair.json backup/grx-mint-$(date +%Y%m%d).json
   ```

3. **Recovery Plan**:
   - Document recovery procedures for each wallet type
   - Store secure backups in multiple locations
   - Test recovery procedures regularly

---

## Maintenance

### Regular Tasks

1. **Balance Monitoring**:
   ```bash
   # Create a script to monitor all wallet balances
   for wallet in dev-wallet.json wallet-1-keypair.json wallet-2-keypair.json; do
     address=$(solana-keygen pubkey $wallet)
     balance=$(solana balance $address | awk '{print $1}')
     echo "$wallet: $address -> $balance SOL"
   done
   ```

2. **Token Account Cleanup**:
   ```bash
   # Close unused token accounts to recover rent
   spl-token close <TOKEN_ACCOUNT_ADDRESS> --recipient <RECIPIENT_ADDRESS>
   ```

3. **Log Analysis**:
   ```bash
   # Monitor transaction patterns
   solana logs --url localhost
   ```

### Wallet Refresh Procedures

1. **Test Wallet Reset**:
   ```bash
   # Reset test wallets for fresh testing
   rm wallet-1-keypair.json wallet-2-keypair.json
   ts-node scripts/setup-loop-test-standalone.ts
   ```

2. **Token Supply Reset**:
   ```bash
   # Create new token mint for testing
   rm grx-mint-keypair.json grx-token-info.json
   ts-node scripts/create-grx-token.ts
   ```

---

## Troubleshooting

### Common Issues

1. **"Insufficient funds for transaction"**:
   - Check SOL balance: `solana balance <WALLET_ADDRESS>`
   - Request airdrop: `solana airdrop 2 <WALLET_ADDRESS>`

2. **"Account not found" errors**:
   - Verify token account exists: `spl-token accounts --owner <WALLET_ADDRESS>`
   - Create token account: `spl-token create-account <TOKEN_MINT>`

3. **"Invalid authority" errors**:
   - Verify wallet is set correctly: `echo $ANCHOR_WALLET`
   - Check mint authority: `spl-token display <TOKEN_MINT>`

4. **Performance test failures**:
   - Verify both test wallets have tokens
   - Check transaction fees: `solana fees`
   - Monitor validator resources

---

## Quick Reference

| Wallet | Address | Balance | Primary Use |
|--------|---------|----------|-------------|
| CLI/Default | `7QL3CrTn1xwvvGLq4W7d51bBhQA2HWu9KH1ChU1gujD9` | `499,999,999.99` SOL | System operations |
| Development | `AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3` | `88.75907216` SOL | Development |
| Test-1 | `5NsnerukMfPUTDYZeCpxfRxq6RKzSdk9S5gXSv38cXhH` | `3.999725` SOL | Performance testing |
| Test-2 | `DbyyRkFtxmD1vFSL7MEtDKqz7mW8ZyFYSCDhvFR7UduP` | `3.999725` SOL | Performance testing |

| Token | Address | Program | Supply | Primary Wallets |
|-------|---------|----------|---------|-----------------|
| GRX (Test) | `9gDi1TDAitfJV13vi3txDiU89vWK9KAH6kJt9temAKGP` | Token 2022 | 8000 | Test-1, Test-2 |
| Alternative GRX | `HgnXQ5jV8Jz1ipxB3RrTgTw2UBCgTb4mSFyswXrxMt6f` | - | - | - |
| Unknown 1 | `DYXurk47FxGZyzrGJ1pcDM3djZSg3XBFJn9hTzsjx5MM` | Original Token | 7996 | Development |
| Unknown 2 | `2qBiLbyHQtfWQquLUshSZzNKfVNe8V6w4uEsxedPN1dJ` | Token 2022 | 3500 | Development |

---

*Last Updated: $(date)*  
*Document Version: 1.0*  
*GridTokenX Project*