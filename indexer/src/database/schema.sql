-- GridTokenX Indexer Database Schema
-- PostgreSQL 15+

-- ============================================
-- Core Tables
-- ============================================

-- Users table (from Registry program)
CREATE TABLE IF NOT EXISTS users (
    pubkey VARCHAR(44) PRIMARY KEY,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('producer', 'consumer', 'prosumer')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'inactive')),
    latitude DECIMAL(10, 6),
    longitude DECIMAL(10, 6),
    total_energy_produced BIGINT DEFAULT 0,
    total_energy_consumed BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    slot BIGINT NOT NULL,
    signature VARCHAR(88) NOT NULL
);

-- Smart meters table
CREATE TABLE IF NOT EXISTS meters (
    pubkey VARCHAR(44) PRIMARY KEY,
    user_pubkey VARCHAR(44) NOT NULL REFERENCES users(pubkey) ON DELETE CASCADE,
    meter_id VARCHAR(64) NOT NULL UNIQUE,
    meter_type VARCHAR(20) NOT NULL CHECK (meter_type IN ('production', 'consumption', 'bidirectional')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'inactive', 'deactivated')),
    total_generated BIGINT DEFAULT 0,
    total_consumed BIGINT DEFAULT 0,
    settled_net_generation BIGINT DEFAULT 0,
    last_reading_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    slot BIGINT NOT NULL,
    signature VARCHAR(88) NOT NULL
);

-- Meter readings history
CREATE TABLE IF NOT EXISTS meter_readings (
    id BIGSERIAL PRIMARY KEY,
    meter_pubkey VARCHAR(44) NOT NULL REFERENCES meters(pubkey) ON DELETE CASCADE,
    energy_generated BIGINT NOT NULL,
    energy_consumed BIGINT NOT NULL,
    net_energy BIGINT GENERATED ALWAYS AS (energy_generated - energy_consumed) STORED,
    reading_timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    slot BIGINT NOT NULL,
    signature VARCHAR(88) NOT NULL
);

-- Trading orders
CREATE TABLE IF NOT EXISTS orders (
    pubkey VARCHAR(44) PRIMARY KEY,
    owner_pubkey VARCHAR(44) NOT NULL REFERENCES users(pubkey),
    order_type VARCHAR(10) NOT NULL CHECK (order_type IN ('buy', 'sell')),
    energy_amount BIGINT NOT NULL,
    price_per_kwh BIGINT NOT NULL,
    filled_amount BIGINT DEFAULT 0,
    remaining_amount BIGINT GENERATED ALWAYS AS (energy_amount - filled_amount) STORED,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partial', 'filled', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    slot BIGINT NOT NULL,
    signature VARCHAR(88) NOT NULL
);

-- Trade executions
CREATE TABLE IF NOT EXISTS trades (
    id BIGSERIAL PRIMARY KEY,
    buy_order_pubkey VARCHAR(44) NOT NULL REFERENCES orders(pubkey),
    sell_order_pubkey VARCHAR(44) NOT NULL REFERENCES orders(pubkey),
    buyer_pubkey VARCHAR(44) NOT NULL REFERENCES users(pubkey),
    seller_pubkey VARCHAR(44) NOT NULL REFERENCES users(pubkey),
    energy_amount BIGINT NOT NULL,
    price_per_kwh BIGINT NOT NULL,
    total_price BIGINT GENERATED ALWAYS AS (energy_amount * price_per_kwh / 1000000000) STORED,
    wheeling_charge BIGINT DEFAULT 0,
    market_fee BIGINT DEFAULT 0,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    slot BIGINT NOT NULL,
    signature VARCHAR(88) NOT NULL UNIQUE
);

-- ERC Certificates (from Governance program)
CREATE TABLE IF NOT EXISTS erc_certificates (
    pubkey VARCHAR(44) PRIMARY KEY,
    certificate_id VARCHAR(64) NOT NULL UNIQUE,
    owner_pubkey VARCHAR(44) NOT NULL REFERENCES users(pubkey),
    energy_amount BIGINT NOT NULL,
    renewable_source VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked', 'retired')),
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    validation_data TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    slot BIGINT NOT NULL,
    signature VARCHAR(88) NOT NULL
);

-- Token transfers
CREATE TABLE IF NOT EXISTS token_transfers (
    id BIGSERIAL PRIMARY KEY,
    from_pubkey VARCHAR(44) NOT NULL,
    to_pubkey VARCHAR(44) NOT NULL,
    amount BIGINT NOT NULL,
    transfer_type VARCHAR(20) NOT NULL CHECK (transfer_type IN ('mint', 'burn', 'transfer', 'trade')),
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    slot BIGINT NOT NULL,
    signature VARCHAR(88) NOT NULL
);

-- Market state snapshots
CREATE TABLE IF NOT EXISTS market_snapshots (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    best_bid_price BIGINT,
    best_ask_price BIGINT,
    bid_volume BIGINT DEFAULT 0,
    ask_volume BIGINT DEFAULT 0,
    last_trade_price BIGINT,
    volume_24h BIGINT DEFAULT 0,
    trade_count_24h INTEGER DEFAULT 0,
    vwap_24h BIGINT,
    slot BIGINT NOT NULL
);

-- Oracle data
CREATE TABLE IF NOT EXISTS oracle_readings (
    id BIGSERIAL PRIMARY KEY,
    meter_id VARCHAR(64) NOT NULL,
    energy_produced BIGINT NOT NULL,
    energy_consumed BIGINT NOT NULL,
    reading_timestamp TIMESTAMPTZ NOT NULL,
    submitted_by VARCHAR(44) NOT NULL,
    is_valid BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    slot BIGINT NOT NULL,
    signature VARCHAR(88) NOT NULL
);

-- ============================================
-- Indexer State Tables
-- ============================================

-- Track the last processed slot for each program
CREATE TABLE IF NOT EXISTS indexer_state (
    program_id VARCHAR(44) PRIMARY KEY,
    program_name VARCHAR(50) NOT NULL,
    last_processed_slot BIGINT NOT NULL DEFAULT 0,
    last_processed_signature VARCHAR(88),
    status VARCHAR(20) DEFAULT 'running',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Error log for failed transaction processing
CREATE TABLE IF NOT EXISTS indexer_errors (
    id BIGSERIAL PRIMARY KEY,
    signature VARCHAR(88) NOT NULL,
    program_id VARCHAR(44),
    error_message TEXT NOT NULL,
    raw_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- Indexes for Performance
-- ============================================

-- Users
CREATE INDEX IF NOT EXISTS idx_users_type ON users(user_type);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_location ON users USING gist (
    point(longitude, latitude)
);

-- Meters
CREATE INDEX IF NOT EXISTS idx_meters_user ON meters(user_pubkey);
CREATE INDEX IF NOT EXISTS idx_meters_status ON meters(status);
CREATE INDEX IF NOT EXISTS idx_meters_last_reading ON meters(last_reading_at DESC);

-- Meter readings
CREATE INDEX IF NOT EXISTS idx_readings_meter ON meter_readings(meter_pubkey);
CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON meter_readings(reading_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_readings_day ON meter_readings(DATE(reading_timestamp));

-- Orders
CREATE INDEX IF NOT EXISTS idx_orders_owner ON orders(owner_pubkey);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_type_status ON orders(order_type, status);
CREATE INDEX IF NOT EXISTS idx_orders_price ON orders(price_per_kwh);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

-- Trades
CREATE INDEX IF NOT EXISTS idx_trades_buyer ON trades(buyer_pubkey);
CREATE INDEX IF NOT EXISTS idx_trades_seller ON trades(seller_pubkey);
CREATE INDEX IF NOT EXISTS idx_trades_executed ON trades(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_signature ON trades(signature);

-- ERC Certificates
CREATE INDEX IF NOT EXISTS idx_erc_owner ON erc_certificates(owner_pubkey);
CREATE INDEX IF NOT EXISTS idx_erc_status ON erc_certificates(status);
CREATE INDEX IF NOT EXISTS idx_erc_source ON erc_certificates(renewable_source);

-- Token transfers
CREATE INDEX IF NOT EXISTS idx_transfers_from ON token_transfers(from_pubkey);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON token_transfers(to_pubkey);
CREATE INDEX IF NOT EXISTS idx_transfers_time ON token_transfers(executed_at DESC);

-- Market snapshots
CREATE INDEX IF NOT EXISTS idx_market_time ON market_snapshots(timestamp DESC);

-- ============================================
-- Views for Common Queries
-- ============================================

-- User energy summary
CREATE OR REPLACE VIEW user_energy_summary AS
SELECT 
    u.pubkey,
    u.user_type,
    u.status,
    COUNT(DISTINCT m.pubkey) as meter_count,
    COALESCE(SUM(m.total_generated), 0) as total_generated,
    COALESCE(SUM(m.total_consumed), 0) as total_consumed,
    COALESCE(SUM(m.total_generated) - SUM(m.total_consumed), 0) as net_energy
FROM users u
LEFT JOIN meters m ON u.pubkey = m.user_pubkey
GROUP BY u.pubkey, u.user_type, u.status;

-- Active order book
CREATE OR REPLACE VIEW active_order_book AS
SELECT 
    order_type,
    price_per_kwh,
    SUM(remaining_amount) as total_volume,
    COUNT(*) as order_count
FROM orders
WHERE status IN ('open', 'partial')
GROUP BY order_type, price_per_kwh
ORDER BY order_type, price_per_kwh;

-- Recent trades
CREATE OR REPLACE VIEW recent_trades AS
SELECT 
    t.id,
    t.buyer_pubkey,
    t.seller_pubkey,
    t.energy_amount,
    t.price_per_kwh,
    t.total_price,
    t.wheeling_charge,
    t.executed_at,
    t.signature
FROM trades t
ORDER BY t.executed_at DESC
LIMIT 100;

-- Daily trading stats
CREATE OR REPLACE VIEW daily_trading_stats AS
SELECT 
    DATE(executed_at) as trade_date,
    COUNT(*) as trade_count,
    SUM(energy_amount) as total_volume,
    SUM(total_price) as total_value,
    AVG(price_per_kwh) as avg_price,
    MIN(price_per_kwh) as min_price,
    MAX(price_per_kwh) as max_price
FROM trades
GROUP BY DATE(executed_at)
ORDER BY trade_date DESC;

-- ============================================
-- Functions
-- ============================================

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_meters_updated_at
    BEFORE UPDATE ON meters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_erc_updated_at
    BEFORE UPDATE ON erc_certificates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_indexer_state_updated_at
    BEFORE UPDATE ON indexer_state
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Initial Data
-- ============================================

-- Initialize indexer state for each program
INSERT INTO indexer_state (program_id, program_name, last_processed_slot) VALUES
    ('EgpmmYPFDAX8QfawUEFissBXi3yG6AapoxNfB6KdGtBQ', 'registry', 0),
    ('G8dC1NwdDiMhfrnPwkf9dMaR2AgrnFXcjWcepyGSHTfA', 'energy_token', 0),
    ('4Agkm8isGD6xDegsfoFzWN5Xp5WLVoqJyPDQLRsjh85u', 'oracle', 0),
    ('CrfC5coUm2ty6DphLBFhAmr8m1AMutf8KTW2JYS38Z5J', 'trading', 0),
    ('3d1BQT3EiwbspkD8HYKAnyLvKjs5kZwSbRBWwS5NHof9', 'governance', 0)
ON CONFLICT (program_id) DO NOTHING;
