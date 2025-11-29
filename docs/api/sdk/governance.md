# Governance SDK Module

> **PoA-based ERC Certificate Management SDK**
>
> Version 2.0 - November 2025

## Overview

The Governance module manages Energy Renewable Certificates (ERCs) through Proof of Authority (PoA) governance, including certificate issuance, validation, revocation, and transfers.

---

## Program ID

```
4D9Mydr4f3BEiDoKxE2V8yMZBj53X6nxMjMWaNPAQKrN
```

---

## Methods

### initializePoa

Initialize the Proof of Authority configuration.

```typescript
async initializePoa(): Promise<TransactionSignature>
```

**Example:**
```typescript
const tx = await client.governance.initializePoa();
console.log('PoA initialized:', tx);
```

---

### issueErc

Issue a new Energy Renewable Certificate.

```typescript
async issueErc(params: {
  certificateId: string;        // Unique ID (max 64 chars)
  energyAmount: bigint;         // kWh (100 - 1,000,000)
  renewableSource: string;      // e.g., "Solar", "Wind"
  validationData: string;       // Additional data (max 256 chars)
  meterAccount: PublicKey;      // Meter from Registry
}): Promise<{
  tx: TransactionSignature;
  certificatePda: PublicKey;
}>
```

**Example:**
```typescript
const { certificatePda } = await client.governance.issueErc({
  certificateId: 'ERC-2025-001',
  energyAmount: 500_000n,         // 500 kWh
  renewableSource: 'Solar',
  validationData: 'Validated by GridTokenX Oracle',
  meterAccount: meterPda,
});
console.log('Certificate issued:', certificatePda.toBase58());
```

---

### validateErcForTrading

Validate a certificate for marketplace trading.

```typescript
async validateErcForTrading(params: {
  certificate: PublicKey;
}): Promise<TransactionSignature>
```

**Example:**
```typescript
const tx = await client.governance.validateErcForTrading({
  certificate: ercPda,
});
console.log('Certificate validated:', tx);
```

---

### revokeErc

Revoke an ERC certificate permanently.

```typescript
async revokeErc(params: {
  certificate: PublicKey;
  reason: string;               // Required, max 128 chars
}): Promise<TransactionSignature>
```

**Example:**
```typescript
const tx = await client.governance.revokeErc({
  certificate: ercPda,
  reason: 'Fraudulent meter data detected',
});
console.log('Certificate revoked:', tx);
```

---

### transferErc

Transfer certificate ownership to a new owner.

```typescript
async transferErc(params: {
  certificate: PublicKey;
  newOwner: PublicKey;
}): Promise<TransactionSignature>
```

**Requirements:**
- Transfers must be enabled in config
- Certificate must be validated for trading
- Certificate must not be expired

**Example:**
```typescript
const tx = await client.governance.transferErc({
  certificate: ercPda,
  newOwner: recipientPubkey,
});
console.log('Certificate transferred:', tx);
```

---

### proposeAuthorityChange

Step 1 of 2-step authority transfer.

```typescript
async proposeAuthorityChange(params: {
  newAuthority: PublicKey;
}): Promise<TransactionSignature>
```

**Note:** The proposed authority has 48 hours to approve.

**Example:**
```typescript
const tx = await client.governance.proposeAuthorityChange({
  newAuthority: newAuthorityPubkey,
});
console.log('Authority change proposed:', tx);
```

---

### approveAuthorityChange

Step 2 of 2-step authority transfer (called by new authority).

```typescript
async approveAuthorityChange(): Promise<TransactionSignature>
```

**Example:**
```typescript
// Called by the new authority wallet
const tx = await client.governance.approveAuthorityChange();
console.log('Authority change approved:', tx);
```

---

### cancelAuthorityChange

Cancel a pending authority change.

```typescript
async cancelAuthorityChange(): Promise<TransactionSignature>
```

---

### setOracleAuthority

Configure oracle for data validation.

```typescript
async setOracleAuthority(params: {
  oracleAuthority: PublicKey;
  minConfidence: number;        // 0-100
  requireValidation: boolean;
}): Promise<TransactionSignature>
```

**Example:**
```typescript
const tx = await client.governance.setOracleAuthority({
  oracleAuthority: oraclePubkey,
  minConfidence: 80,            // 80% minimum
  requireValidation: true,
});
console.log('Oracle configured:', tx);
```

---

### emergencyPause / emergencyUnpause

Control system operations.

```typescript
async emergencyPause(): Promise<TransactionSignature>
async emergencyUnpause(): Promise<TransactionSignature>
```

---

### getGovernanceStats

Query governance statistics.

```typescript
async getGovernanceStats(): Promise<GovernanceStats>
```

**Returns:**
```typescript
interface GovernanceStats {
  totalErcsIssued: bigint;
  totalErcsValidated: bigint;
  totalErcsRevoked: bigint;
  totalEnergyCertified: bigint;
  ercValidationEnabled: boolean;
  emergencyPaused: boolean;
  maintenanceMode: boolean;
  minEnergyAmount: bigint;
  maxErcAmount: bigint;
  ercValidityPeriod: bigint;
  requireOracleValidation: boolean;
  allowCertificateTransfers: boolean;
  pendingAuthorityChange: boolean;
  pendingAuthority: PublicKey | null;
  pendingAuthorityExpiresAt: bigint | null;
  oracleAuthority: PublicKey | null;
  minOracleConfidence: number;
}
```

---

### getCertificate

Fetch certificate details.

```typescript
async getCertificate(certificateId: string): Promise<ErcCertificate | null>
```

**Returns:**
```typescript
interface ErcCertificate {
  publicKey: PublicKey;
  certificateId: string;
  authority: PublicKey;
  owner: PublicKey;
  energyAmount: bigint;
  renewableSource: string;
  validationData: string;
  issuedAt: number;
  expiresAt: number | null;
  status: ErcStatus;
  validatedForTrading: boolean;
  tradingValidatedAt: number | null;
  revocationReason: string | null;
  revokedAt: number | null;
  transferCount: number;
  lastTransferredAt: number | null;
}

type ErcStatus = 'Valid' | 'Expired' | 'Revoked' | 'Pending';
```

---

## Events

### onErcIssued

```typescript
client.governance.onErcIssued((event) => {
  console.log('Certificate:', event.certificateId);
  console.log('Energy:', event.energyAmount, 'kWh');
  console.log('Source:', event.renewableSource);
});
```

### onErcValidatedForTrading

```typescript
client.governance.onErcValidatedForTrading((event) => {
  console.log('Validated:', event.certificateId);
});
```

### onErcRevoked

```typescript
client.governance.onErcRevoked((event) => {
  console.log('Revoked:', event.certificateId);
  console.log('Reason:', event.reason);
});
```

### onErcTransferred

```typescript
client.governance.onErcTransferred((event) => {
  console.log('Certificate:', event.certificateId);
  console.log('From:', event.fromOwner.toBase58());
  console.log('To:', event.toOwner.toBase58());
});
```

### onAuthorityChangeProposed

```typescript
client.governance.onAuthorityChangeProposed((event) => {
  console.log('Proposed:', event.proposedAuthority.toBase58());
  console.log('Expires:', new Date(event.expiresAt * 1000));
});
```

### onOracleAuthoritySet

```typescript
client.governance.onOracleAuthoritySet((event) => {
  console.log('Oracle:', event.oracleAuthority.toBase58());
  console.log('Min confidence:', event.minConfidence, '%');
});
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `UnauthorizedAuthority` | Not the REC authority |
| `SystemPaused` | Emergency pause active |
| `MaintenanceMode` | Maintenance mode active |
| `BelowMinimumEnergy` | Energy < 100 kWh |
| `ExceedsMaximumEnergy` | Energy > 1,000,000 kWh |
| `InsufficientUnclaimedGeneration` | Double-claim prevention |
| `InvalidErcStatus` | Wrong certificate status |
| `AlreadyValidated` | Already validated |
| `ErcExpired` | Certificate expired |
| `AlreadyRevoked` | Already revoked |
| `RevocationReasonRequired` | Empty reason |
| `TransfersNotAllowed` | Transfers disabled |
| `NotValidatedForTrading` | Not validated yet |
| `CannotTransferToSelf` | Same owner transfer |
| `AuthorityChangePending` | Change in progress |
| `NoAuthorityChangePending` | No pending change |
| `AuthorityChangeExpired` | 48h passed |
| `InvalidOracleConfidence` | > 100 |

---

## Complete Workflow Example

```typescript
import { GridTokenXClient } from '@gridtokenx/sdk';

async function ercWorkflow() {
  const client = new GridTokenXClient({ wallet });
  
  // 1. Check governance stats
  const stats = await client.governance.getGovernanceStats();
  console.log('Total ERCs issued:', stats.totalErcsIssued.toString());
  console.log('System paused:', stats.emergencyPaused);
  
  // 2. Issue ERC certificate
  const { certificatePda } = await client.governance.issueErc({
    certificateId: 'ERC-2025-001',
    energyAmount: 500_000n,
    renewableSource: 'Solar',
    validationData: 'Meter: MTR-001, Period: Jan 2025',
    meterAccount: meterPda,
  });
  console.log('Certificate issued:', certificatePda.toBase58());
  
  // 3. Validate for trading
  await client.governance.validateErcForTrading({
    certificate: certificatePda,
  });
  console.log('Certificate validated for trading');
  
  // 4. Transfer to buyer
  await client.governance.transferErc({
    certificate: certificatePda,
    newOwner: buyerPubkey,
  });
  console.log('Certificate transferred to buyer');
  
  // 5. Check certificate status
  const cert = await client.governance.getCertificate('ERC-2025-001');
  console.log('Owner:', cert.owner.toBase58());
  console.log('Transfer count:', cert.transferCount);
}

// Authority transfer workflow
async function authorityTransfer() {
  const client = new GridTokenXClient({ wallet: currentAuthority });
  const newClient = new GridTokenXClient({ wallet: newAuthority });
  
  // Step 1: Current authority proposes change
  await client.governance.proposeAuthorityChange({
    newAuthority: newAuthority.publicKey,
  });
  console.log('Authority change proposed');
  
  // Step 2: New authority approves (within 48h)
  await newClient.governance.approveAuthorityChange();
  console.log('Authority change approved');
}
```

---

**Document Version**: 2.0 - November 29, 2025
