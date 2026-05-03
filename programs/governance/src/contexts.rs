use crate::errors::GovernanceError;
use crate::state::*;
use anchor_lang::prelude::*;

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
        seeds = [b"erc_certificate", erc_certificate.certificate_id[..erc_certificate.id_len as usize].as_ref()],
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
        seeds = [b"erc_certificate", erc_certificate.certificate_id[..erc_certificate.id_len as usize].as_ref()],
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
        seeds = [b"erc_certificate", erc_certificate.certificate_id[..erc_certificate.id_len as usize].as_ref()],
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

// ========== DAO GOVERNANCE ==========

#[derive(Accounts)]
#[instruction(target_zone: i32, proposal_id: u64)]
pub struct CreateProposal<'info> {
    #[account(
        init,
        payer = proposer,
        space = Proposal::LEN,
        seeds = [b"proposal", target_zone.to_le_bytes().as_ref(), proposal_id.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(mut)]
    pub proposer: Signer<'info>,
    /// We need to verify that the proposer has a registered meter in the target zone
    /// CHECK: Manual validation in handler
    pub meter_account: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(
        init,
        payer = voter,
        space = VoteRecord::LEN,
        seeds = [b"vote", proposal.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub vote_record: Account<'info, VoteRecord>,
    #[account(mut)]
    pub voter: Signer<'info>,
    /// Voter's meter account to determine voting weight
    /// CHECK: Manual validation in handler
    pub meter_account: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    #[account(
        mut,
        seeds = [b"zone_config", zone_config.zone_id.to_le_bytes().as_ref()],
        bump
    )]
    pub zone_config: Account<'info, ZoneConfig>,
    #[account(
        mut,
        constraint = proposal.target_zone == zone_config.zone_id @ GovernanceError::InvalidTargetZone,
        constraint = proposal.status == ProposalStatus::Passed @ GovernanceError::InvalidProposalStatus
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(mut)]
    pub executor: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(zone_id: i32)]
pub struct InitializeZoneConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = ZoneConfig::LEN,
        seeds = [b"zone_config", zone_id.to_le_bytes().as_ref()],
        bump
    )]
    pub zone_config: Account<'info, ZoneConfig>,
    #[account(
        seeds = [b"poa_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub poa_config: Account<'info, PoAConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
