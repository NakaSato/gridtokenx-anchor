use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, Burn, MintTo};

use crate::zk_proofs::{WrappedElGamalCiphertext, RangeProof, TransferProof, WrappedPedersenCommitment, ZkTokenProof};
use crate::confidential_ops::{
    verified_shield, verified_unshield, verified_private_transfer, ConfidentialBalance,
    ConfidentialSettlementEvent, BatchConfidentialSettlementEvent,
};
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
    balance.encrypted_balance = WrappedElGamalCiphertext::default();
    balance.balance_commitment = WrappedPedersenCommitment::default();
    balance.pending_credits = 0;
    balance.pending_debits = 0;
    balance.last_update_slot = Clock::get()?.slot;
    balance.bump = ctx.bumps.confidential_balance;
    
    Ok(())
}

/// Shield energy - convert public tokens to confidential balance
pub fn process_shield_energy(
    ctx: Context<ShieldEnergy>,
    amount: u64,
    encrypted_amount: WrappedElGamalCiphertext,
    proof: RangeProof, // Proves that amount matches encrypted_amount
) -> Result<()> {
    require!(amount > 0, TradingError::InvalidAmount);
    
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
    
    // Call verified logic
    let balance = &mut ctx.accounts.confidential_balance;
    verified_shield(
        &ctx.accounts.zk_token_proof_program.to_account_info(),
        balance, 
        amount, 
        encrypted_amount, 
        proof
    )?;
    
    Ok(())
}

/// Unshield energy - convert confidential balance back to public tokens
pub fn process_unshield_energy(
    ctx: Context<UnshieldEnergy>,
    amount: u64,
    new_encrypted_amount: WrappedElGamalCiphertext,
    proof: TransferProof, // Proves: old_encrypted - amount = new_encrypted
) -> Result<()> {
    require!(amount > 0, TradingError::InvalidAmount);
    
    // Call verified logic first (checks proof and balance)
    let balance = &mut ctx.accounts.confidential_balance;
    
    // Deriving a "difference" encryption for the withdrawal amount
    // In SDK, we'd normally decrypt or use a specific unshielding proof
    let encrypted_diff = WrappedElGamalCiphertext::default(); 
    
    verified_unshield(balance, amount, encrypted_diff, new_encrypted_amount, proof)?;
    
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
    
    Ok(())
}

/// Private Transfer - Send encrypted tokens between confidential accounts
pub fn process_private_transfer(
    ctx: Context<PrivateTransfer>,
    _amount: u64,
    encrypted_amount: WrappedElGamalCiphertext,
    proof: TransferProof,
) -> Result<()> {
    let sender = &mut ctx.accounts.sender_balance;
    let receiver = &mut ctx.accounts.receiver_balance;
    
    // Extract public keys for the proof
    let sender_owner = sender.owner.to_bytes();
    let receiver_owner = ctx.accounts.receiver_owner.key().to_bytes();
    
    verified_private_transfer(
        &ctx.accounts.zk_token_proof_program.to_account_info(),
        &sender_owner,
        &receiver_owner,
        sender,
        receiver,
        encrypted_amount,
        proof
    )?;
    
    Ok(())
}

/// Execute a confidential settlement between a buyer and seller
/// payment is confidential (ZK), energy is public (SPL)
pub fn process_execute_confidential_settlement(
    ctx: Context<ExecuteConfidentialSettlement>,
    amount: u64,
    _price: u64, // Price matched by gateway
    _encrypted_amount: WrappedElGamalCiphertext,
    proof: TransferProof,
) -> Result<()> {
    let mut buy_order = ctx.accounts.buy_order.load_mut()?;
    let mut sell_order = ctx.accounts.sell_order.load_mut()?;
    let _clock = Clock::get()?;

    // 1. Validation (Matched logic from public settlement)
    require!(amount > 0, TradingError::InvalidAmount);
    require!(
        buy_order.status == crate::state::OrderStatus::Active as u8 || 
        buy_order.status == crate::state::OrderStatus::PartiallyFilled as u8,
        TradingError::InactiveBuyOrder
    );
    require!(
        sell_order.status == crate::state::OrderStatus::Active as u8 || 
        sell_order.status == crate::state::OrderStatus::PartiallyFilled as u8,
        TradingError::InactiveSellOrder
    );

    // 2. CONFIDENTIAL PAYMENT (Buyer -> Seller)
    let sender = &mut ctx.accounts.buyer_confidential_balance;
    let receiver = &mut ctx.accounts.seller_confidential_balance;
    
    let sender_owner = sender.owner.to_bytes();
    let receiver_owner = receiver.owner.to_bytes();

    verified_private_transfer(
        &ctx.accounts.zk_token_proof_program.to_account_info(),
        &sender_owner,
        &receiver_owner,
        sender,
        receiver,
        _encrypted_amount,
        proof
    )?;

    // 3. PUBLIC ENERGY TRANSFER (Seller Escrow -> Buyer)
    let cpi_accounts = token_interface::TransferChecked {
        from: ctx.accounts.seller_energy_escrow.to_account_info(),
        mint: ctx.accounts.energy_mint.to_account_info(),
        to: ctx.accounts.buyer_energy_account.to_account_info(),
        authority: ctx.accounts.escrow_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    token_interface::transfer_checked(
        CpiContext::new(cpi_program, cpi_accounts), 
        amount,
        ctx.accounts.energy_mint.decimals
    )?;

    // 4. Update Order State
    buy_order.filled_amount += amount;
    sell_order.filled_amount += amount;

    if buy_order.filled_amount >= buy_order.amount {
        buy_order.status = crate::state::OrderStatus::Completed as u8;
    } else {
        buy_order.status = crate::state::OrderStatus::PartiallyFilled as u8;
    }

    if sell_order.filled_amount >= sell_order.amount {
        sell_order.status = crate::state::OrderStatus::Completed as u8;
    } else {
        sell_order.status = crate::state::OrderStatus::PartiallyFilled as u8;
    }

    // Emit event for off-chain tracking
    emit!(ConfidentialSettlementEvent {
        buyer: buy_order.buyer,
        seller: sell_order.seller,
        energy_amount: amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!("Executed confidential settlement for {} energy tokens", amount);
    Ok(())
}

/// Execute a confidential settlement for an auction trade
pub fn process_execute_confidential_auction_settlement(
    ctx: Context<ExecuteConfidentialAuctionSettlement>,
    amount: u64,
    price: u64,
    _encrypted_amount: WrappedElGamalCiphertext,
    proof: TransferProof,
) -> Result<()> {
    let batch = ctx.accounts.batch.load_mut()?;
    let batch_id_bytes = batch.batch_id.to_le_bytes();
    let market_key = batch.market;
    let batch_bump = batch.bump;
    
    // 1. Validation
    require!(batch.state == crate::auction::AuctionState::Cleared as u8, crate::auction::AuctionError::AuctionNotReady);
    require!(price == batch.clearing_price, crate::auction::AuctionError::PriceMismatch);

    // Optional: Check if either party submitted a confidential order
    // This connects the ZK settlement back to the encrypted auction participation.
    let mut buyer_found = false;
    let mut seller_found = false;
    let buyer_key = ctx.accounts.buyer_owner.key();
    let seller_key = ctx.accounts.seller_owner.key();

    for i in 0..batch.confidential_order_count as usize {
        let order = &batch.confidential_orders[i];
        if order.order_id == buyer_key && order.is_bid == 1 {
            buyer_found = true;
        }
        if order.order_id == seller_key && order.is_bid == 0 {
            seller_found = true;
        }
    }
    
    // In a fully confidential auction, we'd require these to be true.
    // For MVP/Hybrid, we log status but keep matching flexible.
    if buyer_found { msg!("Verified Buyer participation in confidential auction"); }
    if seller_found { msg!("Verified Seller participation in confidential auction"); }

    // Drop the batch reference before CPI calls to avoid "already borrowed" errors
    drop(batch);

    // 2. CONFIDENTIAL PAYMENT (Buyer -> Seller)
    // Even though the amount is known from the auction, moving it between 
    // confidential balances hides the total remaining wealth of both parties.
    let sender = &mut ctx.accounts.buyer_confidential_balance;
    let receiver = &mut ctx.accounts.seller_confidential_balance;
    
    let sender_owner = sender.owner.to_bytes();
    let receiver_owner = receiver.owner.to_bytes();

    verified_private_transfer(
        &ctx.accounts.zk_token_proof_program.to_account_info(),
        &sender_owner,
        &receiver_owner,
        sender,
        receiver,
        _encrypted_amount,
        proof
    )?;

    // 3. PUBLIC ENERGY TRANSFER (Vault -> Buyer)
    let batch_seeds = &[
        b"auction",
        market_key.as_ref(),
        batch_id_bytes.as_ref(),
        &[batch_bump],
    ];
    let signer_seeds = &[&batch_seeds[..]];

    let cpi_accounts = token_interface::TransferChecked {
        from: ctx.accounts.seller_energy_vault.to_account_info(),
        mint: ctx.accounts.energy_mint.to_account_info(),
        to: ctx.accounts.buyer_energy_account.to_account_info(),
        authority: ctx.accounts.batch.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    token_interface::transfer_checked(
        CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds), 
        amount,
        ctx.accounts.energy_mint.decimals
    )?;

    // Note: If the buyer had public collateral in the vault, it should be refunded 
    // or adjusted here. For this MVP, we assume the payment is done purely via ZK.
    
    msg!("Executed confidential auction settlement for {} tokens", amount);
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
    pub zk_token_proof_program: Program<'info, ZkTokenProof>,
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
    pub zk_token_proof_program: Program<'info, ZkTokenProof>,
}

#[derive(Accounts)]
pub struct ExecuteConfidentialAuctionSettlement<'info> {
    #[account(mut)]
    pub batch: AccountLoader<'info, crate::auction::AuctionBatch>,

    #[account(
        mut,
        seeds = [b"confidential_balance", buyer_owner.key().as_ref(), mint.key().as_ref()],
        bump = buyer_confidential_balance.bump,
    )]
    pub buyer_confidential_balance: Account<'info, ConfidentialBalance>,

    #[account(
        mut,
        seeds = [b"confidential_balance", seller_owner.key().as_ref(), mint.key().as_ref()],
        bump = seller_confidential_balance.bump,
    )]
    pub seller_confidential_balance: Account<'info, ConfidentialBalance>,

    /// CHECK: Buyer's owner address
    pub buyer_owner: AccountInfo<'info>,
    /// CHECK: Seller's owner address
    pub seller_owner: AccountInfo<'info>,

    /// CHECK: Seller's energy in the auction vault
    #[account(mut)]
    pub seller_energy_vault: AccountInfo<'info>,

    /// CHECK: Buyer's energy account (destination)
    #[account(mut)]
    pub buyer_energy_account: AccountInfo<'info>,

    pub energy_mint: InterfaceAccount<'info, token_interface::Mint>,
    pub mint: InterfaceAccount<'info, Mint>, // Currency mint
    
    pub token_program: Interface<'info, token_interface::TokenInterface>,
    pub zk_token_proof_program: Program<'info, ZkTokenProof>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteConfidentialSettlement<'info> {
    #[account(mut)]
    pub market: AccountLoader<'info, crate::state::Market>,

    #[account(mut)]
    pub buy_order: AccountLoader<'info, crate::state::Order>,

    #[account(mut)]
    pub sell_order: AccountLoader<'info, crate::state::Order>,

    #[account(
        mut,
        seeds = [b"confidential_balance", buy_order.load()?.buyer.as_ref(), mint.key().as_ref()],
        bump = buyer_confidential_balance.bump,
    )]
    pub buyer_confidential_balance: Account<'info, ConfidentialBalance>,

    #[account(
        mut,
        seeds = [b"confidential_balance", sell_order.load()?.seller.as_ref(), mint.key().as_ref()],
        bump = seller_confidential_balance.bump,
    )]
    pub seller_confidential_balance: Account<'info, ConfidentialBalance>,

    /// CHECK: Seller's token account for energy (Escrow)
    #[account(mut)]
    pub seller_energy_escrow: AccountInfo<'info>,

    /// CHECK: Buyer's token account for energy (receiver)
    #[account(mut)]
    pub buyer_energy_account: AccountInfo<'info>,

    pub energy_mint: InterfaceAccount<'info, token_interface::Mint>,
    pub mint: InterfaceAccount<'info, Mint>, // Currency mint

    pub escrow_authority: Signer<'info>, // API Authority that owns escrows
    
    pub token_program: Interface<'info, token_interface::TokenInterface>,
    pub zk_token_proof_program: Program<'info, ZkTokenProof>,
    pub system_program: Program<'info, System>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH CONFIDENTIAL SETTLEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/// A single settlement item in a batch
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BatchSettlementItem {
    pub amount: u64,
    pub encrypted_amount: WrappedElGamalCiphertext,
    pub proof: TransferProof,
}

/// Execute multiple confidential settlements in a single transaction
/// This optimizes compute usage by batching ZK proof verifications
pub fn process_execute_batch_confidential_settlement(
    ctx: Context<ExecuteBatchConfidentialSettlement>,
    settlements: Vec<BatchSettlementItem>,
) -> Result<()> {
    require!(!settlements.is_empty(), TradingError::EmptyBatch);
    require!(settlements.len() <= 5, TradingError::BatchTooLarge);

    let mut total_energy = 0u64;
    
    // Process each settlement
    for (i, settlement) in settlements.iter().enumerate() {
        msg!("Processing batch settlement {} of {}", i + 1, settlements.len());
        
        let sender = &mut ctx.accounts.sender_confidential_balance;
        let receiver = &mut ctx.accounts.receiver_confidential_balance;
        
        let sender_owner = sender.owner.to_bytes();
        let receiver_owner = receiver.owner.to_bytes();

        // Verify the ZK proof for this settlement
        verified_private_transfer(
            &ctx.accounts.zk_token_proof_program.to_account_info(),
            &sender_owner,
            &receiver_owner,
            sender,
            receiver,
            settlement.encrypted_amount,
            settlement.proof.clone(),
        )?;
        
        total_energy = total_energy.checked_add(settlement.amount)
            .ok_or(TradingError::Overflow)?;
    }

    // Emit batch event
    emit!(BatchConfidentialSettlementEvent {
        num_settlements: settlements.len() as u8,
        total_energy,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!("Completed batch confidential settlement: {} settlements, {} total energy", 
        settlements.len(), total_energy);
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteBatchConfidentialSettlement<'info> {
    #[account(
        mut,
        seeds = [b"confidential_balance", authority.key().as_ref(), mint.key().as_ref()],
        bump = sender_confidential_balance.bump,
    )]
    pub sender_confidential_balance: Account<'info, ConfidentialBalance>,

    #[account(
        mut,
        seeds = [b"confidential_balance", receiver_owner.key().as_ref(), mint.key().as_ref()],
        bump = receiver_confidential_balance.bump,
    )]
    pub receiver_confidential_balance: Account<'info, ConfidentialBalance>,

    /// CHECK: Receiver's owner address
    pub receiver_owner: AccountInfo<'info>,

    pub mint: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub zk_token_proof_program: Program<'info, ZkTokenProof>,
    pub system_program: Program<'info, System>,
}
