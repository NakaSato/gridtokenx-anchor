import * as anchor from '@anchor-lang/core';
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';

// Initialize the Treasury program: config PDA, THBC mint, and the swap/stake/reward
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
  console.log('  Initialize Treasury (GRX↔THBC swap, staking, baht settlement)');
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
  const [thbcMint] = PublicKey.findProgramAddressSync([Buffer.from('thbc_mint')], treasuryProgram.programId);
  const [swapVault] = PublicKey.findProgramAddressSync([Buffer.from('swap_vault')], treasuryProgram.programId);
  const [stakeVault] = PublicKey.findProgramAddressSync([Buffer.from('stake_vault')], treasuryProgram.programId);
  const [rewardVault] = PublicKey.findProgramAddressSync([Buffer.from('reward_vault')], treasuryProgram.programId);
  const [rebateVault] = PublicKey.findProgramAddressSync([Buffer.from('rebate_vault')], treasuryProgram.programId);

  console.log('  Treasury PDA   :', treasuryPda.toBase58());
  console.log('  THBC mint      :', thbcMint.toBase58());
  console.log('  GRX mint       :', grxMint.toBase58());
  console.log('  Recorder (PDA) :', marketAuthority.toBase58());

  // Params: attestor = admin for dev; 4 THBC (6dp) per whole GRX; 0.25% fee; 1h TTL.
  const attestor = authority.publicKey;
  const grxPerThbcRate = new BN(4_000_000); // 4.000000 THBC per 1 GRX
  const swapFeeBps = 25;
  const attestationTtl = new BN(3600);

  try {
    const tx = await treasuryProgram.methods
      .initialize(attestor, marketAuthority, grxPerThbcRate, swapFeeBps, attestationTtl)
      .accounts({
        treasury: treasuryPda,
        grxMint,
        thbcMint,
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

  // Rebate-pool vault (role-map.md fix #10): a FOURTH GRX vault, distinct from
  // swap/stake/reward, that slashed validator bonds land in instead of the yield-staker
  // reward_vault — a regulator / consumer-rebate fund, not a staker payout.
  try {
    const rebateTx = await treasuryProgram.methods
      .initializeRebateVault()
      .accounts({
        treasury: treasuryPda,
        grxMint,
        rebateVault,
        authority: authority.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log('✅ Rebate vault initialized:', rebateVault.toBase58(), 'TX:', rebateTx);
  } catch (e: any) {
    if (e.message?.includes('already in use')) {
      console.log('ℹ️  Rebate vault already initialized.');
    } else {
      console.error('❌ Rebate vault init error:', e.message);
      throw e;
    }
  }

  // Bind the registry's slash destination to the treasury rebate_vault (regulator /
  // consumer-rebate pool — role-map.md fix #10, was reward_vault/yield-stakers).
  // slash_validator refuses to send the bond anywhere else once this is set.
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('registry')],
    registryProgram.programId,
  );
  try {
    const slashTx = await registryProgram.methods
      .setSlashDestination(rebateVault)
      .accounts({
        registry: registryPda,
        authority: authority.publicKey,
      })
      .rpc();
    console.log('✅ Registry slash destination → treasury rebate_vault. TX:', slashTx);
  } catch (e: any) {
    console.error('⚠️  set_slash_destination failed (is registry initialized?):', e.message);
  }

  // Make baht-settlement recording MANDATORY for the THBC-denominated market: once
  // set, settle_offchain_match / batch_settle_offchain_match reject THBC settlements
  // that don't pass the treasury accounts (no silent skip of the settled-value counter).
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market')],
    tradingProgram.programId,
  );
  try {
    const policyTx = await tradingProgram.methods
      .setSettlementThbcMint(thbcMint)
      .accounts({
        market: marketPda,
        authority: authority.publicKey,
      })
      .rpc();
    console.log('✅ Market settlement THBC mint set (recording mandatory). TX:', policyTx);
  } catch (e: any) {
    console.error('⚠️  set_settlement_thbc_mint failed (is the market initialized & are you its authority?):', e.message);
  }

  // Create the 16 settlement accumulator shards + per-shard fee/wheeling/loss
  // collectors for the THBC settlement currency (§2c). The sharded batch-settle path
  // (batch_settle_offchain_match → record_settlement_sharded) writes BOTH per shard,
  // so both must exist before any sharded settle runs. Idempotent: each is gated by
  // `init`, so a re-run hits "already in use" per shard and is skipped. The unsharded
  // global path is unaffected — these are additive destinations.
  const NUM_SETTLE_SHARDS = 16;
  const shardedCollectorPda = (prefix: string, shardId: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from(prefix), thbcMint.toBuffer(), Buffer.from([shardId])],
      tradingProgram.programId,
    )[0];

  let shardsCreated = 0;
  let collectorsCreated = 0;
  for (let s = 0; s < NUM_SETTLE_SHARDS; s++) {
    const [settleShardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('settle_shard'), Buffer.from([s])],
      treasuryProgram.programId,
    );
    try {
      await treasuryProgram.methods
        .initializeSettlementShard(s)
        .accounts({
          treasury: treasuryPda,
          shard: settleShardPda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      shardsCreated++;
    } catch (e: any) {
      if (!e.message?.includes('already in use')) {
        console.error(`⚠️  initialize_settlement_shard(${s}) failed:`, e.message);
      }
    }
    try {
      await tradingProgram.methods
        .initializeShardedCollectors(s)
        .accounts({
          payer: authority.publicKey,
          currencyMint: thbcMint,
          feeCollector: shardedCollectorPda('fee_collector', s),
          wheelingCollector: shardedCollectorPda('wheeling_collector', s),
          lossCollector: shardedCollectorPda('loss_collector', s),
          marketAuthority,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      collectorsCreated++;
    } catch (e: any) {
      if (!e.message?.includes('already in use')) {
        console.error(`⚠️  initialize_sharded_collectors(${s}) failed:`, e.message);
      }
    }
  }
  console.log(
    `✅ Settlement shards ready (${shardsCreated}/${NUM_SETTLE_SHARDS} new, ` +
      `${collectorsCreated}/${NUM_SETTLE_SHARDS} collector sets new; rest pre-existing).`,
  );

  const t = await treasuryProgram.account.treasury.fetch(treasuryPda);
  console.log('\n📊 Treasury:');
  console.log('   authority         :', t.authority.toBase58());
  console.log('   attestor          :', t.attestor.toBase58());
  console.log('   settlementRecorder:', t.settlementRecorder.toBase58());
  console.log('   grxPerThbcRate    :', t.grxPerThbcRate.toString());
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
