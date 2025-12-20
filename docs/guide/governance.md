# Governance Program

The Governance program enables decentralized decision-making through proposals and voting.

## Overview

| Property | Value |
|----------|-------|
| Program ID | `governance` |
| Voting Token | GRID |
| Quorum | Configurable |

## Instructions

### `create_proposal`

Create a new governance proposal.

```rust
pub fn create_proposal(
    ctx: Context<CreateProposal>,
    title: String,
    description: String,
    execution_data: Vec<u8>
) -> Result<()>
```

### `cast_vote`

Vote on a proposal.

```rust
pub fn cast_vote(
    ctx: Context<CastVote>,
    vote: VoteChoice
) -> Result<()>
```

**Example:**
```typescript
await program.methods
  .castVote({ yes: {} })
  .accounts({
    proposal: proposalPda,
    voter: voter.publicKey,
    voterTokenAccount: voterAta,
  })
  .signers([voter])
  .rpc();
```

### `execute_proposal`

Execute a passed proposal.

```rust
pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()>
```

## Account Structures

### Proposal

```rust
#[account]
pub struct Proposal {
    pub id: u64,
    pub creator: Pubkey,
    pub title: String,
    pub description: String,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub status: ProposalStatus,
    pub created_at: i64,
    pub expires_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub enum ProposalStatus {
    Active,
    Passed,
    Rejected,
    Executed,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub enum VoteChoice {
    Yes,
    No,
    Abstain,
}
```

### VoteRecord

```rust
#[account]
pub struct VoteRecord {
    pub proposal: Pubkey,
    pub voter: Pubkey,
    pub vote: VoteChoice,
    pub weight: u64,
    pub timestamp: i64,
}
```

## PDAs

| PDA | Seeds | Purpose |
|-----|-------|---------|
| Proposal | `["proposal", id]` | Proposal state |
| Vote Record | `["vote", proposal, voter]` | Vote record |
| Governance Config | `["governance"]` | Global config |

## Governance Parameters

```rust
pub struct GovernanceConfig {
    pub voting_period: i64,      // 3 days default
    pub quorum_percentage: u8,   // 10% default
    pub execution_delay: i64,    // 24 hours
}
```
