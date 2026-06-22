// Registry program state

use anchor_lang::prelude::*;

/// Registry account for metadata storage
#[account(zero_copy)]
#[repr(C)]
pub struct Registry {
    pub authority: Pubkey,
    pub oracle_authority: Pubkey, // Authorized oracle (Option -> Pubkey for ZeroCopy)
    pub has_oracle_authority: u8, // Track if oracle_authority is valid (u8 for Pod)
    pub has_slash_destination: u8, // Track if slash_destination is configured (u8 for Pod)
    pub _padding: [u8; 6],        // Alignment
    pub user_count: u64,
    pub meter_count: u64,
    pub active_meter_count: u64, // Track active meters separately
    pub slash_destination: Pubkey, // Allowed sink for slashed validator bonds (e.g. treasury reward_vault)
}

/// RegistryShard account for distributed counters
#[account(zero_copy)]
#[repr(C)]
pub struct RegistryShard {
    pub shard_id: u8,
    pub bump: u8, // Canonical PDA bump, stored on init to avoid find_program_address re-derivation
    pub _padding: [u8; 6],
    pub user_count: u64,
    pub meter_count: u64,
    pub active_meter_count: u64, // Meters currently Active on this shard; global total reconciled via aggregate_shards
}

impl RegistryShard {
    pub fn load_from_bytes(data: &[u8]) -> Result<&Self> {
        Ok(bytemuck::from_bytes(data))
    }
}

/// Published accounting for the transparent slash fund (T1.4). Inflows are the
/// `slash_fund` vault's GRX balance (slashed remainders routed in via the existing
/// `slash_destination`); outflows are tracked here precisely, with one event per
/// disbursement, so the fund's redistribution history is auditable on-chain.
#[account(zero_copy)]
#[repr(C)]
pub struct SlashFundLedger {
    pub total_disbursed: u64,     // cumulative GRX paid out of the fund
    pub disbursement_count: u64,  // number of disburse_slash_fund calls
    pub last_disbursed_ts: i64,   // unix ts of the most recent disbursement
    pub bump: u8,                 // canonical PDA bump
    pub _padding: [u8; 7],
}

/// User account for frequent lookups
#[account(zero_copy)]
#[repr(C)]
pub struct UserAccount {
    pub authority: Pubkey,   // 32 bytes (0-32)
    pub user_type: UserType, // 1 byte (32-33)
    pub _padding1: [u8; 3],  // 3 bytes padding (33-36)
    pub lat_e7: i32,         // 4 bytes (36-40)
    pub long_e7: i32,        // 4 bytes (40-44)
    pub _padding2: [u8; 4],  // 4 bytes padding (44-48) - Ensures 8-byte alignment for h3_index
    pub h3_index: u64,       // 8 bytes (48-56)
    pub status: UserStatus,  // 1 byte (56-57)
    pub validator_status: ValidatorStatus, // 1 byte (57-58)
    pub shard_id: u8,        // 1 byte (58-59)
    pub airdrop_claimed: u8, // 1 byte (59-60) - 0 = unclaimed, 1 = claimed (reclaimed from padding)
    pub _padding3: [u8; 4],  // 4 bytes padding (60-64)
    pub registered_at: i64,  // 8 bytes (64-72)
    pub meter_count: u32,    // 4 bytes (72-76)
    pub _padding4: [u8; 4],  // 4 bytes padding (76-80) - Alignment for staked_grx
    pub staked_grx: u64,     // 8 bytes (80-88)
    pub last_stake_at: i64,  // 8 bytes (88-96)
    pub resign_at: i64,      // 8 bytes (96-104) - unix ts of deregister_validator; 0 = not resigning.
                             //   Carved from former _padding5; total still 104 bytes (multiple of 8).
}

/// Meter account for reading updates
#[account(zero_copy)]
#[repr(C)]
pub struct MeterAccount {
    pub meter_id: [u8; 32],    // Unique meter identifier (fixed size for ZeroCopy)
    pub owner: Pubkey,         // User who owns this meter
    pub meter_type: MeterType, // Solar, Wind, Battery, or Grid (offset 64)
    pub status: MeterStatus,   // Active, Inactive, or Maintenance (65)
    pub _pad_a: [u8; 2],       // Alignment to the i32 below (66-68)
    pub zone_id: i32,          // Microgrid zone this meter belongs to (68-72). Carved from the
                               //   former _padding[6]; binds the meter to one governance zone so
                               //   its vote weight can only affect that zone. Existing accounts
                               //   read 0 (zone 0). Size unchanged.
    pub registered_at: i64,    // When meter was registered (72)
    pub last_reading_at: i64,  // Last time reading was updated
    pub total_generation: u64, // Cumulative energy generated (in smallest units)
    pub total_consumption: u64, // Cumulative energy consumed (in smallest units)

    // --- TOKENIZATION TRACKING ---
    pub settled_net_generation: u64,
    pub claimed_erc_generation: u64,
}

// Enums
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
#[repr(u8)]
pub enum UserType {
    Prosumer,
    Consumer,
}

unsafe impl bytemuck::Zeroable for UserType {}
unsafe impl bytemuck::Pod for UserType {}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
#[repr(u8)]
pub enum UserStatus {
    Active,
    Suspended,
    Inactive,
}

unsafe impl bytemuck::Zeroable for UserStatus {}
unsafe impl bytemuck::Pod for UserStatus {}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
#[repr(u8)]
pub enum MeterType {
    Solar,
    Wind,
    Battery,
    Grid,
}

unsafe impl bytemuck::Zeroable for MeterType {}
unsafe impl bytemuck::Pod for MeterType {}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
#[repr(u8)]
pub enum MeterStatus {
    Active,
    Inactive,
    Maintenance,
}

unsafe impl bytemuck::Zeroable for MeterStatus {}
unsafe impl bytemuck::Pod for MeterStatus {}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
#[repr(u8)]
pub enum ValidatorStatus {
    None,
    Active,
    Slashed,
    Suspended,
    /// Validator announced an honest exit. Still slashable until the resign cooldown
    /// elapses; only then may the bond be unstaked below MIN_VALIDATOR_STAKE.
    Resigning,
}

unsafe impl bytemuck::Zeroable for ValidatorStatus {}
unsafe impl bytemuck::Pod for ValidatorStatus {}

#[cfg(test)]
mod layout_tests {
    use super::*;

    /// Zero-copy on-chain layout invariant (SKILL.md invariant #1): `resign_at` was carved
    /// from the former `_padding5`, so `UserAccount` must stay exactly 104 bytes — otherwise
    /// already-deployed accounts become unreadable. Recount by hand if a field is added.
    #[test]
    fn user_account_size_is_stable() {
        assert_eq!(std::mem::size_of::<UserAccount>(), 104);
    }

    /// `MeterAccount` is bytemuck-cast cross-program by `governance` (its mirror struct must
    /// match byte-for-byte). `zone_id` was carved from the former `_padding[6]`, so the size
    /// must stay 120 bytes — and `governance::state::meter_account::MeterAccount` must mirror it.
    #[test]
    fn meter_account_size_is_stable() {
        assert_eq!(std::mem::size_of::<MeterAccount>(), 120);
    }
}
