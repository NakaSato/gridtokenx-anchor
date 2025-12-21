use crate::errors::*;
use crate::events::*;
use crate::state::*;
use crate::{IssueErc, ValidateErc};
use anchor_lang::prelude::*;
use base64::{engine::general_purpose, Engine as _};

pub fn issue(
    ctx: Context<IssueErc>,
    certificate_id: String,
    energy_amount: u64,
    renewable_source: String,
    validation_data: String,
) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let erc_certificate = &mut ctx.accounts.erc_certificate;
    let mut meter_data = ctx.accounts.meter_account.try_borrow_mut_data().map_err(|_| error!(GovernanceError::InvalidErcStatus))?;
    let mut meter: MeterAccount = MeterAccount::deserialize(&mut &meter_data[8..]).map_err(|_| error!(GovernanceError::InvalidErcStatus))?;
    let clock = Clock::get()?;

    // Comprehensive validation
    require!(
        poa_config.can_issue_erc(),
        GovernanceError::ErcValidationDisabled
    );
    require!(
        energy_amount >= poa_config.min_energy_amount,
        GovernanceError::BelowMinimumEnergy
    );
    require!(
        energy_amount <= poa_config.max_erc_amount,
        GovernanceError::ExceedsMaximumEnergy
    );
    require!(
        certificate_id.len() <= 64,
        GovernanceError::CertificateIdTooLong
    );
    require!(
        renewable_source.len() <= 64,
        GovernanceError::SourceNameTooLong
    );

    // === CRITICAL: PREVENT DOUBLE-CLAIMING ===
    // Calculate unclaimed generation (total generation minus what's already been claimed)
    let unclaimed_generation = meter
        .total_generation
        .saturating_sub(meter.claimed_erc_generation);

    // Verify sufficient unclaimed generation exists
    require!(
        energy_amount <= unclaimed_generation,
        GovernanceError::InsufficientUnclaimedGeneration
    );

    // Check if oracle validation is required
    if poa_config.require_oracle_validation {
        require!(
            poa_config.oracle_authority.is_some(),
            GovernanceError::OracleValidationRequired
        );
    }

    // Initialize certificate
    erc_certificate.certificate_id = certificate_id.clone();
    erc_certificate.authority = ctx.accounts.authority.key();
    erc_certificate.owner = ctx.accounts.authority.key(); // Initial owner is the authority
    erc_certificate.energy_amount = energy_amount;
    erc_certificate.renewable_source = renewable_source.clone();
    erc_certificate.validation_data = validation_data;
    erc_certificate.issued_at = clock.unix_timestamp;
    erc_certificate.status = ErcStatus::Valid;
    erc_certificate.validated_for_trading = false;
    erc_certificate.expires_at = Some(clock.unix_timestamp + poa_config.erc_validity_period);
    // Initialize new fields
    erc_certificate.revocation_reason = None;
    erc_certificate.revoked_at = None;
    erc_certificate.transfer_count = 0;
    erc_certificate.last_transferred_at = None;

    // === CRITICAL: UPDATE HIGH-WATER MARK ===
    // Track that this generation has been claimed to prevent re-use
    meter.claimed_erc_generation = meter.claimed_erc_generation.saturating_add(energy_amount);

    // Update comprehensive statistics
    poa_config.total_ercs_issued = poa_config.total_ercs_issued.saturating_add(1);
    poa_config.total_energy_certified = poa_config
        .total_energy_certified
        .saturating_add(energy_amount);
    poa_config.last_updated = clock.unix_timestamp;
    poa_config.last_erc_issued_at = Some(clock.unix_timestamp);

    emit!(ErcIssued {
        certificate_id,
        authority: ctx.accounts.authority.key(),
        energy_amount,
        renewable_source,
        timestamp: clock.unix_timestamp,
    });

    // Encode certificate data as base64 for external systems
    let cert_data = format!(
        "{}:{}:{}",
        erc_certificate.certificate_id,
        erc_certificate.energy_amount,
        erc_certificate.renewable_source
    );
    let encoded_data = general_purpose::STANDARD.encode(cert_data.as_bytes());
    msg!("Certificate data (base64): {}", encoded_data);

    msg!(
        "ERC issued by REC: {} kWh from {} (ID: {})",
        energy_amount,
        erc_certificate.renewable_source,
        erc_certificate.certificate_id
    );
    msg!(
        "Meter tracking - Total generation: {} | Claimed for ERCs: {} | Available: {}",
        meter.total_generation,
        meter.claimed_erc_generation,
        unclaimed_generation.saturating_sub(energy_amount)
    );
    msg!(
        "Total ERCs: {} | Total energy certified: {} kWh",
        poa_config.total_ercs_issued,
        poa_config.total_energy_certified
    );
    meter.serialize(&mut &mut meter_data[8..])?;
    Ok(())
}

pub fn validate_for_trading(ctx: Context<ValidateErc>) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let erc_certificate = &mut ctx.accounts.erc_certificate;
    let clock = Clock::get()?;

    // Operational checks
    require!(poa_config.is_operational(), GovernanceError::SystemPaused);
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
    poa_config.total_ercs_validated = poa_config.total_ercs_validated.saturating_add(1);
    poa_config.last_updated = clock.unix_timestamp;

    emit!(ErcValidatedForTrading {
        certificate_id: erc_certificate.certificate_id.clone(),
        authority: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "ERC validated for trading by REC (ID: {})",
        erc_certificate.certificate_id
    );
    msg!(
        "Validation rate: {}/{} ERCs validated",
        poa_config.total_ercs_validated,
        poa_config.total_ercs_issued
    );
    Ok(())
}

/// Revoke an ERC certificate - REC authority only
pub fn revoke(ctx: Context<crate::RevokeErc>, reason: String) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let erc_certificate = &mut ctx.accounts.erc_certificate;
    let clock = Clock::get()?;
    
    // Operational checks
    require!(poa_config.is_operational(), GovernanceError::SystemPaused);
    
    // Reason is required
    require!(!reason.is_empty(), GovernanceError::RevocationReasonRequired);
    require!(reason.len() <= 128, GovernanceError::ContactInfoTooLong);
    
    // Certificate must be revocable (Valid or Pending)
    require!(
        erc_certificate.can_revoke(),
        GovernanceError::AlreadyRevoked
    );
    
    // Store certificate data before revocation
    let energy_amount = erc_certificate.energy_amount;
    let certificate_id = erc_certificate.certificate_id.clone();
    
    // Revoke the certificate
    erc_certificate.status = ErcStatus::Revoked;
    erc_certificate.revocation_reason = Some(reason.clone());
    erc_certificate.revoked_at = Some(clock.unix_timestamp);
    erc_certificate.validated_for_trading = false;
    
    // Update statistics
    poa_config.total_ercs_revoked = poa_config.total_ercs_revoked.saturating_add(1);
    poa_config.last_updated = clock.unix_timestamp;
    
    emit!(ErcRevoked {
        certificate_id: certificate_id.clone(),
        authority: ctx.accounts.authority.key(),
        reason,
        energy_amount,
        timestamp: clock.unix_timestamp,
    });
    
    msg!(
        "ERC revoked: {} ({} kWh)",
        certificate_id,
        energy_amount
    );
    msg!(
        "Revocation stats: {}/{} ERCs revoked",
        poa_config.total_ercs_revoked,
        poa_config.total_ercs_issued
    );
    
    Ok(())
}

/// Transfer an ERC certificate to a new owner
pub fn transfer(ctx: Context<crate::TransferErc>) -> Result<()> {
    let poa_config = &ctx.accounts.poa_config;
    let erc_certificate = &mut ctx.accounts.erc_certificate;
    let clock = Clock::get()?;
    
    // Operational checks
    require!(poa_config.is_operational(), GovernanceError::SystemPaused);
    
    // Transfers must be enabled
    require!(
        poa_config.allow_certificate_transfers,
        GovernanceError::TransfersNotAllowed
    );
    
    // Certificate must be transferable (Valid + validated for trading)
    require!(
        erc_certificate.can_transfer(),
        GovernanceError::NotValidatedForTrading
    );
    
    // Check expiration
    if let Some(expires_at) = erc_certificate.expires_at {
        require!(
            clock.unix_timestamp < expires_at,
            GovernanceError::ErcExpired
        );
    }
    
    // Cannot transfer to self
    require!(
        ctx.accounts.new_owner.key() != erc_certificate.owner,
        GovernanceError::CannotTransferToSelf
    );
    
    // Store data for event
    let from_owner = erc_certificate.owner;
    let to_owner = ctx.accounts.new_owner.key();
    let energy_amount = erc_certificate.energy_amount;
    let certificate_id = erc_certificate.certificate_id.clone();
    
    // Transfer ownership
    erc_certificate.owner = to_owner;
    erc_certificate.transfer_count = erc_certificate.transfer_count.saturating_add(1);
    erc_certificate.last_transferred_at = Some(clock.unix_timestamp);
    
    emit!(ErcTransferred {
        certificate_id: certificate_id.clone(),
        from_owner,
        to_owner,
        energy_amount,
        timestamp: clock.unix_timestamp,
    });
    
    msg!(
        "ERC transferred: {} ({} kWh) from {} to {}",
        certificate_id,
        energy_amount,
        from_owner,
        to_owner
    );
    msg!(
        "Transfer count: {}",
        erc_certificate.transfer_count
    );
    
    Ok(())
}
