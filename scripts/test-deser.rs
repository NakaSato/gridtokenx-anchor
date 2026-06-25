use borsh::{BorshDeserialize, BorshSerialize};
use solana_sdk::pubkey::Pubkey;

#[derive(BorshDeserialize, BorshSerialize, Debug)]
pub struct GovernanceConfig {
    pub authority: Pubkey,
    pub authority_name: [u8; 64],
    pub name_len: u8,
    pub contact_info: [u8; 128],
    pub contact_len: u8,
    pub version: u8,
    pub maintenance_mode: bool,
    pub erc_validation_enabled: bool,
    pub min_energy_amount: u64,
    pub max_erc_amount: u64,
    pub erc_validity_period: i64,
    pub require_oracle_validation: bool,
    pub oracle_authority: Pubkey,
    pub min_oracle_confidence: u8,
    pub allow_certificate_transfers: bool,
    pub min_quorum_votes: u64,
    pub total_ercs_issued: u64,
    pub total_ercs_validated: u64,
    pub total_ercs_revoked: u64,
    pub total_energy_certified: u64,
    pub created_at: i64,
    pub last_updated: i64,
    pub last_erc_issued_at: i64,
    pub pending_authority: Pubkey,
    pub pending_authority_proposed_at: i64,
    pub pending_authority_expires_at: i64,
    // pub _reserved: [u8; 5],
}

fn main() {
    let hex_data = "cffd8d903ac06935c1664959fa92f6b585300610e714e59b36bf58cc2427a1fb5245430000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003656e67696e656572696e675f65726340757463632e61632e74680000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001a010001640000000000000040420f00000000008033e1010000000000005001640000000000000000000000000000000000000000000000000000000000000000000000000000006bbe196a000000006bbe196a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
    let data = hex::decode(hex_data).unwrap();
    
    let mut data_ptr = &data[..];
    match GovernanceConfig::deserialize(&mut data_ptr) {
        Ok(config) => {
            println!("Success! {:?}", config);
            println!("Leftover bytes: {}", data_ptr.len());
        },
        Err(e) => {
            println!("Failed: {}", e);
        }
    }
}
