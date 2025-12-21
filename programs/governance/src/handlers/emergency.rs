use anchor_lang::prelude::*;
use crate::events::*;
use crate::errors::*;
use crate::EmergencyControl;

pub fn pause(ctx: Context<EmergencyControl>) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    
    require!(!poa_config.emergency_paused, GovernanceError::AlreadyPaused);
    
    poa_config.emergency_paused = true;
    poa_config.emergency_timestamp = Some(Clock::get()?.unix_timestamp);
    
    emit!(EmergencyPauseActivated {
        authority: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    msg!("Emergency pause activated by REC authority");
    Ok(())
}

pub fn unpause(ctx: Context<EmergencyControl>) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    
    require!(poa_config.emergency_paused, GovernanceError::NotPaused);
    
    poa_config.emergency_paused = false;
    poa_config.emergency_timestamp = None;
    
    emit!(EmergencyPauseDeactivated {
        authority: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    msg!("Emergency pause deactivated by REC authority");
    Ok(())
}
