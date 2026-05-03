use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey::Pubkey;

const ED25519_ID: Pubkey = Pubkey::new_from_array([
    1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]); // Placeholder, will fix if needed

const IX_ID: Pubkey = Pubkey::new_from_array([
    6, 167, 213, 23, 25, 44, 92, 142, 224, 137, 211, 236, 12, 137, 234, 123, 14, 153, 162, 115, 140,
    201, 192, 141, 160, 23, 138, 203, 166, 131, 11, 138,
]);

fn load_instruction_at_checked(
    index: usize,
    sysvar_info: &AccountInfo,
) -> Result<anchor_lang::solana_program::instruction::Instruction> {
    if sysvar_info.key != &IX_ID {
        return Err(ProgramError::IncorrectProgramId.into());
    }
    
    let data = sysvar_info.try_borrow_data()?;
    let num_instructions = u16::from_le_bytes(data[0..2].try_into().map_err(|_| ProgramError::InvalidInstructionData)?);
    if index >= num_instructions as usize {
        return Err(ProgramError::InvalidInstructionData.into());
    }
    
    let offset = u16::from_le_bytes(data[2 + index * 2..4 + index * 2].try_into().map_err(|_| ProgramError::InvalidInstructionData)?) as usize;
    let ix_data = &data[offset..];
    
    let mut pos = 0;
    let num_accounts = u16::from_le_bytes(ix_data[pos..pos+2].try_into().map_err(|_| ProgramError::InvalidInstructionData)?) as usize;
    pos += 2;
    
    let mut accounts = Vec::with_capacity(num_accounts);
    for _ in 0..num_accounts {
        let pubkey = Pubkey::new_from_array(ix_data[pos..pos+32].try_into().map_err(|_| ProgramError::InvalidInstructionData)?);
        let is_signer = ix_data[pos+32] != 0;
        let is_writable = ix_data[pos+33] != 0;
        accounts.push(anchor_lang::solana_program::instruction::AccountMeta { pubkey, is_signer, is_writable });
        pos += 34;
    }
    
    let program_id = Pubkey::new_from_array(ix_data[pos..pos+32].try_into().map_err(|_| ProgramError::InvalidInstructionData)?);
    pos += 32;
    
    let data_len = u32::from_le_bytes(ix_data[pos..pos+4].try_into().map_err(|_| ProgramError::InvalidInstructionData)?) as usize;
    pos += 4;
    
    let ix_payload = ix_data[pos..pos+data_len].to_vec();
    
    Ok(anchor_lang::solana_program::instruction::Instruction { 
        program_id, 
        accounts, 
        data: ix_payload 
    })
}
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::state::*;
use crate::error::TradingError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OffchainOrderPayload {
    pub order_id: [u8; 16], // UUID
    pub user: Pubkey,
    pub energy_amount: u64,
    pub price_per_kwh: u64,
    pub side: u8, // 0 = Buy, 1 = Sell
    pub zone_id: u32,
    pub expires_at: i64,
}

impl OffchainOrderPayload {
    pub fn get_message(&self) -> Vec<u8> {
        let mut msg = Vec::new();
        msg.extend_from_slice(&self.order_id);
        msg.extend_from_slice(self.user.as_ref());
        msg.extend_from_slice(&self.energy_amount.to_le_bytes());
        msg.extend_from_slice(&self.price_per_kwh.to_le_bytes());
        msg.push(self.side);
        msg.extend_from_slice(&self.zone_id.to_le_bytes());
        msg.extend_from_slice(&self.expires_at.to_le_bytes());
        msg
    }
}

#[derive(Accounts)]
#[instruction(buyer_payload: OffchainOrderPayload, seller_payload: OffchainOrderPayload)]
pub struct SettleOffchainMatchContext<'info> {
    pub market: AccountLoader<'info, Market>,
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    
    #[account(
        init_if_needed,
        payer = payer,
        space = OrderNullifier::LEN,
        seeds = [b"nullifier", buyer_payload.user.as_ref(), &buyer_payload.order_id],
        bump
    )]
    pub buyer_nullifier: Box<Account<'info, OrderNullifier>>,

    #[account(
        init_if_needed,
        payer = payer,
        space = OrderNullifier::LEN,
        seeds = [b"nullifier", seller_payload.user.as_ref(), &seller_payload.order_id],
        bump
    )]
    pub seller_nullifier: Box<Account<'info, OrderNullifier>>,

    #[account(mut)]
    pub buyer_currency_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub seller_currency_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub seller_energy_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub buyer_energy_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub fee_collector: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub wheeling_collector: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub loss_collector: Box<InterfaceAccount<'info, TokenAccount>>,

    pub currency_mint: Box<InterfaceAccount<'info, Mint>>,
    pub energy_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: PDA authority for the market
    #[account(seeds = [b"market_authority"], bump)]
    pub market_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"market_shard", market.key().as_ref(), &[get_shard_id(&payer.key(), market.load()?.num_shards)]],
        bump
    )]
    pub market_shard: AccountLoader<'info, MarketShard>,

    #[account(
        mut,
        seeds = [b"zone_shard", zone_market.key().as_ref(), &[get_shard_id(&payer.key(), zone_market.load()?.num_shards)]],
        bump
    )]
    pub zone_shard: AccountLoader<'info, ZoneMarketShard>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Instructions sysvar to verify Ed25519 sigs
    #[account(address = IX_ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub secondary_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BatchMatchPair {
    pub buyer_payload: OffchainOrderPayload,
    pub seller_payload: OffchainOrderPayload,
    pub match_amount: u64,
    pub match_price: u64,
    pub wheeling_charge: u64,
    pub loss_cost: u64,
}

#[derive(Accounts)]
#[instruction(matches: Vec<BatchMatchPair>)]
pub struct SettleOffchainMatchBatchContext<'info> {
    pub market: AccountLoader<'info, Market>,
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    pub currency_mint: Box<InterfaceAccount<'info, Mint>>,
    pub energy_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: PDA authority for the market
    #[account(seeds = [b"market_authority"], bump)]
    pub market_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub market_shard: AccountLoader<'info, MarketShard>,
    #[account(mut)]
    pub zone_shard: AccountLoader<'info, ZoneMarketShard>,

    #[account(mut)]
    pub fee_collector: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub wheeling_collector: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub loss_collector: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Instructions sysvar to verify Ed25519 sigs
    #[account(address = IX_ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub secondary_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn settle_offchain_match(
    ctx: Context<SettleOffchainMatchContext>,
    buyer_payload: OffchainOrderPayload,
    seller_payload: OffchainOrderPayload,
    match_amount: u64,
    match_price: u64,
    wheeling_charge_val: u64,
    loss_cost_val: u64,
) -> Result<()> {
    // --- 1. Ed25519 SIGNATURE VERIFICATION ---
    let sysvar_info = &ctx.accounts.sysvar_instructions;
    
    // Verify Buyer Signature
    let buyer_msg = buyer_payload.get_message();
    verify_ed25519_signature(sysvar_info, 0, &buyer_payload.user, &buyer_msg)?;
    
    // Verify Seller Signature
    let seller_msg = seller_payload.get_message();
    verify_ed25519_signature(sysvar_info, 1, &seller_payload.user, &seller_msg)?;

    // --- 2. VALIDATION ---
    require!(match_amount > 0, TradingError::InvalidAmount);
    require!(match_price <= buyer_payload.price_per_kwh, TradingError::SlippageExceeded);
    require!(match_price >= seller_payload.price_per_kwh, TradingError::SlippageExceeded);
    require!(buyer_payload.side == 0, TradingError::InvalidOrderSide);
    require!(seller_payload.side == 1, TradingError::InvalidOrderSide);
    
    let clock = Clock::get()?;
    require!(buyer_payload.expires_at == 0 || clock.unix_timestamp < buyer_payload.expires_at, TradingError::OrderExpired);
    require!(seller_payload.expires_at == 0 || clock.unix_timestamp < seller_payload.expires_at, TradingError::OrderExpired);

    let market = ctx.accounts.market.load()?;
    let mut zone_market = ctx.accounts.zone_market.load_mut()?;
    let mut market_shard = ctx.accounts.market_shard.load_mut()?;
    let mut zone_shard = ctx.accounts.zone_shard.load_mut()?;

    if zone_market.capacity > 0 && seller_payload.zone_id != zone_market.zone_id {
        let new_total_flow = zone_market.committed_flow.checked_add(match_amount).ok_or(TradingError::Overflow)?;
        require!(new_total_flow <= zone_market.capacity, TradingError::CapacityExceeded);
        zone_market.committed_flow = new_total_flow;
    }

    let buyer_remaining = buyer_payload.energy_amount.saturating_sub(ctx.accounts.buyer_nullifier.filled_amount);
    let seller_remaining = seller_payload.energy_amount.saturating_sub(ctx.accounts.seller_nullifier.filled_amount);
    require!(match_amount <= buyer_remaining && match_amount <= seller_remaining, TradingError::InvalidAmount);

    // --- 3. SETTLEMENT ---
    let total_currency_value = match_amount.saturating_mul(match_price);
    let market_fee = total_currency_value.checked_mul(market.market_fee_bps as u64).map(|v| v / 10000).unwrap_or(0);
    let net_seller_amount = total_currency_value.saturating_sub(market_fee).saturating_sub(wheeling_charge_val).saturating_sub(loss_cost_val);

    let authority_bump = ctx.bumps.market_authority;
    let authority_seeds = &[b"market_authority".as_ref(), &[authority_bump]];
    let signer = &[&authority_seeds[..]];

    anchor_spl::token_interface::transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), anchor_spl::token_interface::TransferChecked {
            from: ctx.accounts.buyer_currency_account.to_account_info(),
            mint: ctx.accounts.currency_mint.to_account_info(),
            to: ctx.accounts.fee_collector.to_account_info(),
            authority: ctx.accounts.market_authority.to_account_info(),
        }, signer),
        market_fee,
        ctx.accounts.currency_mint.decimals
    )?;

    anchor_spl::token_interface::transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), anchor_spl::token_interface::TransferChecked {
            from: ctx.accounts.buyer_currency_account.to_account_info(),
            mint: ctx.accounts.currency_mint.to_account_info(),
            to: ctx.accounts.seller_currency_account.to_account_info(),
            authority: ctx.accounts.market_authority.to_account_info(),
        }, signer),
        net_seller_amount,
        ctx.accounts.currency_mint.decimals
    )?;

    anchor_spl::token_interface::transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.secondary_token_program.key(), anchor_spl::token_interface::TransferChecked {
            from: ctx.accounts.seller_energy_account.to_account_info(),
            mint: ctx.accounts.energy_mint.to_account_info(),
            to: ctx.accounts.buyer_energy_account.to_account_info(),
            authority: ctx.accounts.market_authority.to_account_info(),
        }, signer),
        match_amount,
        ctx.accounts.energy_mint.decimals
    )?;

    // --- 4. STATE UPDATE ---
    ctx.accounts.buyer_nullifier.filled_amount += match_amount;
    ctx.accounts.buyer_nullifier.order_id = buyer_payload.order_id;
    ctx.accounts.buyer_nullifier.authority = buyer_payload.user;
    ctx.accounts.buyer_nullifier.bump = ctx.bumps.buyer_nullifier;

    ctx.accounts.seller_nullifier.filled_amount += match_amount;
    ctx.accounts.seller_nullifier.order_id = seller_payload.order_id;
    ctx.accounts.seller_nullifier.authority = seller_payload.user;
    ctx.accounts.seller_nullifier.bump = ctx.bumps.seller_nullifier;

    market_shard.volume_accumulated += match_amount;
    market_shard.order_count += 1;
    zone_shard.volume_accumulated += match_amount;
    zone_shard.trade_count += 1;
    zone_shard.last_clearing_price = match_price;
    zone_shard.last_update = clock.unix_timestamp;

    emit!(crate::events::OrderMatched {
        sell_order: ctx.accounts.seller_nullifier.key(),
        buy_order: ctx.accounts.buyer_nullifier.key(),
        seller: seller_payload.user,
        buyer: buyer_payload.user,
        amount: match_amount,
        price: match_price,
        total_value: total_currency_value,
        fee_amount: market_fee,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

pub fn batch_settle_offchain_match<'info>(
    ctx: Context<'info, SettleOffchainMatchBatchContext<'info>>,
    matches: Vec<BatchMatchPair>,
) -> Result<()> {
    let match_count = matches.len();
    require!(match_count > 0 && match_count <= 4, TradingError::BatchTooLarge);
    
    let sysvar_info = &ctx.accounts.sysvar_instructions;
    let remaining_accounts = ctx.remaining_accounts;
    require!(remaining_accounts.len() == match_count * 6, TradingError::InvalidAmount);

    let clock = Clock::get()?;
    let market = ctx.accounts.market.load()?;
    let mut zone_market = ctx.accounts.zone_market.load_mut()?;
    let mut market_shard = ctx.accounts.market_shard.load_mut()?;
    let mut zone_shard = ctx.accounts.zone_shard.load_mut()?;

    let authority_seeds = &[b"market_authority".as_ref(), &[ctx.bumps.market_authority]];
    let signer = &[&authority_seeds[..]];

    for (i, m) in matches.iter().enumerate() {
        // Verify signatures for each pair in the batch
        // Instructions: [Ed25519_Buyer_0, Ed25519_Seller_0, Ed25519_Buyer_1, Ed25519_Seller_1, ..., Program_IX]
        verify_ed25519_signature(sysvar_info, (i * 2) as u16, &m.buyer_payload.user, &m.buyer_payload.get_message())?;
        verify_ed25519_signature(sysvar_info, (i * 2 + 1) as u16, &m.seller_payload.user, &m.seller_payload.get_message())?;

        let offset = i * 6;
        let mut buyer_nullifier: Account<'info, OrderNullifier> = Account::try_from(&remaining_accounts[offset])?;
        let mut seller_nullifier: Account<'info, OrderNullifier> = Account::try_from(&remaining_accounts[offset + 1])?;

        require!(m.match_amount > 0, TradingError::InvalidAmount);
        require!(m.match_price <= m.buyer_payload.price_per_kwh, TradingError::SlippageExceeded);
        require!(m.match_price >= m.seller_payload.price_per_kwh, TradingError::SlippageExceeded);
        
        let buyer_rem = m.buyer_payload.energy_amount.saturating_sub(buyer_nullifier.filled_amount);
        let seller_rem = m.seller_payload.energy_amount.saturating_sub(seller_nullifier.filled_amount);
        require!(m.match_amount <= buyer_rem && m.match_amount <= seller_rem, TradingError::InvalidAmount);

        let total_value = m.match_amount.saturating_mul(m.match_price);
        let market_fee = total_value.checked_mul(market.market_fee_bps as u64).map(|v| v / 10000).unwrap_or(0);
        let net_seller = total_value.saturating_sub(market_fee).saturating_sub(m.wheeling_charge).saturating_sub(m.loss_cost);

        // Zone capacity check and update
        if zone_market.capacity > 0 && m.seller_payload.zone_id != zone_market.zone_id {
            let new_total_flow = zone_market.committed_flow.checked_add(m.match_amount).ok_or(TradingError::Overflow)?;
            require!(new_total_flow <= zone_market.capacity, TradingError::CapacityExceeded);
            zone_market.committed_flow = new_total_flow;
        }

        // Transfers
        if market_fee > 0 {
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new_with_signer(ctx.accounts.token_program.key(), anchor_spl::token_interface::TransferChecked {
                    from: remaining_accounts[offset + 2].to_account_info(),
                    mint: ctx.accounts.currency_mint.to_account_info(),
                    to: ctx.accounts.fee_collector.to_account_info(),
                    authority: ctx.accounts.market_authority.to_account_info(),
                }, signer),
                market_fee, ctx.accounts.currency_mint.decimals
            )?;
        }

        anchor_spl::token_interface::transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.key(), anchor_spl::token_interface::TransferChecked {
                from: remaining_accounts[offset + 2].to_account_info(),
                mint: ctx.accounts.currency_mint.to_account_info(),
                to: remaining_accounts[offset + 3].to_account_info(),
                authority: ctx.accounts.market_authority.to_account_info(),
            }, signer),
            net_seller, ctx.accounts.currency_mint.decimals
        )?;

        anchor_spl::token_interface::transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.secondary_token_program.key(), anchor_spl::token_interface::TransferChecked {
                from: remaining_accounts[offset + 4].to_account_info(),
                mint: ctx.accounts.energy_mint.to_account_info(),
                to: remaining_accounts[offset + 5].to_account_info(),
                authority: ctx.accounts.market_authority.to_account_info(),
            }, signer),
            m.match_amount, ctx.accounts.energy_mint.decimals
        )?;

        buyer_nullifier.filled_amount += m.match_amount;
        buyer_nullifier.exit(ctx.program_id)?;
        seller_nullifier.filled_amount += m.match_amount;
        seller_nullifier.exit(ctx.program_id)?;

        market_shard.volume_accumulated += m.match_amount;
        zone_shard.volume_accumulated += m.match_amount;
        zone_shard.last_clearing_price = m.match_price;
        zone_shard.last_update = clock.unix_timestamp;

        emit!(crate::events::OrderMatched {
            sell_order: seller_nullifier.key(),
            buy_order: buyer_nullifier.key(),
            seller: m.seller_payload.user,
            buyer: m.buyer_payload.user,
            amount: m.match_amount,
            price: m.match_price,
            total_value,
            fee_amount: market_fee,
            timestamp: clock.unix_timestamp,
        });
    }
    Ok(())
}

fn verify_ed25519_signature(
    sysvar_info: &AccountInfo,
    instruction_index: u16,
    expected_pubkey: &Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    let ix = load_instruction_at_checked(instruction_index as usize, sysvar_info)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if ix.program_id != ED25519_ID {
        return Err(ProgramError::IncorrectProgramId.into());
    }

    let pubkey_offset = 16; 
    let _signature_offset = 48;
    let message_offset = 112;

    let pubkey_in_ix = &ix.data[pubkey_offset..pubkey_offset + 32];
    if pubkey_in_ix != expected_pubkey.as_ref() {
        return Err(ProgramError::InvalidArgument.into());
    }

    let message_in_ix = &ix.data[message_offset..];
    if message_in_ix != expected_message {
        return Err(ProgramError::InvalidInstructionData.into());
    }

    Ok(())
}
