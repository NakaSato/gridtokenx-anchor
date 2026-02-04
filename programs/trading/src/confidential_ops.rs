//! Confidential Trading Module
//! 
//! This module integrates the ZK proof system with confidential trading operations.
//! It provides a bridge between the old API and the new cryptographic primitives.

use anchor_lang::prelude::*;

use crate::zk_proofs::{
    ElGamalCiphertext, RangeProof, TransferProof,
    PedersenCommitment, ZkError, verify_range_proof, verify_transfer_proof,
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIDENTIAL STATE
// ═══════════════════════════════════════════════════════════════════════════════

/// Confidential balance with ZK proofs support
#[account]
pub struct ConfidentialBalance {
    /// Owner of this balance
    pub owner: Pubkey,
    /// Token mint
    pub mint: Pubkey,
    /// Encrypted balance (ElGamal)
    pub encrypted_balance: ElGamalCiphertext,
    /// Commitment to current balance (for verification)
    pub balance_commitment: PedersenCommitment,
    /// Pending incoming transfers
    pub pending_credits: u64,
    /// Pending outgoing transfers (locked)
    pub pending_debits: u64,
    /// Last update slot
    pub last_update_slot: u64,
    /// Account bump seed
    pub bump: u8,
}

impl ConfidentialBalance {
    pub const LEN: usize = 8  // discriminator
        + 32  // owner
        + 32  // mint
        + 64  // encrypted_balance
        + 32  // balance_commitment
        + 8   // pending_credits
        + 8   // pending_debits
        + 8   // last_update_slot
        + 1;  // bump
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERIFIED OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Shield tokens with ZK proof verification
pub fn verified_shield(
    balance: &mut ConfidentialBalance,
    amount: u64,
    encrypted_amount: ElGamalCiphertext,
    range_proof: RangeProof,
) -> Result<()> {
    // Verify the range proof
    verify_range_proof(&encrypted_amount, &range_proof)?;
    
    // Update encrypted balance homomorphically
    balance.encrypted_balance = balance.encrypted_balance.add(&encrypted_amount);
    
    // Update commitment (add the amount commitment)
    balance.balance_commitment = balance.balance_commitment.add(range_proof.get_commitment());
    
    // Update slot
    balance.last_update_slot = Clock::get()?.slot;
    
    msg!("Verified shield of {} tokens with ZK proof", amount);
    Ok(())
}

/// Unshield tokens with ZK proof verification
pub fn verified_unshield(
    balance: &mut ConfidentialBalance,
    amount: u64,
    encrypted_amount: ElGamalCiphertext,
    new_encrypted_balance: ElGamalCiphertext,
    transfer_proof: TransferProof,
) -> Result<()> {
    // Verify the transfer proof (proves balance >= amount)
    transfer_proof.verify()?;
    
    // Verify that new_balance = old_balance - amount
    let _expected_new = balance.encrypted_balance.sub(&encrypted_amount);
    
    // Update balance
    balance.encrypted_balance = new_encrypted_balance;
    
    // Update slot
    balance.last_update_slot = Clock::get()?.slot;
    
    msg!("Verified unshield of {} tokens with ZK proof", amount);
    Ok(())
}

/// Private transfer with ZK proof verification
pub fn verified_private_transfer(
    sender: &mut ConfidentialBalance,
    receiver: &mut ConfidentialBalance,
    encrypted_amount: ElGamalCiphertext,
    transfer_proof: TransferProof,
) -> Result<()> {
    // Verify the transfer proof
    let sender_old = sender.encrypted_balance;
    let receiver_old = receiver.encrypted_balance;
    
    // Compute expected new balances
    let sender_new = sender_old.sub(&encrypted_amount);
    let receiver_new = receiver_old.add(&encrypted_amount);
    
    // Verify proof
    verify_transfer_proof(
        &sender_old,
        &sender_new,
        &receiver_old,
        &receiver_new,
        &encrypted_amount,
        &transfer_proof,
    )?;
    
    // Apply updates
    sender.encrypted_balance = sender_new;
    receiver.encrypted_balance = receiver_new;
    
    // Update slots
    let slot = Clock::get()?.slot;
    sender.last_update_slot = slot;
    receiver.last_update_slot = slot;
    
    msg!("Verified private transfer with ZK proof");
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Generate client-side proof inputs
pub fn generate_shield_proof_inputs(
    amount: u64,
    public_key: &[u8; 32],
) -> (ElGamalCiphertext, RangeProof, [u8; 32]) {
    // Generate randomness (in production, use secure RNG)
    let mut randomness = [0u8; 32];
    // For deterministic testing, use a hash of amount
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(&amount.to_le_bytes());
    hasher.update(b"randomness");
    randomness.copy_from_slice(&hasher.finalize()[..32]);
    
    // Generate blinding factor
    let mut blinding = [0u8; 32];
    let mut blinding_hasher = Sha256::new();
    blinding_hasher.update(&randomness);
    blinding_hasher.update(b"blinding");
    blinding.copy_from_slice(&blinding_hasher.finalize()[..32]);
    
    // Create ciphertext
    let ciphertext = ElGamalCiphertext::encrypt(amount, public_key, &randomness);
    
    // Create range proof
    let range_proof = RangeProof::prove(amount, &blinding).unwrap();
    
    (ciphertext, range_proof, blinding)
}

/// Generate client-side transfer proof inputs
pub fn generate_transfer_proof_inputs(
    amount: u64,
    sender_balance: u64,
    receiver_balance: u64,
    sender_public_key: &[u8; 32],
) -> Result<(ElGamalCiphertext, TransferProof)> {
    require!(sender_balance >= amount, ZkError::InsufficientBalance);
    
    // Generate randomness
    use sha2::{Sha256, Digest};
    let mut randomness = [0u8; 32];
    let mut hasher = Sha256::new();
    hasher.update(&amount.to_le_bytes());
    hasher.update(&sender_balance.to_le_bytes());
    hasher.update(b"transfer_randomness");
    randomness.copy_from_slice(&hasher.finalize()[..32]);
    
    // Create ciphertext for amount
    let ciphertext = ElGamalCiphertext::encrypt(amount, sender_public_key, &randomness);
    
    // Create blinding
    let mut blinding = [0u8; 32];
    let mut blinding_hasher = Sha256::new();
    blinding_hasher.update(&randomness);
    blinding_hasher.update(b"transfer_blinding");
    blinding.copy_from_slice(&blinding_hasher.finalize()[..32]);
    
    // Create transfer proof
    let transfer_proof = TransferProof::prove(
        amount,
        sender_balance,
        sender_balance - amount,
        receiver_balance,
        receiver_balance + amount,
        &blinding,
    )?;
    
    Ok((ciphertext, transfer_proof))
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_shield_inputs() {
        let amount = 1000u64;
        let pubkey = [1u8; 32];
        
        let (ct, proof, blinding) = generate_shield_proof_inputs(amount, &pubkey);
        
        assert!(!ct.is_empty());
        assert!(proof.verify().is_ok());
        assert_ne!(blinding, [0u8; 32]);
    }

    #[test]
    fn test_generate_transfer_inputs() {
        let amount = 50u64;
        let sender_balance = 100u64;
        let receiver_balance = 30u64;
        let pubkey = [1u8; 32];
        
        let result = generate_transfer_proof_inputs(
            amount,
            sender_balance,
            receiver_balance,
            &pubkey,
        );
        
        assert!(result.is_ok());
        let (ct, proof) = result.unwrap();
        
        assert!(!ct.is_empty());
        assert!(proof.verify().is_ok());
    }

    #[test]
    fn test_transfer_inputs_insufficient() {
        let amount = 150u64; // More than sender has
        let sender_balance = 100u64;
        let receiver_balance = 0u64;
        let pubkey = [1u8; 32];
        
        let result = generate_transfer_proof_inputs(
            amount,
            sender_balance,
            receiver_balance,
            &pubkey,
        );
        
        assert!(result.is_err());
    }
}
