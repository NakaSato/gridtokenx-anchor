use crate::errors::GovernanceError;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct RevokeErc<'info> {
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

/// Revoke an ERC certificate - REC authority only
pub fn revoke_erc(ctx: Context<RevokeErc>, reason: String) -> Result<()> {
    let governance_config = &mut ctx.accounts.governance_config;
    let erc_certificate = &mut ctx.accounts.erc_certificate;
    let clock = Clock::get()?;

    // Operational checks
    require!(
        governance_config.is_operational(),
        GovernanceError::MaintenanceMode
    );

    // Reason is required and must fit in fixed buffer
    require!(
        !reason.is_empty(),
        GovernanceError::RevocationReasonRequired
    );
    require!(
        reason.len() <= 128,
        GovernanceError::RevocationReasonTooLong // fixed: was ContactInfoTooLong
    );

    // Certificate must be revocable (Valid or Pending)
    require!(
        erc_certificate.can_revoke(),
        GovernanceError::AlreadyRevoked
    );

    // Store certificate data before revocation
    let energy_amount = erc_certificate.energy_amount;

    // Revoke the certificate
    erc_certificate.status = ErcStatus::Revoked;
    erc_certificate.revoked_at = Some(clock.unix_timestamp);
    erc_certificate.validated_for_trading = false;

    // Update statistics
    governance_config.total_ercs_revoked = governance_config.total_ercs_revoked.saturating_add(1);
    governance_config.last_updated = clock.unix_timestamp;

    // Write reason bytes BEFORE emitting the event so `reason` can be moved
    // into emit! without a heap-allocating .clone().
    let mut reason_bytes = [0u8; 128];
    let reason_slice = reason.as_bytes();
    let len = reason_slice.len().min(128);
    reason_bytes[..len].copy_from_slice(&reason_slice[..len]);
    erc_certificate.revocation_reason = reason_bytes;
    erc_certificate.reason_len = len as u8;

    emit!(ErcRevoked {
        certificate_id: String::from_utf8_lossy(
            &erc_certificate.certificate_id[..erc_certificate.id_len as usize],
        )
        .into_owned(),
        authority: ctx.accounts.authority.key(),
        reason, // moved — no clone needed
        energy_amount,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
