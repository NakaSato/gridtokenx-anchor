# Smart Meter Enhancements Task Overview

## Purpose

This document provides a comprehensive breakdown of tasks required to enhance the smart meter functionality in the GridTokenX platform. The primary goal is to automate the processing of real-time smart meter data and enable automatic token minting without manual intervention.

## Current Status

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

## Task Breakdown

The implementation is divided into 7 main components:

1. **[Automated Polling Service](./01-automated-polling-service/README.md)**
   - Background task to monitor unminted readings
   - Validate readings and trigger batch minting
   - Implement retry logic for failed transactions

2. **[WebSocket Enhancements](./02-websocket-enhancements/README.md)**
   - Add `MeterReadingReceived` and `TokensMinted` events
   - Implement real-time broadcasting to connected clients

3. **[Configuration Module](./03-configuration-module/README.md)**
   - Externalize hardcoded values
   - Create environment-based configuration system

4. **[Blockchain Service Enhancements](./04-blockchain-service-enhancements/README.md)**
   - Add batch minting functionality
   - Implement parallel transaction processing

5. **[Integration](./05-integration/README.md)**
   - Wire new services into AppState
   - Update route handlers
   - Initialize background tasks

6. **[Testing](./06-testing/README.md)**
   - Unit tests for new components
   - Integration tests for automated workflows
   - Load testing for high-volume scenarios

7. **[Deployment](./07-deployment/README.md)**
   - Environment configuration
   - Gradual rollout plan
   - Monitoring setup

## Technical Specifications

### Current Conversion Logic
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

## Performance Targets

- **Minting Latency**: < 2 minutes from submission to tokens in wallet (95th percentile)
- **Throughput**: Process 500+ meter readings per hour
- **WebSocket Delivery**: Broadcast events to all connected clients in < 100ms
- **Database Load**: Polling queries should use existing indexes, < 50ms query time

## Implementation Timeline

1. **Week 1**: Automated Polling Service & Configuration Module
2. **Week 2**: WebSocket Enhancements & Blockchain Service Enhancements
3. **Week 3**: Integration & Testing
4. **Week 4**: Deployment & Monitoring

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

## Acceptance Criteria

1. All new services are integrated and working
2. Automated polling successfully processes unminted readings
3. WebSocket events are broadcast correctly
4. Configuration can be modified via environment variables
5. All tests pass with >95% code coverage
6. Performance targets are met in load testing
7. No critical security vulnerabilities are identified
8. Documentation is complete and up-to-date

## Dependencies

- PostgreSQL database (existing)
- Solana blockchain (existing)
- WebSocket server (existing)
- Anchor programs (existing)
- Rust/TypeScript backend (existing)

## Related Documentation

- [GridTokenX Implementation Plan](../../roadmap/implementation-plan.md)
- [Plan: Real-Time Meter Data with Tokenization](../../../.github/prompts/plan-realtimeMeterDataTokenization.prompt.md)
- [Core Programs Assessment](../../programs/core-programs-assessment.md)