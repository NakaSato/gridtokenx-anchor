# Cross-Chain Bridge: Deep Dive

> **Wormhole Integration for Multi-Chain Energy Trading**

---

## 1. Executive Summary

The GridTokenX Cross-Chain Bridge enables **interoperable energy trading** across multiple blockchain networks using the Wormhole protocol. This allows:

- **Asset Bridging**: Transfer GRX tokens between Solana, Ethereum, Polygon, and other chains
- **Cross-Chain Settlements**: Complete energy trades with payments from different networks
- **Liquidity Aggregation**: Unified liquidity pools across blockchain ecosystems
- **Global Market Access**: Connect Thai energy market to international participants

**Key Innovation:** First energy-specific cross-chain bridge with integrated settlement verification.

---

## 2. Wormhole Protocol Overview

### 2.1 Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         WORMHOLE BRIDGE ARCHITECTURE                     │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  SOURCE CHAIN (Solana)                    TARGET CHAIN (Ethereum)        │
│  ┌─────────────────┐                      ┌─────────────────┐           │
│  │  GridTokenX     │                      │   Wrapped GRX   │           │
│  │  Trading        │                      │   (ERC-20)      │           │
│  └────────┬────────┘                      └────────▲────────┘           │
│           │                                        │                     │
│           ▼                                        │                     │
│  ┌─────────────────┐                      ┌─────────────────┐           │
│  │  Token Bridge   │    ═══════════════►  │  Token Bridge   │           │
│  │  (Lock Tokens)  │         VAA          │  (Mint Wrapped) │           │
│  └────────┬────────┘                      └────────▲────────┘           │
│           │                                        │                     │
│           ▼                                        │                     │
│  ┌─────────────────┐                      ┌─────────────────┐           │
│  │  Core Bridge    │                      │  Core Bridge    │           │
│  │  (Emit Message) │                      │  (Verify VAA)   │           │
│  └────────┬────────┘                      └────────▲────────┘           │
│           │                                        │                     │
│           │              ┌───────────┐             │                     │
│           └─────────────►│  Guardian │─────────────┘                     │
│                          │  Network  │                                   │
│                          │  (19/19)  │                                   │
│                          └───────────┘                                   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Verified Action Approval (VAA)

A VAA is a signed attestation from the Guardian network proving a cross-chain message:

```rust
pub struct VAA {
    pub version: u8,
    pub guardian_set_index: u32,
    pub signatures: Vec<GuardianSignature>,  // 13-of-19 threshold
    pub timestamp: u32,
    pub nonce: u32,
    pub emitter_chain: u16,
    pub emitter_address: [u8; 32],
    pub sequence: u64,
    pub consistency_level: u8,
    pub payload: Vec<u8>,
}

pub struct GuardianSignature {
    pub guardian_index: u8,
    pub signature: [u8; 65],  // ECDSA signature
}
```

---

## 3. State Architecture

### 3.1 BridgeConfig Account

```rust
#[account]
#[derive(Default)]
pub struct BridgeConfig {
    pub bump: u8,                      // 1 - PDA bump
    pub market: Pubkey,                // 32 - Parent market
    pub wormhole_program: Pubkey,      // 32 - Wormhole core bridge
    pub token_bridge_program: Pubkey,  // 32 - Wormhole token bridge
    pub authority: Pubkey,             // 32 - Bridge admin
    
    // Configuration
    pub enabled: bool,                 // 1 - Bridge enabled
    pub min_bridge_amount: u64,        // 8 - Minimum transfer (covers fees)
    pub bridge_fee_bps: u16,           // 2 - Platform fee
    pub relayer_fee: u64,              // 8 - Relayer tip (destination chain)
    
    // Supported chains (bitmap)
    pub supported_chains: u32,         // 4 - Chain ID bitmap
    
    // Counters
    pub total_bridged_out: u64,        // 8 - Total sent to other chains
    pub total_bridged_in: u64,         // 8 - Total received from other chains
    pub bridge_count: u64,             // 8 - Total transactions
    
    pub _reserved: [u8; 32],           // 32 - Future use
}

impl BridgeConfig {
    pub const LEN: usize = 8 + 1 + 32 + 32 + 32 + 32 + 
                           1 + 8 + 2 + 8 + 4 + 8 + 8 + 8 + 32;
    
    /// Check if a Wormhole chain is supported
    pub fn is_chain_supported(&self, chain: WormholeChain) -> bool {
        let chain_bit = 1u32 << (chain as u16);
        self.supported_chains & chain_bit != 0
    }
    
    /// Enable a chain
    pub fn enable_chain(&mut self, chain: WormholeChain) {
        let chain_bit = 1u32 << (chain as u16);
        self.supported_chains |= chain_bit;
    }
    
    /// Disable a chain
    pub fn disable_chain(&mut self, chain: WormholeChain) {
        let chain_bit = 1u32 << (chain as u16);
        self.supported_chains &= !chain_bit;
    }
}
```

### 3.2 Supported Chains

```rust
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u16)]
pub enum WormholeChain {
    Solana = 1,
    Ethereum = 2,
    BinanceSmartChain = 4,
    Polygon = 5,
    Avalanche = 6,
    Arbitrum = 23,
    Optimism = 24,
    Base = 30,
}

impl WormholeChain {
    pub fn from_u16(value: u16) -> Option<Self> {
        match value {
            1 => Some(Self::Solana),
            2 => Some(Self::Ethereum),
            4 => Some(Self::BinanceSmartChain),
            5 => Some(Self::Polygon),
            6 => Some(Self::Avalanche),
            23 => Some(Self::Arbitrum),
            24 => Some(Self::Optimism),
            30 => Some(Self::Base),
            _ => None,
        }
    }
}
```

### 3.3 BridgeTransfer Account

```rust
#[account]
#[derive(Default)]
pub struct BridgeTransfer {
    pub bump: u8,                      // 1 - PDA bump
    pub user: Pubkey,                  // 32 - Initiator
    pub source_mint: Pubkey,           // 32 - Token being bridged
    
    // Destination
    pub destination_chain: u16,        // 2 - Wormhole chain ID
    pub destination_address: [u8; 32], // 32 - Recipient address (padded)
    
    // Amount tracking
    pub amount: u64,                   // 8 - Tokens being transferred
    pub fee: u64,                      // 8 - Fee charged
    
    // Status
    pub status: u8,                    // 1 - BridgeStatus enum
    pub sequence: u64,                 // 8 - Wormhole sequence number
    pub vaa_hash: [u8; 32],            // 32 - VAA hash (when confirmed)
    
    // Timestamps
    pub initiated_at: i64,             // 8 - Start time
    pub completed_at: i64,             // 8 - Completion time
    
    pub _reserved: [u8; 32],           // 32 - Future use
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum BridgeStatus {
    Pending = 0,      // Tokens locked, message pending
    MessageSent = 1,  // Wormhole message emitted
    Confirmed = 2,    // VAA generated by guardians
    Completed = 3,    // Tokens minted on destination
    Failed = 4,       // Transfer failed
    Refunded = 5,     // Tokens returned to user
}
```

---

## 4. Bridge Flow: Solana → Ethereum

### 4.1 Outbound Transfer Process

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    SOLANA → ETHEREUM BRIDGE FLOW                         │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  STEP 1: Initiate Transfer (Solana)                                     │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  User calls: bridge_tokens_out(amount, destination_chain,       │    │
│  │                                destination_address)             │    │
│  │                                                                 │    │
│  │  Actions:                                                       │    │
│  │  1. Validate amount >= min_bridge_amount                        │    │
│  │  2. Validate chain is supported                                 │    │
│  │  3. Deduct platform fee                                         │    │
│  │  4. Transfer tokens to bridge custody (PDA vault)               │    │
│  │  5. Create BridgeTransfer record                                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  STEP 2: Emit Wormhole Message                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  CPI to Wormhole Core Bridge:                                   │    │
│  │  - post_message(nonce, payload, consistency_level)              │    │
│  │                                                                 │    │
│  │  Payload:                                                       │    │
│  │  - Transfer type: 1 (Token Transfer)                            │    │
│  │  - Amount: 1000 GRX                                             │    │
│  │  - Token address: GRX Mint                                      │    │
│  │  - Token chain: 1 (Solana)                                      │    │
│  │  - Recipient: 0x1234...5678 (Ethereum address, 32-byte padded) │    │
│  │  - Recipient chain: 2 (Ethereum)                                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  STEP 3: Guardian Observation (~13 minutes for finality)                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Wormhole Guardian Network:                                     │    │
│  │  - 19 guardians observe the message on Solana                   │    │
│  │  - Wait for finality (32 slot confirmations)                    │    │
│  │  - 13+ guardians sign the VAA                                   │    │
│  │  - VAA becomes available via Guardian API                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  STEP 4: Redeem on Ethereum                                             │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  User/Relayer calls: completeTransfer(VAA)                      │    │
│  │                                                                 │    │
│  │  Ethereum Token Bridge:                                         │    │
│  │  1. Verify VAA signatures (13-of-19)                            │    │
│  │  2. Check VAA hasn't been processed                             │    │
│  │  3. Mint wrapped GRX (wGRX) to recipient                        │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Implementation

```rust
pub fn process_bridge_tokens_out(
    ctx: Context<BridgeTokensOut>,
    amount: u64,
    destination_chain: u16,
    destination_address: [u8; 32],
    nonce: u32,
) -> Result<()> {
    let config = &ctx.accounts.bridge_config;
    let transfer = &mut ctx.accounts.bridge_transfer;
    let clock = Clock::get()?;
    
    // Validate bridge is enabled
    require!(config.enabled, BridgeError::BridgeDisabled);
    
    // Validate chain is supported
    let chain = WormholeChain::from_u16(destination_chain)
        .ok_or(BridgeError::UnsupportedChain)?;
    require!(
        config.is_chain_supported(chain),
        BridgeError::ChainNotEnabled
    );
    
    // Validate amount
    require!(
        amount >= config.min_bridge_amount,
        BridgeError::AmountTooSmall
    );
    
    // Calculate and collect fee
    let fee = calculate_bridge_fee(amount, config.bridge_fee_bps);
    let net_amount = amount.checked_sub(fee).ok_or(BridgeError::Overflow)?;
    
    // Transfer tokens to custody vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.custody_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        ),
        net_amount,
    )?;
    
    // Create bridge transfer record
    transfer.bump = ctx.bumps.bridge_transfer;
    transfer.user = ctx.accounts.user.key();
    transfer.source_mint = ctx.accounts.source_mint.key();
    transfer.destination_chain = destination_chain;
    transfer.destination_address = destination_address;
    transfer.amount = net_amount;
    transfer.fee = fee;
    transfer.status = BridgeStatus::Pending as u8;
    transfer.initiated_at = clock.unix_timestamp;
    
    // Emit Wormhole message via CPI
    let payload = create_transfer_payload(
        net_amount,
        ctx.accounts.source_mint.key(),
        destination_chain,
        destination_address,
    );
    
    let sequence = wormhole_cpi::post_message(
        &ctx.accounts.wormhole_program,
        &ctx.accounts.wormhole_bridge,
        &ctx.accounts.wormhole_message,
        &ctx.accounts.wormhole_emitter,
        &ctx.accounts.wormhole_sequence,
        nonce,
        payload,
        1, // Consistency level: 1 = confirmed
    )?;
    
    // Update transfer with sequence
    transfer.sequence = sequence;
    transfer.status = BridgeStatus::MessageSent as u8;
    
    // Update config counters
    ctx.accounts.bridge_config.total_bridged_out += net_amount;
    ctx.accounts.bridge_config.bridge_count += 1;
    
    emit!(TokensBridgedOut {
        user: ctx.accounts.user.key(),
        amount: net_amount,
        destination_chain,
        destination_address,
        sequence,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

fn create_transfer_payload(
    amount: u64,
    token_address: Pubkey,
    to_chain: u16,
    to_address: [u8; 32],
) -> Vec<u8> {
    let mut payload = Vec::with_capacity(133);
    
    // Payload type: 1 = Token Transfer
    payload.push(1);
    
    // Amount (32 bytes, big-endian, scaled to 8 decimals)
    let amount_bytes = [0u8; 24]; // Padding
    payload.extend_from_slice(&amount_bytes);
    payload.extend_from_slice(&amount.to_be_bytes());
    
    // Token address (32 bytes)
    payload.extend_from_slice(&token_address.to_bytes());
    
    // Token chain (2 bytes)
    payload.extend_from_slice(&1u16.to_be_bytes()); // Solana = 1
    
    // Recipient address (32 bytes)
    payload.extend_from_slice(&to_address);
    
    // Recipient chain (2 bytes)
    payload.extend_from_slice(&to_chain.to_be_bytes());
    
    // Fee (32 bytes) - relayer fee
    let fee_bytes = [0u8; 32];
    payload.extend_from_slice(&fee_bytes);
    
    payload
}
```

---

## 5. Bridge Flow: Ethereum → Solana

### 5.1 Inbound Transfer Process

```rust
pub fn process_complete_transfer(
    ctx: Context<CompleteTransfer>,
    vaa_bytes: Vec<u8>,
) -> Result<()> {
    let config = &ctx.accounts.bridge_config;
    let clock = Clock::get()?;
    
    // Parse and verify VAA
    let vaa = parse_vaa(&vaa_bytes)?;
    
    // Verify VAA via Wormhole CPI
    wormhole_cpi::verify_vaa(
        &ctx.accounts.wormhole_program,
        &ctx.accounts.wormhole_bridge,
        &vaa_bytes,
    )?;
    
    // Decode transfer payload
    let transfer = decode_transfer_payload(&vaa.payload)?;
    
    // Verify destination is Solana
    require!(
        transfer.to_chain == 1, // Solana chain ID
        BridgeError::WrongDestination
    );
    
    // Verify recipient
    let recipient = Pubkey::try_from(&transfer.to_address[..])
        .map_err(|_| BridgeError::InvalidRecipient)?;
    require!(
        recipient == ctx.accounts.recipient.key(),
        BridgeError::RecipientMismatch
    );
    
    // Check if this VAA has been processed (prevent replay)
    let vaa_hash = hash_vaa(&vaa_bytes);
    require!(
        !is_vaa_processed(vaa_hash),
        BridgeError::VaaAlreadyProcessed
    );
    mark_vaa_processed(vaa_hash)?;
    
    // Calculate amount (handle decimal normalization)
    let amount = normalize_amount(transfer.amount, transfer.token_decimals, 9)?;
    
    // Release tokens from custody or mint wrapped
    if is_native_token(&transfer.token_address) {
        // Native token: release from custody
        let seeds = &[
            b"custody_signer".as_ref(),
            &[ctx.bumps.custody_signer],
        ];
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.custody_vault.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.custody_signer.to_account_info(),
        };
        
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                &[seeds],
            ),
            amount,
        )?;
    } else {
        // Wrapped token: mint
        let seeds = &[
            b"mint_authority".as_ref(),
            &[ctx.bumps.mint_authority],
        ];
        
        let cpi_accounts = MintTo {
            mint: ctx.accounts.wrapped_mint.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        };
        
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                &[seeds],
            ),
            amount,
        )?;
    }
    
    // Update config
    ctx.accounts.bridge_config.total_bridged_in += amount;
    
    emit!(TokensBridgedIn {
        recipient,
        amount,
        source_chain: vaa.emitter_chain,
        vaa_hash,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}
```

---

## 6. Wrapped Token Management

### 6.1 WrappedTokenRecord Account

```rust
#[account]
#[derive(Default)]
pub struct WrappedTokenRecord {
    pub wrapped_mint: Pubkey,         // 32 - Mint address on Solana
    pub origin_chain: u16,            // 2 - Original chain ID
    pub origin_address: [u8; 32],     // 32 - Original token address
    pub is_approved: bool,            // 1 - Approved for trading
    pub total_supply: u64,            // 8 - Current wrapped supply
    pub created_at: i64,              // 8 - Creation timestamp
    pub bump: u8,                     // 1 - PDA bump
    pub _reserved: [u8; 16],          // 16 - Future use
}

impl WrappedTokenRecord {
    pub const LEN: usize = 8 + 32 + 2 + 32 + 1 + 8 + 8 + 1 + 16;
}
```

### 6.2 Register Wrapped Token

```rust
pub fn process_register_wrapped_token(
    ctx: Context<RegisterWrappedToken>,
    origin_chain: u16,
    origin_address: [u8; 32],
    name: String,
    symbol: String,
    decimals: u8,
) -> Result<()> {
    // Create new mint for wrapped token
    let mint_seeds = &[
        b"wrapped_mint",
        &origin_chain.to_le_bytes(),
        &origin_address,
        &[ctx.bumps.wrapped_mint],
    ];
    
    // Initialize mint
    token::initialize_mint2(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            InitializeMint2 {
                mint: ctx.accounts.wrapped_mint.to_account_info(),
            },
            &[mint_seeds],
        ),
        decimals,
        &ctx.accounts.mint_authority.key(),
        Some(&ctx.accounts.mint_authority.key()),
    )?;
    
    // Create metadata
    create_metadata(
        &ctx.accounts.metadata_program,
        &ctx.accounts.wrapped_mint,
        &ctx.accounts.metadata,
        &name,
        &symbol,
    )?;
    
    // Create record
    let record = &mut ctx.accounts.wrapped_token_record;
    record.wrapped_mint = ctx.accounts.wrapped_mint.key();
    record.origin_chain = origin_chain;
    record.origin_address = origin_address;
    record.is_approved = false; // Requires admin approval
    record.total_supply = 0;
    record.created_at = Clock::get()?.unix_timestamp;
    record.bump = ctx.bumps.wrapped_token_record;
    
    emit!(WrappedTokenRegistered {
        wrapped_mint: record.wrapped_mint,
        origin_chain,
        origin_address,
        timestamp: record.created_at,
    });
    
    Ok(())
}
```

---

## 7. Cross-Chain Settlement

### 7.1 Settlement Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    CROSS-CHAIN ENERGY SETTLEMENT                         │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Scenario: Buyer on Ethereum pays USDC for energy on Solana             │
│                                                                          │
│  1. Buyer (Ethereum) locks USDC in escrow contract                      │
│     └── Emits Wormhole message with order details                       │
│                                                                          │
│  2. GridTokenX (Solana) receives VAA                                    │
│     └── Creates pending settlement record                               │
│                                                                          │
│  3. Seller (Solana) delivers energy tokens                              │
│     └── Energy transferred to cross-chain escrow                        │
│                                                                          │
│  4. GridTokenX confirms delivery                                        │
│     └── Emits Wormhole message: "energy delivered"                      │
│                                                                          │
│  5. Ethereum escrow releases USDC to seller's ETH address               │
│     └── Seller receives payment on Ethereum                             │
│                                                                          │
│  6. Energy tokens released to buyer on Solana                           │
│     └── Buyer receives energy (can bridge back to ETH if desired)       │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Cross-Chain Order Structure

```rust
#[account]
pub struct CrossChainOrder {
    pub order_id: u64,
    
    // Buyer info (may be on another chain)
    pub buyer_chain: u16,
    pub buyer_address: [u8; 32],
    
    // Seller info (Solana)
    pub seller: Pubkey,
    
    // Order details
    pub energy_amount: u64,
    pub price_per_kwh: u64,
    pub payment_token_chain: u16,
    pub payment_token_address: [u8; 32],
    
    // Status
    pub status: CrossChainOrderStatus,
    pub payment_vaa: Option<[u8; 32]>,  // Hash of payment VAA
    pub delivery_sequence: Option<u64>,  // Wormhole sequence for delivery
    
    // Timestamps
    pub created_at: i64,
    pub expires_at: i64,
    pub settled_at: Option<i64>,
    
    pub bump: u8,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CrossChainOrderStatus {
    Pending,           // Order created, awaiting payment
    PaymentReceived,   // Payment VAA verified
    EnergyDelivered,   // Energy transferred to escrow
    Completed,         // Both sides settled
    Cancelled,         // Order cancelled
    Disputed,          // In dispute resolution
}
```

---

## 8. Relayer Integration

### 8.1 Automatic Relaying

```rust
#[account]
pub struct RelayerConfig {
    pub authority: Pubkey,
    pub relayer_address: Pubkey,
    
    // Fee configuration per chain
    pub relayer_fees: [RelayerFee; 8],  // Per-chain fees
    pub relayer_fee_count: u8,
    
    // Status
    pub is_active: bool,
    pub total_relayed: u64,
    
    pub _reserved: [u8; 32],
}

#[derive(Clone, Copy, Default)]
pub struct RelayerFee {
    pub chain_id: u16,
    pub fee_amount: u64,    // Fee in native token
    pub fee_token: Pubkey,  // Token for fee payment
}
```

### 8.2 Relayer Service Integration

```typescript
// Off-chain relayer service
async function relayTransfer(
  solanaConnection: Connection,
  wormholeRpc: string,
  transferAddress: PublicKey,
) {
  // 1. Fetch transfer record
  const transfer = await program.account.bridgeTransfer.fetch(transferAddress);
  
  // 2. Fetch VAA from Guardian network
  const vaa = await getSignedVAA(
    wormholeRpc,
    1, // Solana chain ID
    transfer.sequence,
  );
  
  // 3. Post VAA on destination chain
  if (transfer.destinationChain === 2) {
    // Ethereum
    await redeemOnEthereum(vaa, transfer.destinationAddress);
  } else if (transfer.destinationChain === 5) {
    // Polygon
    await redeemOnPolygon(vaa, transfer.destinationAddress);
  }
  
  // 4. Update transfer status
  await program.methods
    .updateTransferStatus(BridgeStatus.Completed, vaaHash)
    .accounts({ bridgeTransfer: transferAddress })
    .rpc();
}
```

---

## 9. Security Considerations

### 9.1 VAA Verification

```rust
fn verify_vaa_signatures(vaa: &VAA, guardian_set: &GuardianSet) -> Result<()> {
    // Require 13-of-19 guardian signatures
    let required = (guardian_set.len() * 2 / 3) + 1;
    require!(
        vaa.signatures.len() >= required,
        BridgeError::InsufficientSignatures
    );
    
    // Verify each signature
    let body_hash = hash_vaa_body(vaa);
    for sig in &vaa.signatures {
        let guardian_pubkey = guardian_set.get(sig.guardian_index as usize)
            .ok_or(BridgeError::InvalidGuardianIndex)?;
        
        let recovered = recover_signer(&body_hash, &sig.signature)?;
        require!(
            recovered == *guardian_pubkey,
            BridgeError::InvalidSignature
        );
    }
    
    Ok(())
}
```

### 9.2 Replay Protection

```rust
// Processed VAAs are tracked to prevent replay
#[account]
pub struct ProcessedVaa {
    pub vaa_hash: [u8; 32],
    pub processed_at: i64,
}

fn is_vaa_processed(vaa_hash: [u8; 32]) -> bool {
    // Check if PDA exists for this VAA hash
    let (pda, _) = Pubkey::find_program_address(
        &[b"processed_vaa", &vaa_hash],
        &program_id,
    );
    // Account existence check
    account_exists(pda)
}
```

### 9.3 Amount Normalization

```rust
// Handle different decimal places across chains
fn normalize_amount(
    amount: u64,
    source_decimals: u8,
    target_decimals: u8,
) -> Result<u64> {
    if source_decimals > target_decimals {
        // Reduce precision
        let factor = 10u64.pow((source_decimals - target_decimals) as u32);
        Ok(amount / factor)
    } else if source_decimals < target_decimals {
        // Increase precision
        let factor = 10u64.pow((target_decimals - source_decimals) as u32);
        amount.checked_mul(factor)
            .ok_or(BridgeError::Overflow.into())
    } else {
        Ok(amount)
    }
}
```

---

## 10. Compute Unit Profile

| Operation | CU Cost | Notes |
|-----------|---------|-------|
| `bridge_tokens_out` | ~50,000 | Token transfer + Wormhole CPI |
| `complete_transfer` | ~80,000 | VAA verification + token mint/release |
| VAA signature verification | ~30,000 | 13 ECDSA verifications |
| `register_wrapped_token` | ~40,000 | Mint + metadata creation |

---

## 11. Monitoring and Analytics

### 11.1 Events

```rust
#[event]
pub struct TokensBridgedOut {
    pub user: Pubkey,
    pub amount: u64,
    pub destination_chain: u16,
    pub destination_address: [u8; 32],
    pub sequence: u64,
    pub timestamp: i64,
}

#[event]
pub struct TokensBridgedIn {
    pub recipient: Pubkey,
    pub amount: u64,
    pub source_chain: u16,
    pub vaa_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct BridgeStatusUpdated {
    pub transfer: Pubkey,
    pub old_status: u8,
    pub new_status: u8,
    pub timestamp: i64,
}
```

### 11.2 Dashboard Metrics

```typescript
interface BridgeMetrics {
  totalBridgedOut: bigint;
  totalBridgedIn: bigint;
  netFlow: bigint;
  bridgeCount: number;
  averageTransferTime: number; // seconds
  
  // Per-chain breakdown
  chainMetrics: {
    [chainId: number]: {
      outbound: bigint;
      inbound: bigint;
      pendingTransfers: number;
    };
  };
}
```

---

## 12. Future Enhancements

1. **Circle CCTP Integration**: Native USDC bridging without wrapped tokens
2. **LayerZero Support**: Alternative messaging protocol for redundancy
3. **Cross-Chain Governance**: Vote on Ethereum, execute on Solana
4. **Atomic Swaps**: True atomic cross-chain energy trades
5. **Multi-Sig Bridge**: Enhanced security for large transfers

---

## 13. References

1. Wormhole Protocol Documentation. "Wormhole Technical Docs"
2. Solana. "Cross-Program Invocation Guide"
3. Circle. "Cross-Chain Transfer Protocol (CCTP)"
