# WebSocket Enhancements Task

## Overview

This task involves enhancing the existing WebSocket service to support real-time broadcasting of meter reading events and token minting events. This will provide immediate feedback to users when their meter readings are received and when tokens are minted, improving the overall user experience.

## Objectives

1. Add new WebSocket events for meter-related operations
2. Implement secure broadcasting of these events
3. Ensure proper authentication for event subscriptions
4. Optimize event delivery for high-volume scenarios
5. Add filtering capabilities for meter events

## Technical Requirements

### Core Components

#### 1. Enhanced WebSocket Events

Extend the existing `MarketEvent` enum in `src/services/websocket_service.rs` to include meter-related events:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum MarketEvent {
    // Existing events...
    OfferCreated { /* ... */ },
    OrderMatched { /* ... */ },
    TradeExecuted { /* ... */ },
    
    // New meter events
    MeterReadingReceived {
        user_id: Uuid,
        wallet_address: String,
        meter_id: String,
        kwh_amount: f64,
        timestamp: DateTime<Utc>,
    },
    
    TokensMinted {
        user_id: Uuid,
        wallet_address: String,
        meter_id: Option<String>,  // May not be available in batch processing
        kwh_amount: f64,
        tokens_minted: u64,
        transaction_signature: String,
        timestamp: DateTime<Utc>,
    },
    
    MeterReadingValidationFailed {
        user_id: Uuid,
        wallet_address: String,
        meter_id: String,
        kwh_amount: f64,
        error_reason: String,
        timestamp: DateTime<Utc>,
    },
    
    BatchMintingCompleted {
        batch_id: String,
        total_readings: u32,
        successful_mints: u32,
        failed_mints: u32,
        timestamp: DateTime<Utc>,
    },
}
```

#### 2. Event Broadcasting Methods

Add new methods to the WebSocket service for broadcasting meter events:

```rust
impl WebSocketService {
    /// Broadcast a meter reading received event to the specific user
    pub async fn broadcast_meter_reading_received(
        &self,
        user_id: Uuid,
        wallet_address: &str,
        meter_id: &str,
        kwh_amount: f64,
        timestamp: DateTime<Utc>,
    ) -> Result<(), WebSocketError> {
        let event = MarketEvent::MeterReadingReceived {
            user_id,
            wallet_address: wallet_address.to_string(),
            meter_id: meter_id.to_string(),
            kwh_amount,
            timestamp,
        };
        
        self.send_to_user(user_id, &event).await
    }
    
    /// Broadcast tokens minted event to the specific user
    pub async fn broadcast_tokens_minted(
        &self,
        user_id: Uuid,
        wallet_address: &str,
        meter_id: Option<&str>,
        kwh_amount: f64,
        tokens_minted: u64,
        tx_signature: &str,
        timestamp: DateTime<Utc>,
    ) -> Result<(), WebSocketError> {
        let event = MarketEvent::TokensMinted {
            user_id,
            wallet_address: wallet_address.to_string(),
            meter_id: meter_id.map(|m| m.to_string()),
            kwh_amount,
            tokens_minted,
            transaction_signature: tx_signature.to_string(),
            timestamp,
        };
        
        self.send_to_user(user_id, &event).await
    }
    
    /// Broadcast meter reading validation failure to the specific user
    pub async fn broadcast_validation_failed(
        &self,
        user_id: Uuid,
        wallet_address: &str,
        meter_id: &str,
        kwh_amount: f64,
        error_reason: &str,
        timestamp: DateTime<Utc>,
    ) -> Result<(), WebSocketError> {
        let event = MarketEvent::MeterReadingValidationFailed {
            user_id,
            wallet_address: wallet_address.to_string(),
            meter_id: meter_id.to_string(),
            kwh_amount,
            error_reason: error_reason.to_string(),
            timestamp,
        };
        
        self.send_to_user(user_id, &event).await
    }
    
    /// Broadcast batch minting completion to all subscribed admin users
    pub async fn broadcast_batch_minting_completed(
        &self,
        batch_id: &str,
        total_readings: u32,
        successful_mints: u32,
        failed_mints: u32,
    ) -> Result<(), WebSocketError> {
        let event = MarketEvent::BatchMintingCompleted {
            batch_id: batch_id.to_string(),
            total_readings,
            successful_mints,
            failed_mints,
            timestamp: Utc::now(),
        };
        
        self.send_to_admins(&event).await
    }
}
```

#### 3. User-Specific Event Delivery

Enhance the existing WebSocket service to support user-specific event delivery:

```rust
/// Modify the existing connection manager to support user-specific connections
pub struct ConnectionManager {
    connections: Arc<RwLock<HashMap<SocketId, WebSocketConnection>>>,
    user_connections: Arc<RwLock<HashMap<Uuid, Vec<SocketId>>>>,
    admin_connections: Arc<RwLock<Vec<SocketId>>>,
}

impl ConnectionManager {
    /// Register a new connection and associate it with a user
    pub async fn add_connection(
        &self,
        socket_id: SocketId,
        user_id: Uuid,
        is_admin: bool,
        socket: WebSocket,
    ) {
        // Add to general connections
        let mut connections = self.connections.write().await;
        connections.insert(socket_id, WebSocketConnection::new(socket_id, socket, user_id));
        
        // Add to user-specific connections
        let mut user_connections = self.user_connections.write().await;
        user_connections.entry(user_id).or_insert_with(Vec::new).push(socket_id);
        
        // Add to admin connections if applicable
        if is_admin {
            let mut admin_connections = self.admin_connections.write().await;
            admin_connections.push(socket_id);
        }
    }
    
    /// Send an event to all connections for a specific user
    pub async fn send_to_user(
        &self,
        user_id: Uuid,
        event: &MarketEvent,
    ) -> Result<(), WebSocketError> {
        let user_connections = {
            let user_conn_map = self.user_connections.read().await;
            user_conn_map.get(&user_id).cloned().unwrap_or_default()
        };
        
        let connections = self.connections.read().await;
        let mut errors = Vec::new();
        
        for socket_id in user_connections {
            if let Some(conn) = connections.get(&socket_id) {
                if let Err(e) = conn.send(event).await {
                    errors.push(e);
                }
            }
        }
        
        if errors.is_empty() {
            Ok(())
        } else {
            Err(WebSocketError::BroadcastFailed(format!(
                "Failed to send to {} connections for user {}",
                errors.len(),
                user_id
            )))
        }
    }
    
    /// Send an event to all admin connections
    pub async fn send_to_admins(
        &self,
        event: &MarketEvent,
    ) -> Result<(), WebSocketError> {
        let admin_connections = {
            let admin_conn = self.admin_connections.read().await;
            admin_conn.clone()
        };
        
        let connections = self.connections.read().await;
        let mut errors = Vec::new();
        
        for socket_id in admin_connections {
            if let Some(conn) = connections.get(&socket_id) {
                if let Err(e) = conn.send(event).await {
                    errors.push(e);
                }
            }
        }
        
        if errors.is_empty() {
            Ok(())
        } else {
            Err(WebSocketError::BroadcastFailed(format!(
                "Failed to send to {} admin connections",
                errors.len()
            )))
        }
    }
}
```

#### 4. Event Filtering and Subscription

Implement filtering capabilities for meter events:

```rust
/// Add subscription options to the WebSocket service
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventSubscription {
    pub event_types: Vec<String>,
    pub meters: Option<Vec<String>>,
    pub min_amount: Option<f64>,
}

/// Extend the WebSocket service to support filtered subscriptions
impl WebSocketService {
    /// Subscribe to specific events with filtering
    pub async fn subscribe_to_events(
        &self,
        socket_id: SocketId,
        subscription: EventSubscription,
    ) -> Result<(), WebSocketError> {
        // Implementation for storing subscriptions
        let mut subscriptions = self.subscriptions.write().await;
        subscriptions.insert(socket_id, subscription);
        
        Ok(())
    }
    
    /// Check if an event matches a user's subscription
    fn event_matches_subscription(
        &self,
        event: &MarketEvent,
        subscription: &EventSubscription,
    ) -> bool {
        // Check event type
        let event_type = match event {
            MarketEvent::MeterReadingReceived { .. } => "MeterReadingReceived",
            MarketEvent::TokensMinted { .. } => "TokensMinted",
            MarketEvent::MeterReadingValidationFailed { .. } => "MeterReadingValidationFailed",
            MarketEvent::BatchMintingCompleted { .. } => "BatchMintingCompleted",
            _ => return false,
        };
        
        if !subscription.event_types.contains(&event_type.to_string()) {
            return false;
        }
        
        // Check meter filter
        if let (Some(ref meters), Some(meter_id)) = (&subscription.meters, self.extract_meter_id(event)) {
            if !meters.contains(&meter_id.to_string()) {
                return false;
            }
        }
        
        // Check amount filter
        if let (Some(min_amount), Some(amount)) = (subscription.min_amount, self.extract_amount(event)) {
            if amount < min_amount {
                return false;
            }
        }
        
        true
    }
    
    /// Extract meter ID from an event if applicable
    fn extract_meter_id(&self, event: &MarketEvent) -> Option<&str> {
        match event {
            MarketEvent::MeterReadingReceived { meter_id, .. } => Some(meter_id),
            MarketEvent::TokensMinted { meter_id, .. } => meter_id.as_deref(),
            MarketEvent::MeterReadingValidationFailed { meter_id, .. } => Some(meter_id),
            _ => None,
        }
    }
    
    /// Extract amount from an event if applicable
    fn extract_amount(&self, event: &MarketEvent) -> Option<f64> {
        match event {
            MarketEvent::MeterReadingReceived { kwh_amount, .. } => Some(*kwh_amount),
            MarketEvent::TokensMinted { kwh_amount, .. } => Some(*kwh_amount),
            MarketEvent::MeterReadingValidationFailed { kwh_amount, .. } => Some(*kwh_amount),
            _ => None,
        }
    }
}
```

#### 5. Error Handling

Define appropriate error types for the WebSocket service:

```rust
#[derive(Debug, thiserror::Error)]
pub enum WebSocketError {
    #[error("Connection not found: {0}")]
    ConnectionNotFound(SocketId),
    
    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),
    
    #[error("Broadcast failed: {0}")]
    BroadcastFailed(String),
    
    #[error("Authentication failed")]
    AuthenticationFailed,
    
    #[error("Subscription error: {0}")]
    SubscriptionError(String),
    
    #[error("Rate limit exceeded")]
    RateLimitExceeded,
}
```

## Implementation Steps

1. Extend the `MarketEvent` enum with new meter-related events
2. Implement new broadcasting methods for meter events
3. Enhance the connection manager to support user-specific connections
4. Add event filtering and subscription capabilities
5. Update the WebSocket service to handle the new events
6. Implement proper error handling for all new functionality
7. Add authentication checks for event subscriptions
8. Optimize for high-volume scenarios ( batching, compression )
9. Add comprehensive logging for debugging
10. Update API documentation to reflect new events

## Integration Points

### API Route Integration

Update the meter reading submission route to broadcast events:

```rust
// In src/routes/meters.rs
#[post("/submit-reading")]
pub async fn submit_meter_reading(
    request: Json<MeterReadingRequest>,
    websocket_service: web::Data<Arc<WebSocketService>>,
    // ... other dependencies
) -> Result<HttpResponse, Error> {
    // Validate and store the meter reading
    // ...
    
    // Broadcast the event
    if let Err(e) = websocket_service.broadcast_meter_reading_received(
        request.user_id,
        &request.wallet_address,
        &request.meter_id,
        request.kwh_amount,
        Utc::now()
    ).await {
        log::error!("Failed to broadcast meter reading event: {}", e);
    }
    
    Ok(HttpResponse::Ok().json(SubmitReadingResponse {
        success: true,
        message: "Reading submitted successfully".to_string(),
    }))
}
```

### Blockchain Service Integration

Update the blockchain service to broadcast events after successful minting:

```rust
// In src/services/blockchain_service.rs
impl BlockchainService {
    pub async fn mint_energy_tokens(
        &self,
        authority: &Keypair,
        user_token_account: &Pubkey,
        mint: &Pubkey,
        amount_kwh: f64,
        user_id: Uuid,
        wallet_address: &str,
        websocket_service: Option<Arc<WebSocketService>>,
    ) -> Result<Signature, BlockchainError> {
        // Mint tokens
        let signature = self.mint_tokens_direct(
            authority,
            user_token_account,
            mint,
            amount_kwh,
        ).await?;
        
        // Broadcast event if WebSocket service is available
        if let Some(ws_service) = websocket_service {
            let tokens_minted = (amount_kwh * 1_000_000_000.0) as u64;  // 9 decimals
            
            if let Err(e) = ws_service.broadcast_tokens_minted(
                user_id,
                wallet_address,
                None,  // meter_id may not be available in this context
                amount_kwh,
                tokens_minted,
                &signature.to_string(),
                Utc::now(),
            ).await {
                log::error!("Failed to broadcast tokens minted event: {}", e);
            }
        }
        
        Ok(signature)
    }
}
```

### Meter Polling Service Integration

Update the meter polling service to broadcast batch minting events:

```rust
// In src/services/meter_polling_service.rs
impl MeterPollingService {
    async fn process_batch(&self, readings: Vec<MeterReading>) -> Result<Vec<MintResult>, Box<dyn std::error::Error>> {
        let batch_id = Uuid::new_v4().to_string();
        let total_readings = readings.len();
        let mut successful_mints = 0;
        let mut failed_mints = 0;
        
        // Process readings...
        for result in batch_results {
            if result.success {
                successful_mints += 1;
            } else {
                failed_mints += 1;
            }
        }
        
        // Broadcast batch completion event
        if let Err(e) = self.websocket_service.broadcast_batch_minting_completed(
            &batch_id,
            total_readings as u32,
            successful_mints as u32,
            failed_mints as u32,
        ).await {
            log::error!("Failed to broadcast batch minting completed event: {}", e);
        }
        
        Ok(results)
    }
}
```

## Testing Strategy

### Unit Tests

- Test serialization/deserialization of new event types
- Test event filtering logic with various criteria
- Test connection management for user-specific connections
- Test error handling paths

### Integration Tests

- Test end-to-end event broadcasting from meter submission to client
- Test subscription filtering with real events
- Test behavior under high load with many concurrent connections
- Test authentication and authorization for event access

### Performance Tests

- Measure latency from event generation to client delivery
- Test with high-volume event streams (1000+ events/second)
- Test memory usage with many connected clients
- Test behavior under network congestion

## Environment Variables

Add the following configuration options:

```bash
# WebSocket service configuration
WEBSOCKET_MAX_CONNECTIONS=10000
WEBSOCKET_RATE_LIMIT_EVENTS_PER_MINUTE=60
WEBSOCKET_EVENT_BUFFER_SIZE=1000
WEBSOCKET_AUTH_REQUIRED=true
WEBSOCKET_COMPRESSION_ENABLED=true
```

## Security Considerations

1. **Authentication**: Ensure only authenticated users can connect to the WebSocket
2. **Authorization**: Verify users can only receive events for their own meters
3. **Rate Limiting**: Limit the number of events a client can receive per minute
4. **Input Validation**: Validate all incoming subscription requests
5. **PII Protection**: Avoid logging personally identifiable information in events
6. **Audit Logging**: Log all WebSocket connections and subscription requests

## Dependencies

- `tokio-tungstenite` for WebSocket handling
- `futures-util` for async stream processing
- `serde` and `serde_json` for serialization
- `uuid` for ID handling
- `chrono` for date/time handling
- `thiserror` for error handling
- `dashmap` for concurrent collections

## Acceptance Criteria

1. All new meter-related events are defined and properly serialized
2. WebSocket service broadcasts events to the correct users
3. Event filtering works according to subscription criteria
4. Authentication and authorization are properly enforced
5. Error handling is comprehensive and logged appropriately
6. Performance targets are met (events delivered in <100ms)
7. All tests pass with >90% code coverage
8. Documentation is updated to reflect new events and APIs