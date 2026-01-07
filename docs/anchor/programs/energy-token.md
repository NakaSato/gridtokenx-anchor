# Energy Token Program

**Program ID:** `5T7PuWV6wbzhJP9WDfDegPMGRiadMhxHrUc2n2LAB9gY`

The Energy Token program manages the GridTokenX (GRX) utility token. It leverages generic Token 2022 (Token Extensions) standards where applicable and provides custom logic for minting and metered usage.

## Features

- **Token 2022 Compatibility**: Designed to work with the newer Token extensions.
- **Metaplex Metadata**: Integrates with Metaplex to attach metadata (Name, Symbol, URI) to the mint.
- **Compute Optimization**: Includes conditional compilation for `localnet` to enable detailed compute unit logging (`compute_fn!`, `compute_checkpoint!`).

## Account Structures

### TokenInfo
Tracks token authority and supply internally.

**PDA**: Derived from seed `["token_info"]`.

```rust
#[account]
pub struct TokenInfo {
    pub authority: Pubkey,    // Program authority
    pub mint: Pubkey,         // The GRX mint address
    pub total_supply: u64,    // Tracked supply
    pub created_at: i64,      // Creation timestamp
}
```

## Instructions

### `initialize`
Program initialization (currently a no-op/logging checkpoint).

### `create_token_mint`
Creates the GRX token mint account.
- **CPI**: Calls Metaplex Token Metadata program to create metadata.
- **Params**: `name`, `symbol`, `uri`.
- **Logic**: 
  - Sets decimals to **9**.
  - Sets standard to `Fungible`.
  - Sets 0 seller fees.

### `mint_to_wallet`
Mints GRX tokens to a specific wallet.
- **Auth**: Requires program authority signature (`token_info` PDA).
- **CPI**: Calls `token_interface::mint_to`.
- **Seeds**: `&[b"token_info", &[bump]]` used for signing.

### `initialize_token`
Initializes internal `TokenInfo` state to track total supply and authority.
- **Seeds**: `["token_info"]`.

### `add_rec_validator`
Adds an authorized REC validator to the system who can approve minting/burning (stub/check authority).

### `transfer_tokens`
Transfers tokens between accounts.
- **CPI**: Calls `token::transfer`.

### `burn_tokens`
Burns tokens, representing energy consumption or retirement.
- **CPI**: Calls `token::burn`.
- **State Update**: Updates `token_info.total_supply`.

### `mint_tokens_direct`
Allows the authority to mint tokens directly, used for off-chain verified meter readings or adjustments.
