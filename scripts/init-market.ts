import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const tradingProgram = anchor.workspace.Trading;
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
  
  console.log('\nPDAs:');
  console.log('  Market PDA:', marketPda.toBase58());
  
  // Initialize Market
  console.log('\n🚀 Initializing Trading Market on-chain...');
  try {
    const tx = await tradingProgram.methods
      .initializeMarket()
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
}

main().catch(console.error);
