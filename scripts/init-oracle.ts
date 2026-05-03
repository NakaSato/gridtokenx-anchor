import * as anchor from '@anchor-lang/core';
import { PublicKey, SystemProgram } from '@solana/web3.js';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const oracleProgram = anchor.workspace.Oracle;
  const authority = provider.wallet;
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Initialize Oracle Program');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Authority:', authority.publicKey.toBase58());
  console.log('Oracle Program:', oracleProgram.programId.toBase58());
  
  // Derive Oracle Data PDA
  const [oracleDataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('oracle_data')],
    oracleProgram.programId
  );
  
  console.log('\nPDAs:');
  console.log('  Oracle Data PDA:', oracleDataPda.toBase58());
  
  // Initialize Oracle
  console.log('\n🚀 Initializing Oracle on-chain...');
  try {
    const tx = await oracleProgram.methods
      .initialize(authority.publicKey) // api_gateway = authority for now
      .accounts({
        oracleData: oracleDataPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log('✅ Oracle initialized successfully!');
    console.log('   TX:', tx);
    console.log('   Oracle Data PDA:', oracleDataPda.toBase58());
    
    // Fetch the account
    const oracleData = await oracleProgram.account.oracleData.fetch(oracleDataPda);
    console.log('\n📊 Oracle Data:');
    console.log('   Authority:', oracleData.authority.toBase58());
    console.log('   API Gateway:', oracleData.apiGateway.toBase58());
    console.log('   Active:', oracleData.active === 1 ? 'Yes' : 'No');
    console.log('   Total Readings:', oracleData.totalReadings.toString());
    console.log('   Anomaly Detection:', oracleData.anomalyDetectionEnabled === 1 ? 'Enabled' : 'Disabled');
    console.log('   Min Energy:', oracleData.minEnergyValue.toString());
    console.log('   Max Energy:', oracleData.maxEnergyValue.toString());
    console.log('   Max Deviation:', oracleData.maxReadingDeviationPercent + '%');
    console.log('   Quality Score:', oracleData.lastQualityScore + '/100');
    console.log('   Created At:', new Date(oracleData.createdAt.toNumber() * 1000).toISOString());
    
  } catch (e: any) {
    console.error('❌ Error:', e.message);
    if (e.message.includes('already in use')) {
      console.log('ℹ️  Oracle already initialized. Fetching...');
      const oracleData = await oracleProgram.account.oracleData.fetch(oracleDataPda);
      console.log('   Authority:', oracleData.authority.toBase58());
      console.log('   Active:', oracleData.active === 1 ? 'Yes' : 'No');
      console.log('   Total Readings:', oracleData.totalReadings.toString());
    } else {
      throw e;
    }
  }
}

main().catch(console.error);
