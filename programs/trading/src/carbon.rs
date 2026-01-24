use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Carbon Credit Marketplace for GridTokenX
/// 
/// Enables trading of Renewable Energy Certificates (RECs):
/// - REC token minting based on verified green energy production
/// - Carbon offset trading with price discovery
/// - Certificate retirement for compliance
/// - Audit trail for regulatory reporting

/// REC certificate types
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum RecType {
    /// Solar energy certificate
    Solar = 0,
    /// Wind energy certificate
    Wind = 1,
    /// Hydro energy certificate
    Hydro = 2,
    /// Biomass energy certificate
    Biomass = 3,
    /// Geothermal energy certificate
    Geothermal = 4,
    /// Mixed renewable sources
    Mixed = 5,
}

impl Default for RecType {
    fn default() -> Self {
        RecType::Solar
    }
}

/// Retirement reason for compliance tracking
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum RetirementReason {
    /// Voluntary carbon offset
    Voluntary = 0,
    /// Regulatory compliance (RPS/RES)
    Compliance = 1,
    /// Corporate sustainability goal
    Corporate = 2,
    /// Government mandate
    Mandate = 3,
    /// Personal offset
    Personal = 4,
}

impl Default for RetirementReason {
    fn default() -> Self {
        RetirementReason::Voluntary
    }
}

/// Carbon marketplace configuration
#[account]
#[derive(Default)]
pub struct CarbonMarketplace {
    /// Bump seed for PDA
    pub bump: u8,
    
    /// Marketplace authority
    pub authority: Pubkey,
    
    /// REC token mint
    pub rec_mint: Pubkey,
    
    /// Carbon token mint (tradeable)
    pub carbon_mint: Pubkey,
    
    /// Treasury for collected fees
    pub treasury: Pubkey,
    
    /// Minting fee (basis points)
    pub minting_fee_bps: u16,
    
    /// Trading fee (basis points)
    pub trading_fee_bps: u16,
    
    /// Retirement fee (basis points)
    pub retirement_fee_bps: u16,
    
    /// Total RECs minted
    pub total_minted: u64,
    
    /// Total RECs retired
    pub total_retired: u64,
    
    /// Total carbon offset (kg CO2e)
    pub total_carbon_offset: u64,
    
    /// Active listings count
    pub active_listings: u32,
    
    /// Whether marketplace is active
    pub is_active: bool,
    
    /// Conversion rate: kWh to REC tokens (scaled by 1000)
    /// e.g., 1000 = 1 REC per kWh, 100 = 0.1 REC per kWh
    pub kwh_to_rec_rate: u32,
    
    /// Carbon intensity factor (g CO2e avoided per kWh)
    pub carbon_intensity: u32,
    
    /// Reserved
    /// Reserved
    pub _reserved: [u8; 32],
}

/// Instructions
pub fn initialize_carbon_marketplace(
    ctx: Context<InitializeCarbonMarketplace>,
    minting_fee_bps: u16,
    trading_fee_bps: u16,
    kwh_to_rec_rate: u32,
    carbon_intensity: u32,
) -> Result<()> {
    let market = &mut ctx.accounts.marketplace;
    market.bump = ctx.bumps.marketplace;
    market.authority = ctx.accounts.authority.key();
    market.rec_mint = ctx.accounts.rec_mint.key();
    market.carbon_mint = ctx.accounts.carbon_mint.key();
    market.treasury = ctx.accounts.treasury.key();
    market.minting_fee_bps = minting_fee_bps;
    market.trading_fee_bps = trading_fee_bps;
    market.kwh_to_rec_rate = kwh_to_rec_rate;
    market.carbon_intensity = carbon_intensity;
    market.is_active = true;
    
    Ok(())
}

pub fn mint_rec_certificate(
    ctx: Context<MintRecCertificate>,
    generation_start: i64,
    generation_end: i64,
) -> Result<()> {
    let marketplace = &mut ctx.accounts.marketplace;
    let certificate = &mut ctx.accounts.certificate;
    let verified_reading = &ctx.accounts.verified_reading;
    let clock = Clock::get()?;
    
    let energy_amount = verified_reading.value;
    let rec_amount = carbon_utils::calculate_rec_amount(energy_amount, marketplace.kwh_to_rec_rate);
    let carbon_offset = carbon_utils::calculate_carbon_offset(energy_amount, marketplace.carbon_intensity);
    
    certificate.bump = ctx.bumps.certificate;
    certificate.certificate_id = marketplace.total_minted;
    certificate.owner = ctx.accounts.issuer.key();
    certificate.issuer = ctx.accounts.issuer.key();
    certificate.rec_type = RecType::Solar as u8;
    certificate.energy_amount = energy_amount;
    certificate.rec_amount = rec_amount;
    certificate.carbon_offset = carbon_offset;
    certificate.generation_start = generation_start;
    certificate.generation_end = generation_end;
    certificate.issued_at = clock.unix_timestamp;
    certificate.meter = verified_reading.meter;
    certificate.verified_by = verified_reading.verified_by;
    certificate.is_retired = false;
    
    marketplace.total_minted += 1;
    marketplace.total_carbon_offset += carbon_offset;
    
    emit!(RecMinted {
        certificate_id: certificate.certificate_id,
        issuer: certificate.issuer,
        rec_type: certificate.rec_type,
        energy_amount,
        rec_amount,
        carbon_offset,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeCarbonMarketplace<'info> {
    #[account(
        init,
        payer = authority,
        space = CarbonMarketplace::LEN,
        seeds = [b"carbon_marketplace", authority.key().as_ref()],
        bump
    )]
    pub marketplace: Account<'info, CarbonMarketplace>,
    
    /// CHECK: REC Mint
    pub rec_mint: AccountInfo<'info>,
    /// CHECK: Carbon Mint
    pub carbon_mint: AccountInfo<'info>,
    /// CHECK: Treasury
    pub treasury: AccountInfo<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintRecCertificate<'info> {
    #[account(mut)]
    pub marketplace: Account<'info, CarbonMarketplace>,
    
    #[account(
        init,
        payer = issuer,
        space = RecCertificate::LEN,
        seeds = [b"rec_cert", marketplace.key().as_ref(), &marketplace.total_minted.to_le_bytes()],
        bump
    )]
    pub certificate: Account<'info, RecCertificate>,
    
    #[account(mut)]
    pub issuer: Signer<'info>,
    
    /// The verified reading that justifies this REC issuance
    pub verified_reading: Account<'info, crate::meter_verification::VerifiedReading>,
    
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl CarbonMarketplace {
    pub const LEN: usize = 8 + // discriminator
        1 +   // bump
        32 +  // authority
        32 +  // rec_mint
        32 +  // carbon_mint
        32 +  // treasury
        2 +   // minting_fee_bps
        2 +   // trading_fee_bps
        2 +   // retirement_fee_bps
        8 +   // total_minted
        8 +   // total_retired
        8 +   // total_carbon_offset
        4 +   // active_listings
        1 +   // is_active
        4 +   // kwh_to_rec_rate
        4 +   // carbon_intensity
        64;   // reserved
}

/// REC certificate metadata
#[account]
pub struct RecCertificate {
    /// Bump seed for PDA
    pub bump: u8,
    
    /// Unique certificate ID
    pub certificate_id: u64,
    
    /// Owner of the certificate
    pub owner: Pubkey,
    
    /// Original issuer (prosumer)
    pub issuer: Pubkey,
    
    /// Energy source type
    pub rec_type: u8,
    
    /// Energy amount (kWh * 1000)
    pub energy_amount: u64,
    
    /// REC token amount
    pub rec_amount: u64,
    
    /// Carbon offset (g CO2e)
    pub carbon_offset: u64,
    
    /// Generation start timestamp
    pub generation_start: i64,
    
    /// Generation end timestamp
    pub generation_end: i64,
    
    /// Issuance timestamp
    pub issued_at: i64,
    
    /// Location (grid zone)
    pub location: [u8; 8],
    
    /// Meter that generated this energy
    pub meter: Pubkey,
    
    /// Verification oracle
    pub verified_by: Pubkey,
    
    /// Is certificate retired
    pub is_retired: bool,
    
    /// Retirement info (if retired)
    pub retirement_reason: u8,
    pub retired_at: i64,
    pub retired_by: Pubkey,
    pub retirement_beneficiary: [u8; 32], // Name/description (shortened)
    
    /// Reserved
    pub _reserved: [u8; 32],
}

impl RecCertificate {
    pub const LEN: usize = 8 + // discriminator
        1 +   // bump
        8 +   // certificate_id
        32 +  // owner
        32 +  // issuer
        1 +   // rec_type
        8 +   // energy_amount
        8 +   // rec_amount
        8 +   // carbon_offset
        8 +   // generation_start
        8 +   // generation_end
        8 +   // issued_at
        8 +   // location
        32 +  // meter
        32 +  // verified_by
        1 +   // is_retired
        1 +   // retirement_reason
        8 +   // retired_at
        32 +  // retired_by
        32 +  // retirement_beneficiary
        32;   // reserved
}

/// Carbon offset listing for trading
#[account]
#[derive(Default)]
pub struct CarbonListing {
    /// Bump seed for PDA
    pub bump: u8,
    
    /// Listing ID
    pub listing_id: u64,
    
    /// Seller
    pub seller: Pubkey,
    
    /// REC certificate being sold
    pub certificate: Pubkey,
    
    /// Amount of RECs for sale
    pub amount: u64,
    
    /// Price per REC token (in payment token)
    pub price_per_rec: u64,
    
    /// Payment token mint
    pub payment_mint: Pubkey,
    
    /// Minimum purchase amount
    pub min_purchase: u64,
    
    /// Expiry timestamp
    pub expires_at: i64,
    
    /// Created timestamp
    pub created_at: i64,
    
    /// Is listing active
    pub is_active: bool,
    
    /// Total sold from this listing
    pub total_sold: u64,
    
    /// Reserved
    pub _reserved: [u8; 32],
}

impl CarbonListing {
    pub const LEN: usize = 8 + // discriminator
        1 +   // bump
        8 +   // listing_id
        32 +  // seller
        32 +  // certificate
        8 +   // amount
        8 +   // price_per_rec
        32 +  // payment_mint
        8 +   // min_purchase
        8 +   // expires_at
        8 +   // created_at
        1 +   // is_active
        8 +   // total_sold
        32;   // reserved
}

/// Retirement record for compliance/audit
#[account]
#[derive(Default)]
pub struct RetirementRecord {
    /// Unique retirement ID
    pub retirement_id: u64,
    
    /// Certificate that was retired
    pub certificate: Pubkey,
    
    /// Amount retired
    pub amount: u64,
    
    /// Carbon offset (g CO2e)
    pub carbon_offset: u64,
    
    /// Retirement reason
    pub reason: u8,
    
    /// Retired by
    pub retired_by: Pubkey,
    
    /// Beneficiary name/description
    pub beneficiary: [u8; 32],
    
    /// Compliance period (e.g., "2026-Q1")
    pub compliance_period: [u8; 16],
    
    /// Retired timestamp
    pub retired_at: i64,
    
    /// Transaction signature for proof
    pub tx_signature: [u8; 32],
    
    /// Reserved
    pub _reserved: [u8; 32],
}

impl RetirementRecord {
    pub const LEN: usize = 8 + // discriminator
        8 +   // retirement_id
        32 +  // certificate
        8 +   // amount
        8 +   // carbon_offset
        1 +   // reason
        32 +  // retired_by
        32 +  // beneficiary
        16 +  // compliance_period
        8 +   // retired_at
        32 +  // tx_signature
        32;   // reserved
}

/// Events
#[event]
pub struct RecMinted {
    pub certificate_id: u64,
    pub issuer: Pubkey,
    pub rec_type: u8,
    pub energy_amount: u64,
    pub rec_amount: u64,
    pub carbon_offset: u64,
    pub timestamp: i64,
}

#[event]
pub struct RecTransferred {
    pub certificate: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct RecRetired {
    pub retirement_id: u64,
    pub certificate: Pubkey,
    pub amount: u64,
    pub carbon_offset: u64,
    pub reason: u8,
    pub beneficiary: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct ListingCreated {
    pub listing_id: u64,
    pub seller: Pubkey,
    pub certificate: Pubkey,
    pub amount: u64,
    pub price_per_rec: u64,
    pub timestamp: i64,
}

#[event]
pub struct ListingFilled {
    pub listing_id: u64,
    pub buyer: Pubkey,
    pub amount: u64,
    pub total_price: u64,
    pub timestamp: i64,
}

/// Error codes
#[error_code]
pub enum CarbonError {
    #[msg("Marketplace is not active")]
    MarketplaceInactive,
    
    #[msg("Certificate already retired")]
    CertificateRetired,
    
    #[msg("Insufficient REC balance")]
    InsufficientBalance,
    
    #[msg("Listing has expired")]
    ListingExpired,
    
    #[msg("Purchase amount below minimum")]
    BelowMinimumPurchase,
    
    #[msg("Listing not active")]
    ListingInactive,
    
    #[msg("Invalid REC type")]
    InvalidRecType,
    
    #[msg("Unauthorized issuance")]
    UnauthorizedIssuance,
    
    #[msg("Certificate not verified")]
    NotVerified,
}

/// Carbon calculation utilities
pub mod carbon_utils {
    use super::*;
    
    /// Calculate carbon offset from energy amount
    /// Returns grams of CO2e avoided
    pub fn calculate_carbon_offset(
        energy_kwh: u64,
        carbon_intensity: u32,
    ) -> u64 {
        // energy_kwh is in kWh * 1000 (milli-kWh)
        // carbon_intensity is in g CO2e per kWh
        (energy_kwh as u128 * carbon_intensity as u128 / 1000) as u64
    }
    
    /// Calculate REC amount from energy
    pub fn calculate_rec_amount(
        energy_kwh: u64,
        kwh_to_rec_rate: u32,
    ) -> u64 {
        // kwh_to_rec_rate is scaled by 1000
        (energy_kwh as u128 * kwh_to_rec_rate as u128 / 1_000_000) as u64
    }
    
    /// Get default carbon intensity by REC type (g CO2e/kWh)
    /// Based on typical grid displacement factors
    pub fn get_carbon_intensity(rec_type: RecType) -> u32 {
        match rec_type {
            RecType::Solar => 450,      // Solar displaces ~450g CO2e/kWh
            RecType::Wind => 470,       // Wind slightly higher
            RecType::Hydro => 480,      // Hydro highest
            RecType::Biomass => 300,    // Biomass lower (some emissions)
            RecType::Geothermal => 400, // Geothermal moderate
            RecType::Mixed => 420,      // Average
        }
    }
    
    /// Format carbon offset for display (kg)
    pub fn format_carbon_offset_kg(grams: u64) -> u64 {
        grams / 1000
    }
    
    /// Format carbon offset for display (tonnes)
    pub fn format_carbon_offset_tonnes(grams: u64) -> u64 {
        grams / 1_000_000
    }
}

/// Compliance utilities
pub mod compliance {
    use super::*;
    
    /// Generate compliance report data
    pub fn generate_report_hash(
        certificate: &RecCertificate,
        retirement: &RetirementRecord,
    ) -> [u8; 32] {
        let mut data = [0u8; 128];
        data[0..8].copy_from_slice(&certificate.certificate_id.to_le_bytes());
        data[8..16].copy_from_slice(&retirement.retirement_id.to_le_bytes());
        data[16..24].copy_from_slice(&retirement.amount.to_le_bytes());
        data[24..32].copy_from_slice(&retirement.carbon_offset.to_le_bytes());
        data[32..40].copy_from_slice(&retirement.retired_at.to_le_bytes());
        data[40..72].copy_from_slice(retirement.retired_by.as_ref());
        
        // Simple hash
        let mut hash = [0u8; 32];
        for i in 0..32 {
            hash[i] = data[i] ^ data[i + 32] ^ data[i + 64] ^ data[i + 96];
        }
        hash
    }
    
    /// Validate compliance period format (YYYY-QN)
    pub fn validate_compliance_period(period: &[u8; 16]) -> bool {
        // Basic validation - should be like "2026-Q1"
        period[4] == b'-' && period[5] == b'Q'
    }
}
