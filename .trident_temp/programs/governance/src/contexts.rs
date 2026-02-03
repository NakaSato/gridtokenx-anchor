use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::GovernanceError;

// ========== INITIALIZATION ==========

#[derive(Accounts)]
pub struct InitializePoa<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + PoAConfig::LEN,
        seeds = [b"poa_config"],
        bump
    )]
    pub poa_config: Account<'info, PoAConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// ========== EMERGENCY CONTROL ==========

#[derive(Accounts)]
pub struct EmergencyControl<'info> {
    #[account(
        mut,
        seeds = [b"poa_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub poa_config: Account<'info, PoAConfig>,
    pub authority: Signer<'info>,
}

// ========== ERC CERTIFICATE ==========

#[derive(Accounts)]
#[instruction(certificate_id: String)]
pub struct IssueErc<'info> {
    #[account(
        seeds = [b"poa_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub poa_config: Account<'info, PoAConfig>,
    #[account(
        init,
        payer = authority,
        space = 8 + ErcCertificate::LEN,
        seeds = [b"erc_certificate", certificate_id.as_bytes()],
        bump
    )]
    pub erc_certificate: Account<'info, ErcCertificate>,
    /// Meter account from registry program - tracks claimed ERC generation
    /// CHECK: Manual validation and read-only usage
    pub meter_account: AccountInfo<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ValidateErc<'info> {
    #[account(
        seeds = [b"poa_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub poa_config: Account<'info, PoAConfig>,
    #[account(
        mut,
        seeds = [b"erc_certificate", erc_certificate.certificate_id.as_bytes()],
        bump
    )]
    pub erc_certificate: Account<'info, ErcCertificate>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RevokeErc<'info> {
    #[account(
        mut,
        seeds = [b"poa_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub poa_config: Account<'info, PoAConfig>,
    #[account(
        mut,
        seeds = [b"erc_certificate", erc_certificate.certificate_id.as_bytes()],
        bump
    )]
    pub erc_certificate: Account<'info, ErcCertificate>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TransferErc<'info> {
    #[account(
        seeds = [b"poa_config"],
        bump
    )]
    pub poa_config: Account<'info, PoAConfig>,
    #[account(
        mut,
        seeds = [b"erc_certificate", erc_certificate.certificate_id.as_bytes()],
        bump,
        constraint = erc_certificate.owner == current_owner.key() @ GovernanceError::UnauthorizedAuthority
    )]
    pub erc_certificate: Account<'info, ErcCertificate>,
    /// Current owner of the certificate
    pub current_owner: Signer<'info>,
    /// New owner to transfer to
    /// CHECK: This is the new owner address, validated in handler
    pub new_owner: AccountInfo<'info>,
}

// ========== GOVERNANCE CONFIG ==========

#[derive(Accounts)]
pub struct UpdateGovernanceConfig<'info> {
    #[account(
        mut,
        seeds = [b"poa_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub poa_config: Account<'info, PoAConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct GetGovernanceStats<'info> {
    #[account(
        seeds = [b"poa_config"],
        bump
    )]
    pub poa_config: Account<'info, PoAConfig>,
}

// ========== AUTHORITY MANAGEMENT ==========

#[derive(Accounts)]
pub struct ProposeAuthorityChange<'info> {
    #[account(
        mut,
        seeds = [b"poa_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub poa_config: Account<'info, PoAConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ApproveAuthorityChange<'info> {
    #[account(
        mut,
        seeds = [b"poa_config"],
        bump
    )]
    pub poa_config: Account<'info, PoAConfig>,
    /// The proposed new authority who must sign to approve
    pub new_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelAuthorityChange<'info> {
    #[account(
        mut,
        seeds = [b"poa_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub poa_config: Account<'info, PoAConfig>,
    pub authority: Signer<'info>,
}

// ========== ORACLE INTEGRATION ==========

#[derive(Accounts)]
pub struct SetOracleAuthority<'info> {
    #[account(
        mut,
        seeds = [b"poa_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub poa_config: Account<'info, PoAConfig>,
    pub authority: Signer<'info>,
}
