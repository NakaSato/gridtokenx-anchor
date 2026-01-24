import * as ed25519 from "@noble/ed25519";
import { Keypair } from "@solana/web3.js";
import { sha512 } from "@noble/hashes/sha512";

// Configure noble-ed25519 to use noble-hashes sha512
// @ts-ignore
ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m));

export class ReadingSigner {
    private keypair: Keypair;

    constructor(secretKey: Uint8Array) {
        this.keypair = Keypair.fromSecretKey(secretKey);
    }

    /**
     * Sign a meter reading for the GridTokenX program
     * @param meterAddress The public key of the meter
     * @param reading Value in Wh
     * @param timestamp Unix timestamp
     * @returns 64-byte signature
     */
    public async signReading(
        meterAddress: string,
        reading: number,
        timestamp: number
    ): Promise<Uint8Array> {
        const message = this.serializeReading(meterAddress, reading, timestamp);
        return await ed25519.sign(message, this.keypair.secretKey.slice(0, 32));
    }

    private serializeReading(
        meterAddress: string,
        reading: number,
        timestamp: number
    ): Uint8Array {
        const buffer = Buffer.alloc(32 + 8 + 8);
        buffer.write(meterAddress, 0, "hex"); // Simplified, should be bytes
        buffer.writeBigUInt64LE(BigInt(reading), 32);
        buffer.writeBigInt64LE(BigInt(timestamp), 40);
        return new Uint8Array(buffer);
    }
}
