#![allow(deprecated)]

use anchor_lang::prelude::*;
// Instructions sysvar (Sysvar1nstructions1111111111111111111111111).
// The previous array decoded to SysvarReoJr2... (wrong address), which made the
// `address = IX_ID` constraint on sysvar_instructions reject the real sysvar.
const IX_ID: Pubkey = Pubkey::new_from_array([
    6, 167, 213, 23, 24, 123, 209, 102, 53, 218, 212, 4, 85, 253, 194, 192, 193, 36, 198, 143, 33,
    86, 117, 165, 219, 186, 203, 95, 8, 0, 0, 0,
]);

use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        self as token_interface, Burn as BurnInterface, Mint as MintInterface,
        MintTo as MintToInterface, TokenAccount as TokenAccountInterface, TokenInterface,
        TransferChecked as TransferCheckedInterface,
    },
};
use mpl_token_metadata::instructions::CreateV1CpiBuilder;
use mpl_token_metadata::types::{PrintSupply, TokenStandard};

// Core modules
pub mod error;
pub mod events;
pub mod state;

pub use error::EnergyTokenError;
pub use events::*;
pub use state::*;

// Import compute_fn! macro when localnet feature is enabled
#[cfg(feature = "localnet")]
use compute_debug::{compute_checkpoint, compute_fn};

// No-op versions for non-localnet builds
#[cfg(not(feature = "localnet"))]
macro_rules! compute_fn {
    ($name:expr => $block:block) => {
        $block
    };
}
#[cfg(not(feature = "localnet"))]
macro_rules! compute_checkpoint {
    ($name:expr) => {};
}

declare_id!("6FZKcVKCLFSNLMxypFJGU4K14xUBnxNW9VAuKGhmqjGX");

/// True if `key` is one of the registered REC validators. Single source of truth for
/// the REC co-signature gate, shared by every mint path (`mint_to_wallet`,
/// `mint_generation`, `mint_tokens_direct`) so the membership check can never drift
/// between them. Only scans the populated prefix (`count <= 5`).
fn rec_validator_registered(token_info: &TokenInfo, key: &Pubkey) -> bool {
    token_info.rec_validators[..token_info.rec_validators_count as usize].contains(key)
}

#[program]
pub mod energy_token {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        compute_fn!("initialize" => {
        });
        Ok(())
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
            // Logging disabled to save CU

            // Check if Metaplex program is available (for localnet testing)
            if ctx.accounts.metadata_program.executable {
                compute_checkpoint!("before_metaplex_cpi");

                // The mint's mint-authority is the token_info PDA, so CreateV1 must be
                // signed by that PDA (the mint itself is not a signer for an existing
                // mint). The human admin is the metadata update_authority.
                // NOTE: this branch is unexercised on localnet (no Metaplex program is
                // loaded), so it is verified only by compilation.
                let seeds: &[&[u8]] = &[b"token_info_2022", &[ctx.bumps.token_info]];
                CreateV1CpiBuilder::new(&ctx.accounts.metadata_program.to_account_info())
                    .metadata(&ctx.accounts.metadata.to_account_info())
                    .mint(&ctx.accounts.mint.to_account_info(), false)
                    .authority(&ctx.accounts.token_info.to_account_info())
                    .payer(&ctx.accounts.payer.to_account_info())
                    .update_authority(&ctx.accounts.authority.to_account_info(), true)
                    .system_program(&ctx.accounts.system_program.to_account_info())
                    .sysvar_instructions(&ctx.accounts.sysvar_instructions.to_account_info())
                    .spl_token_program(Some(&ctx.accounts.token_program.to_account_info()))
                    .name(name)
                    .symbol(symbol)
                    .uri(uri)
                    .seller_fee_basis_points(0)
                    .decimals(9)
                    .token_standard(TokenStandard::Fungible)
                    .print_supply(PrintSupply::Zero)
                    .invoke_signed(&[seeds])?;

                compute_checkpoint!("after_metaplex_cpi");
            }
        });
        Ok(())
    }

    /// Mint GRID tokens to a wallet using Token interface
    pub fn mint_to_wallet(ctx: Context<MintToWallet>, amount: u64) -> Result<()> {
        compute_fn!("mint_to_wallet" => {
            {
                let token_info = ctx.accounts.token_info.load()?;
                require!(
                    token_info.authority == ctx.accounts.authority.key(),
                    EnergyTokenError::UnauthorizedAuthority
                );

                // REC provenance: when validators are registered, one must co-sign.
                // Parity with mint_tokens_direct — without this the admin mint path
                // bypasses the Renewable Energy Certificate proof. The signer is
                // optional so existing callers keep working while no validators exist.
                if token_info.rec_validators_count > 0 {
                    let rec_key = ctx
                        .accounts
                        .rec_validator
                        .as_ref()
                        .map(|v| v.key())
                        .ok_or(EnergyTokenError::RecValidatorNotFound)?;
                    require!(
                        rec_validator_registered(&token_info, &rec_key),
                        EnergyTokenError::RecValidatorNotFound
                    );
                }
            }
            // Cache clock before CPI — avoids an inline syscall inside the emit! macro
            // and ensures the timestamp is captured before the CPI context is consumed.
            let now = Clock::get()?.unix_timestamp;
            // Logging disabled to save CU
            let cpi_accounts = token_interface::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.token_info.to_account_info(),
            };

            let seeds = &[b"token_info_2022".as_ref(), &[ctx.bumps.token_info]];
            let signer = &[&seeds[..]];

            let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer);

            compute_checkpoint!("before_mint_cpi");
            token_interface::mint_to(cpi_ctx, amount)?;
            compute_checkpoint!("after_mint_cpi");

            // total_supply is NOT updated here — use sync_total_supply for batch updates
            // to avoid write-lock contention on token_info during high-frequency minting

            emit!(TokensMinted {
                recipient: ctx.accounts.destination.key(),
                amount,
                timestamp: now,
            });
        });
        Ok(())
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
            // Idempotency: this (meter, window) already minted — no-op success.
            // Must be the first check so a replay never re-runs the mint CPI.
            if ctx.accounts.mint_record.minted {
                return Ok(());
            }

            // Window-unit reconciliation: the off-chain node aligns 15-min windows to
            // wall-clock (oracle checks `epoch % 900 == 0` in *seconds*). This PDA keys on
            // `window_start_ms` (*milliseconds*), so enforce the same boundary in ms:
            // 900 s = 900_000 ms. Rejects unaligned/garbage windows before minting.
            require!(
                window_start_ms > 0 && window_start_ms % 900_000 == 0,
                EnergyTokenError::MisalignedWindow
            );

            {
                let token_info = ctx.accounts.token_info.load()?;
                require!(
                    token_info.authority == ctx.accounts.authority.key(),
                    EnergyTokenError::UnauthorizedAuthority
                );

                // REC provenance: parity with mint_to_wallet — when validators are
                // registered, one must co-sign.
                if token_info.rec_validators_count > 0 {
                    let rec_key = ctx
                        .accounts
                        .rec_validator
                        .as_ref()
                        .map(|v| v.key())
                        .ok_or(EnergyTokenError::RecValidatorNotFound)?;
                    require!(
                        rec_validator_registered(&token_info, &rec_key),
                        EnergyTokenError::RecValidatorNotFound
                    );
                }
            }

            let now = Clock::get()?.unix_timestamp;
            let cpi_accounts = token_interface::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.token_info.to_account_info(),
            };
            let seeds = &[b"token_info_2022".as_ref(), &[ctx.bumps.token_info]];
            let signer = &[&seeds[..]];
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                cpi_accounts,
                signer,
            );

            compute_checkpoint!("before_mint_cpi");
            token_interface::mint_to(cpi_ctx, amount)?;
            compute_checkpoint!("after_mint_cpi");

            // Stamp the record only AFTER a successful mint, so a failed mint leaves
            // the window un-minted and retryable (the account exists with
            // minted == false; the next attempt re-runs the CPI).
            let record = &mut ctx.accounts.mint_record;
            record.meter_id = meter_id;
            record.window_start_ms = window_start_ms;
            record.amount = amount;
            record.minted = true;
            record.bump = ctx.bumps.mint_record;

            emit!(TokensMinted {
                recipient: ctx.accounts.destination.key(),
                amount,
                timestamp: now,
            });
        });
        Ok(())
    }

    /// Initialize the energy token program
    pub fn initialize_token(
        ctx: Context<InitializeToken>,
        registry_program_id: Pubkey,
        registry_authority: Pubkey,
    ) -> Result<()> {
        compute_fn!("initialize_token" => {
            let clock = Clock::get()?;
            let mut token_info = ctx.accounts.token_info.load_init()?;
            token_info.authority = ctx.accounts.authority.key();
            token_info.registry_authority = registry_authority;
            token_info.registry_program = registry_program_id;
            token_info.mint = ctx.accounts.mint.key();
            token_info.total_supply = 0;
            token_info.created_at = clock.unix_timestamp;
            token_info.rec_validators_count = 0;
            token_info.rec_validators = [Pubkey::default(); 5];
        });
        Ok(())
    }

    /// Add a REC validator to the system
    pub fn add_rec_validator(
        ctx: Context<AddRecValidator>,
        validator_pubkey: Pubkey,
        _authority_name: String,
    ) -> Result<()> {
        compute_fn!("add_rec_validator" => {
            let mut token_info = ctx.accounts.token_info.load_mut()?;

            // Check that it does not exceed the specified number
            require!(
                token_info.rec_validators_count < 5,
                EnergyTokenError::MaxValidatorsReached
            );

            // Check if it already exists
            for i in 0..token_info.rec_validators_count as usize {
                require!(
                    token_info.rec_validators[i] != validator_pubkey,
                    EnergyTokenError::ValidatorAlreadyExists
                );
            }

            let index = token_info.rec_validators_count as usize;
            token_info.rec_validators[index] = validator_pubkey;
            token_info.rec_validators_count += 1;
        });
        Ok(())
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
            let mut token_info = ctx.accounts.token_info.load_mut()?;

            let count = token_info.rec_validators_count as usize;
            let mut target = None;
            for i in 0..count {
                if token_info.rec_validators[i] == validator_pubkey {
                    target = Some(i);
                    break;
                }
            }
            let idx = target.ok_or(EnergyTokenError::RemoveValidatorNotFound)?;

            let last = count - 1;
            token_info.rec_validators[idx] = token_info.rec_validators[last];
            token_info.rec_validators[last] = Pubkey::default();
            token_info.rec_validators_count -= 1;
        });
        Ok(())
    }

    /// Transfer energy tokens between accounts
    pub fn transfer_tokens(ctx: Context<TransferTokens>, amount: u64) -> Result<()> {
        compute_fn!("transfer_tokens" => {
            let cpi_accounts = TransferCheckedInterface {
                from: ctx.accounts.from_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.to_token_account.to_account_info(),
                authority: ctx.accounts.from_authority.to_account_info(),
            };

            let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);

            compute_checkpoint!("before_transfer_cpi");
            token_interface::transfer_checked(cpi_ctx, amount, 9)?;
            compute_checkpoint!("after_transfer_cpi");
            // Logging disabled to save CU
        });
        Ok(())
    }

    /// Burn energy tokens (for energy consumption)
    pub fn burn_tokens(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        compute_fn!("burn_tokens" => {
            let cpi_accounts = BurnInterface {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            };

            let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);

            compute_checkpoint!("before_burn_cpi");
            token_interface::burn(cpi_ctx, amount)?;
            compute_checkpoint!("after_burn_cpi");

            // total_supply is NOT updated here — use sync_total_supply for batch updates
        });
        Ok(())
    }

    /// Mint tokens directly to a user (authority or registry program only)
    ///
    /// Sealevel-optimized: token_info is read-only (no total_supply write).
    /// If REC validators are registered, one must co-sign to prove energy provenance.
    /// Call sync_total_supply periodically to batch-update the stored total.
    pub fn mint_tokens_direct(ctx: Context<MintTokensDirect>, amount: u64) -> Result<()> {
        compute_fn!("mint_tokens_direct" => {
            let token_info = ctx.accounts.token_info.load()?;

            // Check if caller has permission (Admin or Registry Program)
            let is_admin = ctx.accounts.authority.key() == token_info.authority;
            let is_registry = ctx.accounts.authority.key() == ctx.accounts.registry_authority.key();
            

            require!(is_admin || is_registry, EnergyTokenError::UnauthorizedAuthority);

            // REC Validator co-signature: when validators are registered, one must sign
            // This proves the minted energy has a corresponding Renewable Energy Certificate
            if token_info.rec_validators_count > 0 {
                require!(
                    rec_validator_registered(&token_info, &ctx.accounts.rec_validator.key()),
                    EnergyTokenError::RecValidatorNotFound
                );
            }

            drop(token_info);

            // Cache clock before CPI — avoids an inline syscall inside the emit! macro
            // and ensures the timestamp is captured before the CPI context is consumed.
            let now = Clock::get()?.unix_timestamp;

            // Mint tokens using token_info PDA as authority
            let seeds = &[b"token_info_2022".as_ref(), &[ctx.bumps.token_info]];
            let signer_seeds = &[&seeds[..]];

            let cpi_accounts = MintToInterface {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.token_info.to_account_info(),
            };

            let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds);

            compute_checkpoint!("before_mint_direct_cpi");
            token_interface::mint_to(cpi_ctx, amount)?;
            compute_checkpoint!("after_mint_direct_cpi");

            // total_supply is NOT updated here — use sync_total_supply for batch updates

            emit!(GridTokensMinted {
                meter_owner: ctx.accounts.user_token_account.key(),
                amount,
                timestamp: now,
            });
        });
        Ok(())
    }

    /// Sync total_supply from the canonical SPL Mint account (admin only)
    ///
    /// Call this periodically (e.g. every N mints/burns) instead of writing
    /// token_info on every transaction. Eliminates write-lock contention on
    /// token_info during high-frequency mint/burn operations.
    pub fn sync_total_supply(ctx: Context<SyncTotalSupply>) -> Result<()> {
        compute_fn!("sync_total_supply" => {
            let mut token_info = ctx.accounts.token_info.load_mut()?;

            require!(
                ctx.accounts.authority.key() == token_info.authority,
                EnergyTokenError::UnauthorizedAuthority
            );

            let canonical_supply = ctx.accounts.mint.supply;
            token_info.total_supply = canonical_supply;

            // Hoist Clock::get() before emit! — avoids inline syscall inside macro expansion.
            let now = Clock::get()?.unix_timestamp;
            emit!(TotalSupplySynced {
                authority: ctx.accounts.authority.key(),
                supply: canonical_supply,
                timestamp: now,
            });
        });
        Ok(())
    }

    /// Update the registry authority (admin only)
    pub fn set_registry_authority(ctx: Context<SetRegistryAuthority>, new_registry_authority: Pubkey) -> Result<()> {
        let mut token_info = ctx.accounts.token_info.load_mut()?;
        require!(
            ctx.accounts.authority.key() == token_info.authority,
            EnergyTokenError::UnauthorizedAuthority
        );

        token_info.registry_authority = new_registry_authority;
        Ok(())
    }
}

// Account structs
#[derive(Accounts)]
pub struct Initialize<'info> {
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CreateTokenMint<'info> {
    #[account(
        mut,
        constraint = mint.key() == token_info.load()?.mint @ EnergyTokenError::UnauthorizedAuthority,
    )]
    pub mint: Box<InterfaceAccount<'info, MintInterface>>,

    #[account(
        seeds = [b"token_info_2022"],
        bump,
        constraint = token_info.load()?.authority == authority.key() @ EnergyTokenError::UnauthorizedAuthority,
    )]
    pub token_info: AccountLoader<'info, TokenInfo>,

    /// CHECK: Validated by Metaplex metadata program (optional)
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    /// CHECK: Metaplex metadata program (optional for localnet)
    pub metadata_program: UncheckedAccount<'info>,
    pub rent: Sysvar<'info, Rent>,
    /// CHECK: Instructions sysvar for verification
    #[account(address = IX_ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct MintToWallet<'info> {
    #[account(
        mut,
        constraint = mint.key() == token_info.load()?.mint @ EnergyTokenError::UnauthorizedAuthority,
    )]
    pub mint: InterfaceAccount<'info, MintInterface>,

    #[account(
        seeds = [b"token_info_2022"],
        bump,
        constraint = token_info.load()?.authority == authority.key() @ EnergyTokenError::UnauthorizedAuthority,
    )]
    pub token_info: AccountLoader<'info, TokenInfo>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = destination_owner,
        token::token_program = token_program,
    )]
    pub destination: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// CHECK: The owner of the destination token account
    pub destination_owner: UncheckedAccount<'info>,

    pub authority: Signer<'info>,

    /// REC validator co-signer — required only when token_info.rec_validators_count > 0
    pub rec_validator: Option<Signer<'info>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(meter_id: [u8; 16], window_start_ms: i64)]
pub struct MintGeneration<'info> {
    #[account(
        mut,
        constraint = mint.key() == token_info.load()?.mint @ EnergyTokenError::UnauthorizedAuthority,
    )]
    pub mint: InterfaceAccount<'info, MintInterface>,

    #[account(
        seeds = [b"token_info_2022"],
        bump,
        constraint = token_info.load()?.authority == authority.key() @ EnergyTokenError::UnauthorizedAuthority,
    )]
    pub token_info: AccountLoader<'info, TokenInfo>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = destination_owner,
        token::token_program = token_program,
    )]
    pub destination: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// CHECK: The owner of the destination token account
    pub destination_owner: UncheckedAccount<'info>,

    /// Per-(meter, window) idempotency guard. `init_if_needed` so the first mint
    /// creates it and a replay finds it already present; the `minted` flag (checked
    /// in the handler before any mint) makes re-entry a no-op, closing the standard
    /// init_if_needed re-init footgun.
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + GenerationMintRecord::LEN,
        seeds = [b"gen_mint", meter_id.as_ref(), &window_start_ms.to_le_bytes()],
        bump,
    )]
    pub mint_record: Account<'info, GenerationMintRecord>,

    pub authority: Signer<'info>,

    /// REC validator co-signer — required only when token_info.rec_validators_count > 0
    pub rec_validator: Option<Signer<'info>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeToken<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<TokenInfo>(),
        seeds = [b"token_info_2022"],
        bump
    )]
    pub token_info: AccountLoader<'info, TokenInfo>,

    #[account(
        init,
        payer = authority,
        seeds = [b"mint_2022"],
        bump,
        mint::decimals = 9,
        mint::authority = token_info,
        mint::token_program = token_program,
    )]
    pub mint: InterfaceAccount<'info, MintInterface>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AddRecValidator<'info> {
    #[account(mut, has_one = authority @ EnergyTokenError::UnauthorizedAuthority)]
    pub token_info: AccountLoader<'info, TokenInfo>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TransferTokens<'info> {
    #[account(mut)]
    pub from_token_account: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut)]
    pub to_token_account: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub mint: InterfaceAccount<'info, MintInterface>,

    pub from_authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct BurnTokens<'info> {
    #[account(mut)]
    pub mint: InterfaceAccount<'info, MintInterface>,

    #[account(mut)]
    pub token_account: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct MintTokensDirect<'info> {
    /// Global config — read-only, no write lock for Sealevel parallelism
    #[account(
        seeds = [b"token_info_2022"],
        bump
    )]
    pub token_info: AccountLoader<'info, TokenInfo>,

    #[account(
        mut,
        constraint = mint.key() == token_info.load()?.mint @ EnergyTokenError::UnauthorizedAuthority,
    )]
    pub mint: InterfaceAccount<'info, MintInterface>,

    // Bind the recipient to the canonical mint + token program — parity with the
    // `destination` binding on mint_to_wallet / mint_generation. Defense-in-depth:
    // the mint_to CPI already rejects a wrong-mint account, but this makes the
    // contract explicit and fails earlier in account validation.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub authority: Signer<'info>,

    /// CHECK: Validated against stored registry_authority in TokenInfo
    #[account(
        constraint = registry_authority.key() == token_info.load()?.registry_authority @ EnergyTokenError::UnauthorizedAuthority
    )]
    pub registry_authority: UncheckedAccount<'info>,

    /// REC Validator co-signer — must be in token_info.rec_validators when count > 0
    pub rec_validator: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SyncTotalSupply<'info> {
    #[account(
        mut,
        seeds = [b"token_info_2022"],
        bump
    )]
    pub token_info: AccountLoader<'info, TokenInfo>,

    #[account(
        constraint = mint.key() == token_info.load()?.mint @ EnergyTokenError::UnauthorizedAuthority,
    )]
    pub mint: InterfaceAccount<'info, MintInterface>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetRegistryAuthority<'info> {
    #[account(
        mut,
        seeds = [b"token_info_2022"],
        bump,
    )]
    pub token_info: AccountLoader<'info, TokenInfo>,

    pub authority: Signer<'info>,
}
