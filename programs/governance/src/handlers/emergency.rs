use anchor_lang::prelude::*;
use crate::events::*;
use crate::errors::*;
use crate::EmergencyControl;

pub fn pause(ctx: Context<EmergencyControl>) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let clock = Clock::get()?;
    
    require!(!poa_config.emergency_paused, GovernanceError::AlreadyPaused);
    
    poa_config.emergency_paused = true;
    poa_config.emergency_timestamp = Some(clock.unix_timestamp);
    
    emit!(EmergencyPauseActivated {
        authority: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
    });
    

    Ok(())
}

pub fn unpause(ctx: Context<EmergencyControl>) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let clock = Clock::get()?;
    
    require!(poa_config.emergency_paused, GovernanceError::NotPaused);
    
    poa_config.emergency_paused = false;
    poa_config.emergency_timestamp = None;
    
    emit!(EmergencyPauseDeactivated {
        authority: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
    });
    

    Ok(())
}
