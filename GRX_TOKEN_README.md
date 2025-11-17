# GRX Token - Quick Start Guide

## Overview

The GRX (GridTokenX) token has been successfully implemented in the Energy Token program with full Token 2022 compatibility and Metaplex metadata support.

## ✅ Implementation Status

- ✅ **Token Program**: `create_token_mint` and `mint_to_wallet` instructions added
- ✅ **Token 2022 Support**: Uses `anchor_spl::token_interface` for compatibility
- ✅ **Metaplex Metadata**: On-chain metadata with name, symbol, and URI
- ✅ **Build Successful**: Program compiled without errors
- ✅ **Tests Created**: Comprehensive test suite in `tests/grx-token.test.ts`
- ✅ **Scripts Ready**: Helper scripts for token creation
- ✅ **Documentation**: Full documentation in `docs/GRX_TOKEN.md`

## Quick Start

### 1. View Demo

```bash
cd anchor
ts-node scripts/demo-grx-token.ts
```

### 2. Create Your GRX Token

```bash
cd anchor
ts-node scripts/create-grx-token.ts
```

This will:
- Generate a new mint keypair (saved to `grx-mint-keypair.json`)
- Create the token with Metaplex metadata
- Mint initial supply to your wallet
- Save token info to `grx-token-info.json`

### 3. Run Tests

```bash
cd anchor
anchor test --skip-local-validator  # If validator is running
# or
anchor test  # Starts validator automatically
```

## Token Specifications

| Property | Value |
|----------|-------|
| Name | GridTokenX |
| Symbol | GRX |
| Decimals | 9 |
| Program ID | `94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur` |
| Standard | SPL Token / Token 2022 |

## Instructions

### `create_token_mint`
Creates a new GRX token mint with metadata.

**Parameters:**
- `name`: Token name (string)
- `symbol`: Token symbol (string)
- `uri`: Metadata URI (string)

### `mint_to_wallet`
Mints tokens to any wallet address.

**Parameters:**
- `amount`: Amount to mint (u64, includes decimals)

**Features:**
- Automatically creates associated token account if needed
- Supports both SPL Token and Token 2022 programs

## File Locations

```
anchor/
├── programs/energy-token/
│   ├── src/lib.rs              # Token program implementation
│   └── Cargo.toml              # Dependencies with metadata support
├── tests/
│   └── grx-token.test.ts       # Comprehensive test suite
├── scripts/
│   ├── create-grx-token.ts     # Token creation script
│   └── demo-grx-token.ts       # Demo and information script
├── docs/
│   └── GRX_TOKEN.md            # Full documentation
└── target/
    ├── idl/energy_token.json   # Generated IDL
    └── deploy/energy_token.so  # Compiled program
```

## Example Usage

### TypeScript

```typescript
import * as anchor from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

// Create token
const mintKeypair = Keypair.generate();
const [metadata] = PublicKey.findProgramAddressSync(
  [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), 
   mintKeypair.publicKey.toBuffer()],
  METADATA_PROGRAM_ID
);

await program.methods
  .createTokenMint("GridTokenX", "GRX", "https://arweave.net/metadata.json")
  .accounts({
    mint: mintKeypair.publicKey,
    metadata,
    payer: wallet.publicKey,
    authority: wallet.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    metadataProgram: METADATA_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .signers([mintKeypair])
  .rpc();

// Mint tokens
await program.methods
  .mintToWallet(new anchor.BN(1_000_000_000)) // 1 GRX
  .accounts({
    mint: mintKeypair.publicKey,
    destination: recipientTokenAccount,
    destinationOwner: recipientPublicKey,
    authority: authorityPublicKey,
    payer: payerPublicKey,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

## Metadata JSON Format

Upload to Arweave/IPFS:

```json
{
  "name": "GridTokenX",
  "symbol": "GRX",
  "description": "Utility token for GridTokenX P2P energy trading",
  "image": "https://arweave.net/grx-logo.png",
  "external_url": "https://gridtokenx.io",
  "attributes": [
    {"trait_type": "Token Type", "value": "Utility"},
    {"trait_type": "Platform", "value": "Solana"},
    {"trait_type": "Use Case", "value": "P2P Energy Trading"}
  ]
}
```

## Integration with GridTokenX

- **Trading**: Settlement currency for P2P energy trades
- **Governance**: Voting power for platform decisions
- **Registry**: Payment for smart meter registration
- **Oracle**: Rewards for data providers

## Security Considerations

1. **Mint Authority**: Has full control over token supply
   - Use multisig wallet for production
   - Consider implementing governance
   - Plan token distribution carefully

2. **Metadata**: Immutable once created
   - Use permanent storage (Arweave/IPFS)
   - Verify all metadata before creation
   - Ensure proper licensing for assets

3. **Token Distribution**:
   - Plan initial allocation
   - Implement vesting schedules
   - Set up treasury management
   - Define tokenomics clearly

## Deployment

### Localnet (Testing)
```bash
anchor localnet
# In another terminal:
ts-node scripts/create-grx-token.ts
```

### Devnet
```bash
solana config set -u devnet
anchor build
anchor deploy
# Update program ID in lib.rs
anchor build
anchor deploy
ts-node scripts/create-grx-token.ts
```

### Mainnet
1. Audit code thoroughly
2. Test extensively on devnet
3. Prepare token metadata and assets
4. Deploy with proper security measures
5. Verify on Solana Explorer

## Troubleshooting

**Issue**: "Account already in use"
- **Solution**: Use a new mint keypair or load existing mint

**Issue**: "Insufficient funds"
- **Solution**: Ensure wallet has enough SOL for rent and fees

**Issue**: "Invalid metadata account"
- **Solution**: Verify PDA derivation matches Metaplex program

**Issue**: Program build warnings
- **Solution**: Warnings about `unexpected_cfgs` are expected from Anchor v0.32.1 and don't affect functionality

## Resources

- **Documentation**: `anchor/docs/GRX_TOKEN.md`
- **Tests**: `anchor/tests/grx-token.test.ts`
- **Scripts**: `anchor/scripts/*.ts`
- **Solana Token Docs**: https://spl.solana.com/token
- **Token 2022**: https://spl.solana.com/token-2022
- **Metaplex**: https://docs.metaplex.com/programs/token-metadata/

## Support

For issues or questions:
1. Check the full documentation: `docs/GRX_TOKEN.md`
2. Review test examples: `tests/grx-token.test.ts`
3. Run the demo: `ts-node scripts/demo-grx-token.ts`

---

**Status**: ✅ Ready for testing and deployment
**Last Updated**: November 15, 2025
