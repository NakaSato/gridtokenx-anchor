# Governance SDK Module

## Overview

The Governance module enables decentralized decision-making through proposals, voting, and parameter management.

---

## Program ID

```
4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe
```

---

## Methods

### createProposal

Create a new governance proposal.

```typescript
async createProposal(params: {
  title: string;                    // Proposal title (max 100 chars)
  description: string;              // Detailed description
  proposalType: ProposalType;       // Type of proposal
  actions: ProposalAction[];        // On-chain actions to execute
  votingPeriod?: number;            // Voting duration in seconds
}): Promise<{
  tx: TransactionSignature;
  proposalId: PublicKey;
}>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `title` | `string` | Proposal title |
| `description` | `string` | Full description |
| `proposalType` | `ProposalType` | Category of proposal |
| `actions` | `ProposalAction[]` | Actions to execute if passed |
| `votingPeriod` | `number` | Duration in seconds |

**Example:**
```typescript
const { proposalId } = await client.governance.createProposal({
  title: 'Adjust Trading Fees',
  description: 'Reduce trading fees from 1% to 0.5%',
  proposalType: 'parameter_change',
  actions: [{
    program: TRADING_PROGRAM_ID,
    instruction: 'updateFee',
    data: { newFee: 50 }, // 0.5%
  }],
  votingPeriod: 7 * 24 * 3600, // 7 days
});
```

---

### vote

Cast a vote on an active proposal.

```typescript
async vote(params: {
  proposal: PublicKey;
  support: boolean;           // true = for, false = against
  weight?: bigint;            // Vote weight (defaults to token balance)
}): Promise<TransactionSignature>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `proposal` | `PublicKey` | Proposal PDA |
| `support` | `boolean` | Vote direction |
| `weight` | `bigint` | Custom vote weight |

**Example:**
```typescript
// Vote in favor
const tx = await client.governance.vote({
  proposal: proposalPda,
  support: true,
});
console.log('Vote cast:', tx);
```

---

### executeProposal

Execute a passed proposal after voting period ends.

```typescript
async executeProposal(params: {
  proposal: PublicKey;
}): Promise<TransactionSignature>
```

**Requirements:**
- Voting period must be ended
- Proposal must have passed (for > against, quorum met)
- Not already executed

**Example:**
```typescript
const tx = await client.governance.executeProposal({
  proposal: proposalPda,
});
console.log('Proposal executed:', tx);
```

---

### cancelProposal

Cancel a proposal (creator only, before voting ends).

```typescript
async cancelProposal(params: {
  proposal: PublicKey;
}): Promise<TransactionSignature>
```

---

### getProposal

Fetch proposal details.

```typescript
async getProposal(proposalId: PublicKey): Promise<Proposal | null>
```

**Returns:** Full proposal data or null

---

### getActiveProposals

Fetch all active proposals.

```typescript
async getActiveProposals(): Promise<Proposal[]>
```

**Returns:** Array of proposals in voting period

---

### getProposalHistory

Fetch past proposals.

```typescript
async getProposalHistory(params?: {
  limit?: number;
  status?: ProposalStatus;
}): Promise<Proposal[]>
```

---

### getUserVotes

Get votes cast by a user.

```typescript
async getUserVotes(wallet?: PublicKey): Promise<Vote[]>
```

---

### getVotingPower

Get voting power for a wallet.

```typescript
async getVotingPower(wallet?: PublicKey): Promise<bigint>
```

**Returns:** Total voting power based on token holdings

---

### delegateVotes

Delegate voting power to another address.

```typescript
async delegateVotes(params: {
  delegate: PublicKey;
}): Promise<TransactionSignature>
```

---

### undelegateVotes

Remove vote delegation.

```typescript
async undelegateVotes(): Promise<TransactionSignature>
```

---

## Types

```typescript
type ProposalType = 
  | 'parameter_change'    // Change system parameters
  | 'fee_adjustment'      // Adjust fee structure
  | 'oracle_update'       // Update oracle configuration
  | 'emergency_action'    // Emergency protocol changes
  | 'general';            // General governance

type ProposalStatus = 
  | 'pending'             // Not yet active
  | 'active'              // Voting in progress
  | 'passed'              // Voting passed
  | 'rejected'            // Voting failed
  | 'executed'            // Actions executed
  | 'cancelled';          // Cancelled by creator

interface Proposal {
  publicKey: PublicKey;
  creator: PublicKey;
  title: string;
  description: string;
  proposalType: ProposalType;
  status: ProposalStatus;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
  quorum: bigint;
  actions: ProposalAction[];
  createdAt: number;
  votingStartsAt: number;
  votingEndsAt: number;
  executedAt: number | null;
  totalVoters: number;
}

interface ProposalAction {
  program: PublicKey;
  instruction: string;
  data: Record<string, unknown>;
}

interface Vote {
  proposal: PublicKey;
  voter: PublicKey;
  support: boolean;
  weight: bigint;
  timestamp: number;
}

interface GovernanceConfig {
  minProposalThreshold: bigint;   // Min tokens to create proposal
  quorumPercentage: number;       // Required participation %
  votingDelay: number;            // Delay before voting starts
  votingPeriod: number;           // Default voting duration
  executionDelay: number;         // Timelock after passing
}
```

---

## Events

### onProposalCreated

```typescript
client.governance.onProposalCreated((event) => {
  console.log('New proposal:', event.title);
  console.log('Voting ends:', new Date(event.votingEndsAt * 1000));
});
```

### onVoteCast

```typescript
client.governance.onVoteCast((event) => {
  console.log('Vote:', event.support ? 'FOR' : 'AGAINST');
  console.log('Weight:', event.weight.toString());
});
```

### onProposalExecuted

```typescript
client.governance.onProposalExecuted((event) => {
  console.log('Executed:', event.proposal.toBase58());
});
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `InsufficientVotingPower` | Not enough tokens |
| `ProposalNotActive` | Proposal not in voting |
| `VotingPeriodEnded` | Voting has ended |
| `VotingPeriodNotEnded` | Voting still ongoing |
| `AlreadyVoted` | User already voted |
| `ProposalNotPassed` | Cannot execute failed proposal |
| `AlreadyExecuted` | Proposal already executed |
| `QuorumNotMet` | Quorum threshold not reached |
| `BelowProposalThreshold` | Not enough tokens to propose |
| `Unauthorized` | Caller not authorized |
| `InvalidAction` | Proposal action invalid |

---

## Governance Flow Example

```typescript
import { GridTokenXClient } from '@gridtokenx/sdk';

async function governanceWorkflow() {
  const client = new GridTokenXClient({ wallet });
  
  // 1. Check voting power
  const votingPower = await client.governance.getVotingPower();
  console.log('Voting power:', votingPower.toString());
  
  // 2. Create proposal
  const { proposalId } = await client.governance.createProposal({
    title: 'Reduce minimum order size',
    description: 'Lower minimum order from 1 kWh to 0.5 kWh',
    proposalType: 'parameter_change',
    actions: [{
      program: TRADING_PROGRAM_ID,
      instruction: 'updateMinOrder',
      data: { minOrder: 500_000_000 }, // 0.5 kWh
    }],
  });
  
  console.log('Proposal created:', proposalId.toBase58());
  
  // 3. Vote on proposal
  const voteTx = await client.governance.vote({
    proposal: proposalId,
    support: true,
  });
  
  console.log('Vote cast:', voteTx);
  
  // 4. Check proposal status
  const proposal = await client.governance.getProposal(proposalId);
  console.log('For votes:', proposal.forVotes.toString());
  console.log('Against votes:', proposal.againstVotes.toString());
  
  // 5. Execute after voting ends (if passed)
  if (proposal.status === 'passed') {
    const execTx = await client.governance.executeProposal({
      proposal: proposalId,
    });
    console.log('Executed:', execTx);
  }
}
```

---

**Document Version**: 1.0
