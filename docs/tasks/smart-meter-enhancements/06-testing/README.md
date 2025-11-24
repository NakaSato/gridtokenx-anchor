# Testing Task

## Overview

This task involves creating a comprehensive testing strategy for all smart meter enhancements. The goal is to ensure that the automated meter polling service, WebSocket enhancements, configuration module, and blockchain service enhancements work correctly individually and as an integrated system. Testing will cover unit tests, integration tests, performance tests, and end-to-end tests.

## Objectives

1. Create unit tests for all new components with >90% code coverage
2. Implement integration tests for component interactions
3. Develop performance tests to verify throughput targets
4. Create end-to-end tests for complete user workflows
5. Implement test fixtures and data generation utilities
6. Add load testing for high-volume scenarios

## Testing Components

### 1. Automated Polling Service Tests

Create comprehensive tests for `src/services/meter_polling_service.rs`:

```rust
// tests/services/meter_polling_service_test.rs
use gridtokenx::services::MeterPollingService;
use gridtokenx::config::TokenizationConfig;
use gridtokenx::models::MeterReading;
use tokio_test;
use uuid::Uuid;
use chrono::Utc;

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_fetch_unminted_readings() {
        // Setup test database with mock data
        let (pool, _lock) = create_test_db().await;
        let config = TokenizationConfig::default();
        let blockchain_service = create_mock_blockchain_service();
        let websocket_service = create_mock_websocket_service();
        
        let service = MeterPollingService::new(
            Arc::new(pool),
            Arc::new(blockchain_service),
            Arc::new(websocket_service),
            config,
        );
        
        // Insert test data
        insert_test_meter_readings(&pool, 5).await;
        
        // Fetch unminted readings
        let readings = service.fetch_unminted_readings().await.unwrap();
        
        // Assertions
        assert_eq!(readings.len(), 5);
        for reading in &readings {
            assert!(!reading.minted);
        }
    }
    
    #[tokio::test]
    async fn test_validate_reading() {
        let config = TokenizationConfig {
            max_reading_kwh: 100.0,
            reading_max_age_days: 7,
            ..Default::default()
        };
        
        let service = MeterPollingService::new(
            Arc::new(create_test_db().await.0),
            Arc::new(create_mock_blockchain_service()),
            Arc::new(create_mock_websocket_service()),
            config,
        );
        
        // Test valid reading
        let valid_reading = create_test_meter_reading(50.0, Utc::now());
        assert!(service.validate_reading(&valid_reading).is_ok());
        
        // Test reading with too high kWh
        let invalid_reading = create_test_meter_reading(150.0, Utc::now());
        assert!(service.validate_reading(&invalid_reading).is_err());
        
        // Test old reading
        let old_reading = create_test_meter_reading(50.0, Utc::now() - chrono::Duration::days(10));
        assert!(service.validate_reading(&old_reading).is_err());
    }
    
    #[tokio::test]
    async fn test_process_batch() {
        let (pool, _lock) = create_test_db().await;
        let config = TokenizationConfig::default();
        let blockchain_service = Arc::new(MockBlockchainService::new());
        let websocket_service = Arc::new(MockWebSocketService::new());
        
        let service = MeterPollingService::new(
            Arc::new(pool),
            blockchain_service.clone(),
            websocket_service.clone(),
            config,
        );
        
        // Create test readings
        let readings = vec![
            create_test_meter_reading(10.0, Utc::now()),
            create_test_meter_reading(20.0, Utc::now()),
            create_test_meter_reading(30.0, Utc::now()),
        ];
        
        // Process batch
        let results = service.process_batch(readings).await.unwrap();
        
        // Verify results
        assert_eq!(results.len(), 3);
        
        // Check blockchain service was called
        assert_eq!(blockchain_service.mint_calls.borrow().len(), 3);
        
        // Check WebSocket notifications were sent
        assert_eq!(websocket_service.tokens_minted_calls.borrow().len(), 3);
    }
    
    #[tokio::test]
    async fn test_retry_logic() {
        let (pool, _lock) = create_test_db().await;
        let config = TokenizationConfig {
            max_retry_attempts: 2,
            initial_retry_delay_secs: 1,
            ..Default::default()
        };
        
        // Create a blockchain service that fails on first attempt
        let blockchain_service = Arc::new(MockFailingBlockchainService::new(1));
        let websocket_service = Arc::new(MockWebSocketService::new());
        
        let service = MeterPollingService::new(
            Arc::new(pool),
            blockchain_service.clone(),
            websocket_service.clone(),
            config,
        );
        
        // Create test readings
        let readings = vec![create_test_meter_reading(10.0, Utc::now())];
        
        // Process batch
        let results = service.process_batch(readings).await.unwrap();
        
        // Verify retry happened
        assert_eq!(blockchain_service.mint_attempts.borrow().len(), 2);
        
        // Verify final result is success
        assert!(results[0].success);
    }
}
```

### 2. WebSocket Service Tests

Create comprehensive tests for `src/services/websocket_service.rs`:

```rust
// tests/services/websocket_service_test.rs
use gridtokenx::services::{WebSocketService, MarketEvent};
use gridtokenx::models::{SocketId, WebSocketConnection};
use tokio_tungstenite::tungstenite::Message;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_meter_reading_event_serialization() {
        // Create a meter reading event
        let event = MarketEvent::MeterReadingReceived {
            user_id: Uuid::new_v4(),
            wallet_address: "5C4wSuGVU2J5qmM4gR1gM7YJQ2dEjKowZ3zLsjhZxKq9".to_string(),
            meter_id: "METER_001".to_string(),
            kwh_amount: 10.5,
            timestamp: Utc::now(),
        };
        
        // Serialize to JSON
        let json = serde_json::to_string(&event).unwrap();
        
        // Deserialize back
        let deserialized: MarketEvent = serde_json::from_str(&json).unwrap();
        
        // Verify
        match deserialized {
            MarketEvent::MeterReadingReceived { meter_id, kwh_amount, .. } => {
                assert_eq!(meter_id, "METER_001");
                assert_eq!(kwh_amount, 10.5);
            }
            _ => panic!("Expected MeterReadingReceived event"),
        }
    }
    
    #[tokio::test]
    async fn test_user_specific_event_delivery() {
        let service = WebSocketService::new();
        let user_id = Uuid::new_v4();
        
        // Create a mock WebSocket connection
        let (mock_ws, _handle) = create_mock_websocket();
        let socket_id = SocketId::new();
        
        // Register connection
        service.add_connection(
            socket_id.clone(),
            user_id,
            false, // not admin
            mock_ws,
        ).await;
        
        // Create an event
        let event = MarketEvent::MeterReadingReceived {
            user_id,
            wallet_address: "5C4wSuGVU2J5qmM4gR1gM7YJQ2dEjKowZ3zLsjhZxKq9".to_string(),
            meter_id: "METER_001".to_string(),
            kwh_amount: 10.5,
            timestamp: Utc::now(),
        };
        
        // Send event to user
        service.send_to_user(user_id, &event).await.unwrap();
        
        // Verify event was sent to the correct connection
        // This would require mocking the WebSocket to capture sent messages
    }
    
    #[tokio::test]
    async fn test_event_filtering() {
        let service = WebSocketService::new();
        let socket_id = SocketId::new();
        
        // Create a subscription with filters
        let subscription = EventSubscription {
            event_types: vec!["MeterReadingReceived".to_string()],
            meters: Some(vec!["METER_001".to_string()]),
            min_amount: Some(5.0),
        };
        
        // Subscribe to events
        service.subscribe_to_events(socket_id, subscription).await.unwrap();
        
        // Create events that match and don't match the filter
        let matching_event = MarketEvent::MeterReadingReceived {
            user_id: Uuid::new_v4(),
            wallet_address: "5C4wSuGVU2J5qmM4gR1gM7YJQ2dEjKowZ3zLsjhZxKq9".to_string(),
            meter_id: "METER_001".to_string(),
            kwh_amount: 10.0,
            timestamp: Utc::now(),
        };
        
        let non_matching_event = MarketEvent::MeterReadingReceived {
            user_id: Uuid::new_v4(),
            wallet_address: "5C4wSuGVU2J5qmM4gR1gM7YJQ2dEjKowZ3zLsjhZxKq9".to_string(),
            meter_id: "METER_002".to_string(),
            kwh_amount: 10.0,
            timestamp: Utc::now(),
        };
        
        // Test filtering logic
        assert!(service.event_matches_subscription(&matching_event, &subscription));
        assert!(!service.event_matches_subscription(&non_matching_event, &subscription));
    }
}
```

### 3. Configuration Module Tests

Create comprehensive tests for `src/config/tokenization.rs`:

```rust
// tests/config/tokenization_test.rs
use gridtokenx::config::{TokenizationConfig, ConfigError};
use std::env;

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_default_config() {
        let config = TokenizationConfig::default();
        
        assert_eq!(config.kwh_to_token_ratio, 1.0);
        assert_eq!(config.decimals, 9);
        assert_eq!(config.max_reading_kwh, 100.0);
        assert_eq!(config.reading_max_age_days, 7);
        assert!(config.auto_mint_enabled);
        assert_eq!(config.polling_interval_secs, 60);
        assert_eq!(config.batch_size, 50);
        assert_eq!(config.max_retry_attempts, 3);
        assert_eq!(config.initial_retry_delay_secs, 300);
    }
    
    #[test]
    fn test_environment_variable_loading() {
        // Set environment variables
        env::set_var("TOKENIZATION_KWH_TO_TOKEN_RATIO", "2.5");
        env::set_var("TOKENIZATION_DECIMALS", "6");
        env::set_var("TOKENIZATION_MAX_READING_KWH", "200.0");
        env::set_var("TOKENIZATION_READING_MAX_AGE_DAYS", "14");
        env::set_var("TOKENIZATION_AUTO_MINT_ENABLED", "false");
        env::set_var("TOKENIZATION_POLLING_INTERVAL_SECS", "120");
        env::set_var("TOKENIZATION_BATCH_SIZE", "25");
        env::set_var("TOKENIZATION_MAX_RETRY_ATTEMPTS", "5");
        env::set_var("TOKENIZATION_INITIAL_RETRY_DELAY_SECS", "600");
        
        // Load config
        let config = TokenizationConfig::load();
        
        // Verify values
        assert_eq!(config.kwh_to_token_ratio, 2.5);
        assert_eq!(config.decimals, 6);
        assert_eq!(config.max_reading_kwh, 200.0);
        assert_eq!(config.reading_max_age_days, 14);
        assert!(!config.auto_mint_enabled);
        assert_eq!(config.polling_interval_secs, 120);
        assert_eq!(config.batch_size, 25);
        assert_eq!(config.max_retry_attempts, 5);
        assert_eq!(config.initial_retry_delay_secs, 600);
        
        // Clean up
        env::remove_var("TOKENIZATION_KWH_TO_TOKEN_RATIO");
        env::remove_var("TOKENIZATION_DECIMALS");
        env::remove_var("TOKENIZATION_MAX_READING_KWH");
        env::remove_var("TOKENIZATION_READING_MAX_AGE_DAYS");
        env::remove_var("TOKENIZATION_AUTO_MINT_ENABLED");
        env::remove_var("TOKENIZATION_POLLING_INTERVAL_SECS");
        env::remove_var("TOKENIZATION_BATCH_SIZE");
        env::remove_var("TOKENIZATION_MAX_RETRY_ATTEMPTS");
        env::remove_var("TOKENIZATION_INITIAL_RETRY_DELAY_SECS");
    }
    
    #[test]
    fn test_token_kwh_conversion() {
        let config = TokenizationConfig {
            kwh_to_token_ratio: 1.0,
            decimals: 9,
            ..Default::default()
        };
        
        // Test token calculation
        let tokens = config.calculate_tokens(1.0);
        assert_eq!(tokens, 1_000_000_000); // 1.0 * 10^9
        
        // Test kWh calculation
        let kwh = config.calculate_kwh(1_000_000_000);
        assert_eq!(kwh, 1.0);
        
        // Test with different ratio
        let config = TokenizationConfig {
            kwh_to_token_ratio: 2.0,
            decimals: 9,
            ..Default::default()
        };
        
        let tokens = config.calculate_tokens(1.0);
        assert_eq!(tokens, 2_000_000_000); // 1.0 * 2.0 * 10^9
    }
    
    #[test]
    fn test_reading_validation() {
        let config = TokenizationConfig {
            max_reading_kwh: 100.0,
            reading_max_age_days: 7,
            ..Default::default()
        };
        
        // Valid reading
        assert!(config.validate_reading(50.0, 3).is_ok());
        
        // Invalid reading - too high
        assert!(config.validate_reading(150.0, 3).is_err());
        
        // Invalid reading - too old
        assert!(config.validate_reading(50.0, 10).is_err());
    }
    
    #[test]
    fn test_retry_delay_calculation() {
        let config = TokenizationConfig {
            initial_retry_delay_secs: 60,
            ..Default::default()
        };
        
        // Test exponential backoff
        let delay1 = config.calculate_retry_delay(1);
        let delay2 = config.calculate_retry_delay(2);
        let delay3 = config.calculate_retry_delay(3);
        
        assert_eq!(delay1.as_secs(), 60);      // 60 * 2^0
        assert_eq!(delay2.as_secs(), 120);     // 60 * 2^1
        assert_eq!(delay3.as_secs(), 240);     // 60 * 2^2
    }
    
    #[test]
    fn test_config_validation() {
        // Valid config
        let valid_config = TokenizationConfig {
            polling_interval_secs: 60,
            batch_size: 10,
            kwh_to_token_ratio: 1.0,
            decimals: 9,
            initial_retry_delay_secs: 300,
            max_retry_attempts: 3,
            ..Default::default()
        };
        assert!(valid_config.validate().is_ok());
        
        // Invalid polling interval for batch size
        let invalid_config = TokenizationConfig {
            polling_interval_secs: 1, // Too short for batch size
            batch_size: 50,
            ..Default::default()
        };
        assert!(invalid_config.validate().is_err());
        
        // Unreasonable precision
        let invalid_config = TokenizationConfig {
            kwh_to_token_ratio: 0.1,
            decimals: 15,
            ..Default::default()
        };
        assert!(invalid_config.validate().is_err());
    }
}
```

### 4. Blockchain Service Tests

Create comprehensive tests for `src/services/blockchain_service.rs`:

```rust
// tests/services/blockchain_service_test.rs
use gridtokenx::services::{BlockchainService, MintBatchData, MintResult};
use solana_sdk::signature::Keypair;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_batch_minting() {
        // Create a mock blockchain service
        let service = create_mock_blockchain_service();
        let authority = Keypair::new();
        
        // Create batch data
        let batch_data = vec![
            MintBatchData {
                reading_id: Uuid::new_v4(),
                user_id: "user1".to_string(),
                wallet_address: "5C4wSuGVU2J5qmM4gR1gM7YJQ2dEjKowZ3zLsjhZxKq9".to_string(),
                kwh_amount: 10.0,
                tokens_to_mint: 10_000_000_000, // 10 tokens with 9 decimals
                meter_id: Some("METER_001".to_string()),
            },
            MintBatchData {
                reading_id: Uuid::new_v4(),
                user_id: "user1".to_string(),
                wallet_address: "5C4wSuGVU2J5qmM4gR1gM7YJQ2dEjKowZ3zLsjhZxKq9".to_string(),
                kwh_amount: 20.0,
                tokens_to_mint: 20_000_000_000, // 20 tokens with 9 decimals
                meter_id: Some("METER_001".to_string()),
            },
        ];
        
        // Process batch
        let results = service.mint_energy_tokens_batch(&authority, batch_data).await.unwrap();
        
        // Verify results
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|r| r.success));
    }
    
    #[tokio::test]
    async fn test_batch_optimization() {
        let service = create_mock_blockchain_service();
        
        // Create batch data with different users and amounts
        let batch_data = vec![
            MintBatchData {
                reading_id: Uuid::new_v4(),
                user_id: "user1".to_string(),
                wallet_address: "5C4wSuGVU2J5qmM4gR1gM7YJQ2dEjKowZ3zLsjhZxKq9".to_string(),
                kwh_amount: 10.0,
                tokens_to_mint: 10_000_000_000,
                meter_id: Some("METER_001".to_string()),
            },
            MintBatchData {
                reading_id: Uuid::new_v4(),
                user_id: "user2".to_string(),
                wallet_address: "5D3cMs7QkA7t5Z7C2Xp9W4kE6mZkR8vY7hF3jG6aL9q".to_string(),
                kwh_amount: 20.0,
                tokens_to_mint: 20_000_000_000,
                meter_id: Some("METER_002".to_string()),
            },
            MintBatchData {
                reading_id: Uuid::new_v4(),
                user_id: "user1".to_string(),
                wallet_address: "5C4wSuGVU2J5qmM4gR1gM7YJQ2dEjKowZ3zLsjhZxKq9".to_string(),
                kwh_amount: 15.0,
                tokens_to_mint: 15_000_000_000,
                meter_id: Some("METER_001".to_string()),
            },
        ];
        
        // Optimize batch
        let optimized_batches = service.optimize_batch(&batch_data);
        
        // Verify optimization
        assert_eq!(optimized_batches.len(), 2); // Should be grouped by user
        
        // Verify user1 items are grouped
        let user1_batch = &optimized_batches[0];
        assert_eq!(user1_batch.len(), 2);
        assert!(user1_batch.iter().all(|item| item.user_id == "user1"));
        
        // Verify user2 items are grouped
        let user2_batch = &optimized_batches[1];
        assert_eq!(user2_batch.len(), 1);
        assert!(user2_batch.iter().all(|item| item.user_id == "user2"));
    }
    
    #[tokio::test]
    async fn test_fee_estimation() {
        let service = create_mock_blockchain_service();
        
        // Create batch data with different users
        let batch_data = vec![
            MintBatchData {
                reading_id: Uuid::new_v4(),
                user_id: "user1".to_string(),
                wallet_address: "5C4wSuGVU2J5qmM4gR1gM7YJQ2dEjKowZ3zLsjhZxKq9".to_string(),
                kwh_amount: 10.0,
                tokens_to_mint: 10_000_000_000,
                meter_id: Some("METER_001".to_string()),
            },
            MintBatchData {
                reading_id: Uuid::new_v4(),
                user_id: "user2".to_string(),
                wallet_address: "5D3cMs7QkA7t5Z7C2Xp9W4kE6mZkR8vY7hF3jG6aL9q".to_string(),
                kwh_amount: 20.0,
                tokens_to_mint: 20_000_000_000,
                meter_id: Some("METER_002".to_string()),
            },
        ];
        
        // Estimate fee
        let estimated_fee = service.estimate_batch_fee(&batch_data).unwrap();
        
        // Verify fee calculation
        assert!(estimated_fee > 0);
        // The exact calculation depends on the implementation
    }
}
```

### 5. Integration Tests

Create comprehensive integration tests for the complete system:

```rust
// tests/integration/smart_meter_integration_test.rs
use gridtokenx::services::{MeterPollingService, WebSocketService, BlockchainService};
use gridtokenx::config::TokenizationConfig;
use gridtokenx::models::MeterReading;
use gridtokenx::AppState;
use std::sync::Arc;
use uuid::Uuid;
use chrono::Utc;

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_complete_meter_reading_flow() {
        // Setup test environment
        let (pool, _lock) = create_test_db().await;
        let config = TokenizationConfig {
            auto_mint_enabled: true,
            polling_interval_secs: 1, // Short for testing
            ..Default::default()
        };
        
        // Create services
        let blockchain_service = Arc::new(MockBlockchainService::new());
        let websocket_service = Arc::new(MockWebSocketService::new());
        
        let polling_service = Arc::new(MeterPollingService::new(
            Arc::new(pool),
            blockchain_service.clone(),
            websocket_service.clone(),
            config.clone(),
        ));
        
        // Submit a meter reading via API
        let reading_request = create_test_meter_reading_request();
        let reading = submit_meter_reading_via_api(&reading_request).await.unwrap();
        
        // Wait for polling service to process
        tokio::time::sleep(Duration::from_secs(2)).await;
        
        // Verify tokens were minted
        let mint_calls = blockchain_service.mint_calls.borrow();
        assert_eq!(mint_calls.len(), 1);
        assert_eq!(mint_calls[0].1, config.calculate_tokens(reading_request.kwh_amount));
        
        // Verify WebSocket events were sent
        let reading_received_calls = websocket_service.reading_received_calls.borrow();
        let tokens_minted_calls = websocket_service.tokens_minted_calls.borrow();
        
        assert_eq!(reading_received_calls.len(), 1);
        assert_eq!(tokens_minted_calls.len(), 1);
        
        // Verify database state
        let updated_reading = fetch_meter_reading(&pool, reading.id).await.unwrap();
        assert!(updated_reading.minted);
        assert!(updated_reading.mint_tx_signature.is_some());
    }
    
    #[tokio::test]
    async fn test_batch_processing() {
        // Setup test environment
        let (pool, _lock) = create_test_db().await;
        let config = TokenizationConfig {
            auto_mint_enabled: true,
            polling_interval_secs: 1, // Short for testing
            batch_size: 10,
            ..Default::default()
        };
        
        // Create services
        let blockchain_service = Arc::new(MockBlockchainService::new());
        let websocket_service = Arc::new(MockWebSocketService::new());
        
        let polling_service = Arc::new(MeterPollingService::new(
            Arc::new(pool),
            blockchain_service.clone(),
            websocket_service.clone(),
            config.clone(),
        ));
        
        // Submit multiple meter readings
        let mut reading_ids = Vec::new();
        for i in 1..=5 {
            let reading_request = create_test_meter_reading_request();
            let reading = submit_meter_reading_via_api(&reading_request).await.unwrap();
            reading_ids.push(reading.id);
        }
        
        // Wait for polling service to process
        tokio::time::sleep(Duration::from_secs(2)).await;
        
        // Verify tokens were minted in batches
        let mint_calls = blockchain_service.mint_calls.borrow();
        assert_eq!(mint_calls.len(), 1); // All should be in one batch
        
        // Verify database state
        for reading_id in &reading_ids {
            let reading = fetch_meter_reading(&pool, *reading_id).await.unwrap();
            assert!(reading.minted);
        }
    }
    
    #[tokio::test]
    async fn test_error_handling_and_retry() {
        // Setup test environment
        let (pool, _lock) = create_test_db().await;
        let config = TokenizationConfig {
            auto_mint_enabled: true,
            polling_interval_secs: 1, // Short for testing
            max_retry_attempts: 2,
            initial_retry_delay_secs: 1, // Short for testing
            ..Default::default()
        };
        
        // Create a blockchain service that fails on first attempt
        let blockchain_service = Arc::new(MockFailingBlockchainService::new(1));
        let websocket_service = Arc::new(MockWebSocketService::new());
        
        let polling_service = Arc::new(MeterPollingService::new(
            Arc::new(pool),
            blockchain_service.clone(),
            websocket_service.clone(),
            config.clone(),
        ));
        
        // Submit a meter reading
        let reading_request = create_test_meter_reading_request();
        let reading = submit_meter_reading_via_api(&reading_request).await.unwrap();
        
        // Wait for polling service to process and retry
        tokio::time::sleep(Duration::from_secs(5)).await;
        
        // Verify retry happened
        let mint_attempts = blockchain_service.mint_attempts.borrow();
        assert_eq!(mint_attempts.len(), 2);
        
        // Verify eventual success
        let updated_reading = fetch_meter_reading(&pool, reading.id).await.unwrap();
        assert!(updated_reading.minted);
    }
}
```

### 6. Performance Tests

Create performance tests to verify throughput targets:

```rust
// tests/performance/meter_processing_performance_test.rs
use gridtokenx::services::{MeterPollingService, WebSocketService, BlockchainService};
use gridtokenx::config::TokenizationConfig;
use std::sync::Arc;
use std::time::{Instant, Duration};

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_meter_processing_throughput() {
        // Setup test environment
        let (pool, _lock) = create_test_db().await;
        let config = TokenizationConfig {
            batch_size: 50,
            polling_interval_secs: 60,
            ..Default::default()
        };
        
        // Create services
        let blockchain_service = Arc::new(MockBlockchainService::new());
        let websocket_service = Arc::new(MockWebSocketService::new());
        
        let polling_service = Arc::new(MeterPollingService::new(
            Arc::new(pool),
            blockchain_service.clone(),
            websocket_service.clone(),
            config.clone(),
        ));
        
        // Insert 500 test readings
        let start_time = Instant::now();
        insert_test_meter_readings(&pool, 500).await;
        
        // Process all readings
        let results = polling_service.process_all_unminted_readings().await.unwrap();
        let processing_time = start_time.elapsed();
        
        // Verify all readings were processed
        assert_eq!(results.len(), 500);
        assert!(results.iter().all(|r| r.success));
        
        // Verify performance target (500 readings per hour)
        // 500 readings in less than an hour is the target
        assert!(processing_time < Duration::from_secs(3600));
        
        // More strict target: 500 readings in less than 10 minutes for test
        assert!(processing_time < Duration::from_secs(600));
    }
    
    #[tokio::test]
    async fn test_websocket_event_delivery_latency() {
        // Setup test environment
        let websocket_service = WebSocketService::new();
        let user_id = Uuid::new_v4();
        let (mock_ws, mut receiver) = create_mock_websocket_with_receiver();
        
        // Register connection
        let socket_id = SocketId::new();
        websocket_service.add_connection(
            socket_id,
            user_id,
            false,
            mock_ws,
        ).await;
        
        // Send an event and measure latency
        let start_time = Instant::now();
        let event = MarketEvent::MeterReadingReceived {
            user_id,
            wallet_address: "5C4wSuGVU2J5qmM4gR1gM7YJQ2dEjKowZ3zLsjhZxKq9".to_string(),
            meter_id: "METER_001".to_string(),
            kwh_amount: 10.5,
            timestamp: Utc::now(),
        };
        
        websocket_service.send_to_user(user_id, &event).await.unwrap();
        
        // Wait for event to be received
        let received_message = receiver.recv().await.unwrap();
        let latency = start_time.elapsed();
        
        // Verify event was received correctly
        let received_event: MarketEvent = serde_json::from_str(&received_message).unwrap();
        match received_event {
            MarketEvent::MeterReadingReceived { meter_id, kwh_amount, .. } => {
                assert_eq!(meter_id, "METER_001");
                assert_eq!(kwh_amount, 10.5);
            }
            _ => panic!("Expected MeterReadingReceived event"),
        }
        
        // Verify performance target (events delivered in <100ms)
        assert!(latency < Duration::from_millis(100));
    }
}
```

## Testing Utilities

### Test Fixtures

Create reusable test fixtures and utilities:

```rust
// tests/common/test_fixtures.rs
use gridtokenx::models::{MeterReading, MeterReadingRequest};
use gridtokenx::services::{MockBlockchainService, MockWebSocketService};
use uuid::Uuid;
use chrono::Utc;
use sqlx::PgPool;

pub async fn create_test_db() -> (PgPool, Drop) {
    // Create a test database
    let url = "postgresql://test_user:test_pass@localhost/test_gridtokenx";
    let pool = PgPool::connect(url).await.unwrap();
    
    // Run migrations
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    
    // Create a drop guard to clean up the database after tests
    let drop = Drop { pool: pool.clone() };
    
    (pool, drop)
}

pub struct Drop {
    pool: PgPool,
}

impl Drop {
    pub async fn drop_database(self) {
        // Drop all tables
        sqlx::query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
            .execute(&self.pool)
            .await
            .unwrap();
    }
}

pub fn create_test_meter_reading(kwh_amount: f64, timestamp: chrono::DateTime<Utc>) -> MeterReading {
    MeterReading {
        id: Uuid::new_v4(),
        user_id: Uuid::new_v4(),
        wallet_address: "5C4wSuGVU2J5qmM4gR1gM7YJQ2dEjKowZ3zLsjhZxKq9".to_string(),
        meter_id: "METER_001".to_string(),
        kwh_amount,
        reading_timestamp: timestamp,
        submitted_at: Utc::now(),
        minted: false,
        mint_tx_signature: None,
    }
}

pub fn create_test_meter_reading_request() -> MeterReadingRequest {
    MeterReadingRequest {
        wallet_address: "5C4wSuGVU2J5qmM4gR1gM7YJQ2dEjKowZ3zLsjhZxKq9".to_string(),
        meter_id: "METER_001".to_string(),
        kwh_amount: 10.0,
        reading_timestamp: Utc::now(),
        meter_signature: "test_signature".to_string(),
    }
}

pub async fn insert_test_meter_readings(pool: &PgPool, count: usize) -> Vec<MeterReading> {
    let mut readings = Vec::new();
    
    for _ in 0..count {
        let reading = create_test_meter_reading(10.0, Utc::now());
        sqlx::query!(
            r#"
            INSERT INTO meter_readings 
            (id, user_id, wallet_address, meter_id, kwh_amount, reading_timestamp, submitted_at, minted) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
            reading.id,
            reading.user_id,
            reading.wallet_address,
            reading.meter_id,
            reading.kwh_amount,
            reading.reading_timestamp,
            reading.submitted_at,
            reading.minted,
        )
        .execute(pool)
        .await
        .unwrap();
        
        readings.push(reading);
    }
    
    readings
}

pub fn create_mock_blockchain_service() -> MockBlockchainService {
    MockBlockchainService::new()
}

pub fn create_mock_websocket_service() -> MockWebSocketService {
    MockWebSocketService::new()
}

pub fn create_mock_websocket() -> (WebSocket, tokio::sync::mpsc::UnboundedReceiver<String>) {
    // Implementation for creating a mock WebSocket that captures sent messages
    // ...
}
```

## Test Execution

### Test Categories

1. **Unit Tests**: Test individual components in isolation
2. **Integration Tests**: Test component interactions
3. **Performance Tests**: Verify performance targets
4. **End-to-End Tests**: Test complete user workflows

### Running Tests

```bash
# Run all tests
cargo test

# Run unit tests only
cargo test --lib

# Run integration tests
cargo test --test '*integration*'

# Run performance tests
cargo test --test '*performance*'

# Run specific test file
cargo test smart_meter_integration_test

# Run tests with coverage
cargo tarpaulin --out Html --output-dir coverage
```

## Test Targets

### Coverage Targets

- Overall code coverage: >95%
- Unit test coverage: >90%
- Integration test coverage: >80%

### Performance Targets

- Meter processing throughput: >500 readings per hour
- WebSocket event delivery: <100ms
- Database query performance: <50ms
- Batch processing efficiency: 3x faster than individual processing

## Continuous Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Test Smart Meter Enhancements

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:13
        env:
          POSTGRES_PASSWORD: test_pass
          POSTGRES_USER: test_user
          POSTGRES_DB: test_gridtokenx
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v2
      
      - name: Install Rust
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
          override: true
          
      - name: Cache dependencies
        uses: actions/cache@v2
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            target
          key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}
          
      - name: Install dependencies
        run: cargo build --verbose
        
      - name: Run unit tests
        run: cargo test --lib --verbose
        
      - name: Run integration tests
        run: cargo test --test '*integration*' --verbose
        
      - name: Run performance tests
        run: cargo test --test '*performance*' --verbose
        
      - name: Generate coverage report
        run: |
          cargo install cargo-tarpaulin
          cargo tarpaulin --out Xml --output-dir coverage
          
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v1
        with:
          file: ./coverage/cobertura.xml
```

## Acceptance Criteria

1. All unit tests pass with >90% code coverage
2. All integration tests pass
3. Performance tests meet or exceed targets
4. End-to-end tests verify complete user workflows
5. Continuous integration pipeline passes on all commits
6. Test documentation is complete and up-to-date
7. Test fixtures and utilities are reusable across the test suite
8. Mock implementations are realistic and comprehensive