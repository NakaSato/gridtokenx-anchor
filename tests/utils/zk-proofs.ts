/**
 * ZK Proof Utilities - Bridge between WASM module and TypeScript tests
 * Provides runtime proof generation for confidential trading/settlement tests
 */

// Import the WASM module built for Node.js
import * as wasm from '../../../gridtokenx-wasm/pkg-node/gridtokenx_wasm';

export interface RangeProofResult {
    commitment: { data: number[] };
    proof: Buffer;
}

export interface TransferProofResult {
    amountCommitment: { data: number[] };
    proof: Buffer;
}

/**
 * Generate a valid random scalar for Curve25519 (blinding factor)
 * A random 32-byte value might be greater than the group order.
 * Clearing the top bits ensures it's always within a valid range for the ZK SDK.
 */
export function generateValidBlinding(): Uint8Array {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    // Clear the top 4 bits to ensure it's < 2^252, which is always < group order L
    bytes[31] &= 0x0F;
    return bytes;
}

/**
 * Generate a real range proof for a given amount
 * @param amount The value to commit to and prove range for
 * @param blinding 32-byte blinding factor
 */
export function createRangeProof(amount: bigint, blinding: Uint8Array): RangeProofResult {
    const result = wasm.create_range_proof(amount, blinding) as {
        commitment: { point: number[] };
        proof_data: number[];
    };

    return {
        commitment: { data: result.commitment.point },
        proof: Buffer.from(result.proof_data),
    };
}

/**
 * Generate a real transfer proof
 * @param amount The transfer amount
 * @param senderBalance The sender's starting balance
 * @param senderBlinding 32-byte blinding for the sender's balance
 * @param amountBlinding 32-byte blinding for the transfer amount
 */
export function createTransferProof(
    amount: bigint,
    senderBalance: bigint,
    senderBlinding: Uint8Array,
    amountBlinding: Uint8Array
): TransferProofResult {
    const result = wasm.create_transfer_proof(
        amount,
        senderBalance,
        senderBlinding,
        amountBlinding
    ) as {
        amount_commitment: { point: number[] };
        amount_range_proof: { proof_data: number[]; commitment: { point: number[] } };
        remaining_range_proof: { proof_data: number[]; commitment: { point: number[] } };
        balance_proof: { proof_data: number[] };
    };

    return {
        amountCommitment: { data: result.amount_commitment.point },
        proof: Buffer.from(result.amount_range_proof.proof_data),
    };
}

/**
 * Generate a Pedersen Commitment
 */
export function createCommitment(value: bigint, blinding: Uint8Array): { data: number[] } {
    const result = wasm.create_commitment(value, blinding) as { point: number[] };
    return { data: result.point };
}

/**
 * Generate a new ElGamal keypair for test usage
 */
export function generateElGamalKeypair(): { pubkey: Uint8Array; secret: Uint8Array } {
    const kp = new wasm.WasmElGamalKeypair();
    return {
        pubkey: kp.pubkey(),
        secret: kp.secret(),
    };
}
