/**
 * Energy Token Program Event Handler
 */

import { DatabaseClient, TokenTransferRecord } from '../database/client';
import { Logger } from 'pino';

export class EnergyTokenHandler {
    private db: DatabaseClient;
    private logger: Logger;

    constructor(db: DatabaseClient, logger: Logger) {
        this.db = db;
        this.logger = logger.child({ handler: 'energy_token' });
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
            case 'mint_to_wallet':
            case 'mint_tokens_direct':
                await this.handleMint(ix, tx, slot, signature, timestamp);
                break;
            case 'transfer_tokens':
                await this.handleTransfer(ix, tx, slot, signature, timestamp);
                break;
            case 'burn_tokens':
                await this.handleBurn(ix, tx, slot, signature, timestamp);
                break;
        }
    }

    private getInstructionName(discriminator: Buffer): string | null {
        return null;
    }

    private async handleMint(ix: any, tx: any, slot: number, signature: string, timestamp: Date): Promise<void> {
        try {
            const accounts = ix.accounts || [];

            const getAccountKey = (index: number) =>
                tx.transaction.message.staticAccountKeys?.[accounts[index]]?.toBase58();

            const recipientPubkey = getAccountKey(1); // recipient ATA
            const data = Buffer.from(ix.data, 'base64');
            const amount = Number(data.readBigUInt64LE(8));

            if (!recipientPubkey) return;

            const transfer: TokenTransferRecord = {
                from_pubkey: 'mint', // Special marker for mints
                to_pubkey: recipientPubkey,
                amount,
                transfer_type: 'mint',
                executed_at: timestamp,
                slot,
                signature,
            };

            await this.db.insertTokenTransfer(transfer);
            this.logger.info({ recipientPubkey, amount }, 'Tokens minted');

        } catch (error) {
            this.logger.error({ error, signature }, 'Failed to handle mint');
        }
    }

    private async handleTransfer(ix: any, tx: any, slot: number, signature: string, timestamp: Date): Promise<void> {
        try {
            const accounts = ix.accounts || [];

            const getAccountKey = (index: number) =>
                tx.transaction.message.staticAccountKeys?.[accounts[index]]?.toBase58();

            const fromPubkey = getAccountKey(0); // from ATA
            const toPubkey = getAccountKey(2);   // to ATA

            const data = Buffer.from(ix.data, 'base64');
            const amount = Number(data.readBigUInt64LE(8));

            if (!fromPubkey || !toPubkey) return;

            const transfer: TokenTransferRecord = {
                from_pubkey: fromPubkey,
                to_pubkey: toPubkey,
                amount,
                transfer_type: 'transfer',
                executed_at: timestamp,
                slot,
                signature,
            };

            await this.db.insertTokenTransfer(transfer);
            this.logger.info({ fromPubkey, toPubkey, amount }, 'Tokens transferred');

        } catch (error) {
            this.logger.error({ error, signature }, 'Failed to handle transfer');
        }
    }

    private async handleBurn(ix: any, tx: any, slot: number, signature: string, timestamp: Date): Promise<void> {
        try {
            const accounts = ix.accounts || [];

            const getAccountKey = (index: number) =>
                tx.transaction.message.staticAccountKeys?.[accounts[index]]?.toBase58();

            const fromPubkey = getAccountKey(0); // from ATA

            const data = Buffer.from(ix.data, 'base64');
            const amount = Number(data.readBigUInt64LE(8));

            if (!fromPubkey) return;

            const transfer: TokenTransferRecord = {
                from_pubkey: fromPubkey,
                to_pubkey: 'burn', // Special marker for burns
                amount,
                transfer_type: 'burn',
                executed_at: timestamp,
                slot,
                signature,
            };

            await this.db.insertTokenTransfer(transfer);
            this.logger.info({ fromPubkey, amount }, 'Tokens burned');

        } catch (error) {
            this.logger.error({ error, signature }, 'Failed to handle burn');
        }
    }
}
