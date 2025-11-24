# Integration Task

## Overview

This task involves integrating all the smart meter enhancement components into the main GridTokenX application. This includes wiring together the automated polling service, WebSocket enhancements, configuration module, and blockchain service enhancements. The goal is to create a cohesive system that automatically processes smart meter readings and mints tokens in real-time.

## Objectives

1. Wire all new services into the main application state
2. Initialize and start the automated polling service
3. Update existing route handlers to use new services
4. Ensure proper error handling across all components
5. Implement graceful shutdown for background services
6. Add comprehensive logging for the entire system

## Technical Requirements

### Core Components

#### 1. Application State Updates

Update `src/main.rs` to include all new services:

```rust
use std::sync::Arc;
use tokio::sync::RwLock;

// Import all new services
use gridtokenx::config::TokenizationConfig;
use gridtokenx::services::MeterPollingService;
use gridtokenx::services::WebSocketService;
use gridtokenx::services::BlockchainService;

// Extend the existing AppState struct
pub struct AppState {
    // Existing fields...
    pub db: Arc<PgPool>,
    pub blockchain_service: Arc<BlockchainService>,
    pub websocket_service: Arc<WebSocketService>,
    
    // New fields for smart meter enhancements
    pub tokenization_config: Arc<TokenizationConfig>,
    pub meter_polling_service: Arc<MeterPollingService>,
    pub polling_service_handle: Option<tokio::task::JoinHandle<()>>,
}

impl AppState {
    pub async fn new() -> Result<Self, Box<dyn std::error::Error>> {
        // Load configuration
        let tokenization_config = Arc::new(TokenizationConfig::load()
            .validate()
            .expect("Invalid tokenization configuration"));
        
        // Initialize existing services...
        let db = Arc::new(create_db_pool().await?);
        let blockchain_service = Arc::new(BlockchainService::new(
            &tokenization_config,
            db.clone(),
        ).await?);
        let websocket_service = Arc::new(WebSocketService::new());
        
        // Initialize new services
        let meter_polling_service = Arc::new(MeterPollingService::new(
            db.clone(),
            blockchain_service.clone(),
            websocket_service.clone(),
            tokenization_config.clone(),
        ));
        
        Ok(Self {
            db,
            blockchain_service,
            websocket_service,
            tokenization_config,
            meter_polling_service,
            polling_service_handle: None,
        })
    }
    
    pub fn start_background_services(&mut self) {
        // Start the meter polling service if auto-mint is enabled
        if self.tokenization_config.auto_mint_enabled {
            let polling_service = self.meter_polling_service.clone();
            let handle = tokio::spawn(async move {
                polling_service.start().await;
            });
            self.polling_service_handle = Some(handle);
            log::info!("Started meter polling service");
        } else {
            log::info!("Auto-mint disabled, meter polling service not started");
        }
    }
    
    pub async fn shutdown(&mut self) {
        // Shutdown background services gracefully
        if let Some(handle) = self.polling_service_handle.take() {
            handle.abort();
            log::info!("Meter polling service shutdown");
        }
        
        // Close WebSocket connections
        self.websocket_service.shutdown().await;
        log::info!("WebSocket service shutdown");
    }
}
```

#### 2. Main Application Updates

Update the main function to initialize and run the enhanced application:

```rust
#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize logging
    env_logger::init();
    
    // Create application state
    let mut app_state = AppState::new().await
        .expect("Failed to initialize application state");
    
    // Start background services
    app_state.start_background_services();
    
    // Setup graceful shutdown
    let app_state_clone = app_state.clone();
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.expect("Failed to install Ctrl+C handler");
        log::info!("Received Ctrl+C, shutting down");
    };
    
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to install signal handler")
            .recv().await;
        log::info!("Received terminate signal, shutting down");
    };
    
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    
    // Shutdown the application
    app_state.shutdown().await;
    
    Ok(())
}
```

#### 3. Route Handler Updates

Update existing route handlers to integrate with new services:

```rust
// In src/routes/meters.rs
use gridtokenx::services::{WebSocketService, TokenizationConfig};

#[post("/submit-reading")]
pub async fn submit_meter_reading(
    request: Json<MeterReadingRequest>,
    app_state: web::Data<Arc<AppState>>,
) -> Result<HttpResponse, Error> {
    // Validate request
    let validation_result = app_state.tokenization_config.validate_reading(
        request.kwh_amount,
        request.reading_age_days,
    );
    
    if let Err(e) = validation_result {
        return Ok(HttpResponse::BadRequest().json(BadRequestResponse {
            error: format!("Reading validation failed: {}", e),
        }));
    }
    
    // Store meter reading in database
    let reading = store_meter_reading(&app_state.db, &request.into_inner()).await?;
    
    // Broadcast WebSocket event
    if let Err(e) = app_state.websocket_service.broadcast_meter_reading_received(
        reading.user_id,
        &reading.wallet_address,
        &reading.meter_id,
        reading.kwh_amount,
        reading.submitted_at,
    ).await {
        log::error!("Failed to broadcast meter reading event: {}", e);
    }
    
    // If auto-mint is disabled, notify admins for manual processing
    if !app_state.tokenization_config.auto_mint_enabled {
        if let Err(e) = app_state.websocket_service.broadcast_admin_notification(
            format!("New meter reading submitted: {} kWh", reading.kwh_amount)
        ).await {
            log::error!("Failed to broadcast admin notification: {}", e);
        }
    }
    
    Ok(HttpResponse::Ok().json(SubmitReadingResponse {
        success: true,
        message: "Reading submitted successfully".to_string(),
        reading_id: reading.id.to_string(),
    }))
}
```

#### 4. Admin Route Enhancements

Add new admin routes for monitoring and controlling the smart meter system:

```rust
// In src/routes/admin.rs
#[get("/tokenization/status")]
pub async fn get_tokenization_status(
    app_state: web::Data<Arc<AppState>>,
) -> Result<HttpResponse, Error> {
    // Get current configuration
    let config = &app_state.tokenization_config;
    
    // Get status of unminted readings
    let unminted_count = get_unminted_readings_count(&app_state.db).await?;
    
    // Get recent batch processing statistics
    let recent_stats = get_recent_batch_stats(&app_state.db).await?;
    
    Ok(HttpResponse::Ok().json(TokenizationStatusResponse {
        auto_mint_enabled: config.auto_mint_enabled,
        polling_interval_secs: config.polling_interval_secs,
        batch_size: config.batch_size,
        unminted_readings_count: unminted_count,
        recent_batch_stats: recent_stats,
    }))
}

#[post("/tokenization/toggle-auto-mint")]
pub async fn toggle_auto_mint(
    app_state: web::Data<Arc<AppState>>,
    request: Json<ToggleAutoMintRequest>,
) -> Result<HttpResponse, Error> {
    // This would update the configuration in a real implementation
    // For now, we'll just log the request
    
    log::info!("Toggle auto-mint request: enabled={}", request.enabled);
    
    if request.enabled && app_state.polling_service_handle.is_none() {
        // Start polling service
        app_state.meter_polling_service.start().await;
    } else if !request.enabled && app_state.polling_service_handle.is_some() {
        // Stop polling service
        if let Some(handle) = app_state.polling_service_handle.take() {
            handle.abort();
        }
    }
    
    Ok(HttpResponse::Ok().json(ToggleAutoMintResponse {
        success: true,
        auto_mint_enabled: request.enabled,
        message: format!("Auto-mint {}", if request.enabled { "enabled" } else { "disabled" }),
    }))
}

#[post("/tokenization/trigger-batch")]
pub async fn trigger_batch_processing(
    app_state: web::Data<Arc<AppState>>,
) -> Result<HttpResponse, Error> {
    // Manually trigger batch processing
    let results = app_state.meter_polling_service.process_unminted_readings().await?;
    
    let successful = results.iter().filter(|r| r.success).count();
    let failed = results.len() - successful;
    
    Ok(HttpResponse::Ok().json(TriggerBatchResponse {
        success: true,
        processed_readings: results.len(),
        successful_mints: successful,
        failed_mints: failed,
        results,
    }))
}
```

#### 5. Error Handling Integration

Implement centralized error handling for all components:

```rust
// In src/error.rs
#[derive(Debug, thiserror::Error)]
pub enum GridTokenXError {
    // Existing errors...
    
    // New errors for smart meter enhancements
    #[error("Configuration error: {0}")]
    ConfigError(#[from] gridtokenx::config::ConfigError),
    
    #[error("Meter polling service error: {0}")]
    MeterPollingError(String),
    
    #[error("WebSocket service error: {0}")]
    WebSocketError(#[from] gridtokenx::services::WebSocketError),
    
    #[error("Blockchain service error: {0}")]
    BlockchainError(#[from] gridtokenx::services::BlockchainError),
}

// Implement error conversion for Actix-web
impl actix_web::error::ResponseError for GridTokenXError {
    fn error_response(&self) -> HttpResponse {
        match self {
            GridTokenXError::ConfigError(_) => HttpResponse::InternalServerError().json({
                "error": "Configuration error"
            }),
            GridTokenXError::MeterPollingError(_) => HttpResponse::InternalServerError().json({
                "error": "Meter polling service error"
            }),
            GridTokenXError::WebSocketError(_) => HttpResponse::InternalServerError().json({
                "error": "WebSocket service error"
            }),
            GridTokenXError::BlockchainError(_) => HttpResponse::InternalServerError().json({
                "error": "Blockchain service error"
            }),
        }
    }
}
```

## Implementation Steps

1. Update the `AppState` struct to include all new services
2. Implement service initialization and dependency injection
3. Add background service management to the main application
4. Update existing route handlers to use new services
5. Add new admin routes for monitoring and control
6. Implement centralized error handling
7. Add comprehensive logging throughout the application
8. Implement graceful shutdown for all services
9. Update the API documentation to reflect new endpoints
10. Add integration tests for the complete system

## Testing Strategy

### Integration Tests

1. Test the complete flow from meter reading submission to token minting
2. Test WebSocket event broadcasting to clients
3. Test error handling throughout the system
4. Test admin routes for monitoring and control
5. Test graceful shutdown of all services

### End-to-End Tests

1. Test the system with a realistic volume of meter readings
2. Test behavior under various error conditions
3. Test configuration changes affecting system behavior
4. Test performance under high load
5. Test recovery from service failures

## Environment Variables

Ensure all required environment variables are documented in the main configuration:

```bash
# Existing variables...

# Tokenization Configuration
TOKENIZATION_KWH_TO_TOKEN_RATIO=1.0
TOKENIZATION_DECIMALS=9
TOKENIZATION_MAX_READING_KWH=100.0
TOKENIZATION_READING_MAX_AGE_DAYS=7
TOKENIZATION_AUTO_MINT_ENABLED=true
TOKENIZATION_POLLING_INTERVAL_SECS=60
TOKENIZATION_BATCH_SIZE=50
TOKENIZATION_MAX_RETRY_ATTEMPTS=3
TOKENIZATION_INITIAL_RETRY_DELAY_SECS=300

# Blockchain Service Configuration
BLOCKCHAIN_MAX_BATCH_SIZE=50
BLOCKCHAIN_MAX_TOKENS_PER_TRANSACTION=1000000000000
BLOCKCHAIN_CONCURRENT_BATCHES=5

# WebSocket Service Configuration
WEBSOCKET_MAX_CONNECTIONS=10000
WEBSOCKET_RATE_LIMIT_EVENTS_PER_MINUTE=60
WEBSOCKET_EVENT_BUFFER_SIZE=1000
WEBSOCKET_AUTH_REQUIRED=true
WEBSOCKET_COMPRESSION_ENABLED=true
```

## Acceptance Criteria

1. All new services are initialized and working correctly
2. The automated polling service runs when enabled
3. WebSocket events are broadcast for meter operations
4. Configuration can be modified via environment variables
5. Admin routes provide monitoring and control capabilities
6. Error handling is comprehensive and user-friendly
7. The application can be gracefully started and stopped
8. All tests pass with >90% code coverage
9. Performance targets are met
10. Documentation is complete and up-to-date