use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, Burn, MintTo};

use crate::privacy::*;
use crate::TradingError;

/// Confidential Trading Instructions
/// Enables private energy trading with zero-knowledge proofs

/// Initialize a confidential balance account for a user
pub fn process_initialize_confidential_balance(
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
pub fn process_shield_energy(
    ctx: Context<ShieldEnergy>,
    amount: u64,
    encrypted_amount: ElGamalCiphertext,
    _proof: RangeProof, // Proves that amount matches encrypted_amount
) -> Result<()> {
    require!(amount > 0, TradingError::InvalidAmount);
    
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
pub fn process_unshield_energy(
    ctx: Context<UnshieldEnergy>,
    amount: u64,
    _new_encrypted_amount: ElGamalCiphertext,
    _proof: TransferProof, // Proves: old_encrypted - amount = new_encrypted
) -> Result<()> {
    require!(amount > 0, TradingError::InvalidAmount);
    
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

/// Private Transfer - Send encrypted tokens between confidential accounts
pub fn process_private_transfer(
    ctx: Context<PrivateTransfer>,
    amount: u64, // The amount is hidden in the proof, but for MVP we pass it to verify against proof commitments if needed, or if the proof is stubbed
    encrypted_amount: ElGamalCiphertext, // The encrypted transfer amount
    _proof: TransferProof, // Proves old_A - amount = new_A, old_B + amount = new_B, and amount > 0
) -> Result<()> {
    
    // In production: Verification of the Transfer Proof
    // verify_transfer_proof(...)
    
    let sender = &mut ctx.accounts.sender_balance;
    let receiver = &mut ctx.accounts.receiver_balance;
    
    // Homomorphic Subtraction from Sender
    sender.encrypted_amount = sender.encrypted_amount.sub(&encrypted_amount);
    
    // Homomorphic Addition to Receiver
    receiver.encrypted_amount = receiver.encrypted_amount.add(&encrypted_amount);
    
    sender.last_update_slot = Clock::get()?.slot;
    receiver.last_update_slot = Clock::get()?.slot;
    
    msg!("Executed private transfer of encrypted energy");
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

#[derive(Accounts)]
pub struct PrivateTransfer<'info> {
    #[account(
        mut,
        seeds = [b"confidential_balance", owner.key().as_ref(), mint.key().as_ref()],
        bump = sender_balance.bump,
    )]
    pub sender_balance: Account<'info, ConfidentialBalance>,
    
    #[account(
        mut,
        seeds = [b"confidential_balance", receiver_owner.key().as_ref(), mint.key().as_ref()],
        bump = receiver_balance.bump,
    )]
    pub receiver_balance: Account<'info, ConfidentialBalance>,
    
    /// CHECK: Receiver owner address for seed validation
    pub receiver_owner: AccountInfo<'info>,
    
    /// CHECK: Mint for seed derivation
    pub mint: AccountInfo<'info>,
    
    #[account(mut)]
    pub owner: Signer<'info>, // Sender owner
}
