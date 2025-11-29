# Governance Program - Technical Reference

> **Implementation reference for the Governance Program**

Program ID: `4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe`

Source: [`programs/governance/src/lib.rs`](../../../programs/governance/src/lib.rs)

---

## Instructions

### `initialize_governance`

Creates PoA configuration account.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `poa_config` | PDA (mut) | Governance state |
| `authority` | Signer | Initial authority |
| `system_program` | Program | System program |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `rec_authority` | Pubkey | ERC issuing authority |
| `emergency_authority` | Pubkey | Emergency control |

**PDA Seeds:** `["poa_config"]`

---

### `issue_erc`

Issues a new Energy Attribute Certificate.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `erc_certificate` | PDA (mut) | Certificate account |
| `poa_config` | PDA (mut) | Governance state |
| `meter_account` | Account (mut) | Source meter |
| `rec_authority` | Signer | REC authority |
| `system_program` | Program | System program |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `certificate_id` | String | Unique certificate ID |
| `energy_amount` | u64 | Energy to certify (kWh) |
| `generation_start` | i64 | Period start timestamp |
| `generation_end` | i64 | Period end timestamp |
| `energy_source` | EnergySource | Source type |

**PDA Seeds:** `["erc_certificate", certificate_id.as_bytes()]`

---

### `transfer_erc`

Transfers certificate ownership.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `erc_certificate` | PDA (mut) | Certificate |
| `current_owner` | Signer | Current owner |
| `new_owner` | Account | New owner |

---

### `redeem_erc`

Marks certificate as used for compliance.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `erc_certificate` | PDA (mut) | Certificate |
| `poa_config` | PDA (mut) | Governance state |
| `owner` | Signer | Certificate owner |

---

### `revoke_erc`

Invalidates a certificate.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `erc_certificate` | PDA (mut) | Certificate |
| `poa_config` | PDA | Governance state |
| `rec_authority` | Signer | REC authority |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `reason` | String | Revocation reason |

---

### `emergency_pause` / `emergency_resume`

Controls platform emergency state.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `poa_config` | PDA (mut) | Governance state |
| `emergency_authority` | Signer | Emergency authority |

**Arguments (pause only):**
| Name | Type | Description |
|------|------|-------------|
| `reason` | String | Pause reason |

---

### `add_validator` / `remove_validator`

Manages PoA validator set.

**Accounts:**
| Name | Type | Description |
|------|------|-------------|
| `poa_config` | PDA (mut) | Governance state |
| `authority` | Signer | Governance authority |

**Arguments:**
| Name | Type | Description |
|------|------|-------------|
| `validator` | Pubkey | Validator address |

---

## Account Structures

### PoAConfig

```rust
#[account]
pub struct PoAConfig {
    pub authority: Pubkey,
    pub rec_authority: Pubkey,
    pub emergency_authority: Pubkey,
    pub authorized_validators: Vec<Pubkey>,
    pub min_validators: u8,
    pub is_active: bool,
    pub is_paused: bool,
    pub total_certificates: u64,
    pub total_energy_certified: u64,
    pub created_at: i64,
    pub bump: u8,
}
```

### ErcCertificate

```rust
#[account]
pub struct ErcCertificate {
    pub certificate_id: String,
    pub meter_id: String,
    pub owner: Pubkey,
    pub energy_amount: u64,
    pub generation_start: i64,
    pub generation_end: i64,
    pub energy_source: EnergySource,
    pub location: String,
    pub issuer: Pubkey,
    pub status: CertificateStatus,
    pub issued_at: i64,
    pub expires_at: Option<i64>,
    pub used_at: Option<i64>,
    pub bump: u8,
}
```

---

## Enums

### EnergySource

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum EnergySource {
    Solar,
    Wind,
    Hydro,
    Biomass,
    Geothermal,
    Other,
}
```

### CertificateStatus

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum CertificateStatus {
    Active,
    Used,
    Expired,
    Revoked,
}
```

---

## Events

```rust
#[event]
pub struct GovernanceInitialized {
    pub authority: Pubkey,
    pub rec_authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ErcIssued {
    pub certificate_id: String,
    pub meter_id: String,
    pub owner: Pubkey,
    pub energy_amount: u64,
    pub energy_source: EnergySource,
    pub timestamp: i64,
}

#[event]
pub struct ErcTransferred {
    pub certificate_id: String,
    pub from: Pubkey,
    pub to: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ErcRedeemed {
    pub certificate_id: String,
    pub redeemer: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ErcRevoked {
    pub certificate_id: String,
    pub reason: String,
    pub timestamp: i64,
}

#[event]
pub struct ValidatorAdded {
    pub validator: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ValidatorRemoved {
    pub validator: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct EmergencyPauseActivated {
    pub authority: Pubkey,
    pub reason: String,
    pub timestamp: i64,
}

#[event]
pub struct EmergencyPauseDeactivated {
    pub authority: Pubkey,
    pub timestamp: i64,
}
```

---

## Errors

```rust
#[error_code]
pub enum GovernanceError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("System is paused")]
    SystemPaused,
    #[msg("Insufficient generation")]
    InsufficientGeneration,
    #[msg("Invalid certificate status")]
    InvalidCertificateStatus,
    #[msg("Certificate expired")]
    CertificateExpired,
    #[msg("Certificate already used")]
    CertificateAlreadyUsed,
    #[msg("Invalid meter")]
    InvalidMeter,
    #[msg("Duplicate certificate")]
    DuplicateCertificate,
    #[msg("Validator limit reached")]
    ValidatorLimitReached,
    #[msg("Invalid energy source")]
    InvalidEnergySource,
}
```

---

## Double-Claim Prevention

The `issue_erc` instruction updates the meter's `claimed_erc_generation`:

```rust
// Validate available generation
let available = meter.total_generation - meter.claimed_erc_generation;
require!(energy_amount <= available, GovernanceError::InsufficientGeneration);

// Update tracker
meter.claimed_erc_generation = meter.claimed_erc_generation
    .checked_add(energy_amount)
    .ok_or(GovernanceError::Overflow)?;
```

---

*For academic documentation, see [Academic Governance Documentation](../../academic/programs/governance.md)*
