# Configuration Module Task

## Overview

This task involves creating a centralized configuration module for the smart meter tokenization system. This module will externalize hardcoded values, make them configurable via environment variables, and provide a structured way to manage application settings. This improves flexibility, maintainability, and makes it easier to deploy the application across different environments.

## Objectives

1. Create a centralized configuration module for tokenization settings
2. Externalize hardcoded values to environment variables
3. Implement validation for configuration values
4. Add default values for all configuration options
5. Create documentation for all available configuration options

## Technical Requirements

### Core Components

#### 1. TokenizationConfig Structure

Create a new file `src/config/tokenization.rs` with the following structure:

```rust
use std::env;
use serde::Deserialize;
use log::{info, warn};

#[derive(Debug, Clone, Deserialize)]
pub struct TokenizationConfig {
    pub kwh_to_token_ratio: f64,
    pub decimals: u8,
    pub max_reading_kwh: f64,
    pub reading_max_age_days: i64,
    pub auto_mint_enabled: bool,
    pub polling_interval_secs: u64,
    pub batch_size: usize,
    pub max_retry_attempts: u32,
    pub initial_retry_delay_secs: u64,
}

impl Default for TokenizationConfig {
    fn default() -> Self {
        Self {
            kwh_to_token_ratio: 1.0,
            decimals: 9,
            max_reading_kwh: 100.0,
            reading_max_age_days: 7,
            auto_mint_enabled: true,
            polling_interval_secs: 60,
            batch_size: 50,
            max_retry_attempts: 3,
            initial_retry_delay_secs: 300, // 5 minutes
        }
    }
}

impl TokenizationConfig {
    pub fn load() -> Self {
        let mut config = Self::default();
        
        // Load from environment variables
        if let Ok(val) = env::var("TOKENIZATION_KWH_TO_TOKEN_RATIO") {
            match val.parse::<f64>() {
                Ok(ratio) => {
                    if ratio > 0.0 {
                        config.kwh_to_token_ratio = ratio;
                        info!("Using custom kWh to token ratio: {}", ratio);
                    } else {
                        warn!("Invalid kWh to token ratio: {}, using default", val);
                    }
                }
                Err(_) => warn!("Failed to parse kWh to token ratio: {}, using default", val),
            }
        }
        
        if let Ok(val) = env::var("TOKENIZATION_DECIMALS") {
            match val.parse::<u8>() {
                Ok(decimals) => {
                    if decimals <= 18 {
                        config.decimals = decimals;
                        info!("Using custom token decimals: {}", decimals);
                    } else {
                        warn!("Invalid token decimals: {}, using default (max 18)", val);
                    }
                }
                Err(_) => warn!("Failed to parse token decimals: {}, using default", val),
            }
        }
        
        if let Ok(val) = env::var("TOKENIZATION_MAX_READING_KWH") {
            match val.parse::<f64>() {
                Ok(max_kwh) => {
                    if max_kwh > 0.0 {
                        config.max_reading_kwh = max_kwh;
                        info!("Using custom max reading kWh: {}", max_kwh);
                    } else {
                        warn!("Invalid max reading kWh: {}, using default", val);
                    }
                }
                Err(_) => warn!("Failed to parse max reading kWh: {}, using default", val),
            }
        }
        
        if let Ok(val) = env::var("TOKENIZATION_READING_MAX_AGE_DAYS") {
            match val.parse::<i64>() {
                Ok(max_days) => {
                    if max_days > 0 {
                        config.reading_max_age_days = max_days;
                        info!("Using custom reading max age days: {}", max_days);
                    } else {
                        warn!("Invalid reading max age days: {}, using default", val);
                    }
                }
                Err(_) => warn!("Failed to parse reading max age days: {}, using default", val),
            }
        }
        
        if let Ok(val) = env::var("TOKENIZATION_AUTO_MINT_ENABLED") {
            match val.parse::<bool>() {
                Ok(enabled) => {
                    config.auto_mint_enabled = enabled;
                    info!("Using custom auto mint enabled: {}", enabled);
                }
                Err(_) => warn!("Failed to parse auto mint enabled: {}, using default", val),
            }
        }
        
        if let Ok(val) = env::var("TOKENIZATION_POLLING_INTERVAL_SECS") {
            match val.parse::<u64>() {
                Ok(interval) => {
                    if interval >= 10 { // Minimum 10 seconds
                        config.polling_interval_secs = interval;
                        info!("Using custom polling interval secs: {}", interval);
                    } else {
                        warn!("Invalid polling interval secs: {}, using default (min 10)", val);
                    }
                }
                Err(_) => warn!("Failed to parse polling interval secs: {}, using default", val),
            }
        }
        
        if let Ok(val) = env::var("TOKENIZATION_BATCH_SIZE") {
            match val.parse::<usize>() {
                Ok(batch_size) => {
                    if batch_size > 0 && batch_size <= 100 { // Max 100 readings per batch
                        config.batch_size = batch_size;
                        info!("Using custom batch size: {}", batch_size);
                    } else {
                        warn!("Invalid batch size: {}, using default (1-100)", val);
                    }
                }
                Err(_) => warn!("Failed to parse batch size: {}, using default", val),
            }
        }
        
        if let Ok(val) = env::var("TOKENIZATION_MAX_RETRY_ATTEMPTS") {
            match val.parse::<u32>() {
                Ok(attempts) => {
                    if attempts <= 10 { // Max 10 retries
                        config.max_retry_attempts = attempts;
                        info!("Using custom max retry attempts: {}", attempts);
                    } else {
                        warn!("Invalid max retry attempts: {}, using default (max 10)", val);
                    }
                }
                Err(_) => warn!("Failed to parse max retry attempts: {}, using default", val),
            }
        }
        
        if let Ok(val) = env::var("TOKENIZATION_INITIAL_RETRY_DELAY_SECS") {
            match val.parse::<u64>() {
                Ok(delay) => {
                    if delay >= 60 { // Minimum 1 minute
                        config.initial_retry_delay_secs = delay;
                        info!("Using custom initial retry delay secs: {}", delay);
                    } else {
                        warn!("Invalid initial retry delay secs: {}, using default (min 60)", val);
                    }
                }
                Err(_) => warn!("Failed to parse initial retry delay secs: {}, using default", val),
            }
        }
        
        config
    }
    
    /// Calculate the number of tokens to mint for a given kWh amount
    pub fn calculate_tokens(&self, kwh_amount: f64) -> u64 {
        let tokens = kwh_amount * self.kwh_to_token_ratio;
        (tokens * 10_f64.powi(self.decimals as i32)) as u64
    }
    
    /// Calculate the kWh amount for a given number of tokens
    pub fn calculate_kwh(&self, tokens: u64) -> f64 {
        let token_value = tokens as f64 / 10_f64.powi(self.decimals as i32);
        token_value / self.kwh_to_token_ratio
    }
    
    /// Validate a reading against the configuration limits
    pub fn validate_reading(&self, kwh_amount: f64, reading_age_days: i64) -> Result<(), ValidationError> {
        if kwh_amount > self.max_reading_kwh {
            return Err(ValidationError::AmountTooHigh {
                amount: kwh_amount,
                max_allowed: self.max_reading_kwh,
            });
        }
        
        if reading_age_days > self.reading_max_age_days {
            return Err(ValidationError::ReadingTooOld {
                age_days: reading_age_days,
                max_age: self.reading_max_age_days,
            });
        }
        
        Ok(())
    }
    
    /// Calculate the retry delay with exponential backoff
    pub fn calculate_retry_delay(&self, attempt: u32) -> std::time::Duration {
        let multiplier = 2_u64.pow(attempt.saturating_sub(1));
        let delay_secs = self.initial_retry_delay_secs * multiplier;
        std::time::Duration::from_secs(delay_secs)
    }
}
```

#### 2. Error Types

Define error types for validation:

```rust
#[derive(Debug, thiserror::Error)]
pub enum ValidationError {
    #[error("Reading amount {amount} kWh exceeds maximum allowed {max_allowed} kWh")]
    AmountTooHigh { amount: f64, max_allowed: f64 },
    
    #[error("Reading age {age_days} days exceeds maximum allowed {max_age} days")]
    ReadingTooOld { age_days: i64, max_age: i64 },
}
```

#### 3. Configuration Validation

Add validation methods to ensure configuration consistency:

```rust
impl TokenizationConfig {
    /// Validate the entire configuration for consistency
    pub fn validate(&self) -> Result<(), ConfigError> {
        // Check if polling interval is reasonable for batch size
        let min_processing_time = self.batch_size as u64 / 10; // Assuming 10 readings/second processing
        if self.polling_interval_secs < min_processing_time {
            return Err(ConfigError::InsufficientPollingInterval {
                interval: self.polling_interval_secs,
                required_min: min_processing_time,
            });
        }
        
        // Check if token decimals are reasonable for the ratio
        if self.kwh_to_token_ratio < 1.0 && self.decimals > 9 {
            return Err(ConfigError::UnreasonablePrecision {
                ratio: self.kwh_to_token_ratio,
                decimals: self.decimals,
            });
        }
        
        // Check if retry delay is reasonable
        if self.initial_retry_delay_secs * 2_u64.pow(self.max_retry_attempts) > 86400 { // Max 24 hours total
            return Err(ConfigError::ExcessiveRetryTime {
                max_time: self.initial_retry_delay_secs * 2_u64.pow(self.max_retry_attempts),
            });
        }
        
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("Polling interval {interval}s is too short for batch size {batch_size}. Minimum {required_min}s recommended")]
    InsufficientPollingInterval { interval: u64, required_min: u64 },
    
    #[error("Unreasonable precision: ratio {ratio} with {decimals} decimals may cause rounding issues")]
    UnreasonablePrecision { ratio: f64, decimals: u8 },
    
    #[error("Maximum retry time {max_time}s exceeds 24 hours, may cause issues")]
    ExcessiveRetryTime { max_time: u64 },
}
```

#### 4. Environment File Template

Create a template environment file `.env.template`:

```bash
# Tokenization Configuration
# Ratio of kWh to tokens (e.g., 1.0 means 1 kWh = 1 token)
TOKENIZATION_KWH_TO_TOKEN_RATIO=1.0

# Number of decimal places for tokens (similar to SOL having 9 decimals)
TOKENIZATION_DECIMALS=9

# Maximum kWh allowed per reading
TOKENIZATION_MAX_READING_KWH=100.0

# Maximum age of a reading in days before it's rejected
TOKENIZATION_READING_MAX_AGE_DAYS=7

# Whether to enable automatic token minting
TOKENIZATION_AUTO_MINT_ENABLED=true

# Interval in seconds between polling for unminted readings
TOKENIZATION_POLLING_INTERVAL_SECS=60

# Number of readings to process in a single batch
TOKENIZATION_BATCH_SIZE=50

# Maximum number of retry attempts for failed minting operations
TOKENIZATION_MAX_RETRY_ATTEMPTS=3

# Initial delay in seconds before the first retry (subsequent retries use exponential backoff)
TOKENIZATION_INITIAL_RETRY_DELAY_SECS=300
```

## Implementation Steps

1. Create the base `TokenizationConfig` struct with default values
2. Implement environment variable loading with validation
3. Add utility methods for token/kWh conversion
4. Implement validation methods for readings and configuration
5. Create error types for validation and configuration errors
6. Add configuration validation to ensure consistency
7. Create environment file template and documentation
8. Add unit tests for all configuration functionality
9. Update the main application to load and use the configuration
10. Update all hardcoded values to use the configuration

## Integration Points

### Main Application Integration

Update `src/main.rs` to load and use the configuration:

```rust
// In main function, before initializing services
let tokenization_config = TokenizationConfig::load()
    .validate()
    .expect("Invalid tokenization configuration");

// Pass the configuration to services that need it
let meter_polling_service = Arc::new(MeterPollingService::new(
    db.clone(),
    blockchain_service.clone(),
    websocket_service.clone(),
    tokenization_config.clone(),
));
```

### Service Integration

Update services to use the configuration:

```rust
// In src/services/blockchain_service.rs
impl BlockchainService {
    pub async fn mint_energy_tokens(
        &self,
        authority: &Keypair,
        user_token_account: &Pubkey,
        mint: &Pubkey,
        amount_kwh: f64,
        config: &TokenizationConfig,
    ) -> Result<Signature> {
        // Use config.calculate_tokens instead of hardcoded conversion
        let tokens = config.calculate_tokens(amount_kwh);
        
        // Rest of implementation...
    }
}

// In src/services/meter_polling_service.rs
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
        let mut interval = interval(Duration::from_secs(self.config.polling_interval_secs));
        
        loop {
            interval.tick().await;
            
            if self.config.auto_mint_enabled {
                if let Err(e) = self.process_unminted_readings().await {
                    error!("Error processing unminted readings: {}", e);
                }
            }
        }
    }
}
```

## Testing Strategy

### Unit Tests

- Test environment variable loading with various values
- Test validation of configuration values
- Test token/kWh conversion calculations
- Test validation of readings against configuration
- Test retry delay calculation with exponential backoff
- Test configuration consistency validation

### Integration Tests

- Test loading configuration from environment files
- Test passing configuration to services
- Test configuration changes affecting service behavior

## Documentation

Add comprehensive documentation for all configuration options:

```markdown
# GridTokenX Tokenization Configuration

## Overview

This document describes the configuration options available for the GridTokenX tokenization system. These options control how smart meter readings are converted into tokens and how the automated minting process works.

## Configuration Options

### TOKENIZATION_KWH_TO_TOKEN_RATIO

**Default:** 1.0  
**Description:** The ratio of kilowatt-hours (kWh) to tokens. A value of 1.0 means that 1 kWh of energy is equivalent to 1 token.  
**Example:** 0.5 would mean 2 kWh is required for 1 token, while 2.0 would mean 1 kWh generates 2 tokens.

### TOKENIZATION_DECIMALS

**Default:** 9  
**Description:** The number of decimal places for tokens. This is similar to how SOL has 9 decimal places, allowing for fractional tokens.  
**Range:** 0-18

### TOKENIZATION_MAX_READING_KWH

**Default:** 100.0  
**Description:** The maximum kWh amount allowed for a single meter reading. Readings exceeding this value will be rejected.

### TOKENIZATION_READING_MAX_AGE_DAYS

**Default:** 7  
**Description:** The maximum age of a meter reading in days before it's rejected for being too old.

### TOKENIZATION_AUTO_MINT_ENABLED

**Default:** true  
**Description:** Whether to enable automatic token minting for valid meter readings. When set to false, manual admin intervention is required.

### TOKENIZATION_POLLING_INTERVAL_SECS

**Default:** 60  
**Description:** The interval in seconds between checks for unminted readings. Shorter intervals result in faster minting but higher resource usage.

### TOKENIZATION_BATCH_SIZE

**Default:** 50  
**Range:** 1-100  
**Description:** The number of readings to process in a single batch. Larger batches are more efficient but may increase the risk of transaction failures due to size limits.

### TOKENIZATION_MAX_RETRY_ATTEMPTS

**Default:** 3  
**Range:** 0-10  
**Description:** The maximum number of retry attempts for failed minting operations.

### TOKENIZATION_INITIAL_RETRY_DELAY_SECS

**Default:** 300 (5 minutes)  
**Minimum:** 60 (1 minute)  
**Description:** The initial delay in seconds before the first retry. Subsequent retries use exponential backoff.
```

## Dependencies

- `serde` and `serde_derive` for serialization
- `serde_env` for environment variable loading
- `thiserror` for error handling
- `log` for logging

## Acceptance Criteria

1. All hardcoded values are externalized to environment variables
2. Default values are provided for all configuration options
3. Configuration values are properly validated when loaded
4. Utility methods for token/kWh conversion work correctly
5. Configuration validation ensures consistency between settings
6. Environment file template is provided with clear documentation
7. All tests pass with >95% code coverage
8. All services use the configuration instead of hardcoded values