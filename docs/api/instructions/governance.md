# Governance Program Instructions

> **PoA-based ERC Certificate Management**
>
> Version 2.0 - November 2025

## Program ID
```
4D9Mydr4f3BEiDoKxE2V8yMZBj53X6nxMjMWaNPAQKrN
```

---

## Instruction Summary

| # | Instruction | Authority | Description |
|---|-------------|-----------|-------------|
| 1 | `initialize_poa` | Deployer | Initialize PoA configuration |
| 2 | `emergency_pause` | REC authority | Pause all operations |
| 3 | `emergency_unpause` | REC authority | Resume operations |
| 4 | `issue_erc` | REC authority | Issue ERC certificate |
| 5 | `validate_erc_for_trading` | REC authority | Validate for marketplace |
| 6 | `update_governance_config` | REC authority | Update settings |
| 7 | `set_maintenance_mode` | REC authority | Toggle maintenance |
| 8 | `update_erc_limits` | REC authority | Change limits |
| 9 | `update_authority_info` | REC authority | Update contact info |
| 10 | `get_governance_stats` | Public | Query statistics |
| 11 | `revoke_erc` | REC authority | Revoke certificate |
| 12 | `transfer_erc` | Certificate owner | Transfer ownership |
| 13 | `propose_authority_change` | REC authority | Propose new authority |
| 14 | `approve_authority_change` | Pending authority | Accept authority role |
| 15 | `cancel_authority_change` | REC authority | Cancel pending change |
| 16 | `set_oracle_authority` | REC authority | Configure oracle |

---

## initialize_poa

Initialize the Proof of Authority configuration.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | `PDA (init)` | Global PoA configuration |
| `authority` | `Signer (mut)` | Program authority (payer) |
| `system_program` | `Program` | System program |

### PDA Seeds

```rust
seeds = [b"poa_config"]
```

### Example

```typescript
const [poaConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('poa_config')],
  GOVERNANCE_PROGRAM_ID
);

await program.methods
  .initializePoa()
  .accounts({
    poaConfig: poaConfigPda,
    authority: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Initial Configuration

| Parameter | Default Value |
|-----------|---------------|
| `min_energy_amount` | 100 kWh |
| `max_erc_amount` | 1,000,000 kWh |
| `erc_validity_period` | 31,536,000 seconds (1 year) |
| `min_oracle_confidence` | 80% |

---

## issue_erc

Issue a new Energy Renewable Certificate.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | `PDA` | Global configuration |
| `erc_certificate` | `PDA (init)` | Certificate to create |
| `meter_account` | `Account (mut)` | Meter from Registry |
| `authority` | `Signer (mut)` | REC authority (payer) |
| `system_program` | `Program` | System program |

### Arguments

| Name | Type | Constraints |
|------|------|-------------|
| `certificate_id` | `String` | Max 64 chars, unique |
| `energy_amount` | `u64` | 100 - 1,000,000 kWh |
| `renewable_source` | `String` | Max 64 chars |
| `validation_data` | `String` | Max 256 chars |

### PDA Seeds

```rust
seeds = [b"erc_certificate", certificate_id.as_bytes()]
```

### Example

```typescript
const certificateId = 'ERC-2025-001';
const [ercPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('erc_certificate'), Buffer.from(certificateId)],
  GOVERNANCE_PROGRAM_ID
);

await program.methods
  .issueErc(
    certificateId,
    new BN(500_000),  // 500 kWh
    'Solar',
    'Validated by GridTokenX Oracle'
  )
  .accounts({
    poaConfig: poaConfigPda,
    ercCertificate: ercPda,
    meterAccount: meterPda,
    authority: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `BelowMinimumEnergy` | Energy < 100 kWh |
| `ExceedsMaximumEnergy` | Energy > 1,000,000 kWh |
| `InsufficientUnclaimedGeneration` | Double-claim prevention |
| `SystemPaused` | Emergency pause active |

---

## validate_erc_for_trading

Validate a certificate for marketplace trading.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | `PDA` | Global configuration |
| `erc_certificate` | `PDA (mut)` | Certificate to validate |
| `authority` | `Signer` | REC authority |

### Example

```typescript
await program.methods
  .validateErcForTrading()
  .accounts({
    poaConfig: poaConfigPda,
    ercCertificate: ercPda,
    authority: wallet.publicKey,
  })
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `InvalidErcStatus` | Not Valid status |
| `AlreadyValidated` | Already validated |
| `ErcExpired` | Certificate expired |

---

## revoke_erc

Revoke an ERC certificate permanently.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | `PDA (mut)` | Global configuration |
| `erc_certificate` | `PDA (mut)` | Certificate to revoke |
| `authority` | `Signer` | REC authority |

### Arguments

| Name | Type | Constraints |
|------|------|-------------|
| `reason` | `String` | Required, max 128 chars |

### Example

```typescript
await program.methods
  .revokeErc('Fraudulent meter data detected')
  .accounts({
    poaConfig: poaConfigPda,
    ercCertificate: ercPda,
    authority: wallet.publicKey,
  })
  .rpc();
```

### State Changes

- `status` → `Revoked`
- `revocation_reason` → provided reason
- `revoked_at` → current timestamp
- `validated_for_trading` → `false`
- `total_ercs_revoked` → incremented

### Errors

| Code | Description |
|------|-------------|
| `AlreadyRevoked` | Certificate already revoked |
| `RevocationReasonRequired` | Empty reason provided |

---

## transfer_erc

Transfer certificate ownership to a new owner.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | `PDA` | Global configuration |
| `erc_certificate` | `PDA (mut)` | Certificate to transfer |
| `current_owner` | `Signer` | Current certificate owner |
| `new_owner` | `AccountInfo` | Recipient address |

### Example

```typescript
await program.methods
  .transferErc()
  .accounts({
    poaConfig: poaConfigPda,
    ercCertificate: ercPda,
    currentOwner: wallet.publicKey,
    newOwner: recipientPubkey,
  })
  .rpc();
```

### State Changes

- `owner` → `new_owner`
- `transfer_count` → incremented
- `last_transferred_at` → current timestamp

### Errors

| Code | Description |
|------|-------------|
| `TransfersNotAllowed` | Transfers disabled in config |
| `NotValidatedForTrading` | Not validated yet |
| `CannotTransferToSelf` | new_owner == current_owner |
| `ErcExpired` | Certificate expired |

---

## propose_authority_change

Step 1 of 2-step authority transfer.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | `PDA (mut)` | Global configuration |
| `authority` | `Signer` | Current REC authority |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `new_authority` | `Pubkey` | Proposed new authority |

### Example

```typescript
await program.methods
  .proposeAuthorityChange(newAuthorityPubkey)
  .accounts({
    poaConfig: poaConfigPda,
    authority: wallet.publicKey,
  })
  .rpc();
```

### State Changes

- `pending_authority` → `new_authority`
- `pending_authority_proposed_at` → current timestamp
- `pending_authority_expires_at` → current + 48 hours

### Errors

| Code | Description |
|------|-------------|
| `AuthorityChangePending` | Change already pending |
| `CannotTransferToSelf` | new_authority == current |

---

## approve_authority_change

Step 2 of 2-step authority transfer.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | `PDA (mut)` | Global configuration |
| `new_authority` | `Signer` | Pending authority (must sign) |

### Example

```typescript
await program.methods
  .approveAuthorityChange()
  .accounts({
    poaConfig: poaConfigPda,
    newAuthority: newAuthorityWallet.publicKey,
  })
  .signers([newAuthorityWallet])
  .rpc();
```

### State Changes

- `authority` → `pending_authority`
- `pending_authority` → `None`
- `pending_authority_proposed_at` → `None`
- `pending_authority_expires_at` → `None`

### Errors

| Code | Description |
|------|-------------|
| `NoAuthorityChangePending` | No pending change |
| `InvalidPendingAuthority` | Signer != pending |
| `AuthorityChangeExpired` | 48 hours passed |

---

## cancel_authority_change

Cancel a pending authority change.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | `PDA (mut)` | Global configuration |
| `authority` | `Signer` | Current REC authority |

### Example

```typescript
await program.methods
  .cancelAuthorityChange()
  .accounts({
    poaConfig: poaConfigPda,
    authority: wallet.publicKey,
  })
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `NoAuthorityChangePending` | No pending change |

---

## set_oracle_authority

Configure oracle for data validation.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | `PDA (mut)` | Global configuration |
| `authority` | `Signer` | REC authority |

### Arguments

| Name | Type | Constraints |
|------|------|-------------|
| `oracle_authority` | `Pubkey` | Oracle account |
| `min_confidence` | `u8` | 0-100 |
| `require_validation` | `bool` | Enable requirement |

### Example

```typescript
await program.methods
  .setOracleAuthority(
    oraclePubkey,
    80,   // 80% minimum confidence
    true  // Enable validation requirement
  )
  .accounts({
    poaConfig: poaConfigPda,
    authority: wallet.publicKey,
  })
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `InvalidOracleConfidence` | min_confidence > 100 |

---

## emergency_pause

Pause all governance operations.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | `PDA (mut)` | Global configuration |
| `authority` | `Signer` | REC authority |

### Example

```typescript
await program.methods
  .emergencyPause()
  .accounts({
    poaConfig: poaConfigPda,
    authority: wallet.publicKey,
  })
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `AlreadyPaused` | System already paused |

---

## emergency_unpause

Resume governance operations.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | `PDA (mut)` | Global configuration |
| `authority` | `Signer` | REC authority |

### Example

```typescript
await program.methods
  .emergencyUnpause()
  .accounts({
    poaConfig: poaConfigPda,
    authority: wallet.publicKey,
  })
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `NotPaused` | System not paused |

---

## get_governance_stats

Query governance statistics (read-only).

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `poa_config` | `PDA` | Global configuration |

### Returns

```typescript
interface GovernanceStats {
  totalErcsIssued: BN;
  totalErcsValidated: BN;
  totalErcsRevoked: BN;
  totalEnergyCertified: BN;
  ercValidationEnabled: boolean;
  emergencyPaused: boolean;
  maintenanceMode: boolean;
  minEnergyAmount: BN;
  maxErcAmount: BN;
  ercValidityPeriod: BN;
  requireOracleValidation: boolean;
  allowCertificateTransfers: boolean;
  delegationEnabled: boolean;
  createdAt: BN;
  lastUpdated: BN;
  lastErcIssuedAt: BN | null;
  pendingAuthorityChange: boolean;
  pendingAuthority: PublicKey | null;
  pendingAuthorityExpiresAt: BN | null;
  oracleAuthority: PublicKey | null;
  minOracleConfidence: number;
}
```

### Example

```typescript
const stats = await program.methods
  .getGovernanceStats()
  .accounts({
    poaConfig: poaConfigPda,
  })
  .view();

console.log('Total ERCs issued:', stats.totalErcsIssued.toString());
console.log('System paused:', stats.emergencyPaused);
```

---

## Events

### Core Events

| Event | Description |
|-------|-------------|
| `PoAInitialized` | PoA configuration created |
| `EmergencyPauseActivated` | System paused |
| `EmergencyPauseDeactivated` | System resumed |
| `ErcIssued` | Certificate created |
| `ErcValidatedForTrading` | Certificate validated |
| `GovernanceConfigUpdated` | Config changed |
| `MaintenanceModeUpdated` | Maintenance toggled |
| `ErcLimitsUpdated` | Limits changed |
| `AuthorityInfoUpdated` | Contact info changed |

### New Events (v2.0)

| Event | Description |
|-------|-------------|
| `ErcRevoked` | Certificate revoked |
| `ErcTransferred` | Ownership transferred |
| `AuthorityChangeProposed` | Authority change step 1 |
| `AuthorityChangeApproved` | Authority change step 2 |
| `AuthorityChangeCancelled` | Authority change cancelled |
| `OracleAuthoritySet` | Oracle configured |

---

**Document Version**: 2.0 - November 29, 2025
