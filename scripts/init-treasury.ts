import * as anchor from '@anchor-lang/core';
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';

// Initialize the Treasury program: config PDA, THBG mint, and the swap/stake/reward
// GRX vaults. The `settlement_recorder` is bound to the trading market_authority PDA
// so only genuine trading settlements can advance the baht-settled counter.
//
// Run order: bootstrap.ts → init-* (registry/oracle/market/governance) → init-treasury.ts
async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const treasuryProgram = anchor.workspace.Treasury;
  const energyTokenProgram = anchor.workspace.EnergyToken;
  const tradingProgram = anchor.workspace.Trading;
  const registryProgram = anchor.workspace.Registry;
  const authority = provider.wallet;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Initialize Treasury (GRX↔THBG swap, staking, baht settlement)');
  console.log('═══════════════════════════════════════════════════════════════');

  // GRX mint = energy-token program's canonical mint PDA ([b"mint_2022"]).
  const [grxMint] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint_2022')],
    energyTokenProgram.programId,
  );

  // settlement_recorder = trading market_authority PDA (signs the record CPI).
  const [marketAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('market_authority')],
    tradingProgram.programId,
  );

  const [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from('treasury')], treasuryProgram.programId);
  const [thbgMint] = PublicKey.findProgramAddressSync([Buffer.from('thbg_mint')], treasuryProgram.programId);
  const [swapVault] = PublicKey.findProgramAddressSync([Buffer.from('swap_vault')], treasuryProgram.programId);
  const [stakeVault] = PublicKey.findProgramAddressSync([Buffer.from('stake_vault')], treasuryProgram.programId);
  const [rewardVault] = PublicKey.findProgramAddressSync([Buffer.from('reward_vault')], treasuryProgram.programId);

  console.log('  Treasury PDA   :', treasuryPda.toBase58());
  console.log('  THBG mint      :', thbgMint.toBase58());
  console.log('  GRX mint       :', grxMint.toBase58());
  console.log('  Recorder (PDA) :', marketAuthority.toBase58());

  // Params: attestor = admin for dev; 4 THBG (6dp) per whole GRX; 0.25% fee; 1h TTL.
  const attestor = authority.publicKey;
  const grxPerThbgRate = new BN(4_000_000); // 4.000000 THBG per 1 GRX
  const swapFeeBps = 25;
  const attestationTtl = new BN(3600);

  try {
    const tx = await treasuryProgram.methods
      .initialize(attestor, marketAuthority, grxPerThbgRate, swapFeeBps, attestationTtl)
      .accounts({
        treasury: treasuryPda,
        grxMint,
        thbgMint,
        swapVault,
        stakeVault,
        rewardVault,
        authority: authority.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    console.log('✅ Treasury initialized. TX:', tx);
  } catch (e: any) {
    if (e.message?.includes('already in use')) {
      console.log('ℹ️  Treasury already initialized.');
    } else {
      console.error('❌ Error:', e.message);
      throw e;
    }
  }

  // Bind the registry's slash destination to the treasury reward_vault so slashed
  // validator bonds are redistributed to honest stakers. slash_validator refuses to
  // send the bond anywhere else once this is set.
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('registry')],
    registryProgram.programId,
  );
  try {
    const slashTx = await registryProgram.methods
      .setSlashDestination(rewardVault)
      .accounts({
        registry: registryPda,
        authority: authority.publicKey,
      })
      .rpc();
    console.log('✅ Registry slash destination → treasury reward_vault. TX:', slashTx);
  } catch (e: any) {
    console.error('⚠️  set_slash_destination failed (is registry initialized?):', e.message);
  }

  const t = await treasuryProgram.account.treasury.fetch(treasuryPda);
  console.log('\n📊 Treasury:');
  console.log('   authority         :', t.authority.toBase58());
  console.log('   attestor          :', t.attestor.toBase58());
  console.log('   settlementRecorder:', t.settlementRecorder.toBase58());
  console.log('   grxPerThbgRate    :', t.grxPerThbgRate.toString());
  console.log('   swapFeeBps        :', t.swapFeeBps);
  console.log('   attestationTtl    :', t.attestationTtl.toString());
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
