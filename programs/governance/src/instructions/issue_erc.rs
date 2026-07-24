use crate::errors::*;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self as token_interface, Mint as MintInterface, TokenAccount as TokenAccountInterface,
    TokenInterface,
};

#[derive(Accounts)]
#[instruction(certificate_id: String)]
pub struct IssueErc<'info> {
    #[account(
        mut,
        seeds = [b"governance_config"],
        bump,
        has_one = authority @ GovernanceError::UnauthorizedAuthority
    )]
    pub governance_config: Account<'info, GovernanceConfig>,
    #[account(
        init,
        payer = authority,
        space = 8 + ErcCertificate::LEN,
        seeds = [b"erc_certificate", certificate_id.as_bytes()],
        bump
    )]
    pub erc_certificate: Account<'info, ErcCertificate>,
    /// Meter account from registry program - stricter validation via owner constraint
    /// CHECK: Validated via owner constraint and manual deserialization below
    #[account(
        mut,
        owner = registry::ID @ GovernanceError::InvalidMeterAccount
    )]
    pub meter_account: UncheckedAccount<'info>,
    /// Meter owner must sign to authorize issuance
    #[account(
        constraint = {
            let data = meter_account.try_borrow_data()?;
            require!(data.len() >= 8 + std::mem::size_of::<MeterAccount>(), GovernanceError::InvalidMeterAccount);
            let meter = bytemuck::from_bytes::<MeterAccount>(&data[8..]);
            Pubkey::from(meter.owner) == owner.key()
        } @ GovernanceError::UnauthorizedAuthority
    )]
    pub owner: Signer<'info>,
    /// Registry singleton PDA ["registry"] - authority must match governance authority
    /// CHECK: Registry authority is validated against governance authority below
    #[account(
        constraint = {
            let data = registry.try_borrow_data()?;
            // Registry layout: authority is first field (32 bytes) after 8-byte discriminator
            require!(data.len() >= 40, GovernanceError::InvalidMeterAccount);
            let reg_authority = Pubkey::try_from(&data[8..40]).map_err(|_| GovernanceError::InvalidMeterAccount)?;
            require!(
                reg_authority == authority.key(),
                GovernanceError::UnauthorizedAuthority
            );
            true
        }
    )]
    pub registry: UncheckedAccount<'info>,
    /// The registry program - used to invoke mark_erc_claimed
    /// CHECK: pinned to the real registry program ID
    #[account(constraint = registry_program.key() == registry::ID @ GovernanceError::InvalidMeterAccount)]
    pub registry_program: UncheckedAccount<'info>,
    /// Fungible REC mint (1 token = 1 MWh, 6 decimals). Created by `init_rec_mint`.
    #[account(mut, seeds = [b"rec_mint"], bump)]
    pub rec_mint: Box<InterfaceAccount<'info, MintInterface>>,
    /// Producer's REC associated token account (owner = meter owner signer).
    /// REC tokens are minted here on issuance.
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = rec_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub rec_token_account: Box<InterfaceAccount<'info, TokenAccountInterface>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn issue_erc(
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
        // Net-generation basis — MUST match registry `mark_erc_claimed`, which is the
        // authoritative bound: the CPI below re-checks against net generation and reverts
        // the whole tx if exceeded, so combined GRID + REC claims can never exceed net.
        // This local precheck fails fast with a clearer error; keeping it on the same
        // (net) basis avoids a looser "unclaimed" the CPI would then reject.
        let net_generation = meter
            .total_generation
            .saturating_sub(meter.total_consumption);
        let unclaimed = net_generation
            .saturating_sub(meter.claimed_erc_generation)
            .saturating_sub(meter.settled_net_generation);
        (meter_owner, unclaimed)
    };

    let governance_config = &mut ctx.accounts.governance_config;
    let erc_certificate = &mut ctx.accounts.erc_certificate;

    // Operational and config validation
    require!(
        governance_config.can_issue_erc(),
        GovernanceError::ErcValidationDisabled
    );
    require!(
        energy_amount >= governance_config.min_energy_amount,
        GovernanceError::BelowMinimumEnergy
    );
    require!(
        energy_amount <= governance_config.max_erc_amount,
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

    // === PREVENT DOUBLE-CLAIMING (net-basis precheck; registry mark_erc_claimed CPI is authoritative) ===
    require!(
        energy_amount <= unclaimed_generation,
        GovernanceError::InsufficientUnclaimedGeneration
    );

    // Check oracle requirement
    if governance_config.require_oracle_validation {
        require!(
            governance_config.oracle_authority!= Pubkey::default(),
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
    erc_certificate.expires_at = Some(clock.unix_timestamp + governance_config.erc_validity_period);

    // Initialize revocation / transfer tracking fields
    erc_certificate.revocation_reason = [0u8; 128];
    erc_certificate.reason_len = 0;
    erc_certificate.revoked_at = None;
    erc_certificate.transfer_count = 0;
    erc_certificate.last_transferred_at = None;

    // Update comprehensive statistics
    governance_config.total_ercs_issued = governance_config.total_ercs_issued.saturating_add(1);
    governance_config.total_energy_certified = governance_config
        .total_energy_certified
        .saturating_add(energy_amount);
    governance_config.last_updated = clock.unix_timestamp;
    governance_config.last_erc_issued_at = clock.unix_timestamp;

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
    let seeds: &[&[u8]] = &[b"governance_config", std::slice::from_ref(&gov_bump)];
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
