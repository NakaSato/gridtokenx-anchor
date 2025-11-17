#![allow(deprecated)]

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer, Burn, MintTo};
use anchor_spl::token_interface::{self as token_interface, Mint as MintInterface, TokenAccount as TokenAccountInterface, TokenInterface};
use anchor_spl::associated_token::AssociatedToken;
use mpl_token_metadata::instructions::CreateV1CpiBuilder;
use mpl_token_metadata::types::{TokenStandard, PrintSupply};
use base64::{engine::general_purpose, Engine as _};

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
        
        // Create metadata using Metaplex Token Metadata program
        CreateV1CpiBuilder::new(&ctx.accounts.metadata_program.to_account_info())
            .metadata(&ctx.accounts.metadata.to_account_info())
            .mint(&ctx.accounts.mint.to_account_info(), true)
            .authority(&ctx.accounts.authority.to_account_info())
            .payer(&ctx.accounts.payer.to_account_info())
            .update_authority(&ctx.accounts.authority.to_account_info(), true)
            .system_program(&ctx.accounts.system_program.to_account_info())
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
        
        Ok(())
    }
    
    /// Mint GRX tokens to a wallet using Token interface
    pub fn mint_to_wallet(
        ctx: Context<MintToWallet>,
        amount: u64,
    ) -> Result<()> {
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
    pub fn transfer_tokens(
        ctx: Context<TransferTokens>,
        amount: u64,
    ) -> Result<()> {
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
    pub fn burn_tokens(
        ctx: Context<BurnTokens>,
        amount: u64,
    ) -> Result<()> {
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
    pub fn mint_tokens_direct(
        ctx: Context<MintTokensDirect>,
        amount: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.token_info.authority,
            ErrorCode::UnauthorizedAuthority
        );
        
        msg!("Authority minting {} tokens to user", amount);
        
        // Mint tokens using token_info PDA as authority
        let seeds = &[
            b"token_info".as_ref(),
            &[ctx.bumps.token_info],
        ];
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
    pub fn mint_grid_tokens(
        ctx: Context<MintGridTokens>,
    ) -> Result<()> {
        // Step 1: Call registry::settle_meter_balance via CPI
        let cpi_program = ctx.accounts.registry_program.to_account_info();
        let cpi_accounts = registry::cpi::accounts::SettleMeterBalance {
            meter_account: ctx.accounts.meter_account.to_account_info(),
            meter_owner: ctx.accounts.meter_owner.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        // This returns the amount of tokens to mint
        let tokens_to_mint = registry::cpi::settle_meter_balance(cpi_ctx)?;
        
        msg!("Settlement complete. Tokens to mint: {}", tokens_to_mint.get());
        
        // Step 2: Mint GRID tokens using SPL Token program
        let seeds = &[
            b"token_info".as_ref(),
            &[ctx.bumps.token_info],
        ];
        let signer_seeds = &[&seeds[..]];
        
        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.token_info.to_account_info(),
        };
        
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        
        token::mint_to(cpi_ctx, tokens_to_mint.get())?;
        
        // Step 3: Update total supply
        let token_info = &mut ctx.accounts.token_info;
        token_info.total_supply = token_info.total_supply.saturating_add(tokens_to_mint.get());
        
        msg!("Successfully minted {} GRID tokens to user", tokens_to_mint.get());
        
        // Encode minting data as base64 for external systems
        let mint_data = format!("{}:{}:{}", 
            ctx.accounts.meter_owner.key(), 
            tokens_to_mint.get(),
            Clock::get()?.unix_timestamp
        );
        let encoded_data = general_purpose::STANDARD.encode(mint_data.as_bytes());
        msg!("Mint data (base64): {}", encoded_data);
        
        emit!(GridTokensMinted {
            meter_owner: ctx.accounts.meter_owner.key(),
            amount: tokens_to_mint.get(),
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
    
    /// CHECK: Validated by Metaplex metadata program
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    /// CHECK: Metaplex metadata program address checked inline
    #[account(address = MPL_TOKEN_METADATA_ID)]
    pub metadata_program: UncheckedAccount<'info>,
    pub rent: Sysvar<'info, Rent>,
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
}