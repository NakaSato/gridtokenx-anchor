use anchor_lang::prelude::*;

#[account]
pub struct ErcCertificate {
    /// Unique certificate identifier - FIXED: 64 bytes
    pub certificate_id: [u8; 64],
    pub id_len: u8,
    /// Issuing authority (Engineering Department)
    pub authority: Pubkey,
    /// Current owner of the certificate (for transfers)
    pub owner: Pubkey,
    /// Amount of renewable energy (kWh)
    pub energy_amount: u64,
    /// Source of renewable energy (solar, wind, etc.) - FIXED: 64 bytes
    pub renewable_source: [u8; 64],
    pub source_len: u8,
    /// Additional validation data - FIXED: 256 bytes
    pub validation_data: [u8; 256],
    pub data_len: u16,
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
    /// Revocation reason (if revoked) - FIXED: 128 bytes
    pub revocation_reason: [u8; 128],
    pub reason_len: u8,
    /// When revoked
    pub revoked_at: Option<i64>,
    
    // === NEW: Transfer tracking ===
    /// Number of times transferred
    pub transfer_count: u8,
    /// Last transfer timestamp
    pub last_transferred_at: Option<i64>,
}

impl ErcCertificate {
    // Space calculation:
    // certificate_id (64 + 1) + Pubkey (32) + Pubkey (32) + u64 (8) + 
    // renewable_source (64 + 1) + validation_data (256 + 2) + i64 (8) + 
    // expires_at (Option<i64>: 9) + ErcStatus (1) + bool (1) + 
    // trading_validated_at (Option<i64>: 9) + revocation_reason (128 + 1) + 
    // revoked_at (Option<i64>: 9) + u8 (1) + last_transferred_at (Option<i64>: 9)
    pub const LEN: usize = 65 + 32 + 32 + 8 + 65 + 258 + 8 + 9 + 1 + 1 + 9 + 129 + 9 + 1 + 9;
    
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
