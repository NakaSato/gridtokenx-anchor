# Plan: Real-Time Meter Data with 1kWh = 1 GRX Token Minting

Update the GridTokenX system to process real-time smart meter data and automatically mint GRX tokens at a 1:1 ratio (1 kWh = 1 GRX token). The current implementation already uses this conversion but requires manual admin triggers. This plan adds automated real-time processing.

## Steps

1. **Create automated meter polling service** in `src/services/meter_polling_service.rs` - background task that monitors unminted readings every 30-60 seconds, validates readings, and triggers batch minting automatically

2. **Enhance WebSocket service** in `src/services/websocket_service.rs` - add `MeterReadingReceived` and `TokensMinted` events to `MarketEvent` enum for real-time meter data broadcasts to connected clients

3. **Add configuration module** `src/config/tokenization.rs` - externalize the hardcoded 1:1 kWh-to-token ratio from `src/services/blockchain_service.rs` line 303, making it configurable via environment variables

4. **Update blockchain service** `src/services/blockchain_service.rs` - add `mint_energy_tokens_batch()` method to mint multiple readings in parallel transactions, improving throughput for automated processing

5. **Wire services into AppState** in `src/main.rs` - initialize `MeterPollingService` with Arc-wrapped dependencies, spawn background task, and update route handlers to broadcast WebSocket events on meter submissions

## Further Considerations

1. **Processing interval**: Should automated minting run every 30 seconds, 1 minute, or 5 minutes? Consider blockchain transaction costs vs. latency requirements.

2. **Batch size limits**: How many readings should be minted per batch cycle? Solana has ~1232 byte transaction limits - recommend max 50-100 readings per run to avoid failures.

3. **Error handling strategy**: For failed blockchain transactions, should the system retry immediately, queue for later retry, or alert admins? Consider implementing exponential backoff with max 3 retries.

4. **Current ratio confirmation**: The 1 kWh = 1 GRX (with 9 decimals) is already implemented - do you want to keep this exact ratio or adjust it? If keeping it, we just need to make it configurable rather than hardcoded.

## Current Implementation Status

### ✅ Already Implemented
- REST API for meter reading submission (`POST /api/meters/submit-reading`)
- Database storage with minted/unminted tracking (`meter_readings` table)
- Admin endpoint for manual token minting (`POST /api/admin/meters/mint-from-reading`)
- Blockchain integration via `mint_tokens_direct()` anchor instruction
- 1 kWh = 1 token (9 decimals) conversion in `BlockchainService::mint_energy_tokens()`
- Duplicate reading prevention (±15 min window)
- Validation: max 100 kWh per reading, 7-day age limit

### ⏳ Needs Enhancement
- Token minting works but requires manual admin trigger
- WebSocket service exists but only broadcasts trading events
- No automated background processing for meter readings

### ❌ Not Yet Implemented
- Automated meter data polling/ingestion
- Scheduled/batch token minting
- Real-time meter data broadcasts via WebSocket
- Configurable token conversion ratios (currently hardcoded)
- Bulk minting operations
- Retry logic for failed blockchain transactions

## Technical Details

### Current Conversion Logic
From `src/services/blockchain_service.rs` (lines 303-376):
```rust
pub async fn mint_energy_tokens(
    &self,
    authority: &Keypair,
    user_token_account: &Pubkey,
    mint: &Pubkey,
    amount_kwh: f64,
) -> Result<Signature> {
    // CONVERSION FORMULA: 1 kWh = 1 token with 9 decimals
    let amount_lamports = (amount_kwh * 1_000_000_000.0) as u64;
    
    // Calls anchor program mint_tokens_direct instruction
    // ...
}
```

### Database Schema
```sql
CREATE TABLE meter_readings (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    wallet_address VARCHAR(88) NOT NULL,
    kwh_amount DECIMAL(10, 2) NOT NULL,
    reading_timestamp TIMESTAMPTZ NOT NULL,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    minted BOOLEAN DEFAULT FALSE,
    mint_tx_signature VARCHAR(88),
    meter_signature TEXT
);
```

### Proposed Architecture

#### MeterPollingService (New)
```rust
pub struct MeterPollingService {
    db: PgPool,
    blockchain_service: Arc<BlockchainService>,
    websocket_service: Arc<WebSocketService>,
    config: TokenizationConfig,
}

impl MeterPollingService {
    pub async fn start(&self) {
        loop {
            // Fetch unminted readings
            // Batch mint tokens (max 50-100 per cycle)
            // Broadcast WebSocket events
            // Update database
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    }
}
```

#### TokenizationConfig (New)
```rust
pub struct TokenizationConfig {
    pub kwh_to_token_ratio: f64,        // Default: 1.0
    pub decimals: u8,                   // Default: 9
    pub max_reading_kwh: f64,           // Default: 100.0
    pub reading_max_age_days: i64,      // Default: 7
    pub auto_mint_enabled: bool,        // Default: true
    pub polling_interval_secs: u64,     // Default: 60
    pub batch_size: usize,              // Default: 50
}
```

#### WebSocket Events (Enhancement)
```rust
pub enum MarketEvent {
    // Existing events...
    OfferCreated,
    OrderMatched,
    TradeExecuted,
    
    // New meter events
    MeterReadingReceived {
        user_id: Uuid,
        wallet_address: String,
        kwh_amount: Decimal,
        timestamp: DateTime<Utc>,
    },
    TokensMinted {
        user_id: Uuid,
        wallet_address: String,
        kwh_amount: Decimal,
        tokens_minted: u64,
        transaction_signature: String,
    },
}
```

## Implementation Checklist

- [ ] Create `src/config/tokenization.rs` with environment variable parsing
- [ ] Update `src/services/blockchain_service.rs` to use config and add batch minting
- [ ] Create `src/services/meter_polling_service.rs` with background task
- [ ] Update `src/services/websocket_service.rs` to include meter events
- [ ] Update `src/services/mod.rs` to export new modules
- [ ] Update `src/main.rs` to initialize and spawn polling service
- [ ] Add environment variables to `local.env` and documentation
- [ ] Update OpenAPI schema for new WebSocket event types
- [ ] Add integration tests for automated minting flow
- [ ] Update `docs/PHASE4_TOKENIZATION_GUIDE.md` with real-time processing info

## Environment Variables to Add

```bash
# Tokenization Configuration
TOKENIZATION_KWH_TO_TOKEN_RATIO=1.0
TOKENIZATION_DECIMALS=9
TOKENIZATION_AUTO_MINT_ENABLED=true
TOKENIZATION_POLLING_INTERVAL_SECS=60
TOKENIZATION_BATCH_SIZE=50
TOKENIZATION_MAX_READING_KWH=100.0
TOKENIZATION_READING_MAX_AGE_DAYS=7
```

## Testing Strategy

1. **Unit Tests**: Test conversion logic with various kWh amounts
2. **Integration Tests**: 
   - Submit meter reading → auto-mint → verify token balance
   - Batch processing with 100+ readings
   - WebSocket event broadcasting
3. **Load Tests**: 
   - 1000 concurrent meter submissions
   - Verify polling service handles backlog efficiently
4. **Failure Scenarios**:
   - Blockchain RPC timeout during minting
   - Database connection failure during polling
   - Invalid wallet addresses in unminted readings

## Performance Targets

- **Minting Latency**: < 2 minutes from submission to tokens in wallet (95th percentile)
- **Throughput**: Process 500+ meter readings per hour
- **WebSocket Delivery**: Broadcast events to all connected clients in < 100ms
- **Database Load**: Polling queries should use existing indexes, < 50ms query time

## Security Considerations

1. **Authority Wallet**: Ensure keypair is stored securely (KMS in production)
2. **Rate Limiting**: Add per-user limits on meter submissions (e.g., max 1 per 5 minutes)
3. **Validation**: Double-check all readings before minting (prevent double-spend)
4. **Audit Trail**: Log all minting operations with transaction signatures
5. **WebSocket Auth**: Ensure only authenticated users receive their own meter events

## Rollout Plan

1. **Phase 1**: Deploy with `TOKENIZATION_AUTO_MINT_ENABLED=false` (manual mode)
2. **Phase 2**: Enable auto-minting in staging, monitor for 24 hours
3. **Phase 3**: Gradually enable in production with 5-minute polling interval
4. **Phase 4**: Optimize to 1-minute polling after stability confirmed
5. **Phase 5**: Add advanced features (retry logic, bulk operations, ERC issuance)
