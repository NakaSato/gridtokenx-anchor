/**
 * Governance Program Event Handler
 */

import { DatabaseClient, ErcCertificateRecord } from '../database/client';
import { Logger } from 'pino';

export class GovernanceHandler {
    private db: DatabaseClient;
    private logger: Logger;

    constructor(db: DatabaseClient, logger: Logger) {
        this.db = db;
        this.logger = logger.child({ handler: 'governance' });
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
            case 'issue_erc':
                await this.handleIssueErc(ix, tx, slot, signature, timestamp);
                break;
            case 'revoke_erc':
                await this.handleRevokeErc(ix, tx, slot, signature);
                break;
            case 'transfer_erc':
                await this.handleTransferErc(ix, tx, slot, signature);
                break;
            case 'validate_erc_for_trading':
                await this.handleValidateErc(ix, tx, slot, signature);
                break;
        }
    }

    private getInstructionName(discriminator: Buffer): string | null {
        return null;
    }

    private async handleIssueErc(ix: any, tx: any, slot: number, signature: string, timestamp: Date): Promise<void> {
        try {
            const accounts = ix.accounts || [];

            const getAccountKey = (index: number) =>
                tx.transaction.message.staticAccountKeys?.[accounts[index]]?.toBase58();

            const certPubkey = getAccountKey(0);
            const ownerPubkey = getAccountKey(1);

            if (!certPubkey || !ownerPubkey) return;

            // Parse instruction data
            const data = Buffer.from(ix.data, 'base64');

            // certificate_id string
            const certIdLength = data.readUInt32LE(8);
            const certificateId = data.slice(12, 12 + certIdLength).toString('utf8');

            let offset = 12 + certIdLength;
            const energyAmount = Number(data.readBigUInt64LE(offset));
            offset += 8;

            // renewable_source string
            const sourceLength = data.readUInt32LE(offset);
            offset += 4;
            const renewableSource = data.slice(offset, offset + sourceLength).toString('utf8');

            const cert: ErcCertificateRecord = {
                pubkey: certPubkey,
                certificate_id: certificateId,
                owner_pubkey: ownerPubkey,
                energy_amount: energyAmount,
                renewable_source: renewableSource,
                status: 'active',
                issued_at: timestamp,
                slot,
                signature,
            };

            await this.db.upsertErcCertificate(cert);
            this.logger.info({ certPubkey, certificateId, renewableSource }, 'ERC certificate issued');

        } catch (error) {
            this.logger.error({ error, signature }, 'Failed to handle ERC issuance');
        }
    }

    private async handleRevokeErc(ix: any, tx: any, slot: number, signature: string): Promise<void> {
        try {
            const accounts = ix.accounts || [];

            const getAccountKey = (index: number) =>
                tx.transaction.message.staticAccountKeys?.[accounts[index]]?.toBase58();

            const certPubkey = getAccountKey(0);

            if (!certPubkey) return;

            // Update certificate status to revoked
            await this.db.query(
                `UPDATE erc_certificates SET status = 'revoked', slot = $2, signature = $3 WHERE pubkey = $1`,
                [certPubkey, slot, signature]
            );

            this.logger.info({ certPubkey }, 'ERC certificate revoked');

        } catch (error) {
            this.logger.error({ error, signature }, 'Failed to handle ERC revocation');
        }
    }

    private async handleTransferErc(ix: any, tx: any, slot: number, signature: string): Promise<void> {
        try {
            const accounts = ix.accounts || [];

            const getAccountKey = (index: number) =>
                tx.transaction.message.staticAccountKeys?.[accounts[index]]?.toBase58();

            const certPubkey = getAccountKey(0);
            const newOwnerPubkey = getAccountKey(2);

            if (!certPubkey || !newOwnerPubkey) return;

            await this.db.query(
                `UPDATE erc_certificates SET owner_pubkey = $2, slot = $3, signature = $4 WHERE pubkey = $1`,
                [certPubkey, newOwnerPubkey, slot, signature]
            );

            this.logger.info({ certPubkey, newOwnerPubkey }, 'ERC certificate transferred');

        } catch (error) {
            this.logger.error({ error, signature }, 'Failed to handle ERC transfer');
        }
    }

    private async handleValidateErc(ix: any, tx: any, slot: number, signature: string): Promise<void> {
        this.logger.debug({ signature }, 'ERC validated for trading');
    }
}
