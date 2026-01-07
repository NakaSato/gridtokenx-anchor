# Governance Program

**Program ID:** `2WrMSfreZvCCKdQMQGY7bTFgXKgr42fYipJR6VXn1Q8c`

The Governance program is the central control unit for the GridTokenX platform. It manages the Proof of Authority (PoA) configuration, validates Energy Renewable Certificates (ERCs), and controls system-wide parameters.

## Architecture

The program is modularized into several handlers:
- **Authority**: Manages authority (REC) operations.
- **Config**: System configuration updates.
- **Emergency**: Emergency pause/unpause functionality.
- **ERC**: Issuance and validation of Energy Renewable Certificates.
- **Stats**: Governance statistics.

## Account Structures

### PoAConfig
The central configuration account for the governance system.

**PDA**: Derived from seed `["poa_config"]`.

```rust
#[account]
pub struct PoAConfig {
    // === Authority Configuration ===
    pub authority: Pubkey,         // REC certifying entity
    pub authority_name: String,    // e.g., "REC"
    pub contact_info: String,      // Contact details
    pub version: u8,               // Protocol version
    
    // === Emergency Controls ===
    pub emergency_paused: bool,
    pub emergency_timestamp: Option<i64>,
    pub emergency_reason: Option<String>,
    pub maintenance_mode: bool,
    
    // === ERC Configuration ===
    pub erc_validation_enabled: bool,
    pub min_energy_amount: u64,    // Min kWh
    pub max_erc_amount: u64,       // Max kWh
    pub erc_validity_period: i64,  // Seconds
    pub auto_revoke_expired: bool,
    pub require_oracle_validation: bool,
    
    // === Advanced Features ===
    pub delegation_enabled: bool,
    pub oracle_authority: Option<Pubkey>,
    pub min_oracle_confidence: u8,
    pub allow_certificate_transfers: bool,
}
```

### ErcCertificate
Represents a unique Energy Renewable Certificate.

**PDA**: Derived from seed `["erc", certificate_id]`.

```rust
#[account]
pub struct ErcCertificate {
    // === Identity ===
    pub certificate_id: String,      // Unique identifier
    pub authority: Pubkey,           // Issuing authority
    pub owner: Pubkey,               // Current owner
    
    // === Energy Data ===
    pub energy_amount: u64,          // kWh
    pub renewable_source: String,    // solar, wind, etc.
    pub validation_data: String,     // External validation ref
    
    // === Lifecycle ===
    pub issued_at: i64,
    pub expires_at: Option<i64>,
    pub status: ErcStatus,           // Enum: Valid, Revoked, Expired
    pub validated_for_trading: bool,
    pub trading_validated_at: Option<i64>,
    
    // === Revocation & Transfer ===
    pub revocation_reason: Option<String>,
    pub revoked_at: Option<i64>,
    pub transfer_count: u8,
    pub last_transferred_at: Option<i64>,
}
```

## Instructions

### `initialize_poa`
Initializes the PoA configuration with a single REC authority.
- **Seeds**: `["poa_config"]`

### `emergency_pause` / `emergency_unpause`
Allows the REC authority to freeze system operations in case of emergency.
- **Check**: `ctx.accounts.authority` matches `poa_config.authority`.

### `issue_erc`
Issues a new ERC to a producer.
- **Params**: `certificate_id`, `energy_amount`, `renewable_source`, `validation_data`.
- **Constraint**: `certificate_id` must be unique.
- **Logic**: Tracks claimed generation to prevent double-claiming.

### `validate_erc_for_trading`
Validates an issued ERC, marking it as eligible for use in the Trading program.
- **State Change**: Sets `validated_for_trading = true`.

### `update_governance_config`
Updates general governance flags (e.g., enabling ERC validation).

### `set_maintenance_mode`
Toggles maintenance mode.

### `update_erc_limits`
Updates minimum/maximum energy amounts and validity periods.

### `update_authority_info`
Updates the contact information for the authority.

### `get_governance_stats`
Retrieves statistics about the governance system.
