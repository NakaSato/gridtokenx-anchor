#![allow(deprecated)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke;
use anchor_lang::AccountDeserialize;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};
use anchor_spl::token_interface::{
    self as token_interface, Mint as MintInterface, TokenAccount as TokenAccountInterface,
    TokenInterface,
};
use base64::{engine::general_purpose, Engine as _};
use mpl_token_metadata::instructions::CreateV1CpiBuilder;
use mpl_token_metadata::types::{PrintSupply, TokenStandard};

// Metaplex Token Metadata Program ID
const MPL_TOKEN_METADATA_ID: Pubkey = mpl_token_metadata::ID;

declare_id!("94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur");

#[program]
pub mod energy_token {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        msg!("Energy token program initialized");
        Ok(())
    }

    /// Create a new GRX token mint with Token 2022 compatibility
    pub fn create_token_mint(
        ctx: Context<CreateTokenMint>,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        msg!("Creating GRX token mint: {} ({})", name, symbol);

        // Check if Metaplex program is available (for localnet testing)
        if ctx.accounts.metadata_program.executable {
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

            msg!("GRX token mint created successfully with metadata");
        } else {
            msg!("Metaplex program not available, creating token mint without metadata");
        }

        Ok(())
    }

    /// Mint GRX tokens to a wallet using Token interface
    pub fn mint_to_wallet(ctx: Context<MintToWallet>, amount: u64) -> Result<()> {
        msg!("Minting {} GRX tokens to wallet", amount);

        let cpi_accounts = token_interface::MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        token_interface::mint_to(cpi_ctx, amount)?;

        msg!("Successfully minted {} tokens to wallet", amount);

        emit!(TokensMinted {
            recipient: ctx.accounts.destination.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Initialize the energy token program
    pub fn initialize_token(ctx: Context<InitializeToken>) -> Result<()> {
        let token_info = &mut ctx.accounts.token_info;
        token_info.authority = ctx.accounts.authority.key();
        token_info.mint = ctx.accounts.mint.key();
        token_info.total_supply = 0;
        token_info.created_at = Clock::get()?.unix_timestamp;

        msg!("Token initialized with authority: {}", token_info.authority);

        Ok(())
    }

    /// Add a REC validator to the system
    pub fn add_rec_validator(
        ctx: Context<AddRecValidator>,
        validator_pubkey: Pubkey,
        _authority_name: String,
    ) -> Result<()> {
        let token_info = &mut ctx.accounts.token_info;

        require!(
            ctx.accounts.authority.key() == token_info.authority,
            ErrorCode::UnauthorizedAuthority
        );

        msg!("Adding REC validator: {}", validator_pubkey);

        Ok(())
    }

    /// Transfer energy tokens between accounts
    pub fn transfer_tokens(ctx: Context<TransferTokens>, amount: u64) -> Result<()> {
        let cpi_accounts = Transfer {
            from: ctx.accounts.from_token_account.to_account_info(),
            to: ctx.accounts.to_token_account.to_account_info(),
            authority: ctx.accounts.from_authority.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        token::transfer(cpi_ctx, amount)?;

        msg!("Transferred {} tokens", amount);

        Ok(())
    }

    /// Burn energy tokens (for energy consumption)
    pub fn burn_tokens(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        let cpi_accounts = Burn {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx.accounts.token_account.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        token::burn(cpi_ctx, amount)?;

        let token_info = &mut ctx.accounts.token_info;
        token_info.total_supply = token_info.total_supply.saturating_sub(amount);

        msg!("Burned {} tokens", amount);

        Ok(())
    }

    /// Mint tokens directly to a user (authority only)
    /// This is used for off-chain verified meter readings
    pub fn mint_tokens_direct(ctx: Context<MintTokensDirect>, amount: u64) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.token_info.authority,
            ErrorCode::UnauthorizedAuthority
        );

        msg!("Authority minting {} tokens to user", amount);

        // Mint tokens using token_info PDA as authority
        let seeds = &[b"token_info".as_ref(), &[ctx.bumps.token_info]];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.token_info.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

        token::mint_to(cpi_ctx, amount)?;

        // Update total supply
        let token_info = &mut ctx.accounts.token_info;
        token_info.total_supply = token_info.total_supply.saturating_add(amount);

        msg!("Successfully minted {} tokens", amount);

        emit!(TokensMintedDirect {
            recipient: ctx.accounts.user_token_account.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Mint GRID tokens based on settled meter balance
    /// This function performs CPI to registry to settle the meter balance,
    /// then mints the corresponding GRID tokens to the user
    pub fn mint_grid_tokens(ctx: Context<MintGridTokens>) -> Result<()> {
        // Step 1: Call registry::settle_meter_balance via CPI
        // Create the instruction for settle_meter_balance
        let mut settle_meter_balance_data = Vec::new();

        // Add the instruction discriminator (8 bytes)
        // For Anchor programs, this is the first 8 bytes of the SHA256 hash of "global:settle_meter_balance"
        settle_meter_balance_data.extend_from_slice(&[229, 174, 207, 13, 109, 45, 178, 102]);

        // Create the CPI accounts
        let cpi_accounts = vec![
            AccountMeta::new(ctx.accounts.meter_account.key(), false),
            AccountMeta::new_readonly(ctx.accounts.meter_owner.key(), true),
        ];

        // Create the instruction
        let settle_meter_balance_ix = Instruction {
            program_id: ctx.accounts.registry_program.key(),
            accounts: cpi_accounts,
            data: settle_meter_balance_data,
        };

        // Invoke the instruction
        invoke(
            &settle_meter_balance_ix,
            &[
                ctx.accounts.meter_account.to_account_info(),
                ctx.accounts.meter_owner.to_account_info(),
                ctx.accounts.registry_program.to_account_info(),
            ],
        )?;

        // Read the meter account after the CPI to get the settlement data
        // We'll deserialize the meter account to get the settled amount
        let meter_account_data = &ctx.accounts.meter_account.try_borrow_data()?;

        // Since we don't have direct access to registry types, we'll read the raw data
        // The meter account data structure (after the 8-byte discriminator):
        // owner (32 bytes) + meter_id (string) + location (string) +
        // total_generation (8 bytes) + total_consumption (8 bytes) +
        // settled_net_generation (8 bytes) + status (1 byte) + timestamp (8 bytes)

        // For simplicity, we'll skip the discriminator and read the fields we need directly
        let data = &meter_account_data[8..];

        // Skip owner (32 bytes)
        let mut offset = 32;

        // Read meter_id (length-prefixed string)
        let meter_id_len = data[offset] as usize;
        offset += 1 + meter_id_len;

        // Read location (length-prefixed string)
        let location_len = data[offset] as usize;
        offset += 1 + location_len;

        // Read total_generation (8 bytes)
        let total_generation = u64::from_le_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
            data[offset + 4],
            data[offset + 5],
            data[offset + 6],
            data[offset + 7],
        ]);
        offset += 8;

        // Read total_consumption (8 bytes)
        let total_consumption = u64::from_le_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
            data[offset + 4],
            data[offset + 5],
            data[offset + 6],
            data[offset + 7],
        ]);
        offset += 8;

        // Read settled_net_generation (8 bytes)
        let settled_net_generation = u64::from_le_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
            data[offset + 4],
            data[offset + 5],
            data[offset + 6],
            data[offset + 7],
        ]);

        // Calculate the amount of tokens to mint based on the settlement
        // The token amount is the difference between current net generation and settled amount
        let current_net_gen = total_generation.saturating_sub(total_consumption);
        let tokens_to_mint = current_net_gen.saturating_sub(settled_net_generation);

        require!(tokens_to_mint > 0, ErrorCode::NoUnsettledBalance);

        msg!("Settlement complete. Tokens to mint: {}", tokens_to_mint);

        // Step 2: Mint GRID tokens using SPL Token program
        let seeds = &[b"token_info".as_ref(), &[ctx.bumps.token_info]];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.token_info.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        token::mint_to(cpi_ctx, tokens_to_mint)?;

        // Step 3: Update total supply
        let token_info = &mut ctx.accounts.token_info;
        token_info.total_supply = token_info.total_supply.saturating_add(tokens_to_mint);

        msg!("Successfully minted {} GRID tokens to user", tokens_to_mint);

        // Encode minting data as base64 for external systems
        let mint_data = format!(
            "{}:{}:{}",
            ctx.accounts.meter_owner.key(),
            tokens_to_mint,
            Clock::get()?.unix_timestamp
        );
        let encoded_data = general_purpose::STANDARD.encode(mint_data.as_bytes());
        msg!("Mint data (base64): {}", encoded_data);

        emit!(GridTokensMinted {
            meter_owner: ctx.accounts.meter_owner.key(),
            amount: tokens_to_mint,
            timestamp: Clock::get()?.unix_timestamp,
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
    pub mint: InterfaceAccount<'info, MintInterface>,

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
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = destination_owner,
        associated_token::token_program = token_program,
    )]
    pub destination: InterfaceAccount<'info, TokenAccountInterface>,

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
        space = 8 + TokenInfo::INIT_SPACE,
        seeds = [b"token_info"],
        bump
    )]
    pub token_info: Account<'info, TokenInfo>,

    #[account(
        init,
        payer = authority,
        seeds = [b"mint"],
        bump,
        mint::decimals = 9,
        mint::authority = token_info,
    )]
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AddRecValidator<'info> {
    #[account(mut, has_one = authority @ ErrorCode::UnauthorizedAuthority)]
    pub token_info: Account<'info, TokenInfo>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TransferTokens<'info> {
    #[account(mut)]
    pub from_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub to_token_account: Account<'info, TokenAccount>,

    pub from_authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct BurnTokens<'info> {
    #[account(mut)]
    pub token_info: Account<'info, TokenInfo>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct MintTokensDirect<'info> {
    #[account(
        mut,
        seeds = [b"token_info"],
        bump
    )]
    pub token_info: Account<'info, TokenInfo>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct MintGridTokens<'info> {
    #[account(
        mut,
        seeds = [b"token_info"],
        bump
    )]
    pub token_info: Account<'info, TokenInfo>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    /// CHECK: This is the meter account from registry program
    #[account(mut)]
    pub meter_account: AccountInfo<'info>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub meter_owner: Signer<'info>,

    pub token_program: Program<'info, Token>,

    /// CHECK: This is the registry program
    pub registry_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

// Data structs
#[account]
#[derive(InitSpace)]
pub struct TokenInfo {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub total_supply: u64,
    pub created_at: i64,
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
}
