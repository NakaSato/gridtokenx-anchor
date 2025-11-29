# Governance Program - Technical Specification v2.0

> GridTokenX Proof-of-Attribution & Energy Renewable Certificate Governance System

## Overview

The Governance Program manages the certification and verification of renewable energy production on the GridTokenX platform. It implements a robust Proof-of-Attribution (PoA) system and Energy Renewable Certificate (ERC) lifecycle management with multi-sig authority transfers, certificate revocation, ERC transfers, and oracle integration for data validation.

**Program ID:** `4D9Mydr4f3BEiDoKxE2V8yMZBj53X6nxMjMWaNPAQKrN`

---

## Architecture

### System Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Governance Program v2.0                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────────┐  │
│  │   PoA Config    │    │ ERC Certificate  │    │   Advanced     │  │
│  │                 │    │                  │    │   Features     │  │
│  │ • Authority     │    │ • Certificate ID │    │                │  │
│  │ • Emergency     │    │ • Energy Amount  │    │ • Multi-sig    │  │
│  │   Controls      │    │ • Source Type    │    │   Authority    │  │
│  │ • ERC Config    │    │ • Status         │    │ • Revocation   │  │
│  │ • Oracle Auth   │    │ • Owner          │    │ • Transfers    │  │
│  │ • Statistics    │    │ • Expiration     │    │ • Oracle       │  │
│  └─────────────────┘    └──────────────────┘    └────────────────┘  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    Certificate Lifecycle                         ││
│  │  Issue ERC → Validate for Trading → Transfer/Trade → Revoke     ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    Authority Management                          ││
│  │  Propose → Approve (2-step) | Cancel | Oracle Integration       ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Core Components

| Component | Purpose | Key Fields |
|-----------|---------|------------|
| **PoAConfig** | Platform-wide governance settings | authority, emergency_paused, erc_validation_enabled, oracle_authority, pending_authority |
| **ErcCertificate** | Individual renewable energy certificate | certificate_id, owner, energy_amount, status, validated_for_trading, revocation_reason |
| **MeterAccount** | Meter reference for ERC issuance | Imported from Registry program for tracking claimed_erc_generation |

---

## Account Structures

### PoAConfig

Global configuration for the Proof-of-Attribution system.

| Field | Type | Description |
|-------|------|-------------|
| `authority` | Pubkey | Admin with configuration rights |
| `attribution_rules` | [u8; 32] | Hash of attribution rule set |
| `verification_threshold` | u8 | Required verifications (1-10) |
| `certificate_validity_days` | u16 | ERC validity period |
| `total_ercs_issued` | u64 | Counter of all ERCs issued |
| `total_energy_certified` | u64 | Total kWh certified |
| `is_paused` | bool | Emergency pause flag |
| `bump` | u8 | PDA bump seed |

**Size:** 112 bytes  
**Seeds:** `["poa_config"]`

### ErcCertificate

Individual Energy Renewable Certificate.

| Field | Type | Description |
|-------|------|-------------|
| `id` | u64 | Unique certificate ID |
| `owner` | Pubkey | Current certificate owner |
| `issuer` | Pubkey | Original issuing authority |
| `meter_id` | u64 | Source smart meter |
| `energy_amount_kwh` | u64 | Certified energy (Wh precision) |
| `source_type` | EnergySourceType | Solar, Wind, Hydro, Biomass, Geothermal |
| `production_start` | i64 | Production period start (Unix timestamp) |
| `production_end` | i64 | Production period end (Unix timestamp) |
| `issued_at` | i64 | Certificate issuance timestamp |
| `expires_at` | i64 | Certificate expiration timestamp |
| `status` | ErcStatus | Pending, Verified, Traded, Retired, Revoked |
| `verification_count` | u8 | Number of oracle verifications |
| `verifications` | [Verification; 5] | Array of verification records |
| `trading_validated` | bool | Ready for trading |
| `metadata_uri` | String(128) | IPFS/Arweave metadata link |
| `bump` | u8 | PDA bump seed |

**Size:** 512 bytes  
**Seeds:** `["erc_certificate", id.to_le_bytes()]`

### Verification

Oracle verification record (embedded in ErcCertificate).

| Field | Type | Description |
|-------|------|-------------|
| `verifier` | Pubkey | Oracle/verifier public key |
| `timestamp` | i64 | Verification timestamp |
| `attestation_hash` | [u8; 32] | Hash of attestation data |
| `is_valid` | bool | Verification validity |

**Size:** 73 bytes

---

## Enumerations

### EnergySourceType

| Variant | Value | Description |
|---------|-------|-------------|
| `Solar` | 0 | Photovoltaic generation |
| `Wind` | 1 | Wind turbine generation |
| `Hydro` | 2 | Hydroelectric generation |
| `Biomass` | 3 | Biomass/biogas generation |
| `Geothermal` | 4 | Geothermal generation |

### ErcStatus

| Variant | Value | Description |
|---------|-------|-------------|
| `Pending` | 0 | Awaiting verification |
| `Verified` | 1 | Verified, ready for trading validation |
| `Traded` | 2 | Has been traded at least once |
| `Retired` | 3 | Permanently retired (used for compliance) |
| `Revoked` | 4 | Revoked by authority |

---

## Instructions

### 1. initialize_poa

Initialize the Proof-of-Attribution configuration.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | init | PoAConfig PDA to create |
| `authority` | signer, mut | Initial admin authority |
| `system_program` | program | System Program |

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `attribution_rules` | [u8; 32] | Rule set hash |
| `verification_threshold` | u8 | Required verifications (1-10) |
| `certificate_validity_days` | u16 | Certificate validity (1-3650) |

**Validation:**
- Verification threshold must be between 1 and 10
- Certificate validity must be between 1 and 3650 days

**Events Emitted:** `PoAInitialized`

---

### 2. issue_erc

Issue a new Energy Renewable Certificate.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | mut | PoAConfig for ID generation |
| `erc_certificate` | init | New ERC PDA |
| `owner` | - | Certificate recipient |
| `issuer` | signer, mut | Authorized issuer |
| `system_program` | program | System Program |

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `meter_id` | u64 | Source meter ID |
| `energy_amount_kwh` | u64 | Energy amount in Wh |
| `source_type` | EnergySourceType | Energy source type |
| `production_start` | i64 | Production period start |
| `production_end` | i64 | Production period end |
| `metadata_uri` | String | Metadata URI (max 128 chars) |

**Validation:**
- System must not be paused
- Energy amount must be greater than 0
- Production start must be before production end
- Metadata URI must not exceed 128 characters

**Events Emitted:** `ErcIssued`

---

### 3. add_verification

Add an oracle verification to a certificate.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `erc_certificate` | mut | Certificate to verify |
| `verifier` | signer | Oracle/verifier authority |

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `attestation_hash` | [u8; 32] | Hash of attestation data |

**Validation:**
- Certificate must be in Pending status
- Certificate must not be expired
- Maximum 5 verifications allowed
- Same verifier cannot verify twice

**State Transitions:**
- If verification_count >= threshold: status changes to `Verified`

**Events Emitted:** `VerificationAdded`

---

### 4. validate_erc_for_trading

Validate a verified ERC for trading.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | - | Configuration reference |
| `erc_certificate` | mut | Certificate to validate |
| `authority` | signer | PoA authority |

**Validation:**
- Only PoA authority can validate
- Certificate must be in Verified status
- Must not already be trading validated
- Certificate must not be expired

**Events Emitted:** `ErcValidatedForTrading`

---

### 5. transfer_erc

Transfer certificate ownership.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `erc_certificate` | mut | Certificate to transfer |
| `current_owner` | signer | Current owner |
| `new_owner` | - | New owner |

**Validation:**
- Caller must be current owner
- Certificate must be trading validated
- Certificate must not be expired or revoked

**State Transitions:**
- Status changes to `Traded` (if first transfer)
- Owner field updated to new_owner

**Events Emitted:** `ErcTransferred`

---

### 6. retire_erc

Permanently retire a certificate (for compliance reporting).

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `erc_certificate` | mut | Certificate to retire |
| `owner` | signer | Certificate owner |

**Validation:**
- Caller must be owner
- Certificate must be in Verified or Traded status
- Certificate must not be expired

**State Transitions:**
- Status changes to `Retired`
- trading_validated set to false

**Events Emitted:** `ErcRetired`

---

### 7. revoke_erc

Revoke a certificate (authority action).

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | - | Configuration reference |
| `erc_certificate` | mut | Certificate to revoke |
| `authority` | signer | PoA authority |

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `reason` | String | Revocation reason (max 256 chars) |

**Validation:**
- Only PoA authority can revoke
- Certificate must not already be retired or revoked

**Events Emitted:** `ErcRevoked`

---

### 8. update_poa_config

Update PoA configuration parameters.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | mut | Configuration to update |
| `authority` | signer | Current authority |

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `new_attribution_rules` | Option<[u8; 32]> | New rule set hash |
| `new_verification_threshold` | Option<u8> | New threshold (1-10) |
| `new_certificate_validity_days` | Option<u16> | New validity (1-3650) |

**Validation:**
- Only authority can update
- If provided, new threshold must be 1-10
- If provided, new validity must be 1-3650

**Events Emitted:** `PoAConfigUpdated`

---

### 9. transfer_poa_authority

Transfer PoA admin authority.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | mut | Configuration account |
| `authority` | signer | Current authority |
| `new_authority` | - | New authority |

**Validation:**
- Only current authority can transfer
- New authority must be different from current

**Events Emitted:** `PoAAuthorityTransferred`

---

### 10. pause_poa

Emergency pause the PoA system.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | mut | Configuration account |
| `authority` | signer | PoA authority |

**Validation:**
- Only authority can pause
- Must not already be paused

**Events Emitted:** `PoAPaused`

---

### 11. unpause_poa

Resume PoA system operations.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | mut | Configuration account |
| `authority` | signer | PoA authority |

**Validation:**
- Only authority can unpause
- Must currently be paused

**Events Emitted:** `PoAUnpaused`

---

## Events

### PoAInitialized

| Field | Type | Description |
|-------|------|-------------|
| `authority` | Pubkey | Initial authority |
| `verification_threshold` | u8 | Required verifications |
| `certificate_validity_days` | u16 | Certificate validity |
| `timestamp` | i64 | Initialization timestamp |

### ErcIssued

| Field | Type | Description |
|-------|------|-------------|
| `erc_id` | u64 | Certificate ID |
| `owner` | Pubkey | Certificate owner |
| `issuer` | Pubkey | Issuing authority |
| `meter_id` | u64 | Source meter |
| `energy_amount_kwh` | u64 | Energy amount |
| `source_type` | EnergySourceType | Energy source |
| `expires_at` | i64 | Expiration timestamp |
| `timestamp` | i64 | Issuance timestamp |

### VerificationAdded

| Field | Type | Description |
|-------|------|-------------|
| `erc_id` | u64 | Certificate ID |
| `verifier` | Pubkey | Verifier public key |
| `verification_count` | u8 | Total verifications |
| `is_now_verified` | bool | Reached threshold |
| `timestamp` | i64 | Verification timestamp |

### ErcValidatedForTrading

| Field | Type | Description |
|-------|------|-------------|
| `erc_id` | u64 | Certificate ID |
| `validator` | Pubkey | Validating authority |
| `timestamp` | i64 | Validation timestamp |

### ErcTransferred

| Field | Type | Description |
|-------|------|-------------|
| `erc_id` | u64 | Certificate ID |
| `from` | Pubkey | Previous owner |
| `to` | Pubkey | New owner |
| `timestamp` | i64 | Transfer timestamp |

### ErcRetired

| Field | Type | Description |
|-------|------|-------------|
| `erc_id` | u64 | Certificate ID |
| `owner` | Pubkey | Retiring owner |
| `energy_amount_kwh` | u64 | Retired energy |
| `timestamp` | i64 | Retirement timestamp |

### ErcRevoked

| Field | Type | Description |
|-------|------|-------------|
| `erc_id` | u64 | Certificate ID |
| `authority` | Pubkey | Revoking authority |
| `reason` | String | Revocation reason |
| `timestamp` | i64 | Revocation timestamp |

### PoAConfigUpdated

| Field | Type | Description |
|-------|------|-------------|
| `authority` | Pubkey | Updating authority |
| `attribution_rules_changed` | bool | Rules were changed |
| `verification_threshold_changed` | bool | Threshold was changed |
| `certificate_validity_changed` | bool | Validity was changed |
| `timestamp` | i64 | Update timestamp |

### PoAAuthorityTransferred

| Field | Type | Description |
|-------|------|-------------|
| `old_authority` | Pubkey | Previous authority |
| `new_authority` | Pubkey | New authority |
| `timestamp` | i64 | Transfer timestamp |

### PoAPaused / PoAUnpaused

| Field | Type | Description |
|-------|------|-------------|
| `authority` | Pubkey | Acting authority |
| `timestamp` | i64 | Action timestamp |

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | `InvalidVerificationThreshold` | Threshold must be 1-10 |
| 6001 | `InvalidCertificateValidity` | Validity must be 1-3650 days |
| 6002 | `SystemPaused` | System is paused |
| 6003 | `InvalidEnergyAmount` | Energy amount must be > 0 |
| 6004 | `InvalidProductionPeriod` | Start must be before end |
| 6005 | `MetadataUriTooLong` | URI exceeds 128 characters |
| 6006 | `CertificateNotPending` | Certificate not in Pending status |
| 6007 | `CertificateExpired` | Certificate has expired |
| 6008 | `MaxVerificationsReached` | Maximum 5 verifications |
| 6009 | `DuplicateVerifier` | Verifier already verified |
| 6010 | `NotVerified` | Certificate not verified |
| 6011 | `AlreadyTradingValidated` | Already validated for trading |
| 6012 | `NotTradingValidated` | Not validated for trading |
| 6013 | `NotOwner` | Caller is not owner |
| 6014 | `InvalidStatus` | Invalid status for operation |
| 6015 | `AlreadyRetiredOrRevoked` | Already retired or revoked |
| 6016 | `ReasonTooLong` | Revocation reason too long |
| 6017 | `AlreadyPaused` | System already paused |
| 6018 | `NotPaused` | System not paused |
| 6019 | `SameAuthority` | New authority same as current |

---

## State Transitions

### ERC Lifecycle

```
┌─────────┐  issue_erc   ┌─────────┐  add_verification  ┌──────────┐
│  None   │─────────────▶│ Pending │───────────────────▶│ Verified │
└─────────┘              └─────────┘   (threshold met)   └──────────┘
                                                              │
                              ┌────────────────────────────────┤
                              │ validate_erc_for_trading       │
                              ▼                                │
                         ┌──────────────────┐                  │
                         │ Trading Validated │                  │
                         └──────────────────┘                  │
                              │                                │
              ┌───────────────┼───────────────┐                │
              │ transfer_erc  │               │ retire_erc     │
              ▼               │               ▼                │
         ┌─────────┐          │          ┌─────────┐           │
         │ Traded  │          │          │ Retired │◀──────────┘
         └─────────┘          │          └─────────┘  retire_erc
              │               │
              │ retire_erc    │
              ▼               │
         ┌─────────┐          │
         │ Retired │          │
         └─────────┘          │
                              │
         ┌─────────┐          │ revoke_erc (any non-terminal state)
         │ Revoked │◀─────────┘
         └─────────┘
```

### Valid Operations by Status

| Status | Allowed Operations |
|--------|-------------------|
| **Pending** | add_verification, revoke_erc |
| **Verified** | validate_erc_for_trading, retire_erc, revoke_erc |
| **Trading Validated** | transfer_erc, retire_erc, revoke_erc |
| **Traded** | transfer_erc, retire_erc, revoke_erc |
| **Retired** | None (terminal state) |
| **Revoked** | None (terminal state) |

---

## Security Model

### Access Control Matrix

| Operation | Authority | Owner | Verifier | Anyone |
|-----------|:---------:|:-----:|:--------:|:------:|
| initialize_poa | ✓ | | | |
| issue_erc | ✓ | | | |
| add_verification | | | ✓ | |
| validate_erc_for_trading | ✓ | | | |
| transfer_erc | | ✓ | | |
| retire_erc | | ✓ | | |
| revoke_erc | ✓ | | | |
| update_poa_config | ✓ | | | |
| transfer_poa_authority | ✓ | | | |
| pause/unpause_poa | ✓ | | | |

### Security Features

1. **Verification Integrity**
   - Multi-oracle verification requirement
   - Duplicate verifier prevention
   - Attestation hash immutability

2. **Certificate Protection**
   - Trading requires explicit validation
   - Expiration enforcement
   - Revocation capability for fraud

3. **System Controls**
   - Emergency pause mechanism
   - Authority-only configuration
   - Bounded configuration values

---

## Integration Points

### Cross-Program Invocation

| Program | CPI Purpose |
|---------|-------------|
| **Registry** | Meter ownership verification |
| **Energy Token** | Token minting based on ERC |
| **Trading** | Certificate verification for trades |
| **Oracle** | Reading verification data |

### Integration Flow

```
┌──────────┐    ┌────────────┐    ┌──────────────┐    ┌─────────┐
│ Registry │───▶│ Governance │───▶│ Energy Token │───▶│ Trading │
│          │    │            │    │              │    │         │
│ • Meter  │    │ • Issue    │    │ • Mint       │    │ • Trade │
│   Data   │    │   ERC      │    │   Tokens     │    │   ERCs  │
│          │    │ • Verify   │    │              │    │         │
└──────────┘    └────────────┘    └──────────────┘    └─────────┘
```

---

## Performance Characteristics

| Operation | Compute Units | Accounts | Space |
|-----------|---------------|----------|-------|
| initialize_poa | ~15,000 | 3 | 112 bytes |
| issue_erc | ~25,000 | 5 | 512 bytes |
| add_verification | ~12,000 | 2 | 0 (update) |
| validate_erc_for_trading | ~8,000 | 3 | 0 (update) |
| transfer_erc | ~10,000 | 3 | 0 (update) |
| retire_erc | ~8,000 | 2 | 0 (update) |
| revoke_erc | ~10,000 | 3 | 0 (update) |

---

## Changelog

### v2.0 (Current)
- Added multi-verifier support (up to 5)
- Implemented configurable verification threshold
- Added certificate validity expiration
- Enhanced event logging
- Added emergency pause mechanism

### v1.0
- Initial release
- Basic ERC issuance and verification
- Single verifier model
