use anchor_lang::prelude::*;


/// Stablecoin payment configuration for multi-token trading support
/// Enables payments in USDC/USDT alongside native GRID tokens

/// Supported payment tokens for energy trading
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PaymentToken {
    /// Native GRID energy token
    Grid = 0,
    /// USDC stablecoin (Wormhole wrapped or native)
    Usdc = 1,
    /// USDT stablecoin
    Usdt = 2,
    /// Cross-chain wrapped token via Wormhole
    WormholeWrapped = 3,
}

impl Default for PaymentToken {
    fn default() -> Self {
        PaymentToken::Grid
    }
}

/// Token configuration for the trading market
#[account]
#[derive(Default)]
pub struct TokenConfig {
    /// Bump seed for PDA
    pub bump: u8,
    
    /// Market this config belongs to
    pub market: Pubkey,
    
    /// Token type
    pub token_type: u8,
    
    /// Token mint address
    pub mint: Pubkey,
    
    /// Token decimals
    pub decimals: u8,
    
    /// Whether this token is enabled for trading
    pub enabled: bool,
    
    /// Minimum order size in this token
    pub min_order_size: u64,
    
    /// Oracle price feed for conversion (if applicable)
    pub price_oracle: Option<Pubkey>,
    
    /// Last known price in base units (for rate limiting)
    pub last_price: u64,
    
    /// Last price update timestamp
    pub last_price_update: i64,
    
    /// Maximum price deviation allowed (basis points)
    pub max_price_deviation_bps: u16,
    
    /// Reserved for future use
    pub _reserved: [u8; 32],
}

impl TokenConfig {
    pub const LEN: usize = 8 + // discriminator
        1 +   // bump
        32 +  // market
        1 +   // token_type
        32 +  // mint
        1 +   // decimals
        1 +   // enabled
        8 +   // min_order_size
        33 +  // price_oracle (Option<Pubkey>)
        8 +   // last_price
        8 +   // last_price_update
        2 +   // max_price_deviation_bps
        32;   // reserved
}

/// Stablecoin order extension - stores payment token preference
#[account]
#[derive(Default)]
pub struct OrderPaymentInfo {
    /// Order this payment info belongs to
    pub order: Pubkey,
    
    /// Payment token type
    pub payment_token: u8,
    
    /// Payment token mint
    pub payment_mint: Pubkey,
    
    /// Price in payment token (converted from GRID if needed)
    pub price_in_payment_token: u64,
    
    /// Exchange rate used for conversion (if applicable)
    pub exchange_rate: u64,
    
    /// Conversion timestamp
    pub rate_timestamp: i64,
    
    /// Whether payment has been processed
    pub payment_processed: bool,
    
    /// Reserved
    pub _reserved: [u8; 32],
}

impl OrderPaymentInfo {
    pub const LEN: usize = 8 + // discriminator
        32 + // order
        1 +  // payment_token
        32 + // payment_mint
        8 +  // price_in_payment_token
        8 +  // exchange_rate
        8 +  // rate_timestamp
        1 +  // payment_processed
        32;  // reserved
}

/// Swap quote for token conversion
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SwapQuote {
    /// Input token mint
    pub input_mint: Pubkey,
    
    /// Output token mint  
    pub output_mint: Pubkey,
    
    /// Input amount
    pub input_amount: u64,
    
    /// Output amount (after fees)
    pub output_amount: u64,
    
    /// Exchange rate (input per output * 10^9)
    pub rate: u64,
    
    /// Swap fee in basis points
    pub fee_bps: u16,
    
    /// Quote expiry timestamp
    pub expires_at: i64,
    
    /// Quote signature for verification
    pub signature: [u8; 32],
}

/// Events for stablecoin payments
#[event]
pub struct TokenConfigured {
    pub market: Pubkey,
    pub token_type: u8,
    pub mint: Pubkey,
    pub enabled: bool,
    pub timestamp: i64,
}

#[event]
pub struct StablecoinOrderCreated {
    pub order: Pubkey,
    pub owner: Pubkey,
    pub payment_token: u8,
    pub payment_mint: Pubkey,
    pub energy_amount: u64,
    pub price_in_payment: u64,
    pub timestamp: i64,
}

#[event]
pub struct TokenSwapExecuted {
    pub user: Pubkey,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub input_amount: u64,
    pub output_amount: u64,
    pub rate: u64,
    pub timestamp: i64,
}

#[event]
pub struct StablecoinSettlement {
    pub buy_order: Pubkey,
    pub sell_order: Pubkey,
    pub payment_token: u8,
    pub energy_amount: u64,
    pub payment_amount: u64,
    pub grid_equivalent: u64,
    pub timestamp: i64,
}

/// Error codes for stablecoin payments
#[error_code]
pub enum StablecoinError {
    #[msg("Token not configured for this market")]
    TokenNotConfigured,
    
    #[msg("Token is disabled for trading")]
    TokenDisabled,
    
    #[msg("Order size below minimum")]
    OrderBelowMinimum,
    
    #[msg("Price oracle required for this token")]
    OracleRequired,
    
    #[msg("Price too stale")]
    PriceTooStale,
    
    #[msg("Price deviation too high")]
    PriceDeviationTooHigh,
    
    #[msg("Swap quote expired")]
    SwapQuoteExpired,
    
    #[msg("Invalid swap signature")]
    InvalidSwapSignature,
    
    #[msg("Insufficient token balance")]
    InsufficientBalance,
    
    #[msg("Payment already processed")]
    PaymentAlreadyProcessed,
}

/// Known stablecoin mints on Solana mainnet
/// Note: Use these as reference - actual mints should be configured via TokenConfig
pub mod known_mints {
    /// USDC on Solana mainnet (base58 string)
    pub const USDC_MAINNET: &str = "EPjFWdd5AufqSSqZEM6d1Hetq9ePVNJ4LNM2UCVd7pH";
    
    /// USDC on Solana devnet
    pub const USDC_DEVNET: &str = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr";
    
    /// USDT on Solana mainnet
    pub const USDT_MAINNET: &str = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
    
    /// Wormhole USDC
    pub const USDC_WORMHOLE: &str = "A9mUU4qviSctJVPJdBJWkb28deg915LYJKrzQ19ji3FM";
}

/// Utility functions for swap rate calculations
pub mod rate_utils {
    use super::*;
    
    /// Calculate output amount given input and rate
    /// Rate is expressed as input tokens per output token * 10^9
    pub fn calculate_output(input_amount: u64, rate: u64, fee_bps: u16) -> u64 {
        let gross_output = (input_amount as u128)
            .saturating_mul(1_000_000_000)
            .checked_div(rate as u128)
            .unwrap_or(0) as u64;
        
        let fee = (gross_output as u128)
            .saturating_mul(fee_bps as u128)
            .checked_div(10_000)
            .unwrap_or(0) as u64;
        
        gross_output.saturating_sub(fee)
    }
    
    /// Calculate input amount required for desired output
    pub fn calculate_input(output_amount: u64, rate: u64, fee_bps: u16) -> u64 {
        // Account for fee first
        let gross_output = (output_amount as u128)
            .saturating_mul(10_000)
            .checked_div(10_000 - fee_bps as u128)
            .unwrap_or(0) as u64;
        
        (gross_output as u128)
            .saturating_mul(rate as u128)
            .checked_div(1_000_000_000)
            .unwrap_or(0) as u64
    }
    
    /// Verify swap quote signature
    pub fn verify_quote_signature(quote: &SwapQuote, _oracle_pubkey: &Pubkey) -> bool {
        // In production, verify Ed25519 signature
        // For now, basic validation
        quote.input_amount > 0 
            && quote.output_amount > 0 
            && quote.rate > 0
            && quote.expires_at > Clock::get().unwrap().unix_timestamp
    }
    
    /// Calculate GRID equivalent value for a stablecoin amount
    pub fn to_grid_equivalent(stablecoin_amount: u64, grid_price_usd: u64) -> u64 {
        // grid_price_usd is in micro-USD (6 decimals)
        // stablecoin_amount is in stablecoin base units (usually 6 decimals for USDC)
        if grid_price_usd == 0 {
            return 0;
        }
        
        (stablecoin_amount as u128)
            .saturating_mul(1_000_000_000) // GRID uses 9 decimals
            .checked_div(grid_price_usd as u128)
            .unwrap_or(0) as u64
    }
}
