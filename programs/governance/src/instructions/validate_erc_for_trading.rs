use crate::errors::GovernanceError;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ValidateErc<'info> {
    #[account(
        mut,
        seeds = [b"governance_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub governance_config: Account<'info, GovernanceConfig>,
    #[account(
        mut,
        seeds = [b"erc_certificate", erc_certificate.certificate_id[..erc_certificate.id_len as usize].as_ref()],
        bump
    )]
    pub erc_certificate: Account<'info, ErcCertificate>,
    pub authority: Signer<'info>,
}

pub fn validate_erc_for_trading(ctx: Context<ValidateErc>) -> Result<()> {
    let governance_config = &mut ctx.accounts.governance_config;
    let erc_certificate = &mut ctx.accounts.erc_certificate;
    let clock = Clock::get()?;

    // Operational checks
    require!(
        governance_config.is_operational(),
        GovernanceError::MaintenanceMode
    );
    require!(
        erc_certificate.status == ErcStatus::Valid,
        GovernanceError::InvalidErcStatus
    );
    require!(
        !erc_certificate.validated_for_trading,
        GovernanceError::AlreadyValidated
    );

    // Check expiration
    if let Some(expires_at) = erc_certificate.expires_at {
        require!(
            clock.unix_timestamp < expires_at,
            GovernanceError::ErcExpired
        );
    }

    // Validate and update
    erc_certificate.validated_for_trading = true;
    erc_certificate.trading_validated_at = Some(clock.unix_timestamp);

    // Update statistics
    governance_config.total_ercs_validated = governance_config.total_ercs_validated.saturating_add(1);
    governance_config.last_updated = clock.unix_timestamp;

    emit!(ErcValidatedForTrading {
        certificate_id: String::from_utf8_lossy(
            &erc_certificate.certificate_id[..erc_certificate.id_len as usize]
        )
        .into_owned(),
        authority: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
