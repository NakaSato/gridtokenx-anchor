import * as anchor from '@anchor-lang/core';
import { PublicKey, SystemProgram } from '@solana/web3.js';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const tradingProgram = anchor.workspace.Trading;
  const energyTokenProgram = anchor.workspace.EnergyToken;
  const authority = provider.wallet;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Initialize Trading Market');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Authority:', authority.publicKey.toBase58());
  console.log('Trading Program:', tradingProgram.programId.toBase58());
  
  // Derive Market PDA
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market')],
    tradingProgram.programId
  );
  // The energy mint is a PDA of the energy-token program, so it needs no config or
  // keypair file — the same derivation bootstrap.ts and fund-platform-sources.ts use.
  const [energyMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint_2022')],
    energyTokenProgram.programId
  );

  console.log('\nPDAs:');
  console.log('  Market PDA:', marketPda.toBase58());
  console.log('  Energy Mint PDA:', energyMintPda.toBase58());

  // Initialize Market
  console.log('\n🚀 Initializing Trading Market on-chain...');
  try {
    const tx = await tradingProgram.methods
      .initializeMarket(16)
      .accounts({
        market: marketPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log('✅ Market initialized successfully!');
    console.log('   TX:', tx);
    console.log('   Market PDA:', marketPda.toBase58());
    
    // Fetch the account
    const market = await tradingProgram.account.market.fetch(marketPda);
    console.log('\n📊 Market Data:');
    console.log('   Authority:', market.authority.toBase58());
    console.log('   Active Orders:', market.activeOrders);
    console.log('   Total Volume:', market.totalVolume.toString());
    console.log('   Total Trades:', market.totalTrades);
    console.log('   Clearing Enabled:', market.clearingEnabled === 1 ? 'Yes' : 'No');
    console.log('   Market Fee (bps):', market.marketFeeBps);
    console.log('   Created At:', new Date(market.createdAt.toNumber() * 1000).toISOString());
    
  } catch (e: any) {
    console.error('❌ Error:', e.message);
    if (e.message.includes('already in use')) {
      console.log('ℹ️  Market already initialized. Fetching...');
      const market = await tradingProgram.account.market.fetch(marketPda);
      console.log('   Authority:', market.authority.toBase58());
      console.log('   Active Orders:', market.activeOrders);
      console.log('   Clearing Enabled:', market.clearingEnabled === 1 ? 'Yes' : 'No');
    } else {
      throw e;
    }
  }

  // Pin the energy mint this market may BURN on settlement. Runs whether the market was
  // just created or already existed — a market initialized before this instruction
  // existed reads has_settlement_energy_mint = 0, which is exactly the state that must be
  // repaired, so skipping it on the "already initialized" branch would miss every market
  // that needs it most.
  //
  // Settlement fails CLOSED without it (SettlementEnergyMintUnset): orders still place
  // and match, but nothing settles. See programs/trading/src/instructions/
  // set_settlement_energy_mint.rs for why the mint cannot be trusted from the caller.
  console.log('\n🔒 Pinning settlement energy mint...');
  try {
    const tx = await tradingProgram.methods
      .setSettlementEnergyMint(energyMintPda)
      .accounts({
        market: marketPda,
        authority: authority.publicKey,
      })
      .rpc();
    console.log('✅ Settlement energy mint pinned:', energyMintPda.toBase58());
    console.log('   TX:', tx);
  } catch (e: any) {
    console.error('❌ set_settlement_energy_mint failed — settlement will revert with');
    console.error('   SettlementEnergyMintUnset until this succeeds:', e.message);
    throw e;
  }
}

main().catch(console.error);
