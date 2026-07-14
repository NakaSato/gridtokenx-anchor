// Provisions + funds the platform settlement escrows that
// `execute_atomic_settlement` (trading program, lib.rs) sources funds from, plus
// the fee/wheeling/loss collector ATAs it credits. None of these are created by
// bootstrap.ts, so without this script every trade settlement fails on-chain with
// ConstraintOwner (Custom 2004) the first time it touches a nonexistent account.
//
// Ground truth for which accounts are needed: gridtokenx-trading-service's live
// caller (crates/trading-infra/src/blockchain/settlement.rs) derives:
//   buyer_currency_escrow = ATA(platform, currency_mint, spl-token)   <- debited (GRX)
//   seller_energy_escrow  = ATA(platform, energy_mint,   token-2022) <- debited (GRID)
//   fee_collector         = ATA(env FEE_COLLECTOR_WALLET,      currency_mint, spl-token)
//   wheeling_collector    = ATA(env WHEELING_COLLECTOR_WALLET, currency_mint, spl-token)
//   loss_collector        = ATA(env LOSS_COLLECTOR_WALLET,     currency_mint, spl-token)
// where `platform` is the raw dev-wallet keypair (escrow_authority / market_authority
// are plain Signers, not PDAs — there is no platform-treasury PDA in this model).
// The three collector wallets default to the dev-wallet pubkey (docker-compose.yml),
// so in the common case they collapse onto the same ATA as buyer_currency_escrow.
//
// Only the two escrow accounts need an actual balance (they're debited); the
// collectors just need to exist as valid token accounts (they're credited).
import * as anchor from '@anchor-lang/core';
import { PublicKey } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import * as fs from 'fs';

// Defaults sized well past anything a local e2e/dev run trades in a session.
const CURRENCY_FUND_UNITS = new anchor.BN(process.env.PLATFORM_CURRENCY_FUND_UNITS ?? '1000000000000'); // 1,000,000 GRX (6 decimals)
const ENERGY_FUND_UNITS = new anchor.BN(process.env.PLATFORM_ENERGY_FUND_UNITS ?? '1000000000000000'); // 1,000,000 GRID (9 decimals)

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const energyTokenProgram = anchor.workspace.EnergyToken;
  const platform = provider.wallet.publicKey; // dev-wallet — escrow_authority / market_authority
  console.log('Platform (dev-wallet):', platform.toBase58());

  const currencyMintKeypair = anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync('currency-mint.json', 'utf8')))
  );
  const currencyMint = currencyMintKeypair.publicKey;

  const [tokenInfoPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_info_2022')],
    energyTokenProgram.programId
  );
  const [energyMint] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint_2022')],
    energyTokenProgram.programId
  );
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('registry')],
    anchor.workspace.Registry.programId
  );
  console.log('Currency mint (GRX):', currencyMint.toBase58());
  console.log('Energy mint (GRID):', energyMint.toBase58());

  const collectorWallet = (envVar: string) =>
    new PublicKey(process.env[envVar] ?? platform.toBase58());

  // 1. Platform's own GRX + GRID escrows (debited on every settlement).
  console.log('\n[1/3] Provisioning platform escrow ATAs...');
  const buyerCurrencyEscrow = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    (provider.wallet as any).payer,
    currencyMint,
    platform,
    false,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  console.log('  buyer_currency_escrow (GRX):', buyerCurrencyEscrow.address.toBase58());

  const sellerEnergyEscrow = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    (provider.wallet as any).payer,
    energyMint,
    platform,
    false,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  console.log('  seller_energy_escrow (GRID):', sellerEnergyEscrow.address.toBase58());

  // 2. Fee/wheeling/loss collector ATAs (credited — just need to exist).
  console.log('\n[2/3] Provisioning fee/wheeling/loss collector ATAs...');
  for (const [label, envVar] of [
    ['fee_collector', 'FEE_COLLECTOR_WALLET'],
    ['wheeling_collector', 'WHEELING_COLLECTOR_WALLET'],
    ['loss_collector', 'LOSS_COLLECTOR_WALLET'],
  ] as const) {
    const owner = collectorWallet(envVar);
    const ata = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      currencyMint,
      owner,
      false,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log(`  ${label} (owner=${owner.toBase58()}):`, ata.address.toBase58());
  }

  // 3. Fund the two escrows. GRX: dev-wallet is the plain SPL mint authority.
  console.log('\n[3/3] Minting into platform escrows...');
  try {
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      currencyMint,
      buyerCurrencyEscrow.address,
      platform,
      BigInt(CURRENCY_FUND_UNITS.toString()),
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log(`  ✅ Minted ${CURRENCY_FUND_UNITS.toString()} GRX units into buyer_currency_escrow`);
  } catch (e: any) {
    console.log('  ⚠️  GRX mint failed (already funded or auth mismatch?):', e.message);
  }

  // GRID: mint authority is the token_info PDA — must CPI through the energy-token
  // program's mint_tokens_direct (dev-wallet qualifies as `authority` via the
  // is_admin branch, and as `rec_validator` since bootstrap registers it as one;
  // registry_authority just needs to match token_info.registry_authority = registryPda).
  try {
    await energyTokenProgram.methods
      .mintTokensDirect(ENERGY_FUND_UNITS)
      .accounts({
        tokenInfo: tokenInfoPda,
        mint: energyMint,
        userTokenAccount: sellerEnergyEscrow.address,
        authority: platform,
        registryAuthority: registryPda,
        recValidator: platform,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .rpc();
    console.log(`  ✅ Minted ${ENERGY_FUND_UNITS.toString()} GRID units into seller_energy_escrow`);
  } catch (e: any) {
    console.log('  ⚠️  GRID mint failed (already funded or auth mismatch?):', e.message);
  }

  console.log('\nPlatform settlement escrows provisioned.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
