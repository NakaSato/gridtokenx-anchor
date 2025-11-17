#![allow(deprecated)]

use anchor_lang::prelude::*;
use base64::{engine::general_purpose, Engine as _};

declare_id!("DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE");

#[program]
pub mod oracle {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, api_gateway: Pubkey) -> Result<()> {
        let oracle_data = &mut ctx.accounts.oracle_data;
        oracle_data.authority = ctx.accounts.authority.key();
        oracle_data.api_gateway = api_gateway;
        oracle_data.total_readings = 0;
        oracle_data.last_clearing = 0;
        oracle_data.active = true;
        oracle_data.created_at = Clock::get()?.unix_timestamp;
        
        msg!("Oracle program initialized with API Gateway: {}", api_gateway);
        Ok(())
    }

    /// Submit meter reading data from AMI (only via API Gateway)
    pub fn submit_meter_reading(
        ctx: Context<SubmitMeterReading>,
        meter_id: String,
        energy_produced: u64,
        energy_consumed: u64,
        reading_timestamp: i64,
    ) -> Result<()> {
        let oracle_data = &mut ctx.accounts.oracle_data;
        
        require!(oracle_data.active, ErrorCode::OracleInactive);
        
        // Only API Gateway can submit meter readings
        require!(
            ctx.accounts.authority.key() == oracle_data.api_gateway,
            ErrorCode::UnauthorizedGateway
        );
        
        oracle_data.total_readings += 1;
        oracle_data.last_reading_timestamp = reading_timestamp;
        
        // Encode meter reading data as base64 for external systems
        let reading_data = format!("{}:{}:{}:{}", 
            meter_id, 
            energy_produced,
            energy_consumed,
            reading_timestamp
        );
        let encoded_data = general_purpose::STANDARD.encode(reading_data.as_bytes());
        msg!("Meter reading data (base64): {}", encoded_data);
        
        emit!(MeterReadingSubmitted {
            meter_id: meter_id.clone(),
            energy_produced,
            energy_consumed,
            timestamp: reading_timestamp,
            submitter: ctx.accounts.authority.key(),
        });
        
        msg!(
            "Meter reading submitted via API Gateway - Meter: {}, Produced: {}, Consumed: {}", 
            meter_id, energy_produced, energy_consumed
        );
        Ok(())
    }

    /// Trigger market clearing process (only via API Gateway)
    pub fn trigger_market_clearing(ctx: Context<TriggerMarketClearing>) -> Result<()> {
        let oracle_data = &mut ctx.accounts.oracle_data;
        
        require!(oracle_data.active, ErrorCode::OracleInactive);
        
        // Only API Gateway can trigger market clearing
        require!(
            ctx.accounts.authority.key() == oracle_data.api_gateway,
            ErrorCode::UnauthorizedGateway
        );
        
        let current_time = Clock::get()?.unix_timestamp;
        oracle_data.last_clearing = current_time;
        
        emit!(MarketClearingTriggered {
            authority: ctx.accounts.authority.key(),
            timestamp: current_time,
        });
        
        msg!("Market clearing triggered via API Gateway at timestamp: {}", current_time);
        Ok(())
    }

    /// Update oracle status (admin only)
    pub fn update_oracle_status(
        ctx: Context<UpdateOracleStatus>,
        active: bool,
    ) -> Result<()> {
        let oracle_data = &mut ctx.accounts.oracle_data;
        
        require!(
            ctx.accounts.authority.key() == oracle_data.authority,
            ErrorCode::UnauthorizedAuthority
        );
        
        oracle_data.active = active;
        
        emit!(OracleStatusUpdated {
            authority: ctx.accounts.authority.key(),
            active,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        msg!("Oracle status updated to: {}", active);
        Ok(())
    }

    /// Update API Gateway address (admin only)
    pub fn update_api_gateway(
        ctx: Context<UpdateApiGateway>,
        new_api_gateway: Pubkey,
    ) -> Result<()> {
        let oracle_data = &mut ctx.accounts.oracle_data;
        
        require!(
            ctx.accounts.authority.key() == oracle_data.authority,
            ErrorCode::UnauthorizedAuthority
        );
        
        let old_gateway = oracle_data.api_gateway;
        oracle_data.api_gateway = new_api_gateway;
        
        emit!(ApiGatewayUpdated {
            authority: ctx.accounts.authority.key(),
            old_gateway,
            new_gateway: new_api_gateway,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        msg!("API Gateway updated from {} to {}", old_gateway, new_api_gateway);
        Ok(())
    }
}

// Account structs
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + OracleData::INIT_SPACE,
        seeds = [b"oracle_data"],
        bump
    )]
    pub oracle_data: Account<'info, OracleData>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitMeterReading<'info> {
    #[account(mut)]
    pub oracle_data: Account<'info, OracleData>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TriggerMarketClearing<'info> {
    #[account(mut)]
    pub oracle_data: Account<'info, OracleData>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateOracleStatus<'info> {
    #[account(mut, has_one = authority @ ErrorCode::UnauthorizedAuthority)]
    pub oracle_data: Account<'info, OracleData>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateApiGateway<'info> {
    #[account(mut, has_one = authority @ ErrorCode::UnauthorizedAuthority)]
    pub oracle_data: Account<'info, OracleData>,
    
    pub authority: Signer<'info>,
}

// Data structs
#[account]
#[derive(InitSpace)]
pub struct OracleData {
    pub authority: Pubkey,
    pub api_gateway: Pubkey,        // Only API Gateway can call oracle functions
    pub total_readings: u64,
    pub last_reading_timestamp: i64,
    pub last_clearing: i64,
    pub active: bool,
    pub created_at: i64,
}

// Events
#[event]
pub struct MeterReadingSubmitted {
    pub meter_id: String,
    pub energy_produced: u64,
    pub energy_consumed: u64,
    pub timestamp: i64,
    pub submitter: Pubkey,
}

#[event]
pub struct MarketClearingTriggered {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct OracleStatusUpdated {
    pub authority: Pubkey,
    pub active: bool,
    pub timestamp: i64,
}

#[event]
pub struct ApiGatewayUpdated {
    pub authority: Pubkey,
    pub old_gateway: Pubkey,
    pub new_gateway: Pubkey,
    pub timestamp: i64,
}

// Errors
#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,
    #[msg("Unauthorized API Gateway")]
    UnauthorizedGateway,
    #[msg("Oracle is inactive")]
    OracleInactive,
    #[msg("Invalid meter reading")]
    InvalidMeterReading,
    #[msg("Market clearing in progress")]
    MarketClearingInProgress,
}
