/**
 * Oracle Program Event Handler
 */

import { DatabaseClient } from '../database/client';
import { Logger } from 'pino';

export class OracleHandler {
    private db: DatabaseClient;
    private logger: Logger;

    constructor(db: DatabaseClient, logger: Logger) {
        this.db = db;
        this.logger = logger.child({ handler: 'oracle' });
    }

    async processTransaction(tx: any, signature: string): Promise<void> {
        const slot = tx.slot;
        const timestamp = tx.blockTime ? new Date(tx.blockTime * 1000) : new Date();

        const instructions = tx.transaction.message.compiledInstructions ||
            tx.transaction.message.instructions || [];

        for (const ix of instructions) {
            await this.processInstruction(ix, tx, slot, signature, timestamp);
        }
    }

    private async processInstruction(ix: any, tx: any, slot: number, signature: string, timestamp: Date): Promise<void> {
        const data = ix.data ? Buffer.from(ix.data, 'base64') : Buffer.alloc(0);
        if (data.length < 8) return;

        const instructionName = this.getInstructionName(data.slice(0, 8));

        switch (instructionName) {
            case 'submit_meter_reading':
                await this.handleSubmitMeterReading(ix, tx, slot, signature, timestamp);
                break;
            case 'trigger_market_clearing':
                await this.handleMarketClearing(ix, tx, slot, signature, timestamp);
                break;
        }
    }

    private getInstructionName(discriminator: Buffer): string | null {
        return null;
    }

    private async handleSubmitMeterReading(ix: any, tx: any, slot: number, signature: string, timestamp: Date): Promise<void> {
        try {
            const data = Buffer.from(ix.data, 'base64');

            // Parse meter_id string
            const meterIdLength = data.readUInt32LE(8);
            const meterId = data.slice(12, 12 + meterIdLength).toString('utf8');

            const offset = 12 + meterIdLength;
            const energyProduced = Number(data.readBigUInt64LE(offset));
            const energyConsumed = Number(data.readBigUInt64LE(offset + 8));
            const readingTimestamp = Number(data.readBigInt64LE(offset + 16));

            const accounts = ix.accounts || [];
            const getAccountKey = (index: number) =>
                tx.transaction.message.staticAccountKeys?.[accounts[index]]?.toBase58();

            const submittedBy = getAccountKey(0);

            await this.db.query(
                `INSERT INTO oracle_readings (meter_id, energy_produced, energy_consumed, reading_timestamp, submitted_by, slot, signature)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [meterId, energyProduced, energyConsumed, new Date(readingTimestamp * 1000), submittedBy, slot, signature]
            );

            this.logger.info({ meterId, energyProduced, energyConsumed }, 'Oracle reading submitted');

        } catch (error) {
            this.logger.error({ error, signature }, 'Failed to handle oracle reading');
        }
    }

    private async handleMarketClearing(ix: any, tx: any, slot: number, signature: string, timestamp: Date): Promise<void> {
        this.logger.info({ signature, slot }, 'Market clearing triggered');

        // Record market snapshot on clearing
        const [orderBookStats] = await this.db.query<{
            bid_volume: number;
            ask_volume: number;
            best_bid: number;
            best_ask: number;
        }>(`
      SELECT 
        SUM(CASE WHEN order_type = 'buy' THEN remaining_amount ELSE 0 END) as bid_volume,
        SUM(CASE WHEN order_type = 'sell' THEN remaining_amount ELSE 0 END) as ask_volume,
        MAX(CASE WHEN order_type = 'buy' THEN price_per_kwh END) as best_bid,
        MIN(CASE WHEN order_type = 'sell' THEN price_per_kwh END) as best_ask
      FROM orders 
      WHERE status IN ('open', 'partial')
    `);

        const [tradeStats] = await this.db.query<{
            volume_24h: number;
            trade_count_24h: number;
            last_price: number;
        }>(`
      SELECT 
        COALESCE(SUM(energy_amount), 0) as volume_24h,
        COUNT(*) as trade_count_24h,
        (SELECT price_per_kwh FROM trades ORDER BY executed_at DESC LIMIT 1) as last_price
      FROM trades 
      WHERE executed_at > NOW() - INTERVAL '24 hours'
    `);

        await this.db.insertMarketSnapshot({
            best_bid_price: orderBookStats?.best_bid,
            best_ask_price: orderBookStats?.best_ask,
            bid_volume: orderBookStats?.bid_volume || 0,
            ask_volume: orderBookStats?.ask_volume || 0,
            last_trade_price: tradeStats?.last_price,
            volume_24h: tradeStats?.volume_24h || 0,
            trade_count_24h: tradeStats?.trade_count_24h || 0,
            slot,
        });
    }
}
