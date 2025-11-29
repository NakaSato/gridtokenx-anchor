# Governance Program

> **Academic Documentation - ERC Certification and Platform Governance**

Program ID: `4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe`

---

## Overview

The Governance Program manages Energy Attribute Certificates (ERC), implements Proof of Authority (PoA) consensus configuration, and provides emergency controls for the GridTokenX platform. It ensures regulatory compliance and platform integrity.

---

## Theoretical Foundation

### Energy Attribute Certificates

Energy Attribute Certificates (also known as Renewable Energy Certificates, RECs) are market-based instruments that represent the environmental attributes of renewable energy generation. The Governance Program implements on-chain ERC management:

| Attribute | Implementation |
|-----------|---------------|
| Uniqueness | One certificate per generation unit |
| Traceability | Full on-chain provenance |
| Verification | PoA authority validation |
| Transferability | Optional secondary market |

### Proof of Authority Model

The platform uses PoA consensus for ERC certification:

| Aspect | PoA Implementation |
|--------|-------------------|
| Validators | Pre-approved REC authorities |
| Consensus | Single authority signature |
| Finality | Immediate |
| Trust Model | Trusted authority set |

**Rationale**: Energy certification requires trusted authorities (utilities, regulators). PoA aligns with existing regulatory frameworks while enabling blockchain benefits.

---

## Account Architecture

### PoA Configuration Account

Global governance configuration.

| Field | Type | Description |
|-------|------|-------------|
| `authority` | PublicKey | Platform administrator |
| `rec_authority` | PublicKey | ERC issuance authority |
| `emergency_authority` | PublicKey | Emergency controls |
| `authorized_validators` | Vec<PublicKey> | Approved validators (up to 10) |
| `min_validators` | u8 | Minimum validators for consensus |
| `is_active` | bool | Platform operational status |
| `is_paused` | bool | Emergency pause state |
| `total_certificates` | u64 | Total ERCs issued |
| `total_energy_certified` | u64 | Total kWh certified |
| `created_at` | i64 | Initialization timestamp |
| `bump` | u8 | PDA bump seed |

**PDA Derivation**: Seeds = `["poa_config"]`

### ERC Certificate Account

Individual certificate representation.

| Field | Type | Description |
|-------|------|-------------|
| `certificate_id` | String | Unique identifier |
| `meter_id` | String | Source meter |
| `owner` | PublicKey | Current owner |
| `energy_amount` | u64 | Certified energy (kWh) |
| `generation_start` | i64 | Generation period start |
| `generation_end` | i64 | Generation period end |
| `energy_source` | EnergySource | Solar, Wind, Hydro, etc. |
| `location` | String | Generation location |
| `issuer` | PublicKey | Issuing authority |
| `status` | CertificateStatus | Active, Used, Expired, Revoked |
| `issued_at` | i64 | Issuance timestamp |
| `expires_at` | Option<i64> | Expiration timestamp |
| `used_at` | Option<i64> | Redemption timestamp |
| `bump` | u8 | PDA bump seed |

**PDA Derivation**: Seeds = `["erc_certificate", certificate_id.as_bytes()]`

---

## Certificate Lifecycle

### State Machine

**States:**
- `Active` → Valid, can be traded or used
- `Used` → Redeemed for compliance
- `Expired` → Past validity period
- `Revoked` → Invalidated by authority

**Transitions:**
- Active → Used (redemption)
- Active → Expired (time-based)
- Active → Revoked (authority action)
- Used → (terminal state)
- Expired → (terminal state)
- Revoked → (terminal state)

### Double-Claim Prevention

The dual-tracker system prevents double-claiming:

$$\text{claimed\_erc\_generation} \leq \text{total\_generation}$$

Each ERC issuance updates `claimed_erc_generation` in the source meter account, ensuring:

1. Certificate energy ≤ available unclaimed generation
2. Running total never exceeds gross generation
3. Atomic update prevents race conditions

---

## ERC Issuance Process

### Issuance Requirements

| Requirement | Validation |
|-------------|------------|
| Meter registered | Meter account exists |
| Meter active | Status = Active |
| Generation available | Unclaimed > requested |
| Authority valid | Signer is rec_authority |

### Issuance Flow

1. REC authority submits issuance request
2. Program validates meter eligibility
3. Program checks unclaimed generation
4. Certificate account created
5. Meter's `claimed_erc_generation` updated
6. Event emitted for tracking

### Energy Source Classification

| Source | Description | Typical Capacity |
|--------|-------------|------------------|
| Solar | Photovoltaic systems | 1-100 kW |
| Wind | Wind turbines | 10-1000 kW |
| Hydro | Hydroelectric | 100-10000 kW |
| Biomass | Organic fuel generation | 50-500 kW |
| Geothermal | Earth heat | 100-1000 kW |

---

## Instructions

### Administrative Instructions

| Instruction | Authority | Description |
|-------------|-----------|-------------|
| `initialize_governance` | Deployer | Create PoA configuration |
| `update_authority` | Authority | Transfer admin control |
| `set_rec_authority` | Authority | Configure ERC issuer |
| `set_emergency_authority` | Authority | Configure emergency control |
| `add_validator` | Authority | Add approved validator |
| `remove_validator` | Authority | Remove validator |

### Certificate Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `issue_erc` | REC Authority | Issue new certificate |
| `transfer_erc` | Owner | Transfer certificate ownership |
| `redeem_erc` | Owner | Mark certificate as used |
| `revoke_erc` | REC Authority | Invalidate certificate |

### Emergency Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `emergency_pause` | Emergency Authority | Halt all operations |
| `emergency_resume` | Emergency Authority | Resume operations |

### Query Instructions

| Instruction | Access | Description |
|-------------|--------|-------------|
| `get_governance_stats` | Public | Retrieve statistics |
| `validate_certificate` | Public | Check certificate validity |

---

## Trading Integration

### ERC-Validated Orders

The Trading Program can validate ERC certificates:

1. Seller creates order with ERC reference
2. Trading Program reads certificate account
3. Validates status = Active
4. Validates owner = seller
5. Validates energy_amount ≥ order amount
6. Trade proceeds if valid

### Premium Pricing

ERC-backed energy typically commands premium:

| Market Segment | Price Premium |
|----------------|---------------|
| Retail consumers | 0-10% |
| Corporate buyers | 10-30% |
| Compliance market | Regulatory dependent |

---

## Security Model

### Access Control Matrix

| Operation | Public | Owner | REC Auth | Emergency | Admin |
|-----------|:------:|:-----:|:--------:|:---------:|:-----:|
| View certificates | ✓ | ✓ | ✓ | ✓ | ✓ |
| Issue ERC | | | ✓ | | |
| Transfer ERC | | ✓ | | | |
| Redeem ERC | | ✓ | | | |
| Revoke ERC | | | ✓ | | |
| Emergency pause | | | | ✓ | |
| Configure | | | | | ✓ |

### Authority Separation

| Role | Responsibility | Compromise Impact |
|------|---------------|-------------------|
| Admin | Configuration | High |
| REC Authority | Certificate issuance | Medium |
| Emergency | Pause/resume | Low (temporary) |

### Threat Mitigations

| Threat | Mitigation |
|--------|------------|
| Double-claiming | Dual-tracker system |
| Fraudulent issuance | Authority verification |
| Certificate manipulation | Immutable on-chain state |
| System compromise | Emergency pause capability |

---

## Emergency Controls

### Pause Mechanism

Emergency pause halts sensitive operations:

| Operation | During Pause |
|-----------|--------------|
| Certificate issuance | Blocked |
| Certificate transfer | Blocked |
| Certificate redemption | Blocked |
| View/query operations | Allowed |
| Emergency resume | Allowed |

### Pause Triggers

| Scenario | Action |
|----------|--------|
| Security vulnerability | Immediate pause |
| Market manipulation detected | Investigation pause |
| Regulatory requirement | Compliance pause |
| System maintenance | Planned pause |

---

## Events

| Event | Trigger | Key Fields |
|-------|---------|------------|
| `GovernanceInitialized` | Initialization | authority, rec_authority |
| `ErcIssued` | Certificate issuance | cert_id, meter_id, energy, source |
| `ErcTransferred` | Ownership change | cert_id, from, to |
| `ErcRedeemed` | Certificate use | cert_id, redeemer |
| `ErcRevoked` | Invalidation | cert_id, reason |
| `ValidatorAdded` | Validator addition | validator, timestamp |
| `ValidatorRemoved` | Validator removal | validator, timestamp |
| `EmergencyPauseActivated` | Pause | authority, reason |
| `EmergencyPauseDeactivated` | Resume | authority |

---

## Errors

| Error Code | Name | Description |
|------------|------|-------------|
| 6400 | `Unauthorized` | Caller lacks required authority |
| 6401 | `SystemPaused` | Platform in emergency pause |
| 6402 | `InsufficientGeneration` | Not enough unclaimed energy |
| 6403 | `InvalidCertificateStatus` | Certificate not in required state |
| 6404 | `CertificateExpired` | Past validity period |
| 6405 | `CertificateAlreadyUsed` | Already redeemed |
| 6406 | `InvalidMeter` | Meter not eligible |
| 6407 | `DuplicateCertificate` | Certificate ID exists |
| 6408 | `ValidatorLimitReached` | Maximum validators configured |
| 6409 | `InvalidEnergySource` | Unknown energy source type |

---

## Research Implications

### Contribution to Literature

The Governance Program demonstrates:

1. **On-chain certificate management**: Blockchain-based REC system
2. **PoA for energy markets**: Appropriate consensus for regulated markets
3. **Dual-tracker prevention**: Novel double-claim prevention mechanism
4. **Emergency governance**: Responsible DeFi design patterns

### Regulatory Alignment

| Jurisdiction | Standard | Compatibility |
|--------------|----------|---------------|
| International | I-REC | High |
| Europe | GO (Guarantees of Origin) | Medium |
| USA | REC | High |
| Australia | LGC | Medium |

### Performance Characteristics

| Metric | Value |
|--------|-------|
| Certificate issuance | ~80,000 CU |
| Certificate transfer | ~50,000 CU |
| Certificate redemption | ~40,000 CU |
| Account rent | ~0.004 SOL |

---

*For implementation details, see [Technical Governance Documentation](../../technical/programs/governance.md)*
