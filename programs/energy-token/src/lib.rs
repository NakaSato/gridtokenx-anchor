#![allow(deprecated)]

use anchor_lang::prelude::*;

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

// Import compute_fn! macro when localnet feature is enabled
#[cfg(feature = "localnet")]
use compute_debug::{compute_fn, compute_checkpoint};

// No-op versions for non-localnet builds
#[cfg(not(feature = "localnet"))]
macro_rules! compute_fn {
    ($name:expr => $block:block) => { $block };
}
#[cfg(not(feature = "localnet"))]
macro_rules! compute_checkpoint {
    ($name:expr) => {};
}

declare_id!("8jTDw36yCQyYdr9hTtve5D5bFuQdaJ6f3WbdM4iGPHuq");

#[program]
pub mod energy_token {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        compute_fn!("initialize" => {
            msg!("Energy token program initialized");
        });
        Ok(())
    }

    /// Create a new GRX token mint with Token 2022 compatibility
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
                
                // Create metadata using Metaplex Token Metadata program
                CreateV1CpiBuilder::new(&ctx.accounts.metadata_program.to_account_info())
                    .metadata(&ctx.accounts.metadata.to_account_info())
                    .mint(&ctx.accounts.mint.to_account_info(), true)
                    .authority(&ctx.accounts.authority.to_account_info())
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
                    .invoke()?;

                compute_checkpoint!("after_metaplex_cpi");
                msg!("GRX token mint created successfully with metadata");
            } else {
                msg!("Metaplex program not available, creating token mint without metadata");
            }
        });
        Ok(())
    }

    /// Mint GRX tokens to a wallet using Token interface
    pub fn mint_to_wallet(ctx: Context<MintToWallet>, amount: u64) -> Result<()> {
        compute_fn!("mint_to_wallet" => {
            let token_info = ctx.accounts.token_info.load()?;
            require!(
                token_info.authority == ctx.accounts.authority.key(),
                ErrorCode::UnauthorizedAuthority
            );
            // Logging disabled to save CU

            let cpi_accounts = token_interface::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.token_info.to_account_info(),
            };

            let cpi_program = ctx.accounts.token_program.to_account_info();

            let seeds = &[b"token_info_2022".as_ref(), &[ctx.bumps.token_info]];
            let signer = &[&seeds[..]];

            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);

            compute_checkpoint!("before_mint_cpi");
            token_interface::mint_to(cpi_ctx, amount)?;
            compute_checkpoint!("after_mint_cpi");

            // Logging disabled to save CU

            emit!(TokensMinted {
                recipient: ctx.accounts.destination.key(),
                amount,
                timestamp: Clock::get()?.unix_timestamp,
            });
        });
        Ok(())
    }

    /// Initialize the energy token program
    pub fn initialize_token(
        ctx: Context<InitializeToken>,
        registry_program_id: Pubkey,
    ) -> Result<()> {
        compute_fn!("initialize_token" => {
            let clock = Clock::get()?;
            let mut token_info = ctx.accounts.token_info.load_init()?;
            token_info.authority = ctx.accounts.authority.key();
            token_info.registry_program = registry_program_id;
            token_info.mint = ctx.accounts.mint.key();
            token_info.total_supply = 0;
            token_info.created_at = clock.unix_timestamp;
            token_info.rec_validators_count = 0;
            token_info.rec_validators = [Pubkey::default(); 5];

            #[cfg(feature = "localnet")]
            msg!("Token initialized with registry program: {}", registry_program_id);
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
                ErrorCode::MaxValidatorsReached
            );

            // Check if it already exists
            for i in 0..token_info.rec_validators_count as usize {
                require!(
                    token_info.rec_validators[i] != validator_pubkey,
                    ErrorCode::ValidatorAlreadyExists
                );
            }

            let index = token_info.rec_validators_count as usize;
            token_info.rec_validators[index] = validator_pubkey;
            token_info.rec_validators_count += 1;
            
            #[cfg(feature = "localnet")]
            msg!("REC Validator added: {} ({})", validator_pubkey, _authority_name);
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

            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

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

            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

            compute_checkpoint!("before_burn_cpi");
            token_interface::burn(cpi_ctx, amount)?;
            compute_checkpoint!("after_burn_cpi");

            let mut token_info = ctx.accounts.token_info.load_mut()?;
            token_info.total_supply = token_info.total_supply.saturating_sub(amount);

            // Logging disabled to save CU
        });
        Ok(())
    }

    /// Mint tokens directly to a user (authority or registry program only)
    /// This is used for off-chain verified meter readings
    pub fn mint_tokens_direct(ctx: Context<MintTokensDirect>, amount: u64) -> Result<()> {
        compute_fn!("mint_tokens_direct" => {
            // Scope the borrow to ensure it drops before mutable borrow later
            {
                let token_info = ctx.accounts.token_info.load()?;
            
                // Check if caller has permission (Admin or Registry Program)
                let is_admin = ctx.accounts.authority.key() == token_info.authority;
            
                // Note: In real deployment, CPI caller verification can be added
                // By using invoke_signed context or checking instruction data
                require!(is_admin, ErrorCode::UnauthorizedAuthority);
            }

            // Mint tokens using token_info PDA as authority
            let seeds = &[b"token_info_2022".as_ref(), &[ctx.bumps.token_info]];
            let signer_seeds = &[&seeds[..]];

            let cpi_accounts = MintToInterface {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.token_info.to_account_info(),
            };

            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

            compute_checkpoint!("before_mint_direct_cpi");
            token_interface::mint_to(cpi_ctx, amount)?;
            compute_checkpoint!("after_mint_direct_cpi");

            // Update total supply
            let mut token_info = ctx.accounts.token_info.load_mut()?;
            token_info.total_supply = token_info.total_supply.saturating_add(amount);

            // Use GridTokensMinted event which clearly implies energy to token conversion
            emit!(GridTokensMinted {
                meter_owner: ctx.accounts.user_token_account.key(),
                amount,
                timestamp: Clock::get()?.unix_timestamp,
            });
        });
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
        init,
        payer = payer,
        mint::decimals = 9,
        mint::authority = authority,
    )]
    pub mint: Box<InterfaceAccount<'info, MintInterface>>,

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
    /// CHECK: Sysvar instructions account for Metaplex validation
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct MintToWallet<'info> {
    #[account(mut)]
    pub mint: InterfaceAccount<'info, MintInterface>,

    #[account(
        seeds = [b"token_info_2022"],
        bump,
        constraint = token_info.load()?.authority == authority.key() @ ErrorCode::UnauthorizedAuthority,
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
    pub destination_owner: AccountInfo<'info>,

    pub authority: Signer<'info>,

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
    #[account(mut, has_one = authority @ ErrorCode::UnauthorizedAuthority)]
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
    pub token_info: AccountLoader<'info, TokenInfo>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, MintInterface>,

    #[account(mut)]
    pub token_account: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct MintTokensDirect<'info> {
    #[account(
        mut,
        seeds = [b"token_info_2022"],
        bump
    )]
    pub token_info: AccountLoader<'info, TokenInfo>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, MintInterface>,

    #[account(mut)]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

// Data structs
#[account(zero_copy)]
#[repr(C)]
pub struct TokenInfo {
    pub authority: Pubkey,        // 32
    pub registry_program: Pubkey, // 32
    pub mint: Pubkey,             // 32
    pub total_supply: u64,        // 8
    pub created_at: i64,          // 8
    pub rec_validators: [Pubkey; 5], // 32 * 5 = 160
    pub rec_validators_count: u8, // 1
    pub _padding: [u8; 7],        // 7
}

// Events
#[event]
pub struct GridTokensMinted {
    pub meter_owner: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TokensMintedDirect {
    pub recipient: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TokensMinted {
    pub recipient: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

// Errors
#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,
    #[msg("Invalid meter")]
    InvalidMeter,
    #[msg("Insufficient token balance")]
    InsufficientBalance,
    #[msg("Invalid metadata account")]
    InvalidMetadataAccount,
    #[msg("No unsettled balance")]
    NoUnsettledBalance,
    #[msg("Unauthorized registry program")]
    UnauthorizedRegistry,
    #[msg("Validator already exists in the list")]
    ValidatorAlreadyExists,
    #[msg("Maximum number of validators reached")]
    MaxValidatorsReached,
}
