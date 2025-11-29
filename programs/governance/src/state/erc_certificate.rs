use anchor_lang::prelude::*;

#[account]
pub struct ErcCertificate {
    /// Unique certificate identifier
    pub certificate_id: String,
    /// Issuing authority (Engineering Department)
    pub authority: Pubkey,
    /// Current owner of the certificate (for transfers)
    pub owner: Pubkey,
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
    
    // === NEW: Revocation tracking ===
    /// Revocation reason (if revoked)
    pub revocation_reason: Option<String>,
    /// When revoked
    pub revoked_at: Option<i64>,
    
    // === NEW: Transfer tracking ===
    /// Number of times transferred
    pub transfer_count: u8,
    /// Last transfer timestamp
    pub last_transferred_at: Option<i64>,
}

impl ErcCertificate {
    // Updated space: original + owner(32) + revocation_reason(1+128) + revoked_at(9) + transfer_count(1) + last_transferred_at(9)
    pub const LEN: usize = 64 + 32 + 32 + 8 + 64 + 256 + 8 + 9 + 1 + 1 + 9 + 129 + 9 + 1 + 9;
    
    /// Check if certificate can be transferred
    pub fn can_transfer(&self) -> bool {
        self.status == ErcStatus::Valid && self.validated_for_trading
    }
    
    /// Check if certificate can be revoked
    pub fn can_revoke(&self) -> bool {
        self.status == ErcStatus::Valid || self.status == ErcStatus::Pending
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ErcStatus {
    Valid,
    Expired,
    Revoked,
    Pending,
}
