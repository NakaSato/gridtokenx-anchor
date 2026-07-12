#![allow(deprecated)]

use anchor_lang::prelude::*;

// Core modules
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

pub use error::EnergyTokenError;
pub use events::*;
// Handler fns share names with the #[program]-generated re-exports; the glob is
// deliberate (Context structs + client accounts must be crate-public).
#[allow(ambiguous_glob_reexports)]
pub use instructions::*;
pub use state::*;

/// Governance program ID — owner of the `governance_config` (GovernanceConfig) PDA, the ERC
/// governance authority. Hardcoded rather than imported: `registry` already depends on
/// `energy-token` for CPI, and `governance` depends on `registry` for CPI, so
/// `energy-token -> governance` as a path dep would cycle
/// (energy-token -> governance -> registry -> energy-token). Validate the governance
/// authority by raw account checks (owner + PDA seeds + bytes) instead — same pattern as
/// registry's `GOVERNANCE_PROGRAM_ID`/`ORACLE_PROGRAM_ID`. Must match
/// `Anchor.toml [programs.localnet].governance`.
pub const GOVERNANCE_PROGRAM_ID: Pubkey = pubkey!("FokVuBSPXP11aeL7VZWd8n8aVAhWqVpyPZETToSxdvTS");

/// Validate `info` is the canonical governance `governance_config` PDA and return the
/// `GovernanceConfig.authority` pubkey it contains (ERC's governance authority — the only
/// entity allowed to register/remove REC validators, per role-map.md's "REC issuer = ERC"
/// binding). Layout: [0..8] disc | [8..40] authority.
pub(crate) fn governance_authority(info: &AccountInfo) -> Result<Pubkey> {
    require_keys_eq!(*info.owner, GOVERNANCE_PROGRAM_ID, EnergyTokenError::InvalidGovernanceAccount);
    let (expected, _bump) = Pubkey::find_program_address(&[b"governance_config"], &GOVERNANCE_PROGRAM_ID);
    require_keys_eq!(*info.key, expected, EnergyTokenError::InvalidGovernanceAccount);
    let data = info.try_borrow_data()?;
    require!(data.len() >= 40, EnergyTokenError::InvalidGovernanceAccount);
    Ok(Pubkey::new_from_array(data[8..40].try_into().unwrap()))
}

// Import compute_fn! macro when localnet feature is enabled
#[cfg(feature = "localnet")]
use compute_debug::{compute_checkpoint, compute_fn};

// No-op versions for non-localnet builds. `#[macro_export]` hoists them to the crate
// root so the `instructions/` submodules can `use crate::{compute_fn, compute_checkpoint}`.
#[cfg(not(feature = "localnet"))]
#[macro_export]
macro_rules! compute_fn {
    ($name:expr => $block:block) => {
        $block
    };
}
#[cfg(not(feature = "localnet"))]
#[macro_export]
macro_rules! compute_checkpoint {
    ($name:expr) => {};
}

declare_id!("6FZKcVKCLFSNLMxypFJGU4K14xUBnxNW9VAuKGhmqjGX");

/// True if `key` is one of the registered REC validators. Single source of truth for
/// the REC co-signature gate, shared by every mint path (`mint_to_wallet`,
/// `mint_generation`, `mint_tokens_direct`) so the membership check can never drift
/// between them. Only scans the populated prefix (`count <= 5`).
pub(crate) fn rec_validator_registered(token_info: &TokenInfo, key: &Pubkey) -> bool {
    token_info.rec_validators[..token_info.rec_validators_count as usize].contains(key)
}

#[cfg(test)]
mod rec_validator_tests {
    use super::*;

    /// TokenInfo is `#[account(zero_copy)] #[repr(C)]` plain data (Pubkey arrays
    /// + ints), so a host struct literal constructs it directly — no Default,
    /// no on-chain account needed.
    fn token_info_with(validators: [Pubkey; 5], count: u8) -> TokenInfo {
        TokenInfo {
            authority: Pubkey::default(),
            registry_authority: Pubkey::default(),
            registry_program: Pubkey::default(),
            mint: Pubkey::default(),
            total_supply: 0,
            created_at: 0,
            rec_validators: validators,
            rec_validators_count: count,
            _padding: [0u8; 7],
        }
    }

    #[test]
    fn key_present_within_count_is_true() {
        let k = Pubkey::new_from_array([1u8; 32]);
        let mut vs = [Pubkey::default(); 5];
        vs[1] = k;
        let ti = token_info_with(vs, 2);
        assert!(rec_validator_registered(&ti, &k));
    }

    #[test]
    fn key_in_unpopulated_tail_is_false() {
        // Key sits at index 3 but count is only 2 → outside the populated prefix.
        let k = Pubkey::new_from_array([2u8; 32]);
        let mut vs = [Pubkey::default(); 5];
        vs[3] = k;
        let ti = token_info_with(vs, 2);
        assert!(!rec_validator_registered(&ti, &k));
    }

    #[test]
    fn absent_key_is_false() {
        let present = Pubkey::new_from_array([3u8; 32]);
        let absent = Pubkey::new_from_array([4u8; 32]);
        let mut vs = [Pubkey::default(); 5];
        vs[0] = present;
        let ti = token_info_with(vs, 1);
        assert!(!rec_validator_registered(&ti, &absent));
    }

    #[test]
    fn count_zero_is_always_false() {
        // Even if the key physically sits in the array, count 0 means none are registered.
        let k = Pubkey::new_from_array([5u8; 32]);
        let vs = [k; 5];
        let ti = token_info_with(vs, 0);
        assert!(!rec_validator_registered(&ti, &k));
    }
}

#[program]
pub mod energy_token {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        compute_fn!("initialize" => {
            instructions::initialize(ctx)
        })
    }

    /// Add metadata to an existing GRID token mint via Metaplex
    /// Must be called after initialize_token with the same mint address
    /// (GRID is the canonical name for this single 9-dec mint; the source
    /// also labels it GRX for its utility/collateral role — same mint.)
    pub fn create_token_mint(
        ctx: Context<CreateTokenMint>,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        compute_fn!("create_token_mint" => {
            instructions::create_token_mint(ctx, name, symbol, uri)
        })
    }

    /// Mint GRID tokens to a wallet using Token interface
    pub fn mint_to_wallet(ctx: Context<MintToWallet>, amount: u64) -> Result<()> {
        compute_fn!("mint_to_wallet" => {
            instructions::mint_to_wallet(ctx, amount)
        })
    }

    /// Idempotent generation mint, keyed by `(meter_id, window_start_ms)`.
    ///
    /// Identical mint semantics to [`mint_to_wallet`] (authority + REC-validator
    /// checks, Token-2022 `mint_to` CPI), but gated on a per-window
    /// [`GenerationMintRecord`] PDA. The Aggregator Bridge calls this once per
    /// settlement window; if the same window is replayed (crash between submit and
    /// eviction, or a Redis outage that defeated the bridge's `MINTED_SET` guard),
    /// the record already exists with `minted == true` and the call short-circuits
    /// to a no-op success — no second mint. This is the authoritative exactly-once
    /// guard; the bridge-side marker is only a fast path.
    ///
    /// Per-instruction (not per-transaction) so a replayed recipient batched with
    /// fresh ones no-ops without aborting the whole transaction and starving its
    /// chunk-mates.
    pub fn mint_generation(
        ctx: Context<MintGeneration>,
        meter_id: [u8; 16],
        window_start_ms: i64,
        amount: u64,
    ) -> Result<()> {
        compute_fn!("mint_generation" => {
            instructions::mint_generation(ctx, meter_id, window_start_ms, amount)
        })
    }

    /// Initialize the energy token program
    pub fn initialize_token(
        ctx: Context<InitializeToken>,
        registry_program_id: Pubkey,
        registry_authority: Pubkey,
    ) -> Result<()> {
        compute_fn!("initialize_token" => {
            instructions::initialize_token(ctx, registry_program_id, registry_authority)
        })
    }

    /// Add a REC validator to the system
    pub fn add_rec_validator(
        ctx: Context<AddRecValidator>,
        validator_pubkey: Pubkey,
        _authority_name: String,
    ) -> Result<()> {
        compute_fn!("add_rec_validator" => {
            instructions::add_rec_validator(ctx, validator_pubkey, _authority_name)
        })
    }

    /// Remove a REC validator (admin only)
    ///
    /// Enables rotation of a compromised or retired validator key. Swap-removes the
    /// entry with the last slot to keep the array dense.
    pub fn remove_rec_validator(
        ctx: Context<AddRecValidator>,
        validator_pubkey: Pubkey,
    ) -> Result<()> {
        compute_fn!("remove_rec_validator" => {
            instructions::remove_rec_validator(ctx, validator_pubkey)
        })
    }

    /// Transfer energy tokens between accounts
    pub fn transfer_tokens(ctx: Context<TransferTokens>, amount: u64) -> Result<()> {
        compute_fn!("transfer_tokens" => {
            instructions::transfer_tokens(ctx, amount)
        })
    }

    /// Burn energy tokens (for energy consumption)
    pub fn retire_energy_tokens(ctx: Context<RetireEnergyTokens>, amount: u64) -> Result<()> {
        compute_fn!("retire_energy_tokens" => {
            instructions::retire_energy_tokens(ctx, amount)
        })
    }

    /// Mint tokens directly to a user (authority or registry program only)
    ///
    /// Sealevel-optimized: token_info is read-only (no total_supply write).
    /// If REC validators are registered, one must co-sign to prove energy provenance.
    /// Call sync_total_supply periodically to batch-update the stored total.
    pub fn mint_tokens_direct(ctx: Context<MintTokensDirect>, amount: u64) -> Result<()> {
        compute_fn!("mint_tokens_direct" => {
            instructions::mint_tokens_direct(ctx, amount)
        })
    }

    /// Sync total_supply from the canonical SPL Mint account (admin only)
    ///
    /// Call this periodically (e.g. every N mints/burns) instead of writing
    /// token_info on every transaction. Eliminates write-lock contention on
    /// token_info during high-frequency mint/burn operations.
    pub fn sync_total_supply(ctx: Context<SyncTotalSupply>) -> Result<()> {
        compute_fn!("sync_total_supply" => {
            instructions::sync_total_supply(ctx)
        })
    }

    /// Update the registry authority (admin only)
    pub fn set_registry_authority(ctx: Context<SetRegistryAuthority>, new_registry_authority: Pubkey) -> Result<()> {
        instructions::set_registry_authority(ctx, new_registry_authority)
    }

    /// Rotate the admin authority (current authority only).
    ///
    /// `token_info.authority` gates the privileged mint/admin paths (mint_to_wallet,
    /// mint_generation, sync_total_supply, set_*; REC validator-set management is
    /// instead gated by the governance authority via governance_config). It was
    /// previously fixed at `initialize_token` with no rotation path, so a deployment
    /// whose authority must become a different signer (e.g. an off-chain bridge's
    /// signing key) had to be re-initialized. This transfers authority in place. The
    /// CURRENT authority must sign, so it cannot be hijacked.
    pub fn set_authority(ctx: Context<SetAuthority>, new_authority: Pubkey) -> Result<()> {
        compute_fn!("set_authority" => {
            instructions::set_authority(ctx, new_authority)
        })
    }
}
