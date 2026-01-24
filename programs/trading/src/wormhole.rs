use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Wormhole Cross-Chain Bridge Integration for GridTokenX
/// 
/// This module enables:
/// - Bridging GRID tokens to other chains (Ethereum, Polygon, etc.)
/// - Receiving wrapped tokens from other chains
/// - Cross-chain energy trading settlements

/// Supported Wormhole chains
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
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

impl Default for WormholeChain {
    fn default() -> Self {
        WormholeChain::Solana
    }
}

/// Bridge configuration for the trading market
#[account]
#[derive(Default)]
pub struct BridgeConfig {
    /// Bump seed for PDA
    pub bump: u8,
    
    /// Market this config belongs to
    pub market: Pubkey,
    
    /// Wormhole core bridge program
    pub wormhole_program: Pubkey,
    
    /// Wormhole token bridge program  
    pub token_bridge_program: Pubkey,
    
    /// Bridge authority (for managing config)
    pub authority: Pubkey,
    
    /// Whether bridging is enabled
    pub enabled: bool,
    
    /// Minimum bridge amount (to cover fees)
    pub min_bridge_amount: u64,
    
    /// Bridge fee in basis points
    pub bridge_fee_bps: u16,
    
    /// Relayer fee for destination chain
    pub relayer_fee: u64,
    
    /// Supported destination chains (bitmap)
    pub supported_chains: u32,
    
    /// Total bridged out
    pub total_bridged_out: u64,
    
    /// Total bridged in
    pub total_bridged_in: u64,
    
    /// Bridge transaction count
    pub bridge_count: u64,
    
    /// Reserved for future use
    pub _reserved: [u8; 32],
}

impl BridgeConfig {
    pub const LEN: usize = 8 + // discriminator
        1 +   // bump
        32 +  // market
        32 +  // wormhole_program
        32 +  // token_bridge_program
        32 +  // authority
        1 +   // enabled
        8 +   // min_bridge_amount
        2 +   // bridge_fee_bps
        8 +   // relayer_fee
        4 +   // supported_chains
        8 +   // total_bridged_out
        8 +   // total_bridged_in
        8 +   // bridge_count
        64;   // reserved
    
    /// Check if a chain is supported
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

/// Pending bridge transfer record
#[account]
#[derive(Default)]
pub struct BridgeTransfer {
    /// Bump seed for PDA
    pub bump: u8,
    
    /// User who initiated the transfer
    pub user: Pubkey,
    
    /// Source token mint
    pub source_mint: Pubkey,
    
    /// Destination chain
    pub destination_chain: u16,
    
    /// Destination address (32 bytes, zero-padded for non-Solana chains)
    pub destination_address: [u8; 32],
    
    /// Amount being transferred
    pub amount: u64,
    
    /// Bridge fee charged
    pub fee: u64,
    
    /// Transfer status
    pub status: u8,
    
    /// Wormhole sequence number (for tracking)
    pub sequence: u64,
    
    /// VAA hash (when confirmed)
    pub vaa_hash: [u8; 32],
    
    /// Initiated timestamp
    pub initiated_at: i64,
    
    /// Completed timestamp
    pub completed_at: i64,
    
    /// Reserved
    pub _reserved: [u8; 32],
}

impl BridgeTransfer {
    pub const LEN: usize = 8 + // discriminator
        1 +   // bump
        32 +  // user
        32 +  // source_mint
        2 +   // destination_chain
        32 +  // destination_address
        8 +   // amount
        8 +   // fee
        1 +   // status
        8 +   // sequence
        32 +  // vaa_hash
        8 +   // initiated_at
        8 +   // completed_at
        32;   // reserved
}

/// Bridge transfer status
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum BridgeStatus {
    Pending = 0,
    MessageSent = 1,
    Confirmed = 2,
    Completed = 3,
    Failed = 4,
    Refunded = 5,
}

/// Incoming wrapped token record
#[account]
#[derive(Default)]
pub struct WrappedTokenRecord {
    /// Wormhole wrapped token mint
    pub wrapped_mint: Pubkey,
    
    /// Original chain ID
    pub origin_chain: u16,
    
    /// Original token address
    pub origin_address: [u8; 32],
    
    /// Whether this wrapped token is approved for trading
    pub trading_approved: bool,
    
    /// Total received via bridge
    pub total_received: u64,
    
    /// Total unwrapped (sent back)
    pub total_unwrapped: u64,
    
    /// Reserved
    pub _reserved: [u8; 32],
}

impl WrappedTokenRecord {
    pub const LEN: usize = 8 + // discriminator
        32 +  // wrapped_mint
        2 +   // origin_chain
        32 +  // origin_address
        1 +   // trading_approved
        8 +   // total_received
        8 +   // total_unwrapped
        32;   // reserved
}

/// Events for bridge operations
#[event]
pub struct BridgeInitiated {
    pub user: Pubkey,
    pub source_mint: Pubkey,
    pub destination_chain: u16,
    pub destination_address: [u8; 32],
    pub amount: u64,
    pub fee: u64,
    pub sequence: u64,
    pub timestamp: i64,
}

#[event]
pub struct BridgeCompleted {
    pub user: Pubkey,
    pub transfer: Pubkey,
    pub destination_chain: u16,
    pub amount: u64,
    pub vaa_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct TokensReceived {
    pub user: Pubkey,
    pub source_chain: u16,
    pub wrapped_mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct BridgeConfigUpdated {
    pub authority: Pubkey,
    pub enabled: bool,
    pub min_bridge_amount: u64,
    pub bridge_fee_bps: u16,
    pub timestamp: i64,
}

/// Error codes for bridge operations
#[error_code]
pub enum BridgeError {
    #[msg("Bridge is disabled")]
    BridgeDisabled,
    
    #[msg("Destination chain not supported")]
    ChainNotSupported,
    
    #[msg("Amount below minimum bridge amount")]
    AmountBelowMinimum,
    
    #[msg("Invalid destination address")]
    InvalidDestinationAddress,
    
    #[msg("Transfer already completed")]
    TransferAlreadyCompleted,
    
    #[msg("Invalid VAA")]
    InvalidVaa,
    
    #[msg("VAA already processed")]
    VaaAlreadyProcessed,
    
    #[msg("Wrapped token not approved for trading")]
    WrappedTokenNotApproved,
    
    #[msg("Unauthorized bridge authority")]
    UnauthorizedAuthority,
    
    #[msg("Invalid Wormhole program")]
    InvalidWormholeProgram,
}

/// Wormhole program addresses (as base58 strings)
/// Note: Use these as reference - actual addresses should be validated at runtime
pub mod wormhole_addresses {
    /// Wormhole Core Bridge on mainnet
    pub const CORE_BRIDGE_MAINNET: &str = "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth";
    
    /// Wormhole Token Bridge on mainnet
    pub const TOKEN_BRIDGE_MAINNET: &str = "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWvKtSmj1t7N";
    
    /// Wormhole Core Bridge on devnet
    pub const CORE_BRIDGE_DEVNET: &str = "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5";
    
    /// Wormhole Token Bridge on devnet
    pub const TOKEN_BRIDGE_DEVNET: &str = "DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe";
}

/// Helper module for Wormhole message construction
pub mod message_utils {
    use super::*;
    
    /// Construct a token transfer message payload
    /// Format: [payloadId (1)] [amount (32)] [tokenAddress (32)] [tokenChain (2)] [to (32)] [toChain (2)] [fromAddress (32)]
    pub fn construct_transfer_payload(
        amount: u64,
        token_address: [u8; 32],
        token_chain: u16,
        to_address: [u8; 32],
        to_chain: u16,
        from_address: [u8; 32],
    ) -> Vec<u8> {
        let mut payload = Vec::with_capacity(133);
        
        // Payload ID (1 = Transfer)
        payload.push(1u8);
        
        // Amount (32 bytes, big-endian)
        let mut amount_bytes = [0u8; 32];
        amount_bytes[24..32].copy_from_slice(&amount.to_be_bytes());
        payload.extend_from_slice(&amount_bytes);
        
        // Token address (32 bytes)
        payload.extend_from_slice(&token_address);
        
        // Token chain (2 bytes, big-endian)
        payload.extend_from_slice(&token_chain.to_be_bytes());
        
        // To address (32 bytes)
        payload.extend_from_slice(&to_address);
        
        // To chain (2 bytes, big-endian)
        payload.extend_from_slice(&to_chain.to_be_bytes());
        
        // From address (32 bytes) - optional for attestation
        payload.extend_from_slice(&from_address);
        
        payload
    }
    
    /// Parse a VAA header
    pub fn parse_vaa_header(vaa: &[u8]) -> Option<VaaHeader> {
        if vaa.len() < 6 {
            return None;
        }
        
        Some(VaaHeader {
            version: vaa[0],
            guardian_set_index: u32::from_be_bytes([vaa[1], vaa[2], vaa[3], vaa[4]]),
            signature_count: vaa[5],
        })
    }
    
    /// Normalize an Ethereum address to 32 bytes
    pub fn normalize_eth_address(eth_address: [u8; 20]) -> [u8; 32] {
        let mut normalized = [0u8; 32];
        normalized[12..32].copy_from_slice(&eth_address);
        normalized
    }
    
    /// Extract Ethereum address from 32-byte format
    pub fn extract_eth_address(normalized: [u8; 32]) -> [u8; 20] {
        let mut eth_address = [0u8; 20];
        eth_address.copy_from_slice(&normalized[12..32]);
        eth_address
    }
}

/// VAA header structure
#[derive(Clone, Debug)]
pub struct VaaHeader {
    pub version: u8,
    pub guardian_set_index: u32,
    pub signature_count: u8,
}

/// Cross-chain order structure for multi-chain trading
#[account]
#[derive(Default)]
pub struct CrossChainOrder {
    /// Order on Solana
    pub solana_order: Pubkey,
    
    /// Origin chain
    pub origin_chain: u16,
    
    /// Origin order ID (chain-specific format)
    pub origin_order_id: [u8; 32],
    
    /// User on origin chain
    pub origin_user: [u8; 32],
    
    /// Energy amount
    pub energy_amount: u64,
    
    /// Price in origin chain token
    pub price: u64,
    
    /// Origin chain payment token
    pub payment_token: [u8; 32],
    
    /// Order status
    pub status: u8,
    
    /// Settlement VAA hash
    pub settlement_vaa: [u8; 32],
    
    /// Created timestamp
    pub created_at: i64,
    
    /// Settled timestamp
    pub settled_at: i64,
    
    /// Reserved
    pub _reserved: [u8; 32],
}

impl CrossChainOrder {
    pub const LEN: usize = 8 + // discriminator
        32 +  // solana_order
        2 +   // origin_chain
        32 +  // origin_order_id
        32 +  // origin_user
        8 +   // energy_amount
        8 +   // price
        32 +  // payment_token
        1 +   // status
        32 +  // settlement_vaa
        8 +   // created_at
        8 +   // settled_at
        32;   // reserved
}
