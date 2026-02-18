use anchor_lang::prelude::*;
use crate::events::*;
use crate::errors::*;
use crate::UpdateGovernanceConfig;

pub fn update_governance_config(
    ctx: Context<UpdateGovernanceConfig>,
    erc_validation_enabled: bool,
    allow_certificate_transfers: bool,
) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let clock = Clock::get()?;
    
    poa_config.erc_validation_enabled = erc_validation_enabled;
    poa_config.allow_certificate_transfers = allow_certificate_transfers;
    poa_config.last_updated = clock.unix_timestamp;
    
    emit!(GovernanceConfigUpdated {
        authority: ctx.accounts.authority.key(),
        erc_validation_enabled,
        allow_certificate_transfers,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

pub fn set_maintenance_mode(
    ctx: Context<UpdateGovernanceConfig>,
    maintenance_enabled: bool,
) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let clock = Clock::get()?;
    
    poa_config.maintenance_mode = maintenance_enabled;
    poa_config.last_updated = clock.unix_timestamp;
    
    emit!(MaintenanceModeUpdated {
        authority: ctx.accounts.authority.key(),
        maintenance_enabled,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

pub fn update_erc_limits(
    ctx: Context<UpdateGovernanceConfig>,
    min_energy_amount: u64,
    max_erc_amount: u64,
    erc_validity_period: i64,
) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let clock = Clock::get()?;
    
    require!(min_energy_amount > 0, GovernanceError::InvalidMinimumEnergy);
    require!(max_erc_amount > min_energy_amount, GovernanceError::InvalidMaximumEnergy);
    require!(erc_validity_period > 0, GovernanceError::InvalidValidityPeriod);
    
    let old_min = poa_config.min_energy_amount;
    let old_max = poa_config.max_erc_amount;
    let old_validity = poa_config.erc_validity_period;
    
    poa_config.min_energy_amount = min_energy_amount;
    poa_config.max_erc_amount = max_erc_amount;
    poa_config.erc_validity_period = erc_validity_period;
    poa_config.last_updated = clock.unix_timestamp;
    
    emit!(ErcLimitsUpdated {
        authority: ctx.accounts.authority.key(),
        old_min,
        new_min: min_energy_amount,
        old_max,
        new_max: max_erc_amount,
        old_validity,
        new_validity: erc_validity_period,
        timestamp: clock.unix_timestamp,
    });
    

    Ok(())
}

pub fn update_authority_info(
    ctx: Context<UpdateGovernanceConfig>,
    contact_info: String,
) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let clock = Clock::get()?;
    
    require!(contact_info.len() <= 128, GovernanceError::ContactInfoTooLong);
    
    // Capture old contact for event (convert from bytes)
    let old_contact = String::from_utf8_lossy(&poa_config.contact_info[..poa_config.contact_len as usize]).into_owned();
    
    // Update contact_info bytes and length
    let mut contact_bytes = [0u8; 128];
    let contact_slice = contact_info.as_bytes();
    contact_bytes[..contact_slice.len()].copy_from_slice(contact_slice);
    
    poa_config.contact_info = contact_bytes;
    poa_config.contact_len = contact_slice.len() as u8;
    poa_config.last_updated = clock.unix_timestamp;
    
    emit!(AuthorityInfoUpdated {
        authority: ctx.accounts.authority.key(),
        old_contact,
        new_contact: contact_info,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}
