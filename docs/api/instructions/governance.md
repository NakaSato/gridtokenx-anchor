# Governance Program Instructions

## Program ID
```
4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe
```

---

## initialize

Initialize the governance program.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `authority` | `Signer` | Program authority |
| `governance_state` | `PDA` | Governance state |
| `system_program` | `Program` | System program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `config` | `GovernanceConfig` | Initial configuration |

### Example

```typescript
await program.methods
  .initialize({
    minProposalThreshold: new BN(1_000_000_000_000), // 1000 GRID
    quorumPercentage: 10,                            // 10%
    votingDelay: 86400,                              // 1 day
    votingPeriod: 604800,                            // 7 days
    executionDelay: 172800,                          // 2 days
  })
  .accounts({
    authority: wallet.publicKey,
    governanceState: governancePda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

## create_proposal

Create a new governance proposal.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `creator` | `Signer` | Proposal creator |
| `creator_token_account` | `ATA` | Creator's GRID tokens |
| `proposal` | `PDA` | Proposal account to create |
| `governance_state` | `PDA` | Governance state |
| `system_program` | `Program` | System program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `title` | `String` | Proposal title (max 100 chars) |
| `description` | `String` | Full description (max 2000 chars) |
| `proposal_type` | `ProposalType` | Type of proposal |
| `actions` | `Vec<ProposalAction>` | Actions to execute |
| `voting_period` | `Option<i64>` | Custom voting period |

### PDA Seeds

```
["proposal", creator_pubkey, nonce]
```

### Example

```typescript
const nonce = new BN(Date.now());
const [proposalPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from('proposal'),
    wallet.publicKey.toBuffer(),
    nonce.toArrayLike(Buffer, 'le', 8),
  ],
  GOVERNANCE_PROGRAM_ID
);

await program.methods
  .createProposal(
    'Reduce Trading Fees',
    'This proposal reduces trading fees from 1% to 0.5% to increase market activity.',
    { parameterChange: {} },
    [{
      program: TRADING_PROGRAM_ID,
      instruction: 'updateMarketplace',
      data: Buffer.from(JSON.stringify({ feeBps: 50 })),
    }],
    null // Use default voting period
  )
  .accounts({
    creator: wallet.publicKey,
    creatorTokenAccount: creatorAta,
    proposal: proposalPda,
    governanceState: governancePda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Validation

- Creator must hold ≥ minimum threshold tokens
- Title and description within limits
- At least one action required (unless general type)

### Errors

| Code | Description |
|------|-------------|
| `BelowProposalThreshold` | Not enough tokens |
| `TitleTooLong` | Title exceeds 100 chars |
| `DescriptionTooLong` | Description exceeds 2000 chars |
| `NoActionsProvided` | Actions required |
| `InvalidAction` | Action format invalid |

---

## vote

Cast a vote on an active proposal.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `voter` | `Signer` | Vote caster |
| `voter_token_account` | `ATA` | Voter's GRID tokens |
| `vote_record` | `PDA` | Vote record account |
| `proposal` | `PDA` | Proposal to vote on |
| `governance_state` | `PDA` | Governance state |
| `system_program` | `Program` | System program |

### Arguments

| Name | Type | Description |
|------|------|-------------|
| `support` | `VoteType` | For, Against, or Abstain |
| `weight` | `Option<u64>` | Custom vote weight |

### PDA Seeds

```
["vote", proposal_pubkey, voter_pubkey]
```

### Example

```typescript
const [votePda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from('vote'),
    proposalPda.toBuffer(),
    wallet.publicKey.toBuffer(),
  ],
  GOVERNANCE_PROGRAM_ID
);

await program.methods
  .vote(
    { for: {} },  // VoteType::For
    null          // Use full token balance as weight
  )
  .accounts({
    voter: wallet.publicKey,
    voterTokenAccount: voterAta,
    voteRecord: votePda,
    proposal: proposalPda,
    governanceState: governancePda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Validation

- Proposal must be in voting period
- Voter cannot have already voted
- Voter must hold tokens

### Errors

| Code | Description |
|------|-------------|
| `ProposalNotActive` | Not in voting period |
| `AlreadyVoted` | User already voted |
| `NoVotingPower` | No tokens held |
| `VotingNotStarted` | Voting delay not passed |
| `VotingEnded` | Voting period ended |

---

## execute_proposal

Execute a passed proposal.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `executor` | `Signer` | Anyone can execute |
| `proposal` | `PDA` | Passed proposal |
| `governance_state` | `PDA` | Governance state |
| `target_program` | `Program` | Program to invoke |
| Additional accounts as required by actions |

### Arguments

None

### Example

```typescript
await program.methods
  .executeProposal()
  .accounts({
    executor: wallet.publicKey,
    proposal: proposalPda,
    governanceState: governancePda,
    targetProgram: TRADING_PROGRAM_ID,
    // Include accounts required by proposal actions
    marketplaceState: marketplacePda,
  })
  .rpc();
```

### Validation

- Voting period must be ended
- Proposal must have passed (for > against)
- Quorum must be met
- Execution delay must have passed
- Not already executed

### Errors

| Code | Description |
|------|-------------|
| `VotingNotEnded` | Voting still active |
| `ProposalNotPassed` | Did not pass |
| `QuorumNotMet` | Insufficient participation |
| `ExecutionDelayNotPassed` | Timelock active |
| `AlreadyExecuted` | Already executed |
| `ExecutionFailed` | CPI failed |

---

## cancel_proposal

Cancel a proposal (creator or admin only).

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `authority` | `Signer` | Creator or admin |
| `proposal` | `PDA` | Proposal to cancel |
| `governance_state` | `PDA` | Governance state |

### Arguments

None

### Example

```typescript
await program.methods
  .cancelProposal()
  .accounts({
    authority: wallet.publicKey,
    proposal: proposalPda,
    governanceState: governancePda,
  })
  .rpc();
```

### Errors

| Code | Description |
|------|-------------|
| `Unauthorized` | Not creator or admin |
| `ProposalNotCancellable` | Cannot cancel |

---

## delegate_votes

Delegate voting power to another address.

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| `delegator` | `Signer` | Token holder |
| `delegate` | `Account` | Delegate address |
| `delegation_record` | `PDA` | Delegation account |
| `governance_state` | `PDA` | Governance state |
| `system_program` | `Program` | System program |

### Arguments

None

### Example

```typescript
const [delegationPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from('delegation'),
    wallet.publicKey.toBuffer(),
  ],
  GOVERNANCE_PROGRAM_ID
);

await program.methods
  .delegateVotes()
  .accounts({
    delegator: wallet.publicKey,
    delegate: delegatePubkey,
    delegationRecord: delegationPda,
    governanceState: governancePda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

## Account Structures

### GovernanceState

```rust
pub struct GovernanceState {
    pub authority: Pubkey,
    pub config: GovernanceConfig,
    pub total_proposals: u64,
    pub active_proposals: u64,
    pub executed_proposals: u64,
    pub initialized_at: i64,
}
```

### GovernanceConfig

```rust
pub struct GovernanceConfig {
    pub min_proposal_threshold: u64,
    pub quorum_percentage: u8,
    pub voting_delay: i64,
    pub voting_period: i64,
    pub execution_delay: i64,
}
```

### Proposal

```rust
pub struct Proposal {
    pub creator: Pubkey,
    pub title: String,
    pub description: String,
    pub proposal_type: ProposalType,
    pub status: ProposalStatus,
    pub for_votes: u64,
    pub against_votes: u64,
    pub abstain_votes: u64,
    pub quorum: u64,
    pub actions: Vec<ProposalAction>,
    pub nonce: u64,
    pub created_at: i64,
    pub voting_starts_at: i64,
    pub voting_ends_at: i64,
    pub executed_at: Option<i64>,
    pub total_voters: u64,
}
```

### VoteRecord

```rust
pub struct VoteRecord {
    pub proposal: Pubkey,
    pub voter: Pubkey,
    pub vote_type: VoteType,
    pub weight: u64,
    pub timestamp: i64,
}
```

### ProposalAction

```rust
pub struct ProposalAction {
    pub program: Pubkey,
    pub instruction: String,
    pub data: Vec<u8>,
}
```

---

## Enums

### ProposalType

```rust
pub enum ProposalType {
    ParameterChange,
    FeeAdjustment,
    OracleUpdate,
    EmergencyAction,
    General,
}
```

### ProposalStatus

```rust
pub enum ProposalStatus {
    Pending,
    Active,
    Passed,
    Rejected,
    Executed,
    Cancelled,
}
```

### VoteType

```rust
pub enum VoteType {
    For,
    Against,
    Abstain,
}
```

---

## Events

### ProposalCreated

```rust
#[event]
pub struct ProposalCreated {
    pub proposal: Pubkey,
    pub creator: Pubkey,
    pub title: String,
    pub proposal_type: ProposalType,
    pub voting_starts_at: i64,
    pub voting_ends_at: i64,
    pub timestamp: i64,
}
```

### VoteCast

```rust
#[event]
pub struct VoteCast {
    pub proposal: Pubkey,
    pub voter: Pubkey,
    pub vote_type: VoteType,
    pub weight: u64,
    pub timestamp: i64,
}
```

### ProposalExecuted

```rust
#[event]
pub struct ProposalExecuted {
    pub proposal: Pubkey,
    pub executor: Pubkey,
    pub timestamp: i64,
}
```

---

## Voting Power Calculation

```rust
pub fn calculate_voting_power(
    token_balance: u64,
    delegated_to_self: u64,
    delegated_away: u64,
) -> u64 {
    // Own tokens + delegated to self - delegated away
    token_balance + delegated_to_self - delegated_away
}
```

---

## Proposal Lifecycle

```
Created → Pending → Active → Passed/Rejected → Executed/Cancelled
              │
              └── (voting_delay)
                        │
                        └── (voting_period)
                                  │
                                  └── (execution_delay)
```

---

**Document Version**: 1.0
