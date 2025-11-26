-- Migration: Add meter readings and retry queue tables
-- Description: Creates tables for storing smart meter readings and managing failed minting retries
-- Date: 2025-11-26

-- ============================================================================
-- Table: meter_readings
-- Purpose: Store smart meter energy readings with minting status tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS meter_readings (
    -- Primary key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- User identification
    user_id UUID REFERENCES users(id),
    wallet_address VARCHAR(88) NOT NULL,
    
    -- Reading data
    kwh_amount DECIMAL(10, 2) NOT NULL CHECK (kwh_amount > 0 AND kwh_amount <= 100),
    reading_timestamp TIMESTAMPTZ NOT NULL,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Minting status
    minted BOOLEAN DEFAULT FALSE,
    mint_tx_signature VARCHAR(88),
    
    -- Cryptographic verification
    meter_signature TEXT NOT NULL,
    meter_public_key VARCHAR(88) NOT NULL,
    
    -- Constraints
    CONSTRAINT unique_wallet_timestamp UNIQUE (wallet_address, reading_timestamp)
);

-- ============================================================================
-- Indexes for meter_readings
-- ============================================================================

-- Index for polling unminted readings (most critical query)
CREATE INDEX idx_unminted ON meter_readings (minted, submitted_at) 
WHERE minted = FALSE;

-- Index for user reading history queries
CREATE INDEX idx_user_time ON meter_readings (user_id, reading_timestamp DESC);

-- Index for wallet-based queries
CREATE INDEX idx_wallet ON meter_readings (wallet_address);

-- Index for timestamp-based duplicate detection
CREATE INDEX idx_reading_timestamp ON meter_readings (reading_timestamp);

-- ============================================================================
-- Table: minting_retry_queue
-- Purpose: Track failed minting operations with exponential backoff retry logic
-- ============================================================================

CREATE TABLE IF NOT EXISTS minting_retry_queue (
    -- Primary key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Reference to failed reading
    reading_id UUID REFERENCES meter_readings(id) UNIQUE,
    
    -- Error tracking
    error_message TEXT,
    attempts INTEGER DEFAULT 1 CHECK (attempts >= 1),
    
    -- Retry scheduling
    next_retry_at TIMESTAMPTZ NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Indexes for minting_retry_queue
-- ============================================================================

-- Index for finding readings ready to retry (exclude those with too many attempts)
CREATE INDEX idx_retry_next ON minting_retry_queue (next_retry_at) 
WHERE attempts < 10;

-- Index for monitoring retry attempts
CREATE INDEX idx_retry_attempts ON minting_retry_queue (attempts);

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON TABLE meter_readings IS 
'Stores smart meter energy readings with Ed25519 signature verification. Tracks minting status to prevent double-minting.';

COMMENT ON COLUMN meter_readings.kwh_amount IS 
'Energy amount in kWh. Must be between 0 and 100. Will be converted to GRID tokens (1 kWh = 1 GRID with 9 decimals).';

COMMENT ON COLUMN meter_readings.meter_signature IS 
'Base58-encoded Ed25519 signature of the reading data. Format: sign(meter_id:kwh_amount:timestamp:wallet_address)';

COMMENT ON COLUMN meter_readings.minted IS 
'Tracks whether tokens have been minted for this reading. Used by polling service to find unminted readings.';

COMMENT ON TABLE minting_retry_queue IS 
'Manages retry logic for failed token minting operations with exponential backoff. Max 10 attempts before manual review required.';

-- ============================================================================
-- Sample queries for verification
-- ============================================================================

-- Query unminted readings (used by polling service)
-- SELECT * FROM meter_readings 
-- WHERE minted = FALSE 
-- AND submitted_at >= NOW() - INTERVAL '7 days'
-- ORDER BY submitted_at ASC
-- LIMIT 50;

-- Query readings ready for retry
-- SELECT r.*, q.attempts, q.error_message
-- FROM meter_readings r
-- JOIN minting_retry_queue q ON r.id = q.reading_id
-- WHERE q.next_retry_at <= NOW()
-- AND q.attempts < 10
-- ORDER BY q.next_retry_at ASC
-- LIMIT 50;

-- Check for duplicate readings (within 15-minute window)
-- SELECT * FROM meter_readings
-- WHERE wallet_address = $1
-- AND reading_timestamp BETWEEN $2 - INTERVAL '15 minutes' AND $2 + INTERVAL '15 minutes';
