# Automated Polling Service Task

## Overview

This task involves creating an automated meter polling service that monitors unminted meter readings, validates them, and triggers batch token minting automatically. This eliminates the need for manual admin intervention and enables real-time processing of smart meter data.

## Objectives

1. Create a background service that continuously polls for unminted meter readings
2. Implement validation logic for meter readings
3. Develop batch processing for token minting
4. Add error handling and retry logic
5. Ensure the service can be configured via environment variables

## Technical Requirements

### Core Components

#### 1. MeterPollingService Structure

Create a new file `src/services/meter_polling_service.rs` with the following structure:

```rust
use std::sync::Arc;
use std::time::Duration;
use tokio::time::interval;
use log::{info, warn, error};

use crate::config::TokenizationConfig;
use crate::db::PgPool;
use crate::services::blockchain_service::BlockchainService;
use crate::services::websocket_service::WebSocketService;

pub struct MeterPollingService {
    db: Arc<PgPool>,
    blockchain_service: Arc<BlockchainService>,
    websocket_service: Arc<WebSocketService>,
    config: TokenizationConfig,
}

impl MeterPollingService {
    pub fn new(
        db: Arc<PgPool>,
        blockchain_service: Arc<BlockchainService>,
        websocket_service: Arc<WebSocketService>,
        config: TokenizationConfig,
    ) -> Self {
        Self {
            db,
            blockchain_service,
            websocket_service,
            config,
        }
    }

    pub async fn start(&self) {
        info!("Starting meter polling service with interval: {}s", self.config.polling_interval_secs);
        
        let mut interval = interval(Duration::from_secs(self.config.polling_interval_secs));
        
        loop {
            interval.tick().await;
            
            if let Err(e) = self.process_unminted_readings().await {
                error!("Error processing unminted readings: {}", e);
            }
        }
    }
    
    async fn process_unminted_readings(&self) -> Result<(), Box<dyn std::error::Error>> {
        // Implementation details below
    }
}
```

#### 2. Unminted Readings Query

Implement a method to fetch unminted readings:

```rust
async fn fetch_unminted_readings(&self) -> Result<Vec<MeterReading>, Box<dyn std::error::Error>> {
    let readings = sqlx::query_as!(
        MeterReading,
        r#"
        SELECT 
            id, 
            user_id, 
            wallet_address, 
            kwh_amount, 
            reading_timestamp, 
            submitted_at
        FROM meter_readings 
        WHERE minted = FALSE 
        AND submitted_at >= NOW() - INTERVAL '7 days'
        ORDER BY submitted_at ASC
        LIMIT $1
        "#,
        self.config.batch_size as i64
    )
    .fetch_all(self.db.as_ref())
    .await?;
    
    Ok(readings)
}
```

#### 3. Reading Validation

Implement validation logic for meter readings:

```rust
fn validate_reading(&self, reading: &MeterReading) -> Result<(), ValidationError> {
    // Check reading age (not older than configured max age)
    let reading_age = Utc::now().signed_duration_since(reading.submitted_at);
    if reading_age.num_days() > self.config.reading_max_age_days {
        return Err(ValidationError::TooOld);
    }
    
    // Check amount (not exceeding configured max)
    if reading.kwh_amount > self.config.max_reading_kwh {
        return Err(ValidationError::AmountTooHigh);
    }
    
    // Check for duplicates (within ±15 min window)
    // This might require additional database query
    
    Ok(())
}
```

#### 4. Batch Processing

Implement batch processing for minting tokens:

```rust
async fn process_batch(&self, readings: Vec<MeterReading>) -> Result<Vec<MintResult>, Box<dyn std::error::Error>> {
    let mut results = Vec::new();
    let mut valid_readings = Vec::new();
    
    // Validate all readings first
    for reading in readings {
        match self.validate_reading(&reading) {
            Ok(_) => {
                valid_readings.push(reading);
            }
            Err(e) => {
                warn!("Invalid reading {}: {:?}", reading.id, e);
                results.push(MintResult {
                    reading_id: reading.id,
                    success: false,
                    error: Some(format!("Validation error: {:?}", e)),
                    tx_signature: None,
                });
            }
        }
    }
    
    // Process valid readings in batches
    for batch in valid_readings.chunks(self.config.batch_size) {
        let batch_results = self.mint_tokens_for_batch(batch).await?;
        results.extend(batch_results);
    }
    
    Ok(results)
}
```

#### 5. Token Minting

Implement token minting for a batch of readings:

```rust
async fn mint_tokens_for_batch(&self, readings: &[MeterReading]) -> Result<Vec<MintResult>, Box<dyn std::error::Error>> {
    let mut results = Vec::new();
    
    for reading in readings {
        // Calculate tokens to mint
        let tokens_to_mint = (reading.kwh_amount * self.config.kwh_to_token_ratio) * 10_f64.powi(self.config.decimals as i32);
        
        // Mint tokens
        match self.blockchain_service.mint_tokens_direct(
            &reading.wallet_address,
            tokens_to_mint as u64
        ).await {
            Ok(tx_signature) => {
                // Update database
                self.mark_reading_as_minted(&reading.id, &tx_signature).await?;
                
                // Send WebSocket notification
                self.websocket_service.broadcast_meter_tokens_minted(
                    reading.user_id,
                    &reading.wallet_address,
                    reading.kwh_amount,
                    tokens_to_mint as u64,
                    &tx_signature
                ).await?;
                
                info!("Successfully minted {} tokens for reading {}", tokens_to_mint, reading.id);
                
                results.push(MintResult {
                    reading_id: reading.id,
                    success: true,
                    error: None,
                    tx_signature: Some(tx_signature),
                });
            }
            Err(e) => {
                error!("Failed to mint tokens for reading {}: {}", reading.id, e);
                
                results.push(MintResult {
                    reading_id: reading.id,
                    success: false,
                    error: Some(format!("Minting error: {}", e)),
                    tx_signature: None,
                });
            }
        }
    }
    
    Ok(results)
}
```

#### 6. Database Updates

Implement methods to update the database:

```rust
async fn mark_reading_as_minted(&self, reading_id: &uuid::Uuid, tx_signature: &str) -> Result<(), Box<dyn std::error::Error>> {
    sqlx::query!(
        r#"
        UPDATE meter_readings 
        SET minted = TRUE, mint_tx_signature = $1 
        WHERE id = $2
        "#,
        tx_signature,
        reading_id
    )
    .execute(self.db.as_ref())
    .await?;
    
    Ok(())
}
```

#### 7. Error Handling and Retry Logic

Implement retry logic for failed operations:

```rust
async fn handle_failed_minting(&self, failed_results: &[MintResult]) -> Result<(), Box<dyn std::error::Error>> {
    // Add failed readings to retry queue
    for result in failed_results {
        if !result.success {
            // Add to retry table with exponential backoff
            self.add_to_retry_queue(result).await?;
        }
    }
    
    Ok(())
}

async fn add_to_retry_queue(&self, result: &MintResult) -> Result<(), Box<dyn std::error::Error>> {
    // Implementation for adding to retry queue
    // Could be a separate table in the database
    
    sqlx::query!(
        r#"
        INSERT INTO minting_retry_queue 
        (reading_id, error_message, attempts, next_retry_at, created_at) 
        VALUES ($1, $2, 1, NOW() + INTERVAL '5 minutes', NOW())
        ON CONFLICT (reading_id) DO UPDATE SET
        attempts = minting_retry_queue.attempts + 1,
        next_retry_at = CASE 
            WHEN minting_retry_queue.attempts >= 3 THEN NOW() + INTERVAL '1 hour'
            ELSE NOW() + INTERVAL '5 minutes' * POWER(2, minting_retry_queue.attempts)
        END
        "#,
        result.reading_id,
        result.error.as_ref().unwrap_or(&"Unknown error".to_string()),
    )
    .execute(self.db.as_ref())
    .await?;
    
    Ok(())
}
```

## Data Structures

### MeterReading

```rust
#[derive(Debug)]
pub struct MeterReading {
    pub id: Uuid,
    pub user_id: Uuid,
    pub wallet_address: String,
    pub kwh_amount: f64,
    pub reading_timestamp: DateTime<Utc>,
    pub submitted_at: DateTime<Utc>,
}
```

### MintResult

```rust
#[derive(Debug)]
pub struct MintResult {
    pub reading_id: Uuid,
    pub success: bool,
    pub error: Option<String>,
    pub tx_signature: Option<String>,
}
```

### ValidationError

```rust
#[derive(Debug)]
enum ValidationError {
    TooOld,
    AmountTooHigh,
    Duplicate,
    InvalidWallet,
}
```

## Implementation Steps

1. Create the base `MeterPollingService` struct with required dependencies
2. Implement the `fetch_unminted_readings` method
3. Add validation logic for meter readings
4. Develop batch processing for token minting
5. Implement the `mint_tokens_for_batch` method
6. Add database update methods
7. Implement error handling and retry logic
8. Add comprehensive logging
9. Write unit tests for all methods
10. Write integration tests for the complete workflow

## Integration Points

### Database Tables Required

```sql
-- Add to existing meter_readings table if not present
ALTER TABLE meter_readings 
ADD COLUMN IF NOT EXISTS mint_tx_signature VARCHAR(88),
ADD COLUMN IF NOT EXISTS minted BOOLEAN DEFAULT FALSE;

-- New retry queue table
CREATE TABLE IF NOT EXISTS minting_retry_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reading_id UUID REFERENCES meter_readings(id),
    error_message TEXT,
    attempts INTEGER DEFAULT 1,
    next_retry_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(reading_id)
);
```

### Service Dependencies

The service will depend on:
- `PgPool` for database access
- `BlockchainService` for token minting
- `WebSocketService` for real-time notifications
- `TokenizationConfig` for configuration

### Main Application Integration

Update `src/main.rs` to initialize and start the polling service:

```rust
// In main function, after initializing other services
let meter_polling_service = Arc::new(MeterPollingService::new(
    db.clone(),
    blockchain_service.clone(),
    websocket_service.clone(),
    tokenization_config.clone(),
));

// Start the polling service in a background task
let polling_service_clone = meter_polling_service.clone();
tokio::spawn(async move {
    polling_service_clone.start().await;
});
```

## Testing Strategy

### Unit Tests

- Test each method of `MeterPollingService` in isolation
- Mock dependencies and verify method calls
- Test validation logic with various edge cases
- Test error handling paths

### Integration Tests

- Test the complete workflow from unminted reading to token minting
- Test with a real test database
- Test WebSocket event broadcasting
- Test retry queue functionality

### Performance Tests

- Test with large batches of readings (500+)
- Measure memory usage and CPU utilization
- Test behavior under database connection issues
- Test concurrent operations

## Environment Variables

Add the following to the configuration:

```bash
# Polling service configuration
TOKENIZATION_POLLING_INTERVAL_SECS=60
TOKENIZATION_BATCH_SIZE=50
TOKENIZATION_RETRY_ENABLED=true
TOKENIZATION_MAX_RETRY_ATTEMPTS=3
TOKENIZATION_INITIAL_RETRY_DELAY_MINUTES=5
```

## Monitoring and Observability

### Metrics to Track

1. Number of readings processed per cycle
2. Number of successful vs. failed minting operations
3. Average processing time per batch
4. Number of readings in retry queue
5. Size of unminted readings backlog

### Logs to Include

1. Start of each polling cycle
2. Number of readings fetched
3. Validation failures with reasons
4. Minting successes and failures
5. Retry operations

### Alerts to Configure

1. High rate of minting failures
2. Growing backlog of unminted readings
3. Service restarts or crashes
4. Database connection failures

## Dependencies

- `tokio` for async runtime
- `sqlx` for database operations
- `uuid` for ID handling
- `chrono` for date/time handling
- `serde` for serialization
- `log` for logging

## Acceptance Criteria

1. The service runs continuously and polls for unminted readings at the configured interval
2. Valid readings are minted into tokens successfully
3. Invalid readings are properly logged and skipped
4. Failed minting operations are added to a retry queue with exponential backoff
5. WebSocket notifications are sent for successful minting operations
6. The database is updated to mark readings as minted
7. Configuration is loaded from environment variables
8. Comprehensive error handling and logging is implemented
9. All tests pass with >90% code coverage
10. Performance targets are met (process 500+ readings per hour)