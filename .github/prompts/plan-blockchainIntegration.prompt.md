# GridTokenX API Gateway - Blockchain Integration Plan

## Overview
This document outlines how the API gateway connects to Solana blockchain and the blockchain actions it can perform, along with implementation gaps and future enhancements.

## Connection Architecture

### RPC Connection Setup
- **Service**: `BlockchainService` (`src/services/blockchain.rs`)
- **Client**: `solana_client::rpc_client::RpcClient` wrapped in `Arc<RpcClient>`
- **Configuration**:
  - RPC URL: `SOLANA_RPC_URL` environment variable
  - Default: `http://localhost:8899` (localnet)
  - Supports: localnet, devnet, testnet, mainnet-beta
- **Initialization**: Line ~161 in `src/main.rs`

### Anchor Program IDs (Hardcoded)
```rust
REGISTRY_PROGRAM_ID: "Bxvy5YGhGXcqKCtBRHwmToT6mJ4ABEnAKALWiDcmvnN4"
ORACLE_PROGRAM_ID: "2Jqh9JgArbcvAfpwbsnMDz8MRxsyApmn2HKDfC6WRhwbkgbU9ApHVVyaaKBQ"
GOVERNANCE_PROGRAM_ID: "83V1DXEmnzze8jgU4UKDfC6WRhwbkgbU9ApHVVyaaKBQ"
ENERGY_TOKEN_PROGRAM_ID: "6LgvcJJ9fQ4P3h2JybqoRXq5mNqMkTPyMbuYrqpSb7yj"
TRADING_PROGRAM_ID: "Hzmt59G8cSt1viEeX8QcmNDo46xTPU3TE7LrcQ1PVMLV"
```

## Wallet Management

### WalletService (`src/services/wallet.rs`)
Authority wallet manages signing for minting and administrative operations.

**Loading Methods** (priority order):
1. **File-based**: `./authority-wallet.json` (default location)
2. **Environment Path**: `AUTHORITY_WALLET_PATH` variable
3. **Private Key**: `AUTHORITY_WALLET_PRIVATE_KEY` variable (base58-encoded)

**Initialization Flow** (lines 165-176 in `src/main.rs`):
```rust
let wallet_service = WalletService::new(&config.solana_rpc_url);
match wallet_service.initialize_authority().await {
    Ok(()) => info!("Authority wallet loaded: {}", pubkey),
    Err(e) => warn!("Failed to load authority wallet. Minting unavailable.")
}
```

**Key Methods**:
- `generate_keypair()` - Create new Solana keypair
- `get_balance()` / `get_balance_sol()` - Query wallet balance
- `request_airdrop()` - Request SOL (localhost only)
- `get_authority_keypair()` - Retrieve cached authority keypair
- `validate_address()` - Validate Solana address format
- `ping()` - RPC endpoint health check

## Blockchain Operations

### 1. Account Queries
```rust
// Balance operations
get_balance(pubkey: &Pubkey) -> Result<u64>
get_balance_sol(pubkey: &Pubkey) -> Result<f64>

// Account operations
get_account_data(pubkey: &Pubkey) -> Result<Vec<u8>>
account_exists(pubkey: &Pubkey) -> Result<bool>

// Network information
get_latest_blockhash() -> Result<Hash>
get_slot() -> Result<u64>
get_signature_status(signature: &Signature) -> Result<Option<bool>>
```

### 2. Transaction Management

**Core Transaction Method**:
```rust
build_and_send_transaction(
    instructions: Vec<Instruction>,
    signers: &[&Keypair],
) -> Result<Signature>
```

**Transaction Flow**:
1. Fetch recent blockhash
2. Build transaction with payer (first signer)
3. Sign transaction with all provided signers
4. Submit via `send_and_confirm_transaction`

**Advanced Methods**:
- `simulate_transaction()` - Pre-flight simulation without committing
- `wait_for_confirmation()` - Poll for confirmation with timeout
- `send_transaction_with_retry()` - Automatic retry with exponential backoff (default: 3 attempts)
- `build_unsigned_transaction()` - Build transaction for inspection

### 3. Energy Token Minting (IMPLEMENTED ✅)

**Method**: `mint_energy_tokens()`
```rust
pub async fn mint_energy_tokens(
    &self,
    authority: &Keypair,           // Authority wallet (signs)
    user_token_account: &Pubkey,   // User's ATA
    mint: &Pubkey,                 // Token mint address
    amount_kwh: f64,               // Energy in kWh
) -> Result<Signature>
```

**Implementation Details**:
- **Amount Conversion**: `(amount_kwh * 1_000_000_000.0) as u64` (9 decimals)
- **PDA Derivation**: Token info PDA from `["token_info"]` seed + program ID
- **Anchor Discriminator**: SHA256("global:mint_tokens_direct")[0..8]
- **Instruction Data**: `[discriminator (8 bytes)] + [amount_lamports (8 bytes, LE)]`

**Required Accounts**:
1. Token info PDA (writable)
2. User token account (writable)
3. Token mint (writable)
4. Authority (signer)
5. Token program (SPL Token Program)

### 4. Settlement Transfers (PLACEHOLDER ⏳)

**Service**: `SettlementService` (`src/services/settlement.rs`)
**Status**: Built but NOT integrated into blockchain flow

**Current Behavior**: Returns simulated transaction signatures (64-char strings)

**Intended Implementation**:
```rust
async fn execute_blockchain_transfer(&self, settlement: &Settlement) -> Result<SettlementTransaction>
```

**Required Steps**:
1. Get buyer/seller token accounts
2. Create SPL token transfer instruction
3. Sign with authority wallet (or delegate)
4. Submit transaction
5. Wait for confirmation
6. Record in `settlement_transactions` table

**Database Schema**:
- Fields: `buyer_id`, `seller_id`, `energy_amount`, `price_per_kwh`
- `total_amount`, `platform_fee` (1%), `net_seller_amount`
- `status`: Pending → Processing → Confirmed/Failed
- `blockchain_tx_signature`: On-chain transaction signature

### 5. ERC Certificate Operations (DATABASE ONLY ⏳)

**Service**: `ErcService` (`src/services/erc.rs`)
**Current Operations**:
- Issue certificates → Database insertion only
- Transfer certificates → Database + `blockchain_tx_signature` field (placeholder)
- Retire certificates → Status update to "Retired"

**Missing Blockchain Integration**:
- Certificate issuance should mint on-chain NFT
- Transfers should submit on-chain transfer instruction
- Validation should query on-chain certificate data

## Data Flow Examples

### Complete Flow: Energy Tokenization

```
1. User submits meter reading
   POST /api/meters/readings
   Handler: src/handlers/meters.rs::submit_reading
   ↓
2. Validation & Database Storage
   - Amount > 0 kWh, no duplicates within 15-min window
   - Max 100 kWh per reading
   - Insert into `meter_readings` with status='pending'
   ↓
3. Admin triggers minting
   POST /api/admin/meters/readings/{id}/mint
   Handler: src/handlers/meters.rs::mint_from_reading (requires admin role)
   ↓
4. Blockchain Service Call
   - Fetch reading from MeterService
   - Parse wallet address (BlockchainService::parse_pubkey)
   - Get authority keypair (WalletService::get_authority_keypair)
   - Derive user's Associated Token Account
   - Call BlockchainService::mint_energy_tokens()
   ↓
5. Transaction Building
   - Build Anchor instruction (discriminator + amount)
   - Build & sign transaction (authority wallet)
   - Submit to Solana RPC
   ↓
6. Confirmation & Persistence
   - Wait for transaction confirmation
   - Update database: status='minted', mint_tx_signature stored
   - Return success response with transaction signature
```

### Intended Flow: Trade Settlement (Not Implemented)

```
1. Order matching completes (epoch clearing)
   ↓
2. SettlementService creates settlement records
   ↓
3. For each settlement:
   - Get buyer/seller token accounts
   - Build SPL token transfer instruction
   - Sign with authority or escrow account
   - Submit to blockchain
   ↓
4. Wait for confirmations
   ↓
5. Update settlement_transactions table
   - Store blockchain_tx_signature
   - Mark status='confirmed'
```

## Background Tasks

### EpochScheduler (`src/services/epoch_scheduler.rs`)
**Purpose**: Manages 15-minute market trading epochs

**Started In**: `src/main.rs` line ~215
```rust
let epoch_scheduler = Arc::new(EpochScheduler::new(db_pool, EpochConfig::default()));
epoch_scheduler.start().await?;
```

**Responsibilities**:
1. **Activate Pending Epochs**: Transition `pending → active` at `start_time`
2. **Clear Expired Epochs**: Transition `active → cleared` at `end_time` → triggers order matching
3. **Create Future Epochs**: Ensure next epoch exists (15-minute intervals)
4. **Event Broadcasting**: Publishes `EpochTransitionEvent` via WebSocketService

**Configuration**:
- Check interval: 60 seconds (`transition_check_interval_secs`)
- Epoch duration: 15 minutes (configurable)
- Epoch number format: `YYYYMMDDHHMM` (e.g., `202511091430`)

**State Recovery**: On startup, determines correct epoch state based on timestamps

**Note**: Does NOT directly interact with blockchain - manages database state only

### OrderMatchingEngine (`src/services/order_matching.rs`)
**Purpose**: Continuously matches buy/sell orders in active epochs

**Started In**: `src/main.rs` line ~208
**Blockchain Interaction**: None (database-only order matching)
**Future Work**: Settlement phase should trigger blockchain transfers

## Error Handling Patterns

### Service Layer → Handler Layer
**Pattern**: Service methods return `anyhow::Result`, handlers convert to `AppError`

```rust
// Service layer
pub async fn create_order(&self, data: CreateOrderRequest) -> anyhow::Result<Order> {
    let user = sqlx::query!(...).fetch_one(&self.db).await?;
    Ok(order)
}

// Handler layer
pub async fn create_order_handler(...) -> Result<Json<OrderResponse>, AppError> {
    let order = app_state.order_service.create_order(data).await
        .map_err(|e| AppError::internal(format!("Order creation failed: {}", e)))?;
    Ok(Json(OrderResponse::from(order)))
}
```

### Blockchain-Specific Error Scenarios

1. **RPC Connection Failure**
   - Caught in `BlockchainService` methods
   - Returns `anyhow::Error::msg("RPC connection failed")`
   - Handler returns `500 Internal Server Error`

2. **Invalid Addresses**
   - Validated via `BlockchainService::parse_pubkey()`
   - Returns `anyhow::Error` with descriptive message
   - Handler returns `400 Bad Request`

3. **Transaction Failures**
   - Retry logic in `send_transaction_with_retry()` (max 3 attempts)
   - Returns specific error: `"Transaction failed after 3 retries"`
   - Handler logs error and returns `500 Internal Server Error`

4. **Authority Wallet Missing**
   - Checked in handlers before blockchain operations
   - Returns early with appropriate error
   - Handler returns `503 Service Unavailable`

5. **Confirmation Timeouts**
   - `wait_for_confirmation()` returns error after timeout (default: 30s)
   - Handler logs error and returns failure response
   - Transaction may still succeed on-chain (check later)

### Logging Strategy
```rust
// Success
tracing::info!(tx_signature = %signature, "Transaction submitted successfully");

// Non-critical issues
tracing::warn!("Authority wallet not found. Minting will not be available.");

// Failures
tracing::error!(error = %e, "Failed to submit blockchain transaction");
```

## Key Files Reference

| File | Key Functions | Purpose |
|------|---------------|---------|
| `src/services/blockchain.rs` | `mint_energy_tokens`, `build_and_send_transaction` | Core blockchain interaction |
| `src/services/wallet.rs` | `initialize_authority`, `get_authority_keypair` | Wallet management |
| `src/services/meter.rs` | `create_reading`, `mark_as_minted` | Meter data management |
| `src/services/erc.rs` | `issue_certificate`, `transfer_certificate` | ERC certificate lifecycle |
| `src/services/settlement.rs` | `create_settlement`, `execute_settlement` | Trade settlement (placeholder) |
| `src/services/epoch_scheduler.rs` | `start`, `transition_epochs` | 15-minute epoch management |
| `src/handlers/meters.rs` | `mint_from_reading` | Admin endpoint to trigger minting |
| `src/main.rs` | Lines 130-230 | Service initialization & routing |

## Current Implementation Status

### Implemented ✅
- [x] RPC connection & health checks
- [x] Authority wallet loading (file/env/path)
- [x] Energy token minting (Anchor program integration)
- [x] Transaction building, signing, submission
- [x] Retry logic & confirmation polling
- [x] Meter reading → token minting flow
- [x] Epoch-based trading scheduler
- [x] Balance queries & account validation

### Placeholder/Incomplete ⏳
- [ ] **Settlement blockchain transfers**: SPL token transfers for matched trades
- [ ] **ERC certificate on-chain validation**: NFT minting/transfers
- [ ] **Priority fee management**: Dynamic fee calculation based on network congestion
- [ ] **Transaction batching**: Bulk operations (multiple readings → single tx)
- [ ] **Account creation automation**: Create ATAs for new users automatically
- [ ] **Transaction history**: Query on-chain transaction history for users
- [ ] **Escrow accounts**: Secure trading with on-chain escrow

## Future Enhancements

### Phase 1: Settlement Integration (High Priority)
**Goal**: Enable on-chain token transfers for matched trades

**Implementation Steps**:
1. Modify `SettlementService::execute_blockchain_transfer()`:
   - Get buyer/seller Associated Token Accounts
   - Build SPL token transfer instruction
   - Use `spl_token::instruction::transfer()` helper
   - Sign with authority or escrow account
   - Submit via `BlockchainService::build_and_send_transaction()`

2. Update settlement flow:
   - After order matching, iterate through matches
   - Create settlement records in database
   - Execute blockchain transfers
   - Store transaction signatures
   - Mark settlements as confirmed/failed

3. Error recovery:
   - Implement retry logic for failed settlements
   - Add manual admin endpoint to retry stuck settlements
   - Add monitoring/alerting for settlement failures

**Database Changes**:
- Already has `settlement_transactions` table with `blockchain_tx_signature` field
- Add `retry_count`, `error_message` columns for failure tracking

**Testing**:
- Integration test: Create orders → match → settle → verify on-chain balances
- Load test: 1000 concurrent settlements

### Phase 2: ERC Certificate Blockchain Integration
**Goal**: On-chain NFT minting and validation for renewable energy certificates

**Implementation Steps**:
1. Design NFT metadata schema (JSON):
   ```json
   {
     "name": "REC Certificate #12345",
     "description": "100 kWh renewable energy",
     "attributes": [
       {"trait_type": "Energy Amount", "value": "100 kWh"},
       {"trait_type": "Source", "value": "Solar"},
       {"trait_type": "Issue Date", "value": "2025-11-18"}
     ]
   }
   ```

2. Implement `ErcService` blockchain methods:
   - `mint_certificate_nft()` - Call Anchor program to mint NFT
   - `transfer_certificate_nft()` - Transfer NFT ownership
   - `validate_certificate()` - Query on-chain data to verify authenticity

3. Update handlers:
   - `POST /api/erc/certificates` → Mint NFT + database record
   - `POST /api/erc/certificates/{id}/transfer` → Transfer NFT + update DB
   - `GET /api/erc/certificates/{id}/validate` → Query blockchain

**Anchor Program Requirements**:
- Define certificate NFT structure
- Implement mint, transfer, burn instructions
- Add metadata validation

### Phase 3: Account Management Automation
**Goal**: Automatically create Associated Token Accounts for new users

**Implementation Steps**:
1. Add `ensure_token_account_exists()` method:
   ```rust
   pub async fn ensure_token_account_exists(
       &self,
       user_wallet: &Pubkey,
       token_mint: &Pubkey,
   ) -> Result<Pubkey>
   ```
   - Check if ATA exists
   - If not, create ATA instruction
   - Submit transaction (funded by authority wallet)
   - Return ATA address

2. Integrate into user registration flow:
   - When user connects wallet → check/create ATA
   - Store ATA address in `users.token_account_address` (new column)

3. Add admin endpoint:
   - `POST /api/admin/users/{id}/create-token-account`
   - For bulk ATA creation

### Phase 4: Transaction History & Monitoring
**Goal**: Query and display on-chain transaction history

**Implementation Steps**:
1. Add `get_transaction_history()` method:
   ```rust
   pub async fn get_transaction_history(
       &self,
       address: &Pubkey,
       limit: usize,
   ) -> Result<Vec<TransactionWithStatus>>
   ```
   - Query confirmed signatures for address
   - Parse transaction data
   - Return structured history

2. Create new handler:
   - `GET /api/blockchain/transactions?wallet={address}&limit=50`
   - Returns minting, settlement, transfer history

3. Add to user dashboard:
   - Recent transactions widget
   - Transaction details modal

### Phase 5: Priority Fee Optimization
**Goal**: Dynamic fee calculation based on network congestion

**Implementation Steps**:
1. Implement fee estimation:
   ```rust
   pub async fn estimate_priority_fee(&self) -> Result<u64> {
       // Query recent prioritization fees
       // Calculate percentile (e.g., 50th for medium priority)
       // Return recommended fee in micro-lamports
   }
   ```

2. Modify transaction building:
   - Add compute budget instruction with priority fee
   - Make fee configurable per transaction type
   - Add fee to transaction metadata

3. Add configuration:
   - Environment variable: `PRIORITY_FEE_STRATEGY` (low/medium/high)
   - Per-endpoint fee tiers (minting: high, queries: low)

### Phase 6: Transaction Batching
**Goal**: Reduce costs by batching multiple operations into single transactions

**Implementation Steps**:
1. Implement batching service:
   ```rust
   pub struct TransactionBatcher {
       pending_mints: Vec<MintRequest>,
       batch_size: usize,
       batch_interval: Duration,
   }
   ```
   - Collect operations over time window (e.g., 10 seconds)
   - When batch size or interval reached → submit batch transaction
   - Distribute transaction signature to all requests

2. Modify minting flow:
   - Add requests to batch queue instead of immediate execution
   - Return batch job ID
   - Provide status endpoint to check batch completion

3. Error handling:
   - If batch transaction fails, retry individually
   - Implement partial success handling

## Security Considerations

### Authority Wallet Protection
- **Never commit wallet JSON files to version control**
- Use hardware wallets for production authority keys
- Implement key rotation procedures
- Monitor authority wallet balance and transactions

### RPC Endpoint Security
- Use authenticated RPC endpoints in production
- Implement rate limiting for RPC calls
- Have fallback RPC URLs
- Monitor RPC health and switch on failures

### Transaction Validation
- Always verify user wallet ownership before minting
- Validate transaction amounts (max limits)
- Implement double-spend prevention
- Add transaction amount thresholds requiring multi-sig

### Database Security
- Never store private keys in database
- Encrypt sensitive transaction data at rest
- Audit all blockchain-related admin actions
- Implement transaction reconciliation (DB vs. blockchain)

## Performance Optimization

### Transaction Submission
- Use parallel transaction submission for independent operations
- Implement transaction queueing for rate limiting
- Cache recent blockhashes (valid for ~2 minutes)
- Use commitment level strategically (confirmed vs. finalized)

### RPC Client Management
- Connection pooling for multiple concurrent requests
- Circuit breaker pattern for RPC failures
- Metrics tracking: RPC latency, success rate, timeout rate

### Database Performance
- Index on `mint_tx_signature`, `blockchain_tx_signature` columns
- Partition `meter_readings` table by date
- Cache frequently queried blockchain data (balances)

## Testing Strategy

### Unit Tests
- Mock `RpcClient` for blockchain service tests
- Test transaction building logic independently
- Validate instruction data serialization

### Integration Tests
Run against `solana-test-validator`:
```bash
# Start local validator
solana-test-validator

# Run integration tests
./scripts/run-integration-tests.sh
```

**Test Scenarios**:
1. Complete minting flow (meter reading → blockchain → confirmation)
2. Settlement flow (order creation → matching → settlement → blockchain transfer)
3. Error scenarios (RPC failures, invalid addresses, timeout handling)
4. Concurrent operations (multiple mints simultaneously)

### Load Tests
```bash
# 1000 concurrent minting operations
for i in {1..1000}; do
  curl -X POST http://localhost:8080/api/admin/meters/readings/$i/mint \
    -H "Authorization: Bearer $ADMIN_TOKEN" &
done
wait
```

**Metrics to Track**:
- Transaction success rate
- Average confirmation time
- RPC error rate
- Database write latency

## Monitoring & Observability

### Prometheus Metrics
Add blockchain-specific metrics:
```rust
// Transaction metrics
track_blockchain_transaction("mint", "success", duration);
track_blockchain_transaction("settlement", "retry", duration);

// RPC metrics
track_rpc_call("get_balance", "success", latency);
track_rpc_call("send_transaction", "timeout", latency);

// Authority wallet metrics
track_authority_balance(balance_sol);
```

### Logging
Structured logging for all blockchain operations:
```rust
tracing::info!(
    tx_signature = %signature,
    user_id = %user_id,
    amount_kwh = amount,
    "Energy tokens minted successfully"
);
```

### Alerting Rules
- Authority wallet balance < 1 SOL
- Transaction failure rate > 5%
- RPC endpoint unavailable
- Settlement backlog > 100 pending

## Documentation Updates Needed

1. **API Documentation** (`docs/API_REFERENCE.md`):
   - Add blockchain transaction response schema
   - Document transaction signature format
   - Add retry behavior documentation

2. **Deployment Guide** (`docs/DEPLOYMENT.md`):
   - Authority wallet setup instructions
   - RPC endpoint configuration
   - Network selection (devnet/mainnet)

3. **Operations Manual** (`docs/OPERATIONS.md`):
   - Transaction monitoring procedures
   - Failure recovery steps
   - Authority wallet rotation procedures

4. **Developer Guide** (`docs/DEVELOPER.md`):
   - How to add new blockchain operations
   - Testing with solana-test-validator
   - Anchor program integration patterns

## Conclusion

The GridTokenX API gateway provides a robust foundation for blockchain integration with Solana, featuring:
- **Secure wallet management** with multiple loading strategies
- **Production-ready transaction handling** with retry logic and confirmation polling
- **Fully implemented energy token minting** flow
- **Extensible architecture** for settlement and ERC certificate operations

**Next Priority**: Implement settlement blockchain transfers to enable end-to-end P2P energy trading on-chain.
