use crate::errors::GovernanceError;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct TransferErc<'info> {
    #[account(
        seeds = [b"governance_config"],
        bump
    )]
    pub governance_config: Account<'info, GovernanceConfig>,
    #[account(
        mut,
        seeds = [b"erc_certificate", erc_certificate.certificate_id[..erc_certificate.id_len as usize].as_ref()],
        bump,
        constraint = erc_certificate.owner == current_owner.key() @ GovernanceError::UnauthorizedAuthority
    )]
    pub erc_certificate: Account<'info, ErcCertificate>,
    /// Current owner of the certificate
    pub current_owner: Signer<'info>,
    /// New owner to transfer to
    /// CHECK: This is the new owner address, validated in handler
    pub new_owner: UncheckedAccount<'info>,
}

/// Transfer ERC ownership
pub fn transfer_erc(ctx: Context<TransferErc>) -> Result<()> {
    let governance_config = &mut ctx.accounts.governance_config;
    let erc_certificate = &mut ctx.accounts.erc_certificate;
    let clock = Clock::get()?;

    // Operational checks
    require!(
        governance_config.is_operational(),
        GovernanceError::MaintenanceMode
    );

    // Transfers must be enabled OR sender is authority (Issuance transfer)
    require!(
        governance_config.allow_certificate_transfers || erc_certificate.owner == governance_config.authority,
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
