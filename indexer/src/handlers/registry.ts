/**
 * Registry Program Event Handler
 */

import { DatabaseClient, UserRecord, MeterRecord, MeterReadingRecord } from '../database/client';
import { Logger } from 'pino';

export class RegistryHandler {
    private db: DatabaseClient;
    private logger: Logger;

    constructor(db: DatabaseClient, logger: Logger) {
        this.db = db;
        this.logger = logger.child({ handler: 'registry' });
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
            case 'register_user':
                await this.handleRegisterUser(ix, tx, slot, signature);
                break;
            case 'register_meter':
                await this.handleRegisterMeter(ix, tx, slot, signature);
                break;
            case 'update_meter_reading':
                await this.handleUpdateMeterReading(ix, tx, slot, signature, timestamp);
                break;
            case 'update_user_status':
                await this.handleUpdateUserStatus(ix, tx, slot, signature);
                break;
            case 'set_meter_status':
                await this.handleSetMeterStatus(ix, tx, slot, signature);
                break;
            case 'settle_meter_balance':
                await this.handleSettleMeterBalance(ix, tx, slot, signature);
                break;
        }
    }

    private getInstructionName(discriminator: Buffer): string | null {
        // Map discriminators to instruction names
        // In production, generate these from the IDL
        return null;
    }

    private async handleRegisterUser(ix: any, tx: any, slot: number, signature: string): Promise<void> {
        try {
            const accounts = ix.accounts || [];

            const getAccountKey = (index: number) =>
                tx.transaction.message.staticAccountKeys?.[accounts[index]]?.toBase58();

            const userPubkey = getAccountKey(0);
            const ownerPubkey = getAccountKey(1);

            if (!userPubkey || !ownerPubkey) return;

            // Parse instruction data
            const data = Buffer.from(ix.data, 'base64');
            // user_type at offset 8, lat at offset 9, long at offset 17
            const userTypeValue = data.readUInt8(8);
            const lat = data.readDoubleLE(9);
            const long = data.readDoubleLE(17);

            const userTypes = ['producer', 'consumer', 'prosumer'] as const;
            const userType = userTypes[userTypeValue] || 'consumer';

            const user: UserRecord = {
                pubkey: userPubkey,
                user_type: userType,
                status: 'active',
                latitude: lat,
                longitude: long,
                slot,
                signature,
            };

            await this.db.upsertUser(user);
            this.logger.info({ userPubkey, userType }, 'User registered');

        } catch (error) {
            this.logger.error({ error, signature }, 'Failed to handle register user');
        }
    }

    private async handleRegisterMeter(ix: any, tx: any, slot: number, signature: string): Promise<void> {
        try {
            const accounts = ix.accounts || [];

            const getAccountKey = (index: number) =>
                tx.transaction.message.staticAccountKeys?.[accounts[index]]?.toBase58();

            const meterPubkey = getAccountKey(0);
            const userPubkey = getAccountKey(1);

            if (!meterPubkey || !userPubkey) return;

            // Parse meter_id and meter_type from instruction data
            const data = Buffer.from(ix.data, 'base64');

            // meter_id is a string (length prefix + bytes)
            const meterIdLength = data.readUInt32LE(8);
            const meterId = data.slice(12, 12 + meterIdLength).toString('utf8');

            // meter_type follows the meter_id
            const meterTypeOffset = 12 + meterIdLength;
            const meterTypeValue = data.readUInt8(meterTypeOffset);

            const meterTypes = ['production', 'consumption', 'bidirectional'] as const;
            const meterType = meterTypes[meterTypeValue] || 'bidirectional';

            const meter: MeterRecord = {
                pubkey: meterPubkey,
                user_pubkey: userPubkey,
                meter_id: meterId,
                meter_type: meterType,
                status: 'active',
                total_generated: 0,
                total_consumed: 0,
                settled_net_generation: 0,
                slot,
                signature,
            };

            await this.db.upsertMeter(meter);
            this.logger.info({ meterPubkey, meterId }, 'Meter registered');

        } catch (error) {
            this.logger.error({ error, signature }, 'Failed to handle register meter');
        }
    }

    private async handleUpdateMeterReading(ix: any, tx: any, slot: number, signature: string, timestamp: Date): Promise<void> {
        try {
            const accounts = ix.accounts || [];

            const getAccountKey = (index: number) =>
                tx.transaction.message.staticAccountKeys?.[accounts[index]]?.toBase58();

            const meterPubkey = getAccountKey(0);

            if (!meterPubkey) return;

            // Parse reading data
            const data = Buffer.from(ix.data, 'base64');
            const energyGenerated = Number(data.readBigUInt64LE(8));
            const energyConsumed = Number(data.readBigUInt64LE(16));
            const readingTimestamp = Number(data.readBigInt64LE(24));

            const reading: MeterReadingRecord = {
                meter_pubkey: meterPubkey,
                energy_generated: energyGenerated,
                energy_consumed: energyConsumed,
                reading_timestamp: new Date(readingTimestamp * 1000),
                slot,
                signature,
            };

            await this.db.insertMeterReading(reading);

            // Also update the meter's totals
            // In production, fetch current values and add to them

            this.logger.info({ meterPubkey, energyGenerated, energyConsumed }, 'Meter reading updated');

        } catch (error) {
            this.logger.error({ error, signature }, 'Failed to handle meter reading update');
        }
    }

    private async handleUpdateUserStatus(ix: any, tx: any, slot: number, signature: string): Promise<void> {
        try {
            const accounts = ix.accounts || [];

            const getAccountKey = (index: number) =>
                tx.transaction.message.staticAccountKeys?.[accounts[index]]?.toBase58();

            const userPubkey = getAccountKey(0);

            if (!userPubkey) return;

            const data = Buffer.from(ix.data, 'base64');
            const statusValue = data.readUInt8(8);

            const statuses = ['active', 'suspended', 'inactive'] as const;
            const status = statuses[statusValue] || 'active';

            // Update user status
            const existingUser = await this.db.getUserByPubkey(userPubkey);
            if (existingUser) {
                await this.db.upsertUser({
                    ...existingUser,
                    status,
                    slot,
                    signature,
                });
                this.logger.info({ userPubkey, status }, 'User status updated');
            }

        } catch (error) {
            this.logger.error({ error, signature }, 'Failed to handle user status update');
        }
    }

    private async handleSetMeterStatus(ix: any, tx: any, slot: number, signature: string): Promise<void> {
        // Similar to handleUpdateUserStatus but for meters
        this.logger.debug({ signature }, 'Processing meter status change');
    }

    private async handleSettleMeterBalance(ix: any, tx: any, slot: number, signature: string): Promise<void> {
        // Handle balance settlement - update meter's settled_net_generation
        this.logger.debug({ signature }, 'Processing meter balance settlement');
    }
}
