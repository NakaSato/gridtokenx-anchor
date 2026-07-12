use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    Mint as MintInterface, TokenInterface,
};
use mpl_token_metadata::instructions::CreateV1CpiBuilder;
use mpl_token_metadata::types::{PrintSupply, TokenStandard};

use crate::error::EnergyTokenError;
use crate::state::*;

#[cfg(feature = "localnet")]
use compute_debug::compute_checkpoint;
#[cfg(not(feature = "localnet"))]
use crate::compute_checkpoint;

// Instructions sysvar (Sysvar1nstructions1111111111111111111111111).
// The previous array decoded to SysvarReoJr2... (wrong address), which made the
// `address = IX_ID` constraint on sysvar_instructions reject the real sysvar.
const IX_ID: Pubkey = Pubkey::new_from_array([
    6, 167, 213, 23, 24, 123, 209, 102, 53, 218, 212, 4, 85, 253, 194, 192, 193, 36, 198, 143, 33,
    86, 117, 165, 219, 186, 203, 95, 8, 0, 0, 0,
]);

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
    Ok(())
}
