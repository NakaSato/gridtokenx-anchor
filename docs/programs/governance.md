# Governance Program

> **Proof of Authority Consensus & Renewable Energy Certificate Issuance**

**Program ID:** `DamT9e1VqbA5nSyFZHExKwQu6qs4L5FW6dirWCK8YLd4`

---

## Overview

The Governance program implements **Proof of Authority (PoA)** consensus coupled with **Renewable Energy Certificate (ERC)** issuance and validation. It serves as the regulatory layer for decentralized energy trading.

### Core Functions

1. **Certificate Issuance** — Validates renewable energy generation claims and issues ERCs
2. **ERC Lifecycle Management** — Validation for trading, revocation, transfer, expiration
3. **Emergency Controls** — Maintenance mode circuit breaker for all programs
4. **Multi-Sig Authority Transfer** — 2-step authority change with 48-hour expiration
5. **Oracle Authority Configuration** — External validation requirements

---

## State Accounts

### PoAConfig

**PDA Seeds:** `["poa_config"]`
**Layout:** Standard `#[account]`

#### Authority

| Field | Type | Description |
|-------|------|-------------|
| `authority` | `Pubkey` | Single PoA authority (admin key) |
| `authority_name` | `[u8; 64]` | Display name (e.g., "National REC Authority") |
| `name_len` | `u8` | Actual length of authority_name |
| `contact_info` | `[u8; 128]` | Public contact URL or email |
| `contact_len` | `u8` | Actual length of contact_info |
| `version` | `u8` | Governance version for upgrades |

#### Controls

| Field | Type | Description |
|-------|------|-------------|
| `maintenance_mode` | `bool` | Circuit breaker — halts all trading & issuance |

#### ERC Configuration

| Field | Type | Description |
|-------|------|-------------|
| `erc_validation_enabled` | `bool` | Whether ERC issuance is active |
| `min_energy_amount` | `u64` | Minimum kWh to issue an ERC |
| `max_erc_amount` | `u64` | Maximum kWh per certificate |
| `erc_validity_period` | `i64` | Seconds until expiration (max 2 years) |
| `auto_revoke_expired` | `bool` | Auto-revoke expired certificates |
| `require_oracle_validation` | `bool` | Must validate with Oracle data |

#### Advanced Features

| Field | Type | Description |
|-------|------|-------------|
| `delegation_enabled` | `bool` | Allow delegated ERC validation |
| `oracle_authority` | `Option<Pubkey>` | Oracle for AMI data validation |
| `min_oracle_confidence` | `u8` | Min confidence score (0-100) |
| `allow_certificate_transfers` | `bool` | Enable ERC transfers between accounts |

#### Statistics

| Field | Type | Description |
|-------|------|-------------|
| `total_ercs_issued` | `u64` | Lifetime certificate count |
| `total_ercs_validated` | `u64` | Count validated for trading |
| `total_ercs_revoked` | `u64` | Count revoked |
| `total_energy_certified` | `u64` | Cumulative kWh certified |

#### Timestamps

| Field | Type | Description |
|-------|------|-------------|
| `created_at` | `i64` | Initialization timestamp |
| `last_updated` | `i64` | Last config update |
| `last_erc_issued_at` | `Option<i64>` | Last ERC issuance time |

#### Multi-Sig Authority Change

| Field | Type | Description |
|-------|------|-------------|
| `pending_authority` | `Option<Pubkey>` | Proposed new authority |
| `pending_authority_proposed_at` | `Option<i64>` | Proposal timestamp |
| `pending_authority_expires_at` | `Option<i64>` | 48-hour expiration |

### ErcCertificate

**PDA Seeds:** `["erc_certificate", certificate_id]`
**Layout:** Standard `#[account]`

| Field | Type | Description |
|-------|------|-------------|
| `certificate_id` | `[u8; 64]` | Unique identifier (max 64 chars) |
| `id_len` | `u8` | Actual length of certificate_id |
| `authority` | `Pubkey` | Issuing authority |
| `owner` | `Pubkey` | Current owner (supports transfers) |
| `energy_amount` | `u64` | kWh certified (immutable) |
| `renewable_source` | `[u8; 64]` | Energy source (e.g., "Solar PV") |
| `source_len` | `u8` | Actual length of renewable_source |
| `validation_data` | `[u8; 256]` | Hash/reference to external audit |
| `data_len` | `u16` | Actual length of validation_data |
| `issued_at` | `i64` | Issuance timestamp |
| `expires_at` | `Option<i64>` | Expiration timestamp |
| `status` | `ErcStatus` | `Valid | Expired | Revoked | Pending` |
| `validated_for_trading` | `bool` | Approved for marketplace listing |
| `trading_validated_at` | `Option<i64>` | Validation timestamp |
| `revocation_reason` | `[u8; 128]` | Explanation if revoked |
| `reason_len` | `u8` | Actual length of revocation reason |
| `revoked_at` | `Option<i64>` | Revocation timestamp |
| `transfer_count` | `u8` | Number of ownership transfers |
| `last_transferred_at` | `Option<i64>` | Last transfer timestamp |

---

## Instructions

### initialize_poa

Initializes the governance system.

**Accounts:**
- `poa_config` (init, PDA `["poa_config"]`)
- `authority` (Signer, mut)

**Defaults:**
- `erc_validation_enabled = true`
- `erc_validity_period = 2,592,000` (30 days)
- `min/max energy amounts` configured

**Event:** `PoAInitialized`

---

### issue_erc

Creates a new Renewable Energy Certificate.

**Arguments:**
- `certificate_id: String` — Unique ID (≤ 64 chars)
- `energy_amount: u64` — kWh certified
- `renewable_source: String` — Source type (≤ 64 chars)
- `validation_data: String` — Audit reference (≤ 256 chars)

**Accounts:**
- `erc_certificate` (init, PDA)
- `poa_config` (readonly)
- `authority` (Signer, mut)
- `meter_account` (readonly, from Registry program) — For double-claim prevention

**Validation:**
1. System operational (`!maintenance_mode`)
2. ERC validation enabled
3. `energy_amount` within `[min, max]`
4. Certificate ID ≤ 64 chars
5. **Double-claim prevention:** Reads `MeterAccount.claimed_erc_generation` from Registry; verifies `energy_amount ≤ total_generation - claimed_erc_generation`

**Event:** `ErcIssued { certificate_id, energy_amount, renewable_source, timestamp }`

---

### validate_erc_for_trading

Marks certificate as approved for marketplace listing.

**Accounts:**
- `erc_certificate` (mut)
- `poa_config` (readonly)
- `authority` (Signer)

**Pre-Conditions:**
- Certificate `status == Valid`
- Not already validated
- Not expired

**Effect:** Sets `validated_for_trading = true`, increments `total_ercs_validated`

**Event:** `ErcValidatedForTrading`

---

### revoke_erc

Invalidates a certificate (meter tampering, audit failure).

**Arguments:**
- `reason: String` — Explanation (required, ≤ 128 chars)

**Accounts:**
- `erc_certificate` (mut)
- `poa_config` (readonly)
- `authority` (Signer)

**Pre-Conditions:**
- Certificate not already revoked

**Event:** `ErcRevoked { certificate_id, reason, energy_amount, timestamp }`

---

### transfer_erc

Transfers ownership of a certificate.

**Accounts:**
- `erc_certificate` (mut)
- `poa_config` (readonly)
- `current_owner` (Signer)
- `new_owner` (readonly)

**Pre-Conditions:**
- `allow_certificate_transfers == true` (globally enabled)
- `validated_for_trading == true`
- `current_owner ≠ new_owner`

**Effect:** Updates `owner`, increments `transfer_count`

**Event:** `ErcTransferred { certificate_id, from_owner, to_owner, energy_amount, timestamp }`

---

### update_erc_limits

Adjusts operational thresholds.

**Arguments:**
- `min_energy_amount: u64`
- `max_erc_amount: u64`
- `erc_validity_period: i64`

**Event:** `ErcLimitsUpdated` (includes old and new values for audit)

---

### update_governance_config

Toggles global feature flags.

**Arguments:**
- `erc_validation_enabled: bool`
- `allow_certificate_transfers: bool`

**Event:** `GovernanceConfigUpdated`

---

### set_maintenance_mode

Activates/deactivates circuit breaker.

**Arguments:**
- `maintenance_enabled: bool`

**Effect:** When `true`, all trading instructions in the Trading program revert with `MaintenanceMode` error.

**Event:** `MaintenanceModeUpdated`

---

### update_authority_info

Updates authority contact information.

**Arguments:**
- `contact_info: String`

**Event:** `AuthorityInfoUpdated`

---

### propose_authority_change

Step 1 of 2-step authority transfer.

**Arguments:**
- `new_authority: Pubkey`

**Accounts:**
- `poa_config` (mut)
- `current_authority` (Signer)

**Logic:**
1. Ensure no pending authority change
2. Set `pending_authority`, `pending_authority_proposed_at`, `pending_authority_expires_at` (48 hours)

**Event:** `AuthorityChangeProposed`

---

### approve_authority_change

Step 2: New authority confirms and accepts.

**Accounts:**
- `poa_config` (mut)
- `pending_authority` (Signer) — Must be the proposed key

**Validation:**
- Caller must be `pending_authority`
- Not expired (`current_time < expires_at`)

**Effect:** Transfers `authority`, clears pending fields.

**Event:** `AuthorityChangeApproved`

---

### cancel_authority_change

Cancels pending authority transfer.

**Accounts:**
- `poa_config` (mut)
- `current_authority` (Signer)

**Event:** `AuthorityChangeCancelled`

---

### set_oracle_authority

Configures external Oracle validation requirements.

**Arguments:**
- `oracle_authority: Pubkey`
- `min_confidence: u8` — 0-100 score threshold
- `require_validation: bool`

**Event:** `OracleAuthoritySet`

---

### get_governance_stats

View function returning full `GovernanceStats` struct.

**Returns:** `GovernanceStats` — All config, statistics, and authority change status.

---

## Error Codes

| Discriminant | Error | Condition |
|--------------|-------|-----------|
| 0 | `UnauthorizedAuthority` | Caller ≠ PoA authority |
| 1 | `MaintenanceMode` | System paused via circuit breaker |
| 2 | `ErcValidationDisabled` | ERC issuance administratively disabled |
| 3 | `InvalidErcStatus` | Certificate status invalid for operation |
| 4 | `AlreadyValidated` | Certificate already validated for trading |
| 5 | `BelowMinimumEnergy` | Amount < `min_energy_amount` |
| 6 | `ExceedsMaximumEnergy` | Amount > `max_erc_amount` |
| 7 | `CertificateIdTooLong` | ID > 64 chars |
| 8 | `SourceNameTooLong` | Source > 64 chars |
| 9 | `ErcExpired` | Certificate past `expires_at` |
| 10 | `InvalidMinimumEnergy` | `min_energy_amount = 0` |
| 11 | `InvalidMaximumEnergy` | `max ≤ min` |
| 12 | `InvalidValidityPeriod` | Period ≤ 0 or > 2 years |
| 13 | `ContactInfoTooLong` | Contact > 128 chars |
| 14 | `InvalidOracleConfidence` | Score > 100 |
| 15 | `OracleValidationRequired` | Oracle required but not configured |
| 16 | `TransfersNotAllowed` | `allow_certificate_transfers = false` |
| 17 | `InsufficientUnclaimedGeneration` | Meter's remaining < requested |
| 18 | `AlreadyRevoked` | Certificate already revoked |
| 19 | `RevocationReasonRequired` | Empty reason string |
| 20 | `InvalidRecipient` | Transfer to zero pubkey |
| 21 | `CannotTransferToSelf` | `current_owner == new_owner` |
| 22 | `NotValidatedForTrading` | Certificate not approved for trading |
| 23 | `AuthorityChangePending` | Already a pending transfer |
| 24 | `NoAuthorityChangePending` | No pending transfer to approve/cancel |
| 25 | `InvalidPendingAuthority` | Caller ≠ pending authority |
| 26 | `AuthorityChangeExpired` | Past 48-hour window |
| 27 | `OracleConfidenceTooLow` | Below `min_oracle_confidence` |
| 28 | `InvalidOracleAuthority` | Oracle pubkey invalid |
| 29 | `ValidationDataTooLong` | Data > 256 chars |
| 30 | `InvalidMeterAccount` | Meter account invalid/unreadable |

---

## Events

| Event | Fields |
|-------|--------|
| `PoAInitialized` | `authority`, `authority_name`, `timestamp` |
| `ErcIssued` | `certificate_id`, `authority`, `energy_amount`, `renewable_source`, `timestamp` |
| `ErcValidatedForTrading` | `certificate_id`, `authority`, `timestamp` |
| `ErcRevoked` | `certificate_id`, `authority`, `reason`, `energy_amount`, `timestamp` |
| `ErcTransferred` | `certificate_id`, `from_owner`, `to_owner`, `energy_amount`, `timestamp` |
| `GovernanceConfigUpdated` | `authority`, `erc_validation_enabled`, `allow_certificate_transfers`, `timestamp` |
| `MaintenanceModeUpdated` | `authority`, `maintenance_enabled`, `timestamp` |
| `ErcLimitsUpdated` | `authority`, `old_min`, `new_min`, `old_max`, `new_max`, `old_validity`, `new_validity`, `timestamp` |
| `AuthorityInfoUpdated` | `authority`, `old_contact`, `new_contact`, `timestamp` |
| `AuthorityChangeProposed` | `current_authority`, `proposed_authority`, `expires_at`, `timestamp` |
| `AuthorityChangeApproved` | `old_authority`, `new_authority`, `timestamp` |
| `AuthorityChangeCancelled` | `authority`, `cancelled_proposal`, `timestamp` |
| `OracleAuthoritySet` | `authority`, `oracle_authority`, `min_confidence`, `timestamp` |

---

## Helper Methods

### PoAConfig

```rust
pub fn is_operational(&self) -> bool {
    !self.maintenance_mode
}

pub fn can_issue_erc(&self) -> bool {
    self.is_operational() && self.erc_validation_enabled
}
```

### ErcCertificate

```rust
pub fn can_transfer(&self) -> bool {
    self.status == ErcStatus::Valid && self.validated_for_trading
}

pub fn can_revoke(&self) -> bool {
    self.status == ErcStatus::Valid || self.status == ErcStatus::Pending
}
```

---

## Cross-Program Data Validation

### Double-Claim Prevention

When issuing an ERC, the Governance program reads the `MeterAccount` from the Registry program to verify that the requested energy amount hasn't already been claimed:

```
unclaimed = meter.total_generation - meter.claimed_erc_generation
require!(energy_amount <= unclaimed)
```

This ensures the same kWh cannot be certified twice as renewable energy.

---

**Related:** [Registry](./registry.md) — Cross-program meter reading · [Trading](./trading.md) — ERC validation in orders
