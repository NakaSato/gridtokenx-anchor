# API-Gateway to Blockchain Integration Plan

## Overview

The API-Gateway connects to the Solana blockchain through the Oracle program, which acts as a trusted intermediary for submitting off-chain data (smart meter readings, market operations) to the on-chain system.

## Architecture Components

### 1. Oracle Program (Blockchain Layer)

**Location:** `programs/oracle/src/lib.rs`

**Purpose:** Acts as the bridge between external systems and blockchain state

**Key Data Structure:**

```rust
pub struct OracleData {
    pub authority: Pubkey,              // Admin who can manage oracle
    pub api_gateway: Pubkey,            // Authorized API Gateway public key
    pub total_readings: u64,
    pub last_reading_timestamp: i64,
    pub last_clearing: i64,
    pub active: bool,
    pub created_at: i64,
}
```

### 2. Protected Functions

#### Submit Meter Reading

```rust
pub fn submit_meter_reading(
    ctx: Context<SubmitMeterReading>,
    meter_id: String,
    energy_produced: u64,
    energy_consumed: u64,
    reading_timestamp: i64,
) -> Result<()>
```

- **Authorization:** Only API Gateway keypair can call
- **Purpose:** Submit AMI (Advanced Metering Infrastructure) data
- **Data Encoding:** Base64 format for external system compatibility

#### Trigger Market Clearing

```rust
pub fn trigger_market_clearing(
    ctx: Context<TriggerMarketClearing>
) -> Result<()>
```

- **Authorization:** Only API Gateway keypair can call
- **Purpose:** Initiate market settlement operations

### 3. Admin Functions

#### Initialize Oracle

```rust
pub fn initialize(
    ctx: Context<Initialize>,
    api_gateway: Pubkey
) -> Result<()>
```

- Sets up oracle with authorized API Gateway address

#### Update API Gateway

```rust
pub fn update_api_gateway(
    ctx: Context<UpdateApiGateway>,
    new_api_gateway: Pubkey,
) -> Result<()>
```

- **Authorization:** Only authority can call
- **Purpose:** Rotate API Gateway keypair if needed

#### Update Oracle Status

```rust
pub fn update_oracle_status(
    ctx: Context<UpdateOracleStatus>,
    active: bool,
) -> Result<()>
```

- **Authorization:** Only authority can call
- **Purpose:** Pause/resume oracle operations

## Data Flow

```
┌─────────────────┐      ┌──────────────┐      ┌─────────────┐      ┌──────────────┐
│  Smart Meters   │─────▶│ API Gateway  │─────▶│   Oracle    │─────▶│  Registry    │
│  (External AMI) │      │   (REST/WS)  │      │  (Solana)   │      │  (On-chain)  │
└─────────────────┘      └──────────────┘      └─────────────┘      └──────────────┘
    Real-time data      HTTP/WebSocket        Blockchain Tx         State Update
```

## Security Model

### Authentication & Authorization

1. **Keypair-Based Auth:** API Gateway must sign transactions with registered keypair
2. **On-Chain Validation:** Oracle program validates signer matches `api_gateway` pubkey
3. **Error Handling:** Unauthorized calls return `ErrorCode::UnauthorizedGateway`

### Access Control Matrix

| Function                | API Gateway | Authority | Any User |
| ----------------------- | ----------- | --------- | -------- |
| submit_meter_reading    | ✅          | ❌        | ❌       |
| trigger_market_clearing | ✅          | ❌        | ❌       |
| update_api_gateway      | ❌          | ✅        | ❌       |
| update_oracle_status    | ❌          | ✅        | ❌       |
| initialize              | ❌          | ✅        | ❌       |

## Connection Implementation

### RPC Endpoints

- **Local Development:** `http://localhost:8899`
- **Devnet:** `https://api.devnet.solana.com`
- **Mainnet:** `https://api.mainnet-beta.solana.com`

### Transaction Building Pattern

```typescript
// Pseudo-code example
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

// 1. Connect to Solana
const connection = new Connection(RPC_URL, "confirmed");

// 2. Load API Gateway keypair (secure storage)
const apiGatewayKeypair = loadKeypair(API_GATEWAY_KEYPAIR_PATH);

// 3. Load Oracle program
const program = new Program(oracleIdl, ORACLE_PROGRAM_ID, provider);

// 4. Build transaction
const tx = await program.methods
  .submitMeterReading(meterId, energyProduced, energyConsumed, timestamp)
  .accounts({
    oracleData: oracleDataPda,
    authority: apiGatewayKeypair.publicKey,
  })
  .signers([apiGatewayKeypair])
  .rpc();

// 5. Confirm transaction
await connection.confirmTransaction(tx);
```

## Events & Monitoring

### Emitted Events

1. **MeterReadingSubmitted**

   - meter_id
   - energy_produced
   - energy_consumed
   - timestamp
   - submitter

2. **MarketClearingTriggered**

   - authority
   - timestamp

3. **ApiGatewayUpdated**
   - authority
   - old_gateway
   - new_gateway
   - timestamp

### Monitoring Strategy

- Listen to program events via WebSocket subscriptions
- Parse transaction logs for base64-encoded data
- Track metrics: total_readings, last_reading_timestamp, last_clearing

## Error Handling

### Common Error Codes

- `UnauthorizedGateway`: Transaction not signed by registered API Gateway
- `OracleInactive`: Oracle has been paused by authority
- `UnauthorizedAuthority`: Admin function called by non-authority

### Retry Logic

- Implement exponential backoff for RPC failures
- Queue meter readings for retry on network issues
- Monitor transaction confirmations (confirmed/finalized commitment levels)

## Integration Checklist

### Setup Phase

- [ ] Generate API Gateway keypair
- [ ] Deploy Oracle program
- [ ] Initialize Oracle with API Gateway pubkey
- [ ] Fund API Gateway account with SOL for transaction fees

### Development Phase

- [ ] Implement RPC connection with retry logic
- [ ] Build transaction signing service
- [ ] Add event monitoring/logging
- [ ] Implement error handling & alerting

### Testing Phase

- [ ] Test meter reading submission
- [ ] Test market clearing trigger
- [ ] Test unauthorized access (should fail)
- [ ] Test Oracle pause/resume
- [ ] Load test transaction throughput

### Security Phase

- [ ] Secure keypair storage (HSM/KMS recommended)
- [ ] Implement rate limiting
- [ ] Add transaction validation
- [ ] Set up monitoring & alerts
- [ ] Document emergency procedures (key rotation)

### Production Phase

- [ ] Deploy to mainnet
- [ ] Configure monitoring dashboards
- [ ] Set up automated health checks
- [ ] Document runbook for operators

## Best Practices

### Keypair Management

- **Never commit keypairs to version control**
- Use environment variables or secure secret managers
- Implement key rotation procedures
- Separate keys for dev/staging/production

### Transaction Optimization

- Batch multiple meter readings when possible
- Use appropriate commitment levels (confirmed for speed, finalized for certainty)
- Monitor transaction fees and adjust priority fees
- Implement transaction deduplication

### Monitoring & Observability

- Log all API Gateway transactions
- Track success/failure rates
- Monitor blockchain confirmations
- Set up alerts for critical failures

### Disaster Recovery

- Document API Gateway key rotation process
- Maintain backup RPC endpoints
- Test oracle pause/resume procedures
- Keep emergency contact list updated

## Future Enhancements

### Scalability

- Implement transaction batching
- Add parallel processing for high-volume periods
- Consider L2 solutions for extreme throughput

### Security

- Multi-signature support for critical operations
- Time-based access restrictions
- Geographic validation
- Anomaly detection

### Features

- Historical data queries
- Real-time analytics dashboard
- Automated market clearing schedules
- Advanced error recovery

## References

- Oracle Program: `programs/oracle/src/lib.rs`
- Test Cases: `tests/oracle.test.ts`
- Client Implementation: `src/client/js/oracle/`
- Documentation: `docs/`
