//! Smallbank Benchmark Instructions

use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::BlockbenchError;

// ═══════════════════════════════════════════════════════════════════════════════
// INSTRUCTION CONTEXTS
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Accounts)]
#[instruction(customer_id: u64, name: String)]
pub struct SmallbankCreateAccount<'info> {
    #[account(
        init,
        payer = authority,
        space = SmallbankCustomer::SPACE,
        seeds = [b"sb_customer", customer_id.to_le_bytes().as_ref()],
        bump
    )]
    pub customer: Account<'info, SmallbankCustomer>,

    #[account(
        init,
        payer = authority,
        space = SmallbankSavings::SPACE,
        seeds = [b"sb_savings", customer_id.to_le_bytes().as_ref()],
        bump
    )]
    pub savings: Account<'info, SmallbankSavings>,

    #[account(
        init,
        payer = authority,
        space = SmallbankChecking::SPACE,
        seeds = [b"sb_checking", customer_id.to_le_bytes().as_ref()],
        bump
    )]
    pub checking: Account<'info, SmallbankChecking>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SmallbankTransactSavings<'info> {
    #[account(
        mut,
        seeds = [b"sb_savings", savings.customer_id.to_le_bytes().as_ref()],
        bump = savings.bump
    )]
    pub savings: Account<'info, SmallbankSavings>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SmallbankDepositChecking<'info> {
    #[account(
        mut,
        seeds = [b"sb_checking", checking.customer_id.to_le_bytes().as_ref()],
        bump = checking.bump
    )]
    pub checking: Account<'info, SmallbankChecking>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SmallbankSendPayment<'info> {
    #[account(
        mut,
        seeds = [b"sb_checking", from_checking.customer_id.to_le_bytes().as_ref()],
        bump = from_checking.bump
    )]
    pub from_checking: Account<'info, SmallbankChecking>,

    #[account(
        mut,
        seeds = [b"sb_checking", to_checking.customer_id.to_le_bytes().as_ref()],
        bump = to_checking.bump
    )]
    pub to_checking: Account<'info, SmallbankChecking>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SmallbankWriteCheck<'info> {
    #[account(
        mut,
        seeds = [b"sb_checking", checking.customer_id.to_le_bytes().as_ref()],
        bump = checking.bump
    )]
    pub checking: Account<'info, SmallbankChecking>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SmallbankAmalgamate<'info> {
    #[account(
        mut,
        seeds = [b"sb_savings", savings.customer_id.to_le_bytes().as_ref()],
        bump = savings.bump
    )]
    pub savings: Account<'info, SmallbankSavings>,

    #[account(
        mut,
        seeds = [b"sb_checking", checking.customer_id.to_le_bytes().as_ref()],
        bump = checking.bump,
        constraint = checking.customer_id == savings.customer_id
    )]
    pub checking: Account<'info, SmallbankChecking>,
    
    pub authority: Signer<'info>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// INSTRUCTION IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

pub fn smallbank_create_account(
    ctx: Context<SmallbankCreateAccount>,
    customer_id: u64,
    name: String,
    initial_savings: i64,
    initial_checking: i64,
) -> Result<()> {
    let customer = &mut ctx.accounts.customer;
    customer.customer_id = customer_id;
    customer.name = name;
    customer.bump = ctx.bumps.customer;

    let savings = &mut ctx.accounts.savings;
    savings.customer_id = customer_id;
    savings.balance = initial_savings;
    savings.bump = ctx.bumps.savings;

    let checking = &mut ctx.accounts.checking;
    checking.customer_id = customer_id;
    checking.balance = initial_checking;
    checking.bump = ctx.bumps.checking;

    Ok(())
}

pub fn smallbank_transact_savings(
    ctx: Context<SmallbankTransactSavings>,
    amount: i64,
) -> Result<()> {
    let savings = &mut ctx.accounts.savings;
    savings.balance = savings.balance.checked_add(amount).ok_or(BlockbenchError::MathOverflow)?;
    Ok(())
}

pub fn smallbank_deposit_checking(
    ctx: Context<SmallbankDepositChecking>,
    amount: i64,
) -> Result<()> {
    let checking = &mut ctx.accounts.checking;
    checking.balance = checking.balance.checked_add(amount).ok_or(BlockbenchError::MathOverflow)?;
    Ok(())
}

pub fn smallbank_send_payment(
    ctx: Context<SmallbankSendPayment>,
    amount: i64,
) -> Result<()> {
    if amount <= 0 {
        return Err(BlockbenchError::InvalidAmount.into());
    }

    let from = &mut ctx.accounts.from_checking;
    let to = &mut ctx.accounts.to_checking;

    if from.balance < amount {
        return Err(BlockbenchError::InsufficientFunds.into());
    }

    from.balance -= amount;
    to.balance = to.balance.checked_add(amount).ok_or(BlockbenchError::MathOverflow)?;

    Ok(())
}

pub fn smallbank_write_check(
    ctx: Context<SmallbankWriteCheck>,
    amount: i64,
) -> Result<()> {
    let checking = &mut ctx.accounts.checking;
    checking.balance = checking.balance.checked_sub(amount).ok_or(BlockbenchError::MathOverflow)?;
    Ok(())
}

pub fn smallbank_amalgamate(
    ctx: Context<SmallbankAmalgamate>,
) -> Result<()> {
    let savings_balance = ctx.accounts.savings.balance;
    
    ctx.accounts.savings.balance = 0;
    ctx.accounts.checking.balance = ctx.accounts.checking.balance
        .checked_add(savings_balance)
        .ok_or(BlockbenchError::MathOverflow)?;

    Ok(())
}
