use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    Mint as MintInterface, TokenAccount as TokenAccountInterface, TokenInterface,
};

use crate::error::TreasuryError;
use crate::state::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<Treasury>(),
        seeds = [b"treasury"],
        bump,
    )]
    pub treasury: AccountLoader<'info, Treasury>,

    /// GRX SPL mint (owned by the energy-token program).
    pub grx_mint: Box<InterfaceAccount<'info, MintInterface>>,

    /// THBG stablecoin mint, created here with the treasury PDA as mint authority.
    #[account(
        init,
        payer = authority,
        seeds = [b"thbg_mint"],
        bump,
        mint::decimals = THBG_DECIMALS,
        mint::authority = treasury,
        mint::token_program = token_program,
    )]
    pub thbg_mint: Box<InterfaceAccount<'info, MintInterface>>,

    /// GRX received from swaps (peg collateral source for redemptions).
    #[account(
        init,
        payer = authority,
        seeds = [b"swap_vault"],
        bump,
        token::mint = grx_mint,
        token::authority = treasury,
        token::token_program = token_program,
    )]
    pub swap_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// GRX held in custody for stakers (NEVER backs the peg).
    #[account(
        init,
        payer = authority,
        seeds = [b"stake_vault"],
        bump,
        token::mint = grx_mint,
        token::authority = treasury,
        token::token_program = token_program,
    )]
    pub stake_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// GRX reward pool paid out to stakers.
    #[account(
        init,
        payer = authority,
        seeds = [b"reward_vault"],
        bump,
        token::mint = grx_mint,
        token::authority = treasury,
        token::token_program = token_program,
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Bootstrap the treasury: config PDA, the THBG mint (authority = treasury PDA),
/// and the three GRX vaults (swap collateral, stake custody, reward pool).
pub fn initialize(
    ctx: Context<Initialize>,
    attestor: Pubkey,
    settlement_recorder: Pubkey,
    grx_per_thbg_rate: u64,
    swap_fee_bps: u16,
    attestation_ttl: i64,
) -> Result<()> {
    require!(swap_fee_bps <= 10_000, TreasuryError::InvalidFeeBps);
    let now = Clock::get()?.unix_timestamp;
    let mut t = ctx.accounts.treasury.load_init()?;
    t.acc_reward_per_share = 0;
    t.authority = ctx.accounts.authority.key();
    t.attestor = attestor;
    t.grx_mint = ctx.accounts.grx_mint.key();
    t.thbg_mint = ctx.accounts.thbg_mint.key();
    t.settlement_recorder = settlement_recorder;
    t.attested_reserve = 0;
    t.attestation_ts = 0;
    t.attestation_ttl = attestation_ttl;
    t.thbg_supply = 0;
    t.grx_per_thbg_rate = grx_per_thbg_rate;
    t.total_staked = 0;
    t.reward_pool = 0;
    t.created_at = now;
    t.total_settled_thbg = 0;
    t.swap_fee_bps = swap_fee_bps;
    t.paused = 0;
    t.bump = ctx.bumps.treasury;
    t.thbg_mint_bump = ctx.bumps.thbg_mint;
    t.swap_vault_bump = ctx.bumps.swap_vault;
    t.stake_vault_bump = ctx.bumps.stake_vault;
    t.reward_vault_bump = ctx.bumps.reward_vault;
    Ok(())
}
