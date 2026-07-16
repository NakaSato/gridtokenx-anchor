use crate::error::TradingError;
use crate::state::{PrivacyNullifier, PrivateBalance};
use crate::zk_verify;
use anchor_lang::prelude::*;
use solana_curve25519::ristretto::{add_ristretto, PodRistrettoPoint};

/// Okamoto proof of knowledge of the amount commitment's opening.
/// `challenge` = c, `response` = z_v ‖ z_r. Produced by wasm-zk
/// `create_transfer_proof`; verified by `zk_verify::verify_balance_proof`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BalanceProof {
    pub challenge: [u8; 32],
    pub response: [u8; 64],
}

#[derive(Accounts)]
#[instruction(nullifier: [u8; 32])]
pub struct PrivateTransferContext<'info> {
    /// Sender's shielded balance. Must already exist (created by a `shield`
    /// step — Phase 2). `commitment` is the current `C_old`.
    #[account(
        mut,
        seeds = [b"priv_bal", sender.key().as_ref(), mint.key().as_ref()],
        bump = sender_balance.bump,
    )]
    pub sender_balance: Account<'info, PrivateBalance>,

    /// Recipient's shielded balance, created on first credit. A fresh account's
    /// zeroed `commitment` is the identity point, so the homomorphic add is
    /// correct even on init.
    #[account(
        init_if_needed,
        payer = sender,
        space = PrivateBalance::LEN,
        seeds = [b"priv_bal", recipient.key().as_ref(), mint.key().as_ref()],
        bump,
    )]
    pub recipient_balance: Account<'info, PrivateBalance>,

    /// Replay guard: init fails if this nullifier was already spent.
    #[account(
        init,
        payer = sender,
        space = PrivacyNullifier::LEN,
        seeds = [b"priv_null", nullifier.as_ref()],
        bump,
    )]
    pub nullifier_pda: Account<'info, PrivacyNullifier>,

    /// CHECK: recipient pubkey, used only for PDA derivation. Must differ from
    /// the sender: if equal, sender_balance and recipient_balance are the SAME
    /// PDA and the debit/credit double-write would create value. Anchor already
    /// rejects that with ConstraintDuplicateMutableAccount (2040); this explicit
    /// constraint is defense-in-depth with a domain-specific error, so the
    /// invariant does not silently depend on framework behavior.
    #[account(constraint = recipient.key() != sender.key() @ TradingError::SelfTransferNotAllowed)]
    pub recipient: UncheckedAccount<'info>,
    /// CHECK: mint pubkey, used only for PDA derivation.
    pub mint: UncheckedAccount<'info>,

    /// CHECK: ZK ElGamal Proof Program range-proof context-state account. The
    /// handler verifies both its owner (the proof program) and that its
    /// committed values are exactly C_amt and C_new (see zk_verify).
    pub range_proof_context: UncheckedAccount<'info>,

    #[account(mut)]
    pub sender: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Shielded transfer of a hidden `amount` from sender to recipient (Phase 1).
///
/// SECURITY: verifies conservation + the balance PoK only. Range proofs are NOT
/// verified here (see zk_verify.rs) — do not enable `privacy` on mainnet until
/// Phase 2 wires them.
pub fn private_transfer(
    ctx: Context<PrivateTransferContext>,
    _nullifier: [u8; 32],
    amount_commitment: [u8; 32],
    sender_new_commitment: [u8; 32],
    balance_proof: BalanceProof,
) -> Result<()> {
    let c_old = ctx.accounts.sender_balance.commitment;

    // 1. Conservation: C_old == C_amt + C_new.
    require!(
        zk_verify::verify_conservation(&c_old, &amount_commitment, &sender_new_commitment),
        TradingError::InvalidBalanceProof
    );
    // 2. Sender knows the opening of C_amt.
    require!(
        zk_verify::verify_balance_proof(
            &amount_commitment,
            &balance_proof.challenge,
            &balance_proof.response,
        ),
        TradingError::InvalidBalanceProof
    );
    // 3. Range proofs (amount, remaining ∈ [0, 2^64)) — enforced via the ZK
    //    ElGamal Proof Program context-state account. Owner check first (a
    //    matching layout under another owner proves nothing), then the committed
    //    values must be exactly C_amt and C_new. This closes the underflow hole:
    //    without it a sender could pick amount > balance so remaining wraps.
    require!(
        ctx.accounts.range_proof_context.owner == &zk_verify::ZK_ELGAMAL_PROOF_PROGRAM_ID,
        TradingError::InvalidBalanceProof
    );
    {
        let data = ctx.accounts.range_proof_context.try_borrow_data()?;
        require!(
            zk_verify::verify_range_context(&data, &amount_commitment, &sender_new_commitment),
            TradingError::InvalidBalanceProof
        );
    }

    // 4. Debit sender (replace with C_new) and credit recipient (C += C_amt).
    ctx.accounts.sender_balance.commitment = sender_new_commitment;

    let recipient = &mut ctx.accounts.recipient_balance;
    let credited = add_ristretto(
        &PodRistrettoPoint(recipient.commitment),
        &PodRistrettoPoint(amount_commitment),
    )
    .ok_or(TradingError::InvalidBalanceProof)?;
    recipient.commitment = credited.0;
    recipient.owner = ctx.accounts.recipient.key();
    recipient.mint = ctx.accounts.mint.key();
    recipient.bump = ctx.bumps.recipient_balance;

    ctx.accounts.nullifier_pda.bump = ctx.bumps.nullifier_pda;
    Ok(())
}
