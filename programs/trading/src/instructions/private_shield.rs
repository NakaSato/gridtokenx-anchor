//! Shield / unshield: move tokens across the private⇄public boundary.
//!
//! Shield and unshield amounts are PUBLIC (tokens visibly cross the boundary);
//! only `private_transfer` hides amounts. The shielded balance is a Pedersen
//! commitment; shield adds `amount·G`, unshield subtracts it (blinding
//! contribution 0 — blinding accrues through private transfers).
//!
//! FEATURE-GATED (`privacy`). SECURITY: `unshield` is underflow-unsound without a
//! range proof — a user could unshield more than they hold, wrapping the
//! commitment mod l. Phase 2 (ZK ElGamal Proof Program range proofs) closes
//! this; keep `privacy` OFF until then.

use crate::error::TradingError;
use crate::state::PrivateBalance;
use crate::zk_verify;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

#[derive(Accounts)]
pub struct ShieldContext<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = sender,
        token::token_program = token_program,
    )]
    pub user_wallet: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Single shielded-pool vault per mint, owned by the vault authority PDA.
    #[account(
        init_if_needed,
        payer = sender,
        seeds = [b"priv_vault", mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault_authority,
        token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: shielded-pool vault authority PDA — only its key is used.
    #[account(seeds = [b"priv_vault_auth"], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = sender,
        space = PrivateBalance::LEN,
        seeds = [b"priv_bal", sender.key().as_ref(), mint.key().as_ref()],
        bump,
    )]
    pub sender_balance: Box<Account<'info, PrivateBalance>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn shield(ctx: Context<ShieldContext>, amount: u64) -> Result<()> {
    require!(amount > 0, TradingError::InvalidAmount);

    let decimals = ctx.accounts.mint.decimals;
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.user_wallet.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.sender.to_account_info(),
            },
        ),
        amount,
        decimals,
    )?;

    // commitment += amount·G (public deposit, blinding contribution 0).
    let delta = zk_verify::value_times_g(amount).ok_or(TradingError::InvalidBalanceProof)?;
    let balance = &mut ctx.accounts.sender_balance;
    balance.commitment =
        zk_verify::add_commitments(&balance.commitment, &delta).ok_or(TradingError::InvalidBalanceProof)?;
    balance.owner = ctx.accounts.sender.key();
    balance.mint = ctx.accounts.mint.key();
    balance.bump = ctx.bumps.sender_balance;
    Ok(())
}

#[derive(Accounts)]
pub struct UnshieldContext<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = sender,
        token::token_program = token_program,
    )]
    pub user_wallet: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"priv_vault", mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault_authority,
        token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: shielded-pool vault authority PDA — only its key is used.
    #[account(seeds = [b"priv_vault_auth"], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"priv_bal", sender.key().as_ref(), mint.key().as_ref()],
        bump = sender_balance.bump,
    )]
    pub sender_balance: Box<Account<'info, PrivateBalance>>,

    /// CHECK: ZK ElGamal Proof Program range-proof context-state account. The
    /// handler verifies its owner and that its single committed value equals the
    /// post-unshield remaining commitment (C_old − amount·G).
    pub range_proof_context: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn unshield(ctx: Context<UnshieldContext>, amount: u64) -> Result<()> {
    require!(amount > 0, TradingError::InvalidAmount);
    require!(
        amount <= ctx.accounts.vault.amount,
        TradingError::InvalidAmount
    );

    // Post-unshield commitment C_new = C_old − amount·G (amount is public).
    let delta = zk_verify::value_times_g(amount).ok_or(TradingError::InvalidBalanceProof)?;
    let new_commitment = zk_verify::sub_commitments(&ctx.accounts.sender_balance.commitment, &delta)
        .ok_or(TradingError::InvalidBalanceProof)?;

    // Range proof: remaining ∈ [0, 2^64). Without it, amount > balance would wrap
    // C_new mod l. Owner check first, then the proof's single commitment must
    // equal C_new — a caller who over-unshields cannot produce a valid proof.
    require!(
        ctx.accounts.range_proof_context.owner == &zk_verify::ZK_ELGAMAL_PROOF_PROGRAM_ID,
        TradingError::InvalidBalanceProof
    );
    {
        let data = ctx.accounts.range_proof_context.try_borrow_data()?;
        require!(
            zk_verify::verify_single_range_context(&data, &new_commitment),
            TradingError::InvalidBalanceProof
        );
    }
    ctx.accounts.sender_balance.commitment = new_commitment;

    let decimals = ctx.accounts.mint.decimals;
    let authority_seeds = &[b"priv_vault_auth".as_ref(), &[ctx.bumps.vault_authority]];
    let signer = &[&authority_seeds[..]];
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.user_wallet.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer,
        ),
        amount,
        decimals,
    )?;
    Ok(())
}
