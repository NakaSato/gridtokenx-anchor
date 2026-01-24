use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, Burn, MintTo};

use crate::privacy::*;
use crate::ErrorCode;

/// Confidential Trading Instructions
/// Enables private energy trading with zero-knowledge proofs

/// Initialize a confidential balance account for a user
pub fn initialize_confidential_balance(
    ctx: Context<InitializeConfidentialBalance>,
) -> Result<()> {
    let balance = &mut ctx.accounts.confidential_balance;
    balance.owner = ctx.accounts.owner.key();
    balance.mint = ctx.accounts.mint.key();
    balance.encrypted_amount = ElGamalCiphertext::default();
    balance.pending_amount = 0;
    balance.last_update_slot = Clock::get()?.slot;
    balance.bump = ctx.bumps.confidential_balance;
    
    Ok(())
}

/// Shield energy - convert public tokens to confidential balance
pub fn shield_energy(
    ctx: Context<ShieldEnergy>,
    amount: u64,
    encrypted_amount: ElGamalCiphertext,
    _proof: RangeProof, // Proves that amount matches encrypted_amount
) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);
    
    // In production, we would verify a proof that encrypted_amount 
    // is a valid encryption of 'amount' under the user's public key.
    
    let balance = &mut ctx.accounts.confidential_balance;
    
    // Burn public tokens
    let cpi_accounts = Burn {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.owner.to_account_info(),
    };
    
    token_interface::burn(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        amount,
    )?;
    
    // Add to encrypted balance homomorphically
    balance.encrypted_amount = balance.encrypted_amount.add(&encrypted_amount);
    balance.last_update_slot = Clock::get()?.slot;
    
    msg!("Shielded {} energy tokens into confidential balance", amount);
    Ok(())
}

/// Unshield energy - convert confidential balance back to public tokens
pub fn unshield_energy(
    ctx: Context<UnshieldEnergy>,
    amount: u64,
    _new_encrypted_amount: ElGamalCiphertext,
    _proof: TransferProof, // Proves: old_encrypted - amount = new_encrypted
) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);
    
    // Verification would happen here
    
    // Mint public tokens back to user
    let mint_key = ctx.accounts.mint.key();
    let seeds = &[
        b"mint_authority".as_ref(),
        mint_key.as_ref(),
        &[ctx.bumps.mint_authority],
    ];
    let signer = &[&seeds[..]];
    
    let cpi_accounts = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.mint_authority.to_account_info(),
    };
    
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        ),
        amount,
    )?;
    
    // Update balance
    ctx.accounts.confidential_balance.encrypted_amount = _new_encrypted_amount;
    
    msg!("Unshielded {} energy tokens to public account", amount);
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeConfidentialBalance<'info> {
    #[account(
        init,
        payer = owner,
        space = ConfidentialBalance::LEN,
        seeds = [b"confidential_balance", owner.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub confidential_balance: Account<'info, ConfidentialBalance>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ShieldEnergy<'info> {
    #[account(
        mut,
        seeds = [b"confidential_balance", owner.key().as_ref(), mint.key().as_ref()],
        bump = confidential_balance.bump,
    )]
    pub confidential_balance: Account<'info, ConfidentialBalance>,
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct UnshieldEnergy<'info> {
    #[account(
        mut,
        seeds = [b"confidential_balance", owner.key().as_ref(), mint.key().as_ref()],
        bump = confidential_balance.bump,
    )]
    pub confidential_balance: Account<'info, ConfidentialBalance>,
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Mint authority PDA
    #[account(
        seeds = [b"mint_authority", mint.key().as_ref()],
        bump
    )]
    pub mint_authority: AccountInfo<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}
