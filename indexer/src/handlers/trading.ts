/**
 * Trading Program Event Handler
 */

import { PublicKey } from '@solana/web3.js';
import { DatabaseClient, OrderRecord, TradeRecord } from '../database/client';
import { Logger } from 'pino';

// Event discriminators (first 8 bytes of event data)
const EVENT_DISCRIMINATORS = {
    OrderCreated: Buffer.from([/* order created hash */]),
    OrderMatched: Buffer.from([/* order matched hash */]),
    OrderCancelled: Buffer.from([/* order cancelled hash */]),
    AtomicSettlement: Buffer.from([/* settlement hash */]),
};

interface ParsedOrder {
    pubkey: string;
    owner: string;
    orderType: 'buy' | 'sell';
    energyAmount: bigint;
    pricePerKwh: bigint;
    filledAmount: bigint;
    status: string;
    timestamp: bigint;
}

interface ParsedMatch {
    buyOrder: string;
    sellOrder: string;
    buyer: string;
    seller: string;
    amount: bigint;
    price: bigint;
    wheelingCharge: bigint;
    timestamp: bigint;
}

export class TradingHandler {
    private db: DatabaseClient;
    private logger: Logger;

    constructor(db: DatabaseClient, logger: Logger) {
        this.db = db;
        this.logger = logger.child({ handler: 'trading' });
    }

    async processTransaction(tx: any, signature: string): Promise<void> {
        const slot = tx.slot;
        const timestamp = tx.blockTime ? new Date(tx.blockTime * 1000) : new Date();

        // Parse instruction data and logs
        const logs = tx.meta?.logMessages || [];

        for (const log of logs) {
            if (log.includes('Program data:')) {
                await this.processEventLog(log, slot, signature, timestamp);
            }
        }

        // Also check for account changes
        await this.processAccountChanges(tx, slot, signature);
    }

    private async processEventLog(log: string, slot: number, signature: string, timestamp: Date): Promise<void> {
        try {
            // Extract base64 event data
            const match = log.match(/Program data: (.+)/);
            if (!match) return;

            const eventData = Buffer.from(match[1], 'base64');

            // Determine event type from discriminator
            // In a real implementation, match against known discriminators

            // For now, parse based on data length patterns
            if (eventData.length >= 200) {
                // Likely an order or match event
                this.logger.debug({ dataLength: eventData.length }, 'Processing event data');
            }
        } catch (error) {
            this.logger.error({ error, log }, 'Failed to parse event log');
        }
    }

    private async processAccountChanges(tx: any, slot: number, signature: string): Promise<void> {
        // Process pre/post account data to detect changes
        const preBalances = tx.meta?.preTokenBalances || [];
        const postBalances = tx.meta?.postTokenBalances || [];

        // Detect order creations, updates, and cancellations
        // by comparing account data before and after

        // Parse instruction to understand the operation
        const instructions = tx.transaction.message.compiledInstructions ||
            tx.transaction.message.instructions || [];

        for (const ix of instructions) {
            await this.processInstruction(ix, tx, slot, signature);
        }
    }

    private async processInstruction(ix: any, tx: any, slot: number, signature: string): Promise<void> {
        // Decode instruction data
        const data = ix.data ? Buffer.from(ix.data, 'base64') : Buffer.alloc(0);
        if (data.length < 8) return;

        // Get instruction discriminator (first 8 bytes)
        const discriminator = data.slice(0, 8);

        // Match against known instructions
        const instructionName = this.getInstructionName(discriminator);

        switch (instructionName) {
            case 'create_sell_order':
            case 'create_buy_order':
                await this.handleOrderCreation(ix, tx, slot, signature, instructionName);
                break;
            case 'match_orders':
                await this.handleOrderMatch(ix, tx, slot, signature);
                break;
            case 'cancel_order':
                await this.handleOrderCancellation(ix, tx, slot, signature);
                break;
            case 'execute_atomic_settlement':
                await this.handleAtomicSettlement(ix, tx, slot, signature);
                break;
        }
    }

    private getInstructionName(discriminator: Buffer): string | null {
        // Anchor instruction discriminators (SHA256 of "global:<instruction_name>")[0..8]
        const instructionHashes: Record<string, string> = {
            // These would be the actual anchor discriminators
            'create_sell_order': '...',
            'create_buy_order': '...',
            'match_orders': '...',
            'cancel_order': '...',
            'execute_atomic_settlement': '...',
        };

        const discriminatorHex = discriminator.toString('hex');

        for (const [name, hash] of Object.entries(instructionHashes)) {
            if (discriminatorHex === hash) {
                return name;
            }
        }

        return null;
    }

    private async handleOrderCreation(ix: any, tx: any, slot: number, signature: string, orderType: string): Promise<void> {
        try {
            // Extract order data from instruction accounts and data
            // Account indices: [order, owner, market, ...]
            const accounts = ix.accounts || [];

            if (accounts.length < 2) return;

            const orderPubkey = tx.transaction.message.accountKeys[accounts[0]]?.pubkey?.toBase58() ||
                tx.transaction.message.staticAccountKeys?.[accounts[0]]?.toBase58();
            const ownerPubkey = tx.transaction.message.accountKeys[accounts[1]]?.pubkey?.toBase58() ||
                tx.transaction.message.staticAccountKeys?.[accounts[1]]?.toBase58();

            if (!orderPubkey || !ownerPubkey) return;

            // Parse instruction data for energy_amount and price_per_kwh
            const data = Buffer.from(ix.data, 'base64');
            const energyAmount = data.readBigUInt64LE(8);
            const pricePerKwh = data.readBigUInt64LE(16);

            const order: OrderRecord = {
                pubkey: orderPubkey,
                owner_pubkey: ownerPubkey,
                order_type: orderType === 'create_sell_order' ? 'sell' : 'buy',
                energy_amount: Number(energyAmount),
                price_per_kwh: Number(pricePerKwh),
                filled_amount: 0,
                status: 'open',
                slot,
                signature,
            };

            await this.db.upsertOrder(order);
            this.logger.info({ orderPubkey, orderType: order.order_type }, 'Order created');

        } catch (error) {
            this.logger.error({ error, signature }, 'Failed to handle order creation');
        }
    }

    private async handleOrderMatch(ix: any, tx: any, slot: number, signature: string): Promise<void> {
        try {
            const accounts = ix.accounts || [];

            if (accounts.length < 4) return;

            const getAccountKey = (index: number) =>
                tx.transaction.message.staticAccountKeys?.[accounts[index]]?.toBase58();

            const buyOrderPubkey = getAccountKey(0);
            const sellOrderPubkey = getAccountKey(1);
            const buyerPubkey = getAccountKey(2);
            const sellerPubkey = getAccountKey(3);

            if (!buyOrderPubkey || !sellOrderPubkey || !buyerPubkey || !sellerPubkey) return;

            // Parse match amount from instruction data
            const data = Buffer.from(ix.data, 'base64');
            const matchAmount = data.readBigUInt64LE(8);

            // Get current order states to determine fill status
            // In production, fetch from account data

            const trade: TradeRecord = {
                buy_order_pubkey: buyOrderPubkey,
                sell_order_pubkey: sellOrderPubkey,
                buyer_pubkey: buyerPubkey,
                seller_pubkey: sellerPubkey,
                energy_amount: Number(matchAmount),
                price_per_kwh: 0, // Would need to fetch from order account
                wheeling_charge: 0,
                market_fee: 0,
                executed_at: tx.blockTime ? new Date(tx.blockTime * 1000) : new Date(),
                slot,
                signature,
            };

            await this.db.insertTrade(trade);
            this.logger.info({ signature, amount: Number(matchAmount) }, 'Trade executed');

        } catch (error) {
            this.logger.error({ error, signature }, 'Failed to handle order match');
        }
    }

    private async handleOrderCancellation(ix: any, tx: any, slot: number, signature: string): Promise<void> {
        try {
            const accounts = ix.accounts || [];

            if (accounts.length < 1) return;

            const orderPubkey = tx.transaction.message.staticAccountKeys?.[accounts[0]]?.toBase58();

            if (!orderPubkey) return;

            // Update order status
            await this.db.upsertOrder({
                pubkey: orderPubkey,
                owner_pubkey: '',
                order_type: 'buy', // Doesn't matter for update
                energy_amount: 0,
                price_per_kwh: 0,
                filled_amount: 0,
                status: 'cancelled',
                slot,
                signature,
            });

            this.logger.info({ orderPubkey }, 'Order cancelled');

        } catch (error) {
            this.logger.error({ error, signature }, 'Failed to handle order cancellation');
        }
    }

    private async handleAtomicSettlement(ix: any, tx: any, slot: number, signature: string): Promise<void> {
        try {
            // Parse atomic settlement instruction
            const data = Buffer.from(ix.data, 'base64');
            const amount = data.readBigUInt64LE(8);
            const price = data.readBigUInt64LE(16);
            const wheelingCharge = data.readBigUInt64LE(24);

            const accounts = ix.accounts || [];

            const getAccountKey = (index: number) =>
                tx.transaction.message.staticAccountKeys?.[accounts[index]]?.toBase58();

            const buyerPubkey = getAccountKey(0);
            const sellerPubkey = getAccountKey(1);

            if (!buyerPubkey || !sellerPubkey) return;

            const trade: TradeRecord = {
                buy_order_pubkey: '',
                sell_order_pubkey: '',
                buyer_pubkey: buyerPubkey,
                seller_pubkey: sellerPubkey,
                energy_amount: Number(amount),
                price_per_kwh: Number(price),
                wheeling_charge: Number(wheelingCharge),
                market_fee: 0,
                executed_at: tx.blockTime ? new Date(tx.blockTime * 1000) : new Date(),
                slot,
                signature,
            };

            await this.db.insertTrade(trade);
            this.logger.info({ signature, amount: Number(amount) }, 'Atomic settlement executed');

        } catch (error) {
            this.logger.error({ error, signature }, 'Failed to handle atomic settlement');
        }
    }
}
