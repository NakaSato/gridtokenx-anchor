use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitializeProgram<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn initialize_program(_ctx: Context<InitializeProgram>) -> Result<()> {
    msg!("Program Initialized");
    Ok(())
}
