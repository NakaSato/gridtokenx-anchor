// Registry program state

use anchor_lang::prelude::*;

/// Registry account for metadata storage
#[account(zero_copy)]
#[repr(C)]
pub struct Registry {
    pub authority: Pubkey,
    pub oracle_authority: Pubkey,  // Authorized oracle (Option -> Pubkey for ZeroCopy)
    pub has_oracle_authority: u8,   // Track if oracle_authority is valid (u8 for Pod)
    pub _padding: [u8; 7],          // Alignment
    pub user_count: u64,
    pub meter_count: u64,
    pub active_meter_count: u64,    // Track active meters separately
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
    pub _padding3: [u8; 7],  // 7 bytes padding (57-64)
    pub registered_at: i64,  // 8 bytes (64-72)
    pub meter_count: u32,    // 4 bytes (72-76)
    pub _padding4: [u8; 4],  // 4 bytes padding (76-80) - Total: 80 bytes
}

/// Meter account for reading updates
#[account(zero_copy)]
#[repr(C)]
pub struct MeterAccount {
    pub meter_id: [u8; 32],     // Unique meter identifier (fixed size for ZeroCopy)
    pub owner: Pubkey,          // User who owns this meter
    pub meter_type: MeterType,  // Solar, Wind, Battery, or Grid
    pub status: MeterStatus,    // Active, Inactive, or Maintenance
    pub _padding: [u8; 6],      // Alignment
    pub registered_at: i64,     // When meter was registered
    pub last_reading_at: i64,   // Last time reading was updated
    pub total_generation: u64,  // Cumulative energy generated (in smallest units)
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
