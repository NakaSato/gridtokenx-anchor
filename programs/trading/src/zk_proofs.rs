//! Zero-Knowledge Proof Module for GridTokenX using Solana ZK Token SDK
//!
//! This module provides cryptographic primitives for confidential transfers:
//! - ElGamal Encryption (via solana-zk-token-sdk)
//! - Pedersen Commitments (via solana-zk-token-sdk)
//! - Range Proofs (via solana-zk-token-sdk syscalls/verify)
//! - Transfer Proofs (via solana-zk-token-sdk syscalls/verify)

use anchor_lang::prelude::*;
use solana_zk_token_sdk::{
    zk_token_elgamal::pod::{self},
    zk_token_proof_instruction::{
        self,
        range_proof::{RangeProofU64Data, RangeProofContext},
        transfer::{TransferData, TransferProofContext},
    },
};
use bytemuck::{Pod, Zeroable, pod_read_unaligned};
use anchor_lang::solana_program::program::invoke;

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
pub struct ZkTokenProof;

impl anchor_lang::Id for ZkTokenProof {
    fn id() -> Pubkey {
        solana_zk_token_sdk::zk_token_proof_program::id()
    }
}

/// Maximum representable amount (64 bits for SDK range proof)
pub const MAX_CONFIDENTIAL_AMOUNT: u64 = u64::MAX;

// ═══════════════════════════════════════════════════════════════════════════════
// WRAPPERS FOR ANCHOR COMPATIBILITY
// ═══════════════════════════════════════════════════════════════════════════════

/// Wrapper for ElGamal Ciphertext to implement Anchor traits
#[derive(Clone, Copy, Debug, PartialEq, Eq, Pod, Zeroable, AnchorSerialize, AnchorDeserialize)]
#[repr(C)]
pub struct WrappedElGamalCiphertext {
    pub data: [u8; 64],
}

impl Default for WrappedElGamalCiphertext {
    fn default() -> Self {
        Self { data: [0u8; 64] }
    }
}

impl WrappedElGamalCiphertext {
    pub fn as_pod(&self) -> pod::ElGamalCiphertext {
        pod_read_unaligned(&self.data)
    }
}

/// Wrapper for Pedersen Commitment to implement Anchor traits
#[derive(Clone, Copy, Debug, PartialEq, Eq, Pod, Zeroable, AnchorSerialize, AnchorDeserialize)]
#[repr(C)]
pub struct WrappedPedersenCommitment {
    pub data: [u8; 32],
}

impl Default for WrappedPedersenCommitment {
    fn default() -> Self {
        Self { data: [0u8; 32] }
    }
}

impl WrappedPedersenCommitment {
    pub fn as_pod(&self) -> pod::PedersenCommitment {
        pod_read_unaligned(&self.data)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOCAL ZK DATA STRUCTURES (Bypassing "configured out" SDK types)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Clone, Copy, Debug, Pod, Zeroable)]
#[repr(C)]
pub struct LocalTransferPubkeys {
    pub sender_pubkey: pod::ElGamalPubkey,
    pub receiver_pubkey: pod::ElGamalPubkey,
}

#[derive(Clone, Copy, Debug, Pod, Zeroable)]
#[repr(C)]
pub struct LocalTransferProofContext {
    pub ciphertext_lo: pod::ElGamalCiphertext,
    pub ciphertext_hi: pod::ElGamalCiphertext,
    pub transfer_pubkeys: LocalTransferPubkeys,
    pub new_source_ciphertext: pod::ElGamalCiphertext,
}

// ═══════════════════════════════════════════════════════════════════════════════
// RANGE PROOF
// ═══════════════════════════════════════════════════════════════════════════════

/// Range Proof: Proves 0 <= value < 2^64
#[derive(Clone, Debug, AnchorSerialize, AnchorDeserialize)]
pub struct RangeProof {
    /// The commitment being proven
    pub commitment: WrappedPedersenCommitment,
    /// The proof data (serialized SDK RangeProof)
    pub proof: Vec<u8>,
}

impl RangeProof {
    /// Verify a range proof using the SDK
    pub fn verify(&self, zk_program: &AccountInfo) -> Result<()> {
        msg!("Verifying range proof via CPI...");

        // Parse proof data
        let proof_data: pod::RangeProofU64 = pod_read_unaligned(&self.proof);
        
        let range_proof_data = RangeProofU64Data {
            context: RangeProofContext {
                commitment: self.commitment.as_pod(),
            },
            proof: proof_data,
        };

        let ix = zk_token_proof_instruction::verify_range_proof_u64(None, &range_proof_data);
        invoke(&ix, &[zk_program.clone()])?;

        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSFER PROOF
// ═══════════════════════════════════════════════════════════════════════════════

/// Transfer Proof: Proves balance conservation
#[derive(Clone, Debug, AnchorSerialize, AnchorDeserialize)]
pub struct TransferProof {
    /// Commitment to the transfer amount
    pub amount_commitment: WrappedPedersenCommitment,
    /// The proof data (serialized SDK TransferProof)
    pub proof: Vec<u8>,
}

impl TransferProof {
    /// Verify a transfer proof using the SDK
    pub fn verify(
        &self,
        zk_program: &AccountInfo,
        _sender_pubkey: &[u8; 32],
        _receiver_pubkey: &[u8; 32],
        _sender_old_balance: &WrappedElGamalCiphertext,
        _sender_new_balance: &WrappedElGamalCiphertext,
        _receiver_old_balance: &WrappedElGamalCiphertext,
        _receiver_new_balance: &WrappedElGamalCiphertext,
    ) -> Result<()> {
        msg!("Verifying transfer proof via CPI...");
        
        // TransferData in SDK includes all sub-proofs and context.
        // It's meant to be constructed off-chain and passed as a whole.
        let transfer_data: TransferData = pod_read_unaligned(&self.proof);

        let ix = zk_token_proof_instruction::verify_transfer(None, &transfer_data);
        invoke(&ix, &[zk_program.clone()])?;

        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZK VERIFICATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Verify a range proof for a ciphertext
pub fn verify_range_proof(
    zk_program: &AccountInfo,
    _ciphertext: &WrappedElGamalCiphertext,
    proof: &RangeProof,
) -> Result<()> {
    proof.verify(zk_program)?;
    Ok(())
}

/// Verify a transfer proof for encrypted amounts
pub fn verify_transfer_proof(
    zk_program: &AccountInfo,
    sender_pubkey: &[u8; 32],
    receiver_pubkey: &[u8; 32],
    sender_old: &WrappedElGamalCiphertext,
    sender_new: &WrappedElGamalCiphertext,
    receiver_old: &WrappedElGamalCiphertext,
    receiver_new: &WrappedElGamalCiphertext,
    proof: &TransferProof,
) -> Result<()> {
    proof.verify(
        zk_program,
        sender_pubkey,
        receiver_pubkey,
        sender_old,
        sender_new,
        receiver_old,
        receiver_new,
    )?;
    
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR TYPES
// ═══════════════════════════════════════════════════════════════════════════════

#[error_code]
pub enum ZkError {
    #[msg("Value is out of representable range")]
    ValueOutOfRange,
    
    #[msg("Invalid commitment")]
    InvalidCommitment,
    
    #[msg("Invalid public key")]
    InvalidPubkey,
    
    #[msg("Proof generation failed")]
    ProofGenerationFailed,

    #[msg("Invalid proof format")]
    InvalidProofFormat,
    
    #[msg("Proof verification failed")]
    ProofVerificationFailed,

    #[msg("Empty ciphertext not allowed")]
    EmptyCiphertext,
    
    #[msg("Invalid ciphertext")]
    InvalidCiphertext,
}
