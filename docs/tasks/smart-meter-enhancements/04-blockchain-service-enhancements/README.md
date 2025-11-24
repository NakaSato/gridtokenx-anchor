# Blockchain Service Enhancements Task

## Overview

This task involves enhancing the existing blockchain service to support batch token minting for smart meter readings. The current implementation only supports minting tokens for a single reading at a time, which is inefficient for processing multiple readings. The enhanced service will support batch operations, improve throughput, and integrate with the automated meter polling service.

## Objectives

1. Add batch token minting functionality to the blockchain service
2. Implement parallel transaction processing for improved throughput
3. Add validation for batch operations
4. Implement proper error handling for batch transactions
5. Optimize transaction construction to minimize blockchain fees

## Technical Requirements

### Core Components

#### 1. Batch Minting Method

Add a new method to `src/services/blockchain_service.rs` for batch minting:

```rust
impl BlockchainService {
    /// Mint tokens for multiple meter readings in a single operation
    pub async fn mint_energy_tokens_batch(
        &self,
        authority: &Keypair,
        batch_data: Vec<MintBatchData>,
    ) -> Result<Vec<MintResult>, BlockchainError> {
        let mut results = Vec::new();
        let mint = &self.token_mint;
        
        // Validate batch size
        if batch_data.is_empty() {
            return Err(BlockchainError::EmptyBatch);
        }
        
        if batch_data.len() > MAX_BATCH_SIZE {
            return Err(BlockchainError::BatchTooLarge {
                size: batch_data.len(),
                max_size: MAX_BATCH_SIZE,
            });
        }
        
        // Group by user to optimize account creation
        let mut user_groups: std::collections::HashMap<String, Vec<MintBatchData>> = 
            std::collections::HashMap::new();
        
        for data in &batch_data {
            user_groups.entry(data.user_id.clone()).or_insert_with(Vec::new).push(data.clone());
        }
        
        // Process each user group in parallel
        let mut tasks = Vec::new();
        
        for (user_id, user_batch) in user_groups {
            let authority = authority.clone();
            let mint = mint.clone();
            let rpc_client = self.rpc_client.clone();
            
            let task = tokio::spawn(async move {
                Self::mint_for_user_batch(&authority, &mint, &rpc_client, user_batch).await
            });
            
            tasks.push(task);
        }
        
        // Wait for all tasks to complete
        for task in tasks {
            match task.await {
                Ok(Ok(user_results)) => results.extend(user_results),
                Ok(Err(e)) => {
                    // Create error results for all items in this batch
                    error!("Error minting tokens for batch: {}", e);
                }
                Err(e) => {
                    error!("Task failed: {}", e);
                }
            }
        }
        
        Ok(results)
    }
    
    /// Mint tokens for a single user's batch of readings
    async fn mint_for_user_batch(
        authority: &Keypair,
        mint: &Pubkey,
        rpc_client: &RpcClient,
        batch: Vec<MintBatchData>,
    ) -> Result<Vec<MintResult>, BlockchainError> {
        let mut results = Vec::new();
        
        // Create or get user's token account
        let user_token_account = Self::get_or_create_user_token_account(
            authority,
            &batch[0].wallet_address,
            mint,
            rpc_client,
        ).await?;
        
        // Calculate total tokens to mint for this user
        let total_tokens: u64 = batch.iter()
            .map(|data| data.tokens_to_mint)
            .sum();
        
        // Create mint instruction
        let mint_instruction = Self::create_batch_mint_instruction(
            authority,
            &user_token_account,
            mint,
            total_tokens,
        )?;
        
        // Build and send transaction
        let transaction = Transaction::new_signed_with_payer(
            &[mint_instruction],
            Some(&authority.pubkey()),
            &[authority],
            rpc_client.get_latest_blockhash()?,
        );
        
        // Send transaction
        let signature = rpc_client.send_and_confirm_transaction(&transaction)?;
        
        // Create successful results for all items in this batch
        for data in batch {
            results.push(MintResult {
                reading_id: data.reading_id,
                success: true,
                error: None,
                tx_signature: Some(signature.to_string()),
            });
        }
        
        Ok(results)
    }
    
    /// Create or get user's token account
    async fn get_or_create_user_token_account(
        authority: &Keypair,
        user_wallet: &str,
        mint: &Pubkey,
        rpc_client: &RpcClient,
    ) -> Result<Pubkey, BlockchainError> {
        let user_pubkey = Pubkey::from_str(user_wallet)?;
        
        // Get associated token account
        let token_account = get_associated_token_address(&user_pubkey, mint);
        
        // Check if account exists
        match rpc_client.get_account(&token_account) {
            Ok(_) => Ok(token_account),
            Err(_) => {
                // Create the account
                let create_instruction = create_associated_token_account(
                    &authority.pubkey(),
                    &user_pubkey,
                    mint,
                    &spl_token::id(),
                );
                
                let transaction = Transaction::new_signed_with_payer(
                    &[create_instruction],
                    Some(&authority.pubkey()),
                    &[authority],
                    rpc_client.get_latest_blockhash()?,
                );
                
                rpc_client.send_and_confirm_transaction(&transaction)?;
                Ok(token_account)
            }
        }
    }
    
    /// Create batch mint instruction
    fn create_batch_mint_instruction(
        authority: &Keypair,
        user_token_account: &Pubkey,
        mint: &Pubkey,
        amount: u64,
    ) -> Result<Instruction, BlockchainError> {
        // This would call the appropriate Anchor program instruction
        // Using the existing mint_tokens_direct or a new batch_mint_tokens instruction
        
        let mint_keys = MintTokensDirect {
            authority: authority.pubkey(),
            token_mint: *mint,
            user_token_account: *user_token_account,
            token_program: spl_token::id(),
        };
        
        let instruction = mint_tokens_direct(
            &gridtokenx_token::id(),
            &mint_keys,
            amount,
        )?;
        
        Ok(instruction)
    }
}
```

#### 2. Data Structures

Define the data structures needed for batch operations:

```rust
/// Data for a single item in a minting batch
#[derive(Debug, Clone)]
pub struct MintBatchData {
    pub reading_id: Uuid,
    pub user_id: String,
    pub wallet_address: String,
    pub kwh_amount: f64,
    pub tokens_to_mint: u64,
    pub meter_id: Option<String>,
}

/// Result of a minting operation
#[derive(Debug, Clone)]
pub struct MintResult {
    pub reading_id: Uuid,
    pub success: bool,
    pub error: Option<String>,
    pub tx_signature: Option<String>,
}

/// Maximum number of readings to process in a single batch
const MAX_BATCH_SIZE: usize = 50;
```

#### 3. Enhanced Error Types

Extend the existing error types for batch operations:

```rust
#[derive(Debug, thiserror::Error)]
pub enum BlockchainError {
    // Existing errors...
    #[error("Solana error: {0}")]
    SolanaError(#[from] solana_client::client_error::ClientError),
    
    // New batch-related errors
    #[error("Empty batch provided")]
    EmptyBatch,
    
    #[error("Batch too large: {size} items, max {max_size}")]
    BatchTooLarge { size: usize, max_size: usize },
    
    #[error("Batch partially successful: {success}/{total}")
    PartiallySuccessful { success: usize, total: usize },
    
    #[error("Invalid batch data: {reason}")]
    InvalidBatchData { reason: String },
}
```

#### 4. Transaction Optimization

Implement transaction optimization for batch operations:

```rust
impl BlockchainService {
    /// Optimize batch by grouping compatible operations
    pub fn optimize_batch(&self, batch: &[MintBatchData]) -> Vec<Vec<MintBatchData>> {
        let mut optimized_batches = Vec::new();
        let mut current_batch = Vec::new();
        let mut current_tokens = 0u64;
        const MAX_TOKENS_PER_TRANSACTION: u64 = 1_000_000_000_000; // 1 billion tokens
        
        for item in batch {
            // Check if adding this item would exceed limits
            if current_batch.len() >= MAX_BATCH_SIZE || 
               current_tokens.saturating_add(item.tokens_to_mint) > MAX_TOKENS_PER_TRANSACTION {
                if !current_batch.is_empty() {
                    optimized_batches.push(current_batch.clone());
                    current_batch.clear();
                    current_tokens = 0;
                }
            }
            
            current_batch.push(item.clone());
            current_tokens = current_tokens.saturating_add(item.tokens_to_mint);
        }
        
        if !current_batch.is_empty() {
            optimized_batches.push(current_batch);
        }
        
        optimized_batches
    }
    
    /// Calculate estimated transaction fee for a batch
    pub fn estimate_batch_fee(&self, batch: &[MintBatchData]) -> Result<u64, BlockchainError> {
        let num_transactions = self.optimize_batch(batch).len();
        let base_fee = 5000; // Base fee per transaction in lamports
        let fee_per_account = 5000; // Fee per account in transaction
        
        // Estimate number of unique accounts
        let mut unique_accounts = std::collections::HashSet::new();
        for item in batch {
            unique_accounts.insert(item.wallet_address.clone());
        }
        
        let estimated_fee = (base_fee + fee_per_account * unique_accounts.len()) * num_transactions as u64;
        Ok(estimated_fee)
    }
}
```

## Implementation Steps

1. Add batch minting method to the blockchain service
2. Implement user grouping for batch operations
3. Add parallel processing for multiple users
4. Implement transaction optimization
5. Add fee estimation for batch operations
6. Update error handling for batch operations
7. Add comprehensive logging for batch operations
8. Write unit tests for all new methods
9. Write integration tests for batch processing
10. Update existing single minting method to use batch method internally

## Integration Points

### Meter Polling Service Integration

Update the meter polling service to use batch minting:

```rust
// In src/services/meter_polling_service.rs
impl MeterPollingService {
    async fn process_batch(&self, readings: Vec<MeterReading>) -> Result<Vec<MintResult>, Box<dyn std::error::Error>> {
        // Convert readings to batch data
        let batch_data: Vec<MintBatchData> = readings.into_iter().map(|reading| {
            MintBatchData {
                reading_id: reading.id,
                user_id: reading.user_id.to_string(),
                wallet_address: reading.wallet_address.clone(),
                kwh_amount: reading.kwh_amount,
                tokens_to_mint: self.config.calculate_tokens(reading.kwh_amount),
                meter_id: Some(reading.meter_id),
            }
        }).collect();
        
        // Optimize and process batch
        let optimized_batches = self.blockchain_service.optimize_batch(&batch_data);
        let mut all_results = Vec::new();
        
        for batch in optimized_batches {
            let results = self.blockchain_service.mint_energy_tokens_batch(
                &self.authority_keypair,
                batch,
            ).await?;
            
            all_results.extend(results);
        }
        
        Ok(all_results)
    }
}
```

### API Endpoint Integration

Update the existing minting API endpoint to support batch operations:

```rust
// In src/routes/meters.rs
#[post("/mint-batch")]
pub async fn mint_batch(
    request: Json<MintBatchRequest>,
    blockchain_service: web::Data<Arc<BlockchainService>>,
    // ... other dependencies
) -> Result<HttpResponse, Error> {
    // Validate request
    if request.reading_ids.is_empty() {
        return Ok(HttpResponse::BadRequest().json(BadRequestResponse {
            error: "No reading IDs provided".to_string(),
        }));
    }
    
    // Fetch readings from database
    let readings = fetch_readings_by_ids(&request.reading_ids).await?;
    
    // Convert to batch data
    let batch_data: Vec<MintBatchData> = readings.into_iter().map(|reading| {
        MintBatchData {
            reading_id: reading.id,
            user_id: reading.user_id.to_string(),
            wallet_address: reading.wallet_address.clone(),
            kwh_amount: reading.kwh_amount,
            tokens_to_mint: calculate_tokens(reading.kwh_amount),
            meter_id: Some(reading.meter_id),
        }
    }).collect();
    
    // Process batch
    let results = blockchain_service.mint_energy_tokens_batch(
        &authority_keypair,
        batch_data,
    ).await?;
    
    // Count successful and failed operations
    let successful_count = results.iter().filter(|r| r.success).count();
    let failed_count = results.len() - successful_count;
    
    Ok(HttpResponse::Ok().json(MintBatchResponse {
        total_readings: results.len(),
        successful_mints: successful_count,
        failed_mints: failed_count,
        results,
    }))
}
```

## Testing Strategy

### Unit Tests

- Test batch creation and validation
- Test user grouping logic
- Test transaction optimization
- Test fee estimation
- Test error handling for various failure scenarios

### Integration Tests

- Test end-to-end batch minting with real blockchain
- Test behavior with large batches
- Test parallel processing with multiple users
- Test behavior under network congestion

### Performance Tests

- Measure throughput improvements compared to individual minting
- Test with maximum batch sizes
- Measure latency for batch vs. individual operations
- Test resource usage under high load

## Environment Variables

Add configuration options for batch processing:

```bash
# Blockchain service configuration
BLOCKCHAIN_MAX_BATCH_SIZE=50
BLOCKCHAIN_MAX_TOKENS_PER_TRANSACTION=1000000000000
BLOCKCHAIN_CONCURRENT_BATCHES=5
BLOCKCHAIN_FEE_ESTIMATION_ENABLED=true
BLOCKCHAIN_BATCH_RETRY_ENABLED=true
```

## Dependencies

- `tokio` for async runtime and parallel processing
- `solana-sdk` for blockchain operations
- `spl-token` for token operations
- `thiserror` for error handling
- `uuid` for ID handling
- `serde` for serialization

## Acceptance Criteria

1. Batch minting processes multiple readings efficiently
2. Transactions are optimized to minimize fees
3. Parallel processing improves throughput for multiple users
4. Error handling provides detailed feedback for failed operations
5. Fee estimation is accurate for batch operations
6. All tests pass with >90% code coverage
7. Performance targets are met (batch processing is 3x faster than individual)
8. Backward compatibility is maintained for existing single minting method