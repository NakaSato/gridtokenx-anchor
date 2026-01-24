/**
 * Database Client for GridTokenX Indexer
 */

import { Pool, PoolClient } from 'pg';

export interface DatabaseClient {
    query: <T = any>(sql: string, params?: any[]) => Promise<T[]>;
    getIndexerState: (programId: string) => Promise<IndexerState | null>;
    updateIndexerState: (programId: string, slot: number, signature: string) => Promise<void>;
    logIndexerError: (signature: string, programId: string, error: any) => Promise<void>;
    close: () => Promise<void>;

    // User operations
    upsertUser: (user: UserRecord) => Promise<void>;
    getUserByPubkey: (pubkey: string) => Promise<UserRecord | null>;

    // Meter operations
    upsertMeter: (meter: MeterRecord) => Promise<void>;
    insertMeterReading: (reading: MeterReadingRecord) => Promise<void>;

    // Order operations
    upsertOrder: (order: OrderRecord) => Promise<void>;
    getActiveOrders: (orderType?: string) => Promise<OrderRecord[]>;

    // Trade operations
    insertTrade: (trade: TradeRecord) => Promise<void>;
    getRecentTrades: (limit?: number) => Promise<TradeRecord[]>;

    // ERC Certificate operations
    upsertErcCertificate: (cert: ErcCertificateRecord) => Promise<void>;

    // Token transfer operations
    insertTokenTransfer: (transfer: TokenTransferRecord) => Promise<void>;

    // Market snapshot operations
    insertMarketSnapshot: (snapshot: MarketSnapshotRecord) => Promise<void>;
}

export interface IndexerState {
    program_id: string;
    program_name: string;
    last_processed_slot: number;
    last_processed_signature: string | null;
    status: string;
}

export interface UserRecord {
    pubkey: string;
    user_type: 'producer' | 'consumer' | 'prosumer';
    status: 'active' | 'suspended' | 'inactive';
    latitude?: number;
    longitude?: number;
    slot: number;
    signature: string;
}

export interface MeterRecord {
    pubkey: string;
    user_pubkey: string;
    meter_id: string;
    meter_type: 'production' | 'consumption' | 'bidirectional';
    status: 'active' | 'maintenance' | 'inactive' | 'deactivated';
    total_generated: number;
    total_consumed: number;
    settled_net_generation: number;
    last_reading_at?: Date;
    slot: number;
    signature: string;
}

export interface MeterReadingRecord {
    meter_pubkey: string;
    energy_generated: number;
    energy_consumed: number;
    reading_timestamp: Date;
    slot: number;
    signature: string;
}

export interface OrderRecord {
    pubkey: string;
    owner_pubkey: string;
    order_type: 'buy' | 'sell';
    energy_amount: number;
    price_per_kwh: number;
    filled_amount: number;
    status: 'open' | 'partial' | 'filled' | 'cancelled';
    expires_at?: Date;
    slot: number;
    signature: string;
}

export interface TradeRecord {
    buy_order_pubkey: string;
    sell_order_pubkey: string;
    buyer_pubkey: string;
    seller_pubkey: string;
    energy_amount: number;
    price_per_kwh: number;
    wheeling_charge: number;
    market_fee: number;
    executed_at: Date;
    slot: number;
    signature: string;
}

export interface ErcCertificateRecord {
    pubkey: string;
    certificate_id: string;
    owner_pubkey: string;
    energy_amount: number;
    renewable_source: string;
    status: 'active' | 'suspended' | 'revoked' | 'retired';
    issued_at: Date;
    expires_at?: Date;
    validation_data?: string;
    slot: number;
    signature: string;
}

export interface TokenTransferRecord {
    from_pubkey: string;
    to_pubkey: string;
    amount: number;
    transfer_type: 'mint' | 'burn' | 'transfer' | 'trade';
    executed_at: Date;
    slot: number;
    signature: string;
}

export interface MarketSnapshotRecord {
    best_bid_price?: number;
    best_ask_price?: number;
    bid_volume: number;
    ask_volume: number;
    last_trade_price?: number;
    volume_24h: number;
    trade_count_24h: number;
    vwap_24h?: number;
    slot: number;
}

class PostgresDatabaseClient implements DatabaseClient {
    private pool: Pool;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
        const result = await this.pool.query(sql, params);
        return result.rows as T[];
    }

    async getIndexerState(programId: string): Promise<IndexerState | null> {
        const result = await this.query<IndexerState>(
            'SELECT * FROM indexer_state WHERE program_id = $1',
            [programId]
        );
        return result[0] || null;
    }

    async updateIndexerState(programId: string, slot: number, signature: string): Promise<void> {
        await this.query(
            `UPDATE indexer_state 
       SET last_processed_slot = $2, last_processed_signature = $3, updated_at = NOW()
       WHERE program_id = $1`,
            [programId, slot, signature]
        );
    }

    async logIndexerError(signature: string, programId: string, error: any): Promise<void> {
        await this.query(
            `INSERT INTO indexer_errors (signature, program_id, error_message, raw_data)
       VALUES ($1, $2, $3, $4)`,
            [signature, programId, error.message || String(error), JSON.stringify(error)]
        );
    }

    async close(): Promise<void> {
        await this.pool.end();
    }

    // User operations
    async upsertUser(user: UserRecord): Promise<void> {
        await this.query(
            `INSERT INTO users (pubkey, user_type, status, latitude, longitude, slot, signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (pubkey) DO UPDATE SET
         user_type = EXCLUDED.user_type,
         status = EXCLUDED.status,
         latitude = COALESCE(EXCLUDED.latitude, users.latitude),
         longitude = COALESCE(EXCLUDED.longitude, users.longitude),
         slot = EXCLUDED.slot,
         signature = EXCLUDED.signature`,
            [user.pubkey, user.user_type, user.status, user.latitude, user.longitude, user.slot, user.signature]
        );
    }

    async getUserByPubkey(pubkey: string): Promise<UserRecord | null> {
        const result = await this.query<UserRecord>(
            'SELECT * FROM users WHERE pubkey = $1',
            [pubkey]
        );
        return result[0] || null;
    }

    // Meter operations
    async upsertMeter(meter: MeterRecord): Promise<void> {
        await this.query(
            `INSERT INTO meters (pubkey, user_pubkey, meter_id, meter_type, status, total_generated, total_consumed, settled_net_generation, last_reading_at, slot, signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (pubkey) DO UPDATE SET
         status = EXCLUDED.status,
         total_generated = EXCLUDED.total_generated,
         total_consumed = EXCLUDED.total_consumed,
         settled_net_generation = EXCLUDED.settled_net_generation,
         last_reading_at = EXCLUDED.last_reading_at,
         slot = EXCLUDED.slot,
         signature = EXCLUDED.signature`,
            [meter.pubkey, meter.user_pubkey, meter.meter_id, meter.meter_type, meter.status,
            meter.total_generated, meter.total_consumed, meter.settled_net_generation,
            meter.last_reading_at, meter.slot, meter.signature]
        );
    }

    async insertMeterReading(reading: MeterReadingRecord): Promise<void> {
        await this.query(
            `INSERT INTO meter_readings (meter_pubkey, energy_generated, energy_consumed, reading_timestamp, slot, signature)
       VALUES ($1, $2, $3, $4, $5, $6)`,
            [reading.meter_pubkey, reading.energy_generated, reading.energy_consumed,
            reading.reading_timestamp, reading.slot, reading.signature]
        );
    }

    // Order operations
    async upsertOrder(order: OrderRecord): Promise<void> {
        await this.query(
            `INSERT INTO orders (pubkey, owner_pubkey, order_type, energy_amount, price_per_kwh, filled_amount, status, expires_at, slot, signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (pubkey) DO UPDATE SET
         filled_amount = EXCLUDED.filled_amount,
         status = EXCLUDED.status,
         slot = EXCLUDED.slot,
         signature = EXCLUDED.signature`,
            [order.pubkey, order.owner_pubkey, order.order_type, order.energy_amount,
            order.price_per_kwh, order.filled_amount, order.status, order.expires_at,
            order.slot, order.signature]
        );
    }

    async getActiveOrders(orderType?: string): Promise<OrderRecord[]> {
        if (orderType) {
            return this.query<OrderRecord>(
                `SELECT * FROM orders WHERE status IN ('open', 'partial') AND order_type = $1 ORDER BY price_per_kwh`,
                [orderType]
            );
        }
        return this.query<OrderRecord>(
            `SELECT * FROM orders WHERE status IN ('open', 'partial') ORDER BY order_type, price_per_kwh`
        );
    }

    // Trade operations
    async insertTrade(trade: TradeRecord): Promise<void> {
        await this.query(
            `INSERT INTO trades (buy_order_pubkey, sell_order_pubkey, buyer_pubkey, seller_pubkey, energy_amount, price_per_kwh, wheeling_charge, market_fee, executed_at, slot, signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (signature) DO NOTHING`,
            [trade.buy_order_pubkey, trade.sell_order_pubkey, trade.buyer_pubkey, trade.seller_pubkey,
            trade.energy_amount, trade.price_per_kwh, trade.wheeling_charge, trade.market_fee,
            trade.executed_at, trade.slot, trade.signature]
        );
    }

    async getRecentTrades(limit: number = 100): Promise<TradeRecord[]> {
        return this.query<TradeRecord>(
            `SELECT * FROM trades ORDER BY executed_at DESC LIMIT $1`,
            [limit]
        );
    }

    // ERC Certificate operations
    async upsertErcCertificate(cert: ErcCertificateRecord): Promise<void> {
        await this.query(
            `INSERT INTO erc_certificates (pubkey, certificate_id, owner_pubkey, energy_amount, renewable_source, status, issued_at, expires_at, validation_data, slot, signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (pubkey) DO UPDATE SET
         owner_pubkey = EXCLUDED.owner_pubkey,
         status = EXCLUDED.status,
         slot = EXCLUDED.slot,
         signature = EXCLUDED.signature`,
            [cert.pubkey, cert.certificate_id, cert.owner_pubkey, cert.energy_amount,
            cert.renewable_source, cert.status, cert.issued_at, cert.expires_at,
            cert.validation_data, cert.slot, cert.signature]
        );
    }

    // Token transfer operations
    async insertTokenTransfer(transfer: TokenTransferRecord): Promise<void> {
        await this.query(
            `INSERT INTO token_transfers (from_pubkey, to_pubkey, amount, transfer_type, executed_at, slot, signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [transfer.from_pubkey, transfer.to_pubkey, transfer.amount, transfer.transfer_type,
            transfer.executed_at, transfer.slot, transfer.signature]
        );
    }

    // Market snapshot operations
    async insertMarketSnapshot(snapshot: MarketSnapshotRecord): Promise<void> {
        await this.query(
            `INSERT INTO market_snapshots (best_bid_price, best_ask_price, bid_volume, ask_volume, last_trade_price, volume_24h, trade_count_24h, vwap_24h, slot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [snapshot.best_bid_price, snapshot.best_ask_price, snapshot.bid_volume, snapshot.ask_volume,
            snapshot.last_trade_price, snapshot.volume_24h, snapshot.trade_count_24h, snapshot.vwap_24h, snapshot.slot]
        );
    }
}

export async function createDatabaseClient(connectionString: string): Promise<DatabaseClient> {
    const pool = new Pool({ connectionString });

    // Test connection
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();

    return new PostgresDatabaseClient(pool);
}
