use anchor_lang::prelude::*;

#[account]
pub struct ErcCertificate {
    /// Unique certificate identifier
    pub certificate_id: String,
    /// Issuing authority (Engineering Department)
    pub authority: Pubkey,
    /// Amount of renewable energy (kWh)
    pub energy_amount: u64,
    /// Source of renewable energy (solar, wind, etc.)
    pub renewable_source: String,
    /// Additional validation data
    pub validation_data: String,
    /// When the certificate was issued
    pub issued_at: i64,
    /// When the certificate expires
    pub expires_at: Option<i64>,
    /// Current status of the certificate
    pub status: ErcStatus,
    /// Whether validated for trading
    pub validated_for_trading: bool,
    /// When validated for trading
    pub trading_validated_at: Option<i64>,
}

impl ErcCertificate {
    pub const LEN: usize = 64 + 32 + 8 + 64 + 256 + 8 + 9 + 1 + 1 + 9;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ErcStatus {
    Valid,
    Expired,
    Revoked,
    Pending,
}
