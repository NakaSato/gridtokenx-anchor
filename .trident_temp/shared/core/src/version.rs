use anchor_lang::prelude::*;

/// Program version tracking for upgradeable programs
/// This account stores version information and migration state
#[account]
#[derive(Default)]
pub struct ProgramVersion {
    /// Current version number (incremented on each upgrade)
    pub version: u16,
    
    /// Timestamp of last upgrade
    pub last_upgrade: i64,
    
    /// Authority allowed to upgrade the program
    pub upgrade_authority: Pubkey,
    
    /// Whether the program is currently paused for migration
    pub is_migrating: bool,
    
    /// Reserved for future use
    pub _reserved: [u8; 64],
}

impl ProgramVersion {
    pub const LEN: usize = 8 + // discriminator
        2 +  // version
        8 +  // last_upgrade
        32 + // upgrade_authority
        1 +  // is_migrating
        64;  // reserved
}

/// Version history entry for audit trail
#[account]
pub struct VersionHistory {
    /// Program ID this history belongs to
    pub program_id: Pubkey,
    
    /// Version number
    pub version: u16,
    
    /// Timestamp when this version was deployed
    pub deployed_at: i64,
    
    /// Who performed the upgrade
    pub upgraded_by: Pubkey,
    
    /// Optional description/changelog
    pub description: [u8; 256],
    
    /// Hash of the deployed program binary
    pub program_hash: [u8; 32],
}

impl VersionHistory {
    pub const LEN: usize = 8 + // discriminator
        32 + // program_id
        2 +  // version
        8 +  // deployed_at
        32 + // upgraded_by
        256 + // description
        32;  // program_hash
}

/// Migration state for tracking data migrations during upgrades
#[account]
pub struct MigrationState {
    /// Current migration version (from)
    pub from_version: u16,
    
    /// Target migration version (to)
    pub to_version: u16,
    
    /// Total accounts to migrate
    pub total_accounts: u64,
    
    /// Accounts already migrated
    pub migrated_accounts: u64,
    
    /// Whether migration is complete
    pub is_complete: bool,
    
    /// Timestamp when migration started
    pub started_at: i64,
    
    /// Timestamp when migration completed (0 if not complete)
    pub completed_at: i64,
}

impl MigrationState {
    pub const LEN: usize = 8 + // discriminator
        2 +  // from_version
        2 +  // to_version
        8 +  // total_accounts
        8 +  // migrated_accounts
        1 +  // is_complete
        8 +  // started_at
        8;   // completed_at
}

/// Error codes for version management
#[error_code]
pub enum VersionError {
    #[msg("Invalid version number")]
    InvalidVersion,
    
    #[msg("Version mismatch - migration required")]
    VersionMismatch,
    
    #[msg("Migration already in progress")]
    MigrationInProgress,
    
    #[msg("Migration not complete")]
    MigrationNotComplete,
    
    #[msg("Unauthorized upgrade authority")]
    UnauthorizedUpgrade,
    
    #[msg("Program is paused for migration")]
    ProgramPaused,
    
    #[msg("Cannot downgrade version")]
    CannotDowngrade,
}

/// Events for version tracking
#[event]
pub struct ProgramUpgraded {
    pub program_id: Pubkey,
    pub from_version: u16,
    pub to_version: u16,
    pub upgraded_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MigrationStarted {
    pub program_id: Pubkey,
    pub from_version: u16,
    pub to_version: u16,
    pub total_accounts: u64,
    pub timestamp: i64,
}

#[event]
pub struct MigrationCompleted {
    pub program_id: Pubkey,
    pub from_version: u16,
    pub to_version: u16,
    pub migrated_accounts: u64,
    pub duration_seconds: i64,
}
