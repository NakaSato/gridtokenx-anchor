use crate::errors::*;
use crate::events::*;
use crate::state::*;
use crate::{InitRecMint, IssueErc, RetireRec, ValidateErc};
use anchor_lang::prelude::*;
use anchor_spl::token_interface;

pub fn issue(
    ctx: Context<IssueErc>,
    certificate_id: String,
    energy_amount: u64,
    renewable_source: String,
    validation_data: String,
) -> Result<()> {
    let clock = Clock::get()?;

    let (meter_owner, unclaimed_generation) = {
        let meter_data = ctx.accounts.meter_account.try_borrow_data()?;
        require!(
            meter_data.len() >= 8 + std::mem::size_of::<MeterAccount>(),
            GovernanceError::InvalidMeterAccount
        );
        // Slice EXACTLY 8..8+size — `from_bytes` panics on a length mismatch, so passing the
        // whole `[8..]` remainder would DoS issuance if the account carries trailing bytes.
        // (Matches the safe pattern in dao.rs.)
        let meter = bytemuck::from_bytes::<MeterAccount>(
            &meter_data[8..8 + std::mem::size_of::<MeterAccount>()],
        );
        let meter_owner = Pubkey::new_from_array(meter.owner);
        let unclaimed = meter
            .total_generation
            .saturating_sub(meter.claimed_erc_generation)
            .saturating_sub(meter.settled_net_generation);
        (meter_owner, unclaimed)
    };

    let poa_config = &mut ctx.accounts.governance_config;
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
            poa_config.oracle_authority!= Pubkey::default(),
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
    poa_config.last_erc_issued_at = clock.unix_timestamp;

    emit!(ErcIssued {
        certificate_id,
        authority: ctx.accounts.authority.key(),
        energy_amount,
        renewable_source,
        timestamp: clock.unix_timestamp,
    });

    // === Mint fungible REC tokens to the producer (1 token = 1 MWh) ===
    // `energy_amount` is kWh; the REC mint has 6 decimals so 1 MWh = 1_000_000 base
    // units, hence 1 kWh = 1_000 base units. Producer = meter owner (the `owner` signer,
    // verified == rec_token_account authority by the ATA constraint).
    let rec_amount = energy_amount
        .checked_mul(1_000)
        .ok_or(GovernanceError::MathOverflow)?;
    let gov_bump = ctx.bumps.governance_config;
    let seeds: &[&[u8]] = &[b"poa_config", std::slice::from_ref(&gov_bump)];
    let signer = &[seeds];
    let cpi_accounts = token_interface::MintTo {
        mint: ctx.accounts.rec_mint.to_account_info(),
        to: ctx.accounts.rec_token_account.to_account_info(),
        authority: ctx.accounts.governance_config.to_account_info(),
    };
    token_interface::mint_to(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer),
        rec_amount,
    )?;

    emit!(RecMinted {
        owner: meter_owner,
        energy_amount,
        rec_amount,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

/// Initialize the fungible REC mint (PDA `[b"rec_mint"]`, 6 decimals, mint authority =
/// governance_config PDA). Run once before issuing certificates. The mint is created
/// entirely via account constraints.
pub fn init_rec_mint(_ctx: Context<InitRecMint>) -> Result<()> {
    Ok(())
}

/// Retire (burn) REC tokens — the standard REC end-of-life: the holder surrenders the
/// green attribute, removing supply. `amount` is in base units (6 decimals; 1 kWh = 1_000).
pub fn retire_rec(ctx: Context<RetireRec>, amount: u64) -> Result<()> {
    require!(amount > 0, GovernanceError::InvalidAmount);
    let now = Clock::get()?.unix_timestamp;
    let cpi_accounts = token_interface::Burn {
        mint: ctx.accounts.rec_mint.to_account_info(),
        from: ctx.accounts.holder_token_account.to_account_info(),
        authority: ctx.accounts.holder.to_account_info(),
    };
    token_interface::burn(
        CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts),
        amount,
    )?;
    emit!(RecRetired {
        holder: ctx.accounts.holder.key(),
        amount,
        timestamp: now,
    });
    Ok(())
}

pub fn validate_for_trading(ctx: Context<ValidateErc>) -> Result<()> {
    let poa_config = &mut ctx.accounts.governance_config;
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
    let poa_config = &mut ctx.accounts.governance_config;
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
    let poa_config = &mut ctx.accounts.governance_config;
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
