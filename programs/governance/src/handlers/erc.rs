use crate::errors::*;
use crate::events::*;
use crate::state::*;
use crate::{IssueErc, ValidateErc};
use anchor_lang::prelude::*;

pub fn issue(
    ctx: Context<IssueErc>,
    certificate_id: String,
    energy_amount: u64,
    renewable_source: String,
    validation_data: String,
) -> Result<()> {
    let clock = Clock::get()?;

    // --- Read meter data and release borrow BEFORE any CPI ---
    let (meter_owner, unclaimed_generation) = {
        let meter_data = ctx.accounts.meter_account.try_borrow_data()?;
        require!(
            meter_data.len() >= 8 + std::mem::size_of::<MeterAccount>(),
            GovernanceError::InvalidMeterAccount
        );
        let meter = bytemuck::from_bytes::<MeterAccount>(&meter_data[8..]);
        let meter_owner = Pubkey::new_from_array(meter.owner);
        let unclaimed = meter
            .total_generation
            .saturating_sub(meter.claimed_erc_generation);
        (meter_owner, unclaimed)
        // meter_data borrow dropped here
    };

    let poa_config = &mut ctx.accounts.poa_config;
    let erc_certificate = &mut ctx.accounts.erc_certificate;

    // Operational and config validation
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
    require!(
        validation_data.len() <= 256,
        GovernanceError::ValidationDataTooLong
    );

    // === PREVENT DOUBLE-CLAIMING ===
    require!(
        energy_amount <= unclaimed_generation,
        GovernanceError::InsufficientUnclaimedGeneration
    );

    // Check oracle requirement
    if poa_config.require_oracle_validation {
        require!(
            poa_config.oracle_authority.is_some(),
            GovernanceError::OracleValidationRequired
        );
    }

    // === CPI: mark energy as claimed in registry (prevents double-claiming) ===
    {
        let cpi_accounts = registry::cpi::accounts::MarkErcClaimed {
            meter_account: ctx.accounts.meter_account.to_account_info(),
            registry: ctx.accounts.registry.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.registry_program.key(),  // Anchor 1.0.0: takes Pubkey
            cpi_accounts,
        );
        registry::cpi::mark_erc_claimed(cpi_ctx, energy_amount)?;
    }

    // Initialize certificate
    let mut id_bytes = [0u8; 64];
    let id_slice = certificate_id.as_bytes();
    id_bytes[..id_slice.len()].copy_from_slice(id_slice);
    erc_certificate.certificate_id = id_bytes;
    erc_certificate.id_len = id_slice.len() as u8;

    erc_certificate.authority = ctx.accounts.authority.key();
    erc_certificate.owner = meter_owner;
    erc_certificate.energy_amount = energy_amount;

    let mut source_bytes = [0u8; 64];
    let source_slice = renewable_source.as_bytes();
    source_bytes[..source_slice.len()].copy_from_slice(source_slice);
    erc_certificate.renewable_source = source_bytes;
    erc_certificate.source_len = source_slice.len() as u8;

    let mut data_bytes = [0u8; 256];
    let data_slice = validation_data.as_bytes();
    data_bytes[..data_slice.len()].copy_from_slice(data_slice);
    erc_certificate.validation_data = data_bytes;
    erc_certificate.data_len = data_slice.len() as u16;

    erc_certificate.issued_at = clock.unix_timestamp;
    erc_certificate.status = ErcStatus::Valid;
    erc_certificate.validated_for_trading = false;
    erc_certificate.expires_at = Some(clock.unix_timestamp + poa_config.erc_validity_period);

    // Initialize revocation / transfer tracking fields
    erc_certificate.revocation_reason = [0u8; 128];
    erc_certificate.reason_len = 0;
    erc_certificate.revoked_at = None;
    erc_certificate.transfer_count = 0;
    erc_certificate.last_transferred_at = None;

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

    Ok(())
}

pub fn validate_for_trading(ctx: Context<ValidateErc>) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let erc_certificate = &mut ctx.accounts.erc_certificate;
    let clock = Clock::get()?;

    // Operational checks
    require!(
        poa_config.is_operational(),
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
    poa_config.total_ercs_validated = poa_config.total_ercs_validated.saturating_add(1);
    poa_config.last_updated = clock.unix_timestamp;

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

/// Revoke an ERC certificate - REC authority only
pub fn revoke(ctx: Context<crate::RevokeErc>, reason: String) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let erc_certificate = &mut ctx.accounts.erc_certificate;
    let clock = Clock::get()?;

    // Operational checks
    require!(
        poa_config.is_operational(),
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
    poa_config.total_ercs_revoked = poa_config.total_ercs_revoked.saturating_add(1);
    poa_config.last_updated = clock.unix_timestamp;

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

/// Transfer ERC ownership
pub fn transfer(ctx: Context<crate::TransferErc>) -> Result<()> {
    let poa_config = &mut ctx.accounts.poa_config;
    let erc_certificate = &mut ctx.accounts.erc_certificate;
    let clock = Clock::get()?;

    // Operational checks
    require!(
        poa_config.is_operational(),
        GovernanceError::MaintenanceMode
    );

    // Transfers must be enabled OR sender is authority (Issuance transfer)
    require!(
        poa_config.allow_certificate_transfers || erc_certificate.owner == poa_config.authority,
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

    // Transfer ownership
    erc_certificate.owner = to_owner;
    erc_certificate.transfer_count = erc_certificate.transfer_count.saturating_add(1);
    erc_certificate.last_transferred_at = Some(clock.unix_timestamp);

    emit!(ErcTransferred {
        certificate_id: String::from_utf8_lossy(
            &erc_certificate.certificate_id[..erc_certificate.id_len as usize]
        )
        .into_owned(),
        from_owner,
        to_owner,
        energy_amount,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
