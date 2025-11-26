# Backend Services Implementation Guide

## Overview

This guide provides step-by-step instructions for implementing Phase 2 backend services. Since the `gridtokenx-apigateway` is in a separate workspace, you'll need to apply these changes to that project.

## Prerequisites

- Access to `gridtokenx-apigateway` workspace
- PostgreSQL database running
- Solana RPC endpoint configured
- Rust toolchain installed
- Python 3.8+ for smart meter simulator

---

## Step 1: Database Setup

### Apply Migrations

```bash
# Navigate to API Gateway
cd /Users/chanthawat/Developments/weekend/gridtokenx-apigateway

# Copy migration file
cp /Users/chanthawat/Developments/weekend/gridtokenx-anchor/docs/backend-migrations/001_meter_readings_tables.sql migrations/

# Run migration (adjust based on your migration tool)
# If using sqlx:
sqlx migrate run

# If using raw psql:
psql $DATABASE_URL -f migrations/001_meter_readings_tables.sql
```

### Verify Tables Created

```bash
# Check tables exist
psql $DATABASE_URL -c "\dt meter_readings"
psql $DATABASE_URL -c "\dt minting_retry_queue"

# Check indexes
psql $DATABASE_URL -c "\di idx_unminted"
psql $DATABASE_URL -c "\di idx_retry_next"

# View table structure
psql $DATABASE_URL -c "\d+ meter_readings"
```

---

## Step 2: API Gateway Implementation

### File Structure

Create these files in `gridtokenx-apigateway/src/`:

```
src/
├── routes/
│   └── meters.rs          # NEW: Meter reading endpoint
├── services/
│   ├── meter_polling_service.rs   # NEW: Automated polling
│   └── event_processor.rs         # NEW: Solana event listener
├── models/
│   └── meter_reading.rs   # NEW: Data models
├── config.rs              # UPDATE: Add TokenizationConfig
└── main.rs                # UPDATE: Register new services
```

### Add Dependencies to Cargo.toml

```toml
[dependencies]
# Existing dependencies...

# Ed25519 signature verification
ed25519-dalek = "2.0"
bs58 = "0.5"

# Solana integration
solana-client = "1.18"
solana-sdk = "1.18"
solana-transaction-status = "1.18"

# Async runtime
tokio = { version = "1.35", features = ["full"] }

# Database
sqlx = { version = "0.7", features = ["runtime-tokio-rustls", "postgres", "uuid", "chrono"] }

# Utilities
uuid = { version = "1.6", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
```

### Implementation Files

The complete implementation code is available in:
- `docs/PHASE2_BACKEND_IMPLEMENTATION_PLAN.md` - Detailed code for all components

---

## Step 3: Configuration

### Update .env

Add these environment variables to `gridtokenx-apigateway/.env`:

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/gridtokenx

# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_WS_URL=wss://api.devnet.solana.com
REGISTRY_PROGRAM_ID=<your_registry_program_id>
ENERGY_TOKEN_PROGRAM_ID=<your_energy_token_program_id>

# Tokenization Configuration
TOKENIZATION_KWH_TO_TOKEN_RATIO=1.0
TOKENIZATION_DECIMALS=9
TOKENIZATION_AUTO_MINT_ENABLED=true
TOKENIZATION_POLLING_INTERVAL_SECS=60
TOKENIZATION_BATCH_SIZE=50
TOKENIZATION_MAX_READING_KWH=100.0
TOKENIZATION_READING_MAX_AGE_DAYS=7

# Retry Configuration
TOKENIZATION_RETRY_ENABLED=true
TOKENIZATION_MAX_RETRY_ATTEMPTS=10
TOKENIZATION_INITIAL_RETRY_DELAY_MINUTES=5

# Server
HOST=0.0.0.0
PORT=8080
```

---

## Step 4: Smart Meter Simulator Integration

### Update Transport Layer

```bash
# Navigate to smart meter simulator
cd /Users/chanthawat/Developments/weekend/gridtokenx-smartmeter-simulator

# Install dependencies
pip install requests PyNaCl base58
```

### Update src/transport.py

See implementation in `docs/PHASE2_BACKEND_IMPLEMENTATION_PLAN.md` Component 6.

### Update Configuration

Edit `config.yaml` or equivalent:

```yaml
api_gateway:
  url: http://localhost:8080
  endpoint: /api/meters/submit-reading
  
meter:
  id: METER-001
  wallet_address: <your_test_wallet_address>
  reading_interval_seconds: 300  # 5 minutes
  
signing:
  private_key_path: ./keys/meter_private_key.json
```

---

## Step 5: Testing

### Unit Tests

```bash
cd gridtokenx-apigateway

# Test API endpoint
cargo test meter_endpoint_test

# Test polling service
cargo test polling_service_test

# Test event processor
cargo test event_processor_test
```

### Integration Test

```bash
# Start services
docker-compose up postgres -d
cargo run --release &

# Wait for startup
sleep 5

# Run integration tests
cargo test --test integration_tests
```

### End-to-End Test

```bash
# Terminal 1: API Gateway
cd gridtokenx-apigateway
cargo run --release

# Terminal 2: Smart Meter Simulator
cd gridtokenx-smartmeter-simulator
python scripts/run.py

# Terminal 3: Monitor logs
tail -f gridtokenx-apigateway/logs/app.log

# Expected flow:
# 1. Simulator submits reading
# 2. API Gateway accepts and stores (minted=FALSE)
# 3. Polling service detects unminted reading (within 60s)
# 4. Solana transaction sent
# 5. Database updated (minted=TRUE)
# 6. Tokens visible in wallet
```

### Verify on Solana

```bash
# Check token balance
spl-token accounts <WALLET_ADDRESS>

# Should show GRID token balance increased
```

---

## Step 6: Deployment

### Staging Deployment

```bash
# Build release
cargo build --release

# Run database migrations
sqlx migrate run

# Start services
./target/release/gridtokenx-apigateway

# Monitor logs
tail -f logs/app.log
```

### Production Deployment

1. **Phase 1**: Deploy with `TOKENIZATION_AUTO_MINT_ENABLED=false`
2. **Phase 2**: Test manually with admin endpoint
3. **Phase 3**: Enable auto-minting with 5-minute polling
4. **Phase 4**: Monitor for 48 hours
5. **Phase 5**: Optimize to 1-minute polling

---

## Monitoring

### Key Metrics

```sql
-- Unminted readings backlog
SELECT COUNT(*) FROM meter_readings WHERE minted = FALSE;

-- Minting success rate (last hour)
SELECT 
    COUNT(*) FILTER (WHERE minted = TRUE) as minted,
    COUNT(*) FILTER (WHERE minted = FALSE) as unminted,
    ROUND(100.0 * COUNT(*) FILTER (WHERE minted = TRUE) / COUNT(*), 2) as success_rate
FROM meter_readings
WHERE submitted_at >= NOW() - INTERVAL '1 hour';

-- Retry queue size
SELECT 
    COUNT(*) as total,
    AVG(attempts) as avg_attempts,
    MAX(attempts) as max_attempts
FROM minting_retry_queue;

-- Average minting latency
SELECT 
    AVG(EXTRACT(EPOCH FROM (updated_at - submitted_at))) as avg_latency_seconds
FROM meter_readings
WHERE minted = TRUE
AND submitted_at >= NOW() - INTERVAL '1 hour';
```

### Alerts

Set up alerts for:
- Unminted backlog > 100 readings
- Minting success rate < 95%
- Average latency > 120 seconds
- Retry queue size > 50

---

## Troubleshooting

### Issue: Readings not being minted

**Check:**
1. Polling service is running: `ps aux | grep meter_polling_service`
2. Database connection: `psql $DATABASE_URL -c "SELECT 1"`
3. Solana RPC connection: `curl $SOLANA_RPC_URL -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'`
4. Logs: `tail -f logs/app.log | grep "process_unminted"`

### Issue: Signature verification failing

**Check:**
1. Public key matches private key: Verify in smart meter simulator
2. Message format matches: Check signing and verification use same format
3. Base58 encoding: Ensure both sides use same encoding

### Issue: High retry rate

**Check:**
1. Solana RPC rate limits
2. Network connectivity
3. Transaction fees (ensure sufficient SOL)
4. Program errors in logs

---

## Next Steps

After successful implementation:

1. ✅ All tests passing
2. ✅ E2E flow working (meter → settlement)
3. ✅ Monitoring dashboards set up
4. ✅ Documentation updated

Then proceed to:
- WebSocket enhancements for real-time notifications
- Batch minting optimization
- Oracle integration for dynamic pricing
- ERC issuance on settlement

---

## Support

For issues or questions:
- Check logs in `logs/app.log`
- Review implementation plan: `docs/PHASE2_BACKEND_IMPLEMENTATION_PLAN.md`
- Review flow documentation: `docs/SMART_METER_TO_SETTLEMENT_FLOW.md`
