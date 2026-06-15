use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey::Pubkey;

const ED25519_ID: Pubkey = Pubkey::new_from_array([
    3, 125, 70, 214, 124, 147, 251, 190, 18, 249, 66, 143, 131, 141, 64, 255, 5, 112, 116, 73, 39,
    244, 138, 100, 252, 202, 112, 68, 128, 0, 0, 0,
]);

// Instructions sysvar: Sysvar1nstructions1111111111111111111111111
const IX_ID: Pubkey = Pubkey::new_from_array([
    6, 167, 213, 23, 24, 123, 209, 102, 53, 218, 212, 4, 85, 253, 194, 192, 193, 36, 198, 143, 33,
    86, 117, 165, 219, 186, 203, 95, 8, 0, 0, 0,
]);

// Minimal correct parser for the Instructions sysvar. Per-instruction layout is:
//   num_accounts: u16
//   per account: flags u8 + pubkey [u8;32]   (33 bytes)
//   program_id: [u8;32]
//   data_len: u16
//   data: [u8; data_len]
// Only program_id + data are needed for ed25519 verification.
fn load_instruction_at_checked(
    index: usize,
    sysvar_info: &AccountInfo,
) -> Result<anchor_lang::solana_program::instruction::Instruction> {
    if sysvar_info.key != &IX_ID {
        return Err(ProgramError::IncorrectProgramId.into());
    }
    let data = sysvar_info.try_borrow_data()?;
    let bad = || -> anchor_lang::error::Error { ProgramError::InvalidInstructionData.into() };

    let read_u16 = |buf: &[u8], at: usize| -> Result<usize> {
        let slice = buf.get(at..at + 2).ok_or_else(bad)?;
        Ok(u16::from_le_bytes([slice[0], slice[1]]) as usize)
    };

    let num_instructions = read_u16(&data, 0)?;
    if index >= num_instructions {
        return Err(bad());
    }
    let mut pos = read_u16(&data, 2 + index * 2)?;

    let num_accounts = read_u16(&data, pos)?;
    pos += 2;
    pos = pos
        .checked_add(num_accounts.checked_mul(33).ok_or_else(bad)?)
        .ok_or_else(bad)?;

    let program_id = Pubkey::new_from_array(
        data.get(pos..pos + 32).ok_or_else(bad)?.try_into().map_err(|_| bad())?,
    );
    pos += 32;

    let data_len = read_u16(&data, pos)?;
    pos += 2;
    let payload = data.get(pos..pos + data_len).ok_or_else(bad)?.to_vec();

    Ok(anchor_lang::solana_program::instruction::Instruction {
        program_id,
        accounts: Vec::new(),
        data: payload,
    })
}
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::state::*;
use crate::error::TradingError;

#[cfg(feature = "localnet")]
use compute_debug::{compute_checkpoint, compute_fn};
#[cfg(not(feature = "localnet"))]
use crate::{compute_checkpoint, compute_fn};

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
    // Bound to the canonical singleton market PDA — blocks substituting a fee=0 market.
    #[account(seeds = [b"market"], bump)]
    pub market: AccountLoader<'info, Market>,
    // Must belong to `market` — blocks substituting a zero-capacity / wrong-zone book.
    #[account(mut, constraint = zone_market.load()?.market == market.key())]
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

    pub currency_mint: Box<InterfaceAccount<'info, Mint>>,
    pub energy_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: global escrow authority PDA — signs the transfer CPIs.
    #[account(seeds = [b"market_authority"], bump)]
    pub market_authority: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub secondary_token_program: Interface<'info, TokenInterface>,

    // --- Per-user escrows: address is fully derived from the SIGNED payload user + mint,
    // so settlement can never be aimed at a victim's funds. ---
    #[account(
        mut,
        seeds = [b"escrow", buyer_payload.user.as_ref(), currency_mint.key().as_ref()],
        bump,
        token::mint = currency_mint,
        token::authority = market_authority,
        token::token_program = token_program,
    )]
    pub buyer_currency_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [b"escrow", seller_payload.user.as_ref(), currency_mint.key().as_ref()],
        bump,
        token::mint = currency_mint,
        token::authority = market_authority,
        token::token_program = token_program,
    )]
    pub seller_currency_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [b"escrow", seller_payload.user.as_ref(), energy_mint.key().as_ref()],
        bump,
        token::mint = energy_mint,
        token::authority = market_authority,
        token::token_program = secondary_token_program,
    )]
    pub seller_energy_escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [b"escrow", buyer_payload.user.as_ref(), energy_mint.key().as_ref()],
        bump,
        token::mint = energy_mint,
        token::authority = market_authority,
        token::token_program = secondary_token_program,
    )]
    pub buyer_energy_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    // Protocol collectors — bound to seed PDAs so fees can't be redirected.
    #[account(
        mut,
        seeds = [b"fee_collector", currency_mint.key().as_ref()],
        bump,
        token::mint = currency_mint,
        token::authority = market_authority,
        token::token_program = token_program,
    )]
    pub fee_collector: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [b"wheeling_collector", currency_mint.key().as_ref()],
        bump,
        token::mint = currency_mint,
        token::authority = market_authority,
        token::token_program = token_program,
    )]
    pub wheeling_collector: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [b"loss_collector", currency_mint.key().as_ref()],
        bump,
        token::mint = currency_mint,
        token::authority = market_authority,
        token::token_program = token_program,
    )]
    pub loss_collector: Box<InterfaceAccount<'info, TokenAccount>>,

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
    pub system_program: Program<'info, System>,

    // --- Optional treasury wiring (baht-denominated settlement) ---
    // When both are supplied, the settlement currency must be the treasury's THBG
    // mint and the trade value is recorded via a non-custodial CPI (moves no funds,
    // so the escrow / ed25519 / replay-nullifier guarantees are untouched). Omitting
    // them keeps the legacy generic-currency settlement working unchanged.
    pub treasury_program: Option<Program<'info, treasury::program::Treasury>>,
    #[account(mut)]
    pub treasury_state: Option<AccountLoader<'info, treasury::Treasury>>,
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
    #[account(seeds = [b"market"], bump)]
    pub market: AccountLoader<'info, Market>,
    #[account(mut, constraint = zone_market.load()?.market == market.key())]
    pub zone_market: AccountLoader<'info, ZoneMarket>,
    pub currency_mint: Box<InterfaceAccount<'info, Mint>>,
    pub energy_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: global escrow authority PDA — signs the transfer CPIs.
    #[account(seeds = [b"market_authority"], bump)]
    pub market_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub market_shard: AccountLoader<'info, MarketShard>,
    #[account(mut)]
    pub zone_shard: AccountLoader<'info, ZoneMarketShard>,

    #[account(
        mut,
        seeds = [b"fee_collector", currency_mint.key().as_ref()],
        bump,
        token::mint = currency_mint,
        token::authority = market_authority,
        token::token_program = token_program,
    )]
    pub fee_collector: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [b"wheeling_collector", currency_mint.key().as_ref()],
        bump,
        token::mint = currency_mint,
        token::authority = market_authority,
        token::token_program = token_program,
    )]
    pub wheeling_collector: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [b"loss_collector", currency_mint.key().as_ref()],
        bump,
        token::mint = currency_mint,
        token::authority = market_authority,
        token::token_program = token_program,
    )]
    pub loss_collector: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Instructions sysvar to verify Ed25519 sigs
    #[account(address = IX_ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub secondary_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,

    // --- Optional treasury wiring (baht-denominated settlement) ---
    // When both are supplied, the settlement currency must be the treasury's THBG
    // mint and the batch's gross settled value is recorded with a single CPI.
    pub treasury_program: Option<Program<'info, treasury::program::Treasury>>,
    #[account(mut)]
    pub treasury_state: Option<AccountLoader<'info, treasury::Treasury>>,
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
    compute_fn!("settle_offchain_match" => {
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

    // Capacity throttles cross-zone (wheeling) flow; intra-zone trades are exempt because
    // they consume no inter-zone transmission line. A trade is cross-zone if EITHER leg is
    // remote relative to this zone_market — checking only the seller lets a remote-buyer /
    // local-seller trade bypass the throttle.
    if zone_market.capacity > 0
        && (seller_payload.zone_id != zone_market.zone_id || buyer_payload.zone_id != zone_market.zone_id)
    {
        let new_total_flow = zone_market.committed_flow.checked_add(match_amount).ok_or(TradingError::Overflow)?;
        require!(new_total_flow <= zone_market.capacity, TradingError::CapacityExceeded);
        zone_market.committed_flow = new_total_flow;
    }

    let buyer_remaining = buyer_payload.energy_amount.saturating_sub(ctx.accounts.buyer_nullifier.filled_amount);
    let seller_remaining = seller_payload.energy_amount.saturating_sub(ctx.accounts.seller_nullifier.filled_amount);
    require!(match_amount <= buyer_remaining && match_amount <= seller_remaining, TradingError::InvalidAmount);

    // --- 3. SETTLEMENT ---
    // checked_mul, not saturating: clamping a money product to u64::MAX would pay out
    // and record a garbage value instead of rejecting an impossible match.
    let total_currency_value = match_amount.checked_mul(match_price).ok_or(TradingError::Overflow)?;
    let market_fee = total_currency_value.checked_mul(market.market_fee_bps as u64).map(|v| v / 10000).ok_or(TradingError::Overflow)?;
    let net_seller_amount = total_currency_value.saturating_sub(market_fee).saturating_sub(wheeling_charge_val).saturating_sub(loss_cost_val);

    let authority_bump = ctx.bumps.market_authority;
    let authority_seeds = &[b"market_authority".as_ref(), &[authority_bump]];
    let signer = &[&authority_seeds[..]];

    compute_checkpoint!("before_settle_cpis");
    // Currency: buyer escrow -> fee collector
    if market_fee > 0 {
        anchor_spl::token_interface::transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.key(), anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.buyer_currency_escrow.to_account_info(),
                mint: ctx.accounts.currency_mint.to_account_info(),
                to: ctx.accounts.fee_collector.to_account_info(),
                authority: ctx.accounts.market_authority.to_account_info(),
            }, signer),
            market_fee,
            ctx.accounts.currency_mint.decimals
        )?;
    }

    // Currency: buyer escrow -> wheeling collector
    if wheeling_charge_val > 0 {
        anchor_spl::token_interface::transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.key(), anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.buyer_currency_escrow.to_account_info(),
                mint: ctx.accounts.currency_mint.to_account_info(),
                to: ctx.accounts.wheeling_collector.to_account_info(),
                authority: ctx.accounts.market_authority.to_account_info(),
            }, signer),
            wheeling_charge_val,
            ctx.accounts.currency_mint.decimals
        )?;
    }

    // Currency: buyer escrow -> loss collector
    if loss_cost_val > 0 {
        anchor_spl::token_interface::transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.key(), anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.buyer_currency_escrow.to_account_info(),
                mint: ctx.accounts.currency_mint.to_account_info(),
                to: ctx.accounts.loss_collector.to_account_info(),
                authority: ctx.accounts.market_authority.to_account_info(),
            }, signer),
            loss_cost_val,
            ctx.accounts.currency_mint.decimals
        )?;
    }

    // Currency: buyer escrow -> seller escrow (net)
    if net_seller_amount > 0 {
        anchor_spl::token_interface::transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.key(), anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.buyer_currency_escrow.to_account_info(),
                mint: ctx.accounts.currency_mint.to_account_info(),
                to: ctx.accounts.seller_currency_escrow.to_account_info(),
                authority: ctx.accounts.market_authority.to_account_info(),
            }, signer),
            net_seller_amount,
            ctx.accounts.currency_mint.decimals
        )?;
    }

    // Energy: seller escrow -> buyer escrow
    anchor_spl::token_interface::transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.secondary_token_program.key(), anchor_spl::token_interface::TransferChecked {
            from: ctx.accounts.seller_energy_escrow.to_account_info(),
            mint: ctx.accounts.energy_mint.to_account_info(),
            to: ctx.accounts.buyer_energy_escrow.to_account_info(),
            authority: ctx.accounts.market_authority.to_account_info(),
        }, signer),
        match_amount,
        ctx.accounts.energy_mint.decimals
    )?;
    compute_checkpoint!("after_settle_cpis");

    // --- 3b. TREASURY: record the baht-denominated settlement (optional, non-custodial) ---
    if let (Some(treasury_program), Some(treasury_state)) =
        (&ctx.accounts.treasury_program, &ctx.accounts.treasury_state)
    {
        // Require the settlement currency IS the THBG mint so this is genuinely a
        // baht-denominated settlement, not an arbitrary token. Records the GROSS
        // settled value (total THBG leaving buyer escrow = seller payout + fee +
        // wheeling + loss), so the counter reconciles to on-chain escrow outflow —
        // not the seller's net receipt.
        require_keys_eq!(
            ctx.accounts.currency_mint.key(),
            treasury_state.load()?.thbg_mint,
            TradingError::TreasuryCurrencyMismatch
        );
        treasury::cpi::record_settlement(
            CpiContext::new_with_signer(
                treasury_program.key(),
                treasury::cpi::accounts::RecordSettlement {
                    treasury: treasury_state.to_account_info(),
                    recorder: ctx.accounts.market_authority.to_account_info(),
                },
                signer,
            ),
            total_currency_value,
        )?;
    }

    // --- 4. STATE UPDATE ---
    ctx.accounts.buyer_nullifier.filled_amount = ctx.accounts.buyer_nullifier.filled_amount.saturating_add(match_amount);
    ctx.accounts.buyer_nullifier.order_id = buyer_payload.order_id;
    ctx.accounts.buyer_nullifier.authority = buyer_payload.user;
    ctx.accounts.buyer_nullifier.bump = ctx.bumps.buyer_nullifier;

    ctx.accounts.seller_nullifier.filled_amount = ctx.accounts.seller_nullifier.filled_amount.saturating_add(match_amount);
    ctx.accounts.seller_nullifier.order_id = seller_payload.order_id;
    ctx.accounts.seller_nullifier.authority = seller_payload.user;
    ctx.accounts.seller_nullifier.bump = ctx.bumps.seller_nullifier;

    market_shard.volume_accumulated = market_shard.volume_accumulated.saturating_add(match_amount);
    market_shard.order_count = market_shard.order_count.saturating_add(1);
    zone_shard.volume_accumulated = zone_shard.volume_accumulated.saturating_add(match_amount);
    zone_shard.trade_count = zone_shard.trade_count.saturating_add(1);
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
    });

    Ok(())
}

pub fn batch_settle_offchain_match<'info>(
    ctx: Context<'info, SettleOffchainMatchBatchContext<'info>>,
    matches: Vec<BatchMatchPair>,
) -> Result<()> {
    compute_fn!("batch_settle_offchain_match" => {
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

    // Hoist keys/program ids out of the loop to avoid repeated borrows.
    let program_id = ctx.program_id;
    let currency_mint_key = ctx.accounts.currency_mint.key();
    let energy_mint_key = ctx.accounts.energy_mint.key();
    let token_prog_key = ctx.accounts.token_program.key();
    let sec_token_prog_key = ctx.accounts.secondary_token_program.key();

    let authority_seeds = &[b"market_authority".as_ref(), &[ctx.bumps.market_authority]];
    let signer = &[&authority_seeds[..]];

    // Accumulate the gross settled value across the batch; recorded once after the
    // loop via a single treasury CPI (cheaper than one CPI per match).
    let mut batch_total_value: u64 = 0;

    for (i, m) in matches.iter().enumerate() {
        // Verify signatures for each pair in the batch
        // Instructions: [Ed25519_Buyer_0, Ed25519_Seller_0, Ed25519_Buyer_1, Ed25519_Seller_1, ..., Program_IX]
        verify_ed25519_signature(sysvar_info, (i * 2) as u16, &m.buyer_payload.user, &m.buyer_payload.get_message())?;
        verify_ed25519_signature(sysvar_info, (i * 2 + 1) as u16, &m.seller_payload.user, &m.seller_payload.get_message())?;

        let offset = i * 6;

        // --- ACCOUNT BINDING: every remaining account must be the canonical PDA for the
        // SIGNED payload, otherwise an attacker could substitute a victim escrow (theft)
        // or an unrelated nullifier (replay). Address derivation is the binding. ---
        let buyer_null_key = remaining_accounts[offset].key();
        require_keys_eq!(
            buyer_null_key,
            Pubkey::find_program_address(&[b"nullifier", m.buyer_payload.user.as_ref(), &m.buyer_payload.order_id], program_id).0,
            TradingError::InvalidNullifier
        );
        require_keys_eq!(
            remaining_accounts[offset + 1].key(),
            Pubkey::find_program_address(&[b"nullifier", m.seller_payload.user.as_ref(), &m.seller_payload.order_id], program_id).0,
            TradingError::InvalidNullifier
        );
        require_keys_eq!(
            remaining_accounts[offset + 2].key(),
            Pubkey::find_program_address(&[b"escrow", m.buyer_payload.user.as_ref(), currency_mint_key.as_ref()], program_id).0,
            TradingError::InvalidEscrow
        );
        require_keys_eq!(
            remaining_accounts[offset + 3].key(),
            Pubkey::find_program_address(&[b"escrow", m.seller_payload.user.as_ref(), currency_mint_key.as_ref()], program_id).0,
            TradingError::InvalidEscrow
        );
        require_keys_eq!(
            remaining_accounts[offset + 4].key(),
            Pubkey::find_program_address(&[b"escrow", m.seller_payload.user.as_ref(), energy_mint_key.as_ref()], program_id).0,
            TradingError::InvalidEscrow
        );
        require_keys_eq!(
            remaining_accounts[offset + 5].key(),
            Pubkey::find_program_address(&[b"escrow", m.buyer_payload.user.as_ref(), energy_mint_key.as_ref()], program_id).0,
            TradingError::InvalidEscrow
        );
        // Light SPL-ownership checks (defense-in-depth, mirrors execute_atomic_settlement).
        require_keys_eq!(*remaining_accounts[offset + 2].owner, token_prog_key, TradingError::InvalidEscrow);
        require_keys_eq!(*remaining_accounts[offset + 3].owner, token_prog_key, TradingError::InvalidEscrow);
        require_keys_eq!(*remaining_accounts[offset + 4].owner, sec_token_prog_key, TradingError::InvalidEscrow);
        require_keys_eq!(*remaining_accounts[offset + 5].owner, sec_token_prog_key, TradingError::InvalidEscrow);

        let mut buyer_nullifier: Account<'info, OrderNullifier> = Account::try_from(&remaining_accounts[offset])?;
        let mut seller_nullifier: Account<'info, OrderNullifier> = Account::try_from(&remaining_accounts[offset + 1])?;
        require_keys_eq!(buyer_nullifier.authority, m.buyer_payload.user, TradingError::NullifierUserMismatch);
        require_keys_eq!(seller_nullifier.authority, m.seller_payload.user, TradingError::NullifierUserMismatch);

        require!(m.match_amount > 0, TradingError::InvalidAmount);
        require!(m.match_price <= m.buyer_payload.price_per_kwh, TradingError::SlippageExceeded);
        require!(m.match_price >= m.seller_payload.price_per_kwh, TradingError::SlippageExceeded);

        let buyer_rem = m.buyer_payload.energy_amount.saturating_sub(buyer_nullifier.filled_amount);
        let seller_rem = m.seller_payload.energy_amount.saturating_sub(seller_nullifier.filled_amount);
        require!(m.match_amount <= buyer_rem && m.match_amount <= seller_rem, TradingError::InvalidAmount);

        let total_value = m.match_amount.checked_mul(m.match_price).ok_or(TradingError::Overflow)?;
        let market_fee = total_value.checked_mul(market.market_fee_bps as u64).map(|v| v / 10000).ok_or(TradingError::Overflow)?;
        let net_seller = total_value.saturating_sub(market_fee).saturating_sub(m.wheeling_charge).saturating_sub(m.loss_cost);
        batch_total_value = batch_total_value.checked_add(total_value).ok_or(TradingError::Overflow)?;

        // Zone capacity check and update (cross-zone wheeling flow only — see single path).
        // Cross-zone if EITHER leg is remote relative to this zone_market.
        if zone_market.capacity > 0
            && (m.seller_payload.zone_id != zone_market.zone_id || m.buyer_payload.zone_id != zone_market.zone_id)
        {
            let new_total_flow = zone_market.committed_flow.checked_add(m.match_amount).ok_or(TradingError::Overflow)?;
            require!(new_total_flow <= zone_market.capacity, TradingError::CapacityExceeded);
            zone_market.committed_flow = new_total_flow;
        }

        // Transfers
        compute_checkpoint!("before_settle_cpis");
        if market_fee > 0 {
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new_with_signer(token_prog_key, anchor_spl::token_interface::TransferChecked {
                    from: remaining_accounts[offset + 2].to_account_info(),
                    mint: ctx.accounts.currency_mint.to_account_info(),
                    to: ctx.accounts.fee_collector.to_account_info(),
                    authority: ctx.accounts.market_authority.to_account_info(),
                }, signer),
                market_fee, ctx.accounts.currency_mint.decimals
            )?;
        }

        if m.wheeling_charge > 0 {
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new_with_signer(token_prog_key, anchor_spl::token_interface::TransferChecked {
                    from: remaining_accounts[offset + 2].to_account_info(),
                    mint: ctx.accounts.currency_mint.to_account_info(),
                    to: ctx.accounts.wheeling_collector.to_account_info(),
                    authority: ctx.accounts.market_authority.to_account_info(),
                }, signer),
                m.wheeling_charge, ctx.accounts.currency_mint.decimals
            )?;
        }

        if m.loss_cost > 0 {
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new_with_signer(token_prog_key, anchor_spl::token_interface::TransferChecked {
                    from: remaining_accounts[offset + 2].to_account_info(),
                    mint: ctx.accounts.currency_mint.to_account_info(),
                    to: ctx.accounts.loss_collector.to_account_info(),
                    authority: ctx.accounts.market_authority.to_account_info(),
                }, signer),
                m.loss_cost, ctx.accounts.currency_mint.decimals
            )?;
        }

        if net_seller > 0 {
            anchor_spl::token_interface::transfer_checked(
                CpiContext::new_with_signer(token_prog_key, anchor_spl::token_interface::TransferChecked {
                    from: remaining_accounts[offset + 2].to_account_info(),
                    mint: ctx.accounts.currency_mint.to_account_info(),
                    to: remaining_accounts[offset + 3].to_account_info(),
                    authority: ctx.accounts.market_authority.to_account_info(),
                }, signer),
                net_seller, ctx.accounts.currency_mint.decimals
            )?;
        }

        anchor_spl::token_interface::transfer_checked(
            CpiContext::new_with_signer(sec_token_prog_key, anchor_spl::token_interface::TransferChecked {
                from: remaining_accounts[offset + 4].to_account_info(),
                mint: ctx.accounts.energy_mint.to_account_info(),
                to: remaining_accounts[offset + 5].to_account_info(),
                authority: ctx.accounts.market_authority.to_account_info(),
            }, signer),
            m.match_amount, ctx.accounts.energy_mint.decimals
        )?;
        compute_checkpoint!("after_settle_cpis");

        buyer_nullifier.filled_amount = buyer_nullifier.filled_amount.saturating_add(m.match_amount);
        buyer_nullifier.exit(program_id)?;
        seller_nullifier.filled_amount = seller_nullifier.filled_amount.saturating_add(m.match_amount);
        seller_nullifier.exit(program_id)?;

        market_shard.volume_accumulated = market_shard.volume_accumulated.saturating_add(m.match_amount);
        zone_shard.volume_accumulated = zone_shard.volume_accumulated.saturating_add(m.match_amount);
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

    // --- TREASURY: record the batch's gross baht-denominated settlement value with a
    // single CPI (optional, non-custodial). Mirrors the single-match path. ---
    if let (Some(treasury_program), Some(treasury_state)) =
        (&ctx.accounts.treasury_program, &ctx.accounts.treasury_state)
    {
        if batch_total_value > 0 {
            require_keys_eq!(
                currency_mint_key,
                treasury_state.load()?.thbg_mint,
                TradingError::TreasuryCurrencyMismatch
            );
            treasury::cpi::record_settlement(
                CpiContext::new_with_signer(
                    treasury_program.key(),
                    treasury::cpi::accounts::RecordSettlement {
                        treasury: treasury_state.to_account_info(),
                        recorder: ctx.accounts.market_authority.to_account_info(),
                    },
                    signer,
                ),
                batch_total_value,
            )?;
        }
    }
    });
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
