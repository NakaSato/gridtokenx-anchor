use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::TradingError;
use crate::events::{EscrowDeposited, EscrowWithdrawn};

#[cfg(feature = "localnet")]
use compute_debug::compute_fn;
#[cfg(not(feature = "localnet"))]
use crate::compute_fn;

// Per-user escrow accounts hold funds for the off-chain settlement path. Each escrow is a
// PDA token account seeds=[b"escrow", user, mint] whose SPL authority is the global
// `market_authority` PDA (seeds=[b"market_authority"]). Because the address is fully
// determined by the signed payload's user + mint, settlement cannot be pointed at a
// victim's funds — the seed derivation is the binding.
//
// INVARIANT: single global market. `market_authority` and the escrow seeds carry no
// market key. If multi-market support is ever added, both must gain `market.key()`.

#[derive(Accounts)]
pub struct DepositEscrowContext<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_wallet: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        seeds = [b"escrow", user.key().as_ref(), mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = market_authority,
        token::token_program = token_program,
    )]
    pub user_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: global escrow authority PDA — only its key is used.
    #[account(seeds = [b"market_authority"], bump)]
    pub market_authority: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn deposit_escrow(ctx: Context<DepositEscrowContext>, amount: u64) -> Result<()> {
    compute_fn!("deposit_escrow" => {
        require!(amount > 0, TradingError::InvalidAmount);

        let decimals = ctx.accounts.mint.decimals;
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.user_wallet.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.user_escrow.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
            decimals,
        )?;

        let now = Clock::get()?.unix_timestamp;
        emit!(EscrowDeposited {
            user: ctx.accounts.user.key(),
            mint: ctx.accounts.mint.key(),
            amount,
            timestamp: now,
        });
    });
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawEscrowContext<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    // Seeds include user.key() so a signer can only ever address their own escrow.
    #[account(
        mut,
        seeds = [b"escrow", user.key().as_ref(), mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = market_authority,
        token::token_program = token_program,
    )]
    pub user_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_wallet: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: global escrow authority PDA — signs the transfer CPI.
    #[account(seeds = [b"market_authority"], bump)]
    pub market_authority: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn withdraw_escrow(ctx: Context<WithdrawEscrowContext>, amount: u64) -> Result<()> {
    compute_fn!("withdraw_escrow" => {
        require!(amount > 0, TradingError::InvalidAmount);
        require!(
            amount <= ctx.accounts.user_escrow.amount,
            TradingError::InsufficientEscrowBalance
        );

        let decimals = ctx.accounts.mint.decimals;
        let authority_seeds = &[b"market_authority".as_ref(), &[ctx.bumps.market_authority]];
        let signer = &[&authority_seeds[..]];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.user_escrow.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.user_wallet.to_account_info(),
                    authority: ctx.accounts.market_authority.to_account_info(),
                },
                signer,
            ),
            amount,
            decimals,
        )?;

        let now = Clock::get()?.unix_timestamp;
        emit!(EscrowWithdrawn {
            user: ctx.accounts.user.key(),
            mint: ctx.accounts.mint.key(),
            amount,
            timestamp: now,
        });
    });
    Ok(())
}

// One-time creation of the protocol fee/wheeling/loss collector PDAs for a currency mint.
// They are PDA token accounts owned (SPL authority) by `market_authority`, bound by seeds
// so the off-chain settlement path cannot redirect fees to an attacker account.
#[derive(Accounts)]
pub struct InitializeCollectorsContext<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub currency_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        seeds = [b"fee_collector", currency_mint.key().as_ref()],
        bump,
        token::mint = currency_mint,
        token::authority = market_authority,
        token::token_program = token_program,
    )]
    pub fee_collector: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = payer,
        seeds = [b"wheeling_collector", currency_mint.key().as_ref()],
        bump,
        token::mint = currency_mint,
        token::authority = market_authority,
        token::token_program = token_program,
    )]
    pub wheeling_collector: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = payer,
        seeds = [b"loss_collector", currency_mint.key().as_ref()],
        bump,
        token::mint = currency_mint,
        token::authority = market_authority,
        token::token_program = token_program,
    )]
    pub loss_collector: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: global escrow authority PDA — only its key is used.
    #[account(seeds = [b"market_authority"], bump)]
    pub market_authority: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_collectors(_ctx: Context<InitializeCollectorsContext>) -> Result<()> {
    compute_fn!("initialize_collectors" => {
        msg!("Collector PDAs initialized");
    });
    Ok(())
}

// One-time creation of the SHARDED fee/wheeling/loss collector PDAs for a currency
// mint and one shard (§2c Part B). Run once per shard (0..NUM_SETTLE_SHARDS) so the
// sharded batch-settle path has its per-shard destinations. Same seed-binding to
// `market_authority` as the unsharded collectors — fees still can't be redirected.
#[derive(Accounts)]
#[instruction(shard_id: u8)]
pub struct InitializeShardedCollectorsContext<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub currency_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        seeds = [b"fee_collector", currency_mint.key().as_ref(), &[shard_id]],
        bump,
        token::mint = currency_mint,
        token::authority = market_authority,
        token::token_program = token_program,
    )]
    pub fee_collector: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = payer,
        seeds = [b"wheeling_collector", currency_mint.key().as_ref(), &[shard_id]],
        bump,
        token::mint = currency_mint,
        token::authority = market_authority,
        token::token_program = token_program,
    )]
    pub wheeling_collector: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = payer,
        seeds = [b"loss_collector", currency_mint.key().as_ref(), &[shard_id]],
        bump,
        token::mint = currency_mint,
        token::authority = market_authority,
        token::token_program = token_program,
    )]
    pub loss_collector: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: global escrow authority PDA — only its key is used.
    #[account(seeds = [b"market_authority"], bump)]
    pub market_authority: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_sharded_collectors(
    _ctx: Context<InitializeShardedCollectorsContext>,
    shard_id: u8,
) -> Result<()> {
    compute_fn!("initialize_sharded_collectors" => {
        require!(shard_id < treasury::NUM_SETTLE_SHARDS, TradingError::InvalidShardId);
        msg!("Sharded collector PDAs initialized for shard {}", shard_id);
    });
    Ok(())
}

// Consolidate one shard's fee/wheeling/loss balances into the canonical (unsharded)
// collectors so accounting/withdrawal reads a single sink per fee class. Permissionless:
// both source and destination are `market_authority`-owned, seed-bound PDAs, so a caller
// can only move market funds between market accounts — never out. Non-hot-path.
#[derive(Accounts)]
#[instruction(shard_id: u8)]
pub struct SweepCollectorsContext<'info> {
    pub currency_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: global escrow authority PDA — signs the transfer CPIs.
    #[account(seeds = [b"market_authority"], bump)]
    pub market_authority: UncheckedAccount<'info>,

    #[account(mut, seeds = [b"fee_collector", currency_mint.key().as_ref(), &[shard_id]], bump,
        token::mint = currency_mint, token::authority = market_authority, token::token_program = token_program)]
    pub fee_shard: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [b"wheeling_collector", currency_mint.key().as_ref(), &[shard_id]], bump,
        token::mint = currency_mint, token::authority = market_authority, token::token_program = token_program)]
    pub wheeling_shard: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [b"loss_collector", currency_mint.key().as_ref(), &[shard_id]], bump,
        token::mint = currency_mint, token::authority = market_authority, token::token_program = token_program)]
    pub loss_shard: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, seeds = [b"fee_collector", currency_mint.key().as_ref()], bump,
        token::mint = currency_mint, token::authority = market_authority, token::token_program = token_program)]
    pub fee_main: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [b"wheeling_collector", currency_mint.key().as_ref()], bump,
        token::mint = currency_mint, token::authority = market_authority, token::token_program = token_program)]
    pub wheeling_main: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [b"loss_collector", currency_mint.key().as_ref()], bump,
        token::mint = currency_mint, token::authority = market_authority, token::token_program = token_program)]
    pub loss_main: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn sweep_collectors(ctx: Context<SweepCollectorsContext>, shard_id: u8) -> Result<()> {
    compute_fn!("sweep_collectors" => {
        // Defense-in-depth: the InvalidShardId error is practically unreachable here because
        // the shard collectors are `mut` (must already exist) — an out-of-range shard_id
        // derives uninitialized PDAs that fail account validation first. Kept as the explicit
        // range contract (cf. initialize_sharded_collectors, where `init` makes it reachable).
        require!(shard_id < treasury::NUM_SETTLE_SHARDS, TradingError::InvalidShardId);
        let authority_bump = ctx.bumps.market_authority;
        let authority_seeds = &[b"market_authority".as_ref(), &[authority_bump]];
        let signer = &[&authority_seeds[..]];
        let decimals = ctx.accounts.currency_mint.decimals;

        let pairs: [(&InterfaceAccount<TokenAccount>, &InterfaceAccount<TokenAccount>); 3] = [
            (&ctx.accounts.fee_shard, &ctx.accounts.fee_main),
            (&ctx.accounts.wheeling_shard, &ctx.accounts.wheeling_main),
            (&ctx.accounts.loss_shard, &ctx.accounts.loss_main),
        ];
        for (src, dst) in pairs {
            let amount = src.amount;
            if amount > 0 {
                transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.key(),
                        TransferChecked {
                            from: src.to_account_info(),
                            mint: ctx.accounts.currency_mint.to_account_info(),
                            to: dst.to_account_info(),
                            authority: ctx.accounts.market_authority.to_account_info(),
                        },
                        signer,
                    ),
                    amount,
                    decimals,
                )?;
            }
        }
    });
    Ok(())
}
