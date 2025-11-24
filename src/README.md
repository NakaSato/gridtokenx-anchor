# GridTokenX Generated Clients

This directory contains generated client libraries for the GridTokenX project.

## JavaScript/TypeScript Client

### Files Generated:
- `energy_token.ts` - TypeScript types for the Energy Token program
- `governance.ts` - TypeScript types for the Governance program  
- `oracle.ts` - TypeScript types for the Oracle program
- `registry.ts` - TypeScript types for the Registry program
- `trading.ts` - TypeScript types for the Trading program
- `index.ts` - Main export file with all types and IDLs
- `client.ts` - Unified client for all GridTokenX programs

### Usage:

```typescript
import { Connection, Keypair } from '@solana/web3.js';
import { Wallet } from '@coral-xyz/anchor';
import { createGridTokenXClient } from './client';

// Create connection
const connection = new Connection('https://api.devnet.solana.com');

// Create wallet
const keypair = Keypair.generate();
const wallet = new Wallet(keypair);

// Create client
const client = createGridTokenXClient(connection, wallet);

// Access programs
const energyTokenProgram = client.energyToken;
const governanceProgram = client.governance;
// ... etc
```

### Program Addresses:
- Energy Token: `94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur`
- Governance: `4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe`
- Oracle: `DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE`
- Registry: `2XPQmFYMdXjP7ffoBB3mXeCdboSFg5Yeb6QmTSGbW8a7`
- Trading: `GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk`

## Rust Client

### Location: `../generated/rust/`

### Files Generated:
- `Cargo.toml` - Rust project configuration
- `src/lib.rs` - Main library with unified client

### Usage:

```rust
use gridtokenx_clients::{GridTokenXClient, utils};
use solana_sdk::signature::Keypair;

// Create keypair
let keypair = Keypair::new();

// Create client for devnet
let client = utils::devnet(keypair)?;

// Access programs
let energy_token_program = client.energy_token()?;
let governance_program = client.governance()?;
// ... etc
```

## Generation Process

These clients were generated using:
1. Anchor framework for IDL extraction
2. Anchor's built-in TypeScript type generation
3. Custom client wrappers for unified API access

The original IDL files are located in `../../target/idl/` and contain the complete interface definitions for each program.
