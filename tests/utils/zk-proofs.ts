/**
 * ZK Proof Utilities - Bridge between WASM module and TypeScript tests
 * Provides runtime proof generation for confidential trading/settlement tests
 */

// Import the WASM module
import * as wasm from '../../pkg-wasm/gridtokenx_wasm';

export interface RangeProofResult {
    commitment: { data: number[] };
    proof: Buffer;
}

export interface TransferProofResult {
    amountCommitment: { data: number[] };
    proof: Buffer;
}

/**
 * Generate a real range proof for a given amount
 * Uses the WASM module to create a cryptographically valid proof
 */
export function createRangeProof(amount: bigint): RangeProofResult {
    const result = wasm.create_range_proof(amount) as {
        commitment: { point: number[] };
        proof_data: number[];
    };

    return {
        commitment: { data: result.commitment.point },
        proof: Buffer.from(result.proof_data),
    };
}

/**
 * Generate a real transfer proof for a given amount
 * Uses the WASM module to create a cryptographically valid proof
 */
export function createTransferProof(
    amount: bigint,
    senderBalance: bigint,
    senderSecret: Uint8Array,
    receiverPubkey: Uint8Array
): TransferProofResult {
    const result = wasm.create_transfer_proof(
        amount,
        senderBalance,
        senderSecret,
        receiverPubkey
    ) as {
        amount_commitment: { point: number[] };
        proof_data: number[];
    };

    return {
        amountCommitment: { data: result.amount_commitment.point },
        proof: Buffer.from(result.proof_data),
    };
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
