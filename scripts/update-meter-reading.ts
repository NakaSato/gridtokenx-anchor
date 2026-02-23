import * as anchor from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const registryProgram = anchor.workspace.Registry;
  const authority = provider.wallet;
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Meter Reading Update Flow');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Authority (Oracle/Gateway):', authority.publicKey.toBase58());
  console.log('Registry Program:', registryProgram.programId.toBase58());
  
  // Use the dev wallet as the oracle authority (as configured in test-meter-to-blockchain.ts)
  const oracleAuthority = authority;
  
  // Derive PDAs
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('registry')],
    registryProgram.programId
  );
  
  // Use the meter we just created
  const owner = authority.publicKey;
  const meterId = 'METER-001-TEST';
  
  const [meterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('meter'), owner.toBuffer(), Buffer.from(meterId)],
    registryProgram.programId
  );
  
  console.log('\nPDAs:');
  console.log('  Registry PDA:', registryPda.toBase58());
  console.log('  Meter PDA:', meterPda.toBase58());
  console.log('  Meter ID:', meterId);
  
  // First, check current meter state
  console.log('\n📊 Current Meter State:');
  try {
    const meterBefore = await registryProgram.account.meterAccount.fetch(meterPda);
    console.log('   Generation:', meterBefore.totalGeneration.toString());
    console.log('   Consumption:', meterBefore.totalConsumption.toString());
    console.log('   Last Reading:', new Date(meterBefore.lastReadingAt.toNumber() * 1000).toISOString());
  } catch (e: any) {
    console.log('   (Could not fetch meter state)');
  }
  
  // Simulate meter reading
  const reading = {
    energyGenerated: 5000,  // 5.00 kWh generated (in Wh)
    energyConsumed: 2300,   // 2.30 kWh consumed (in Wh)
    timestamp: Math.floor(Date.now() / 1000),
  };
  
  console.log('\n📡 Submitting Meter Reading...');
  console.log('   Energy Generated:', reading.energyGenerated, 'Wh (', (reading.energyGenerated / 1000).toFixed(2), 'kWh)');
  console.log('   Energy Consumed:', reading.energyConsumed, 'Wh (', (reading.energyConsumed / 1000).toFixed(2), 'kWh)');
  console.log('   Net Energy:', reading.energyGenerated - reading.energyConsumed, 'Wh');
  console.log('   Timestamp:', new Date(reading.timestamp * 1000).toISOString());
  
  try {
    // First set oracle authority if not already set
    console.log('\n[Step 1] Checking Oracle Authority...');
    const registry = await registryProgram.account.registry.fetch(registryPda);
    
    if (registry.hasOracleAuthority === 0) {
      console.log('   Oracle not configured. Setting oracle authority...');
      const setOracleTx = await registryProgram.methods
        .setOracleAuthority(oracleAuthority.publicKey)
        .accounts({
          registry: registryPda,
          authority: authority.publicKey,
        })
        .rpc();
      console.log('   ✅ Oracle authority set. TX:', setOracleTx.slice(0, 20) + '...');
    } else {
      console.log('   ℹ️  Oracle already configured:', registry.oracleAuthority.toBase58().slice(0, 20) + '...');
    }
    
    // Submit meter reading
    console.log('\n[Step 2] Submitting meter reading...');
    const tx = await registryProgram.methods
      .updateMeterReading(
        new BN(reading.energyGenerated),
        new BN(reading.energyConsumed),
        new BN(reading.timestamp)
      )
      .accounts({
        registry: registryPda,
        meterAccount: meterPda,
        oracleAuthority: oracleAuthority.publicKey,
      })
      .rpc();
    
    console.log('   ✅ Meter reading submitted!');
    console.log('   TX:', tx);
    
    // Verify updated meter state
    console.log('\n[Step 3] Verifying Updated Meter State:');
    const meterAfter = await registryProgram.account.meterAccount.fetch(meterPda);
    console.log('   Generation:', meterAfter.totalGeneration.toString(), 'Wh');
    console.log('   Consumption:', meterAfter.totalConsumption.toString(), 'Wh');
    console.log('   Net Generation:', (meterAfter.totalGeneration.toNumber() - meterAfter.totalConsumption.toNumber()), 'Wh');
    console.log('   Last Reading:', new Date(meterAfter.lastReadingAt.toNumber() * 1000).toISOString());
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  ✅ Meter Reading Update Complete!');
    console.log('═══════════════════════════════════════════════════════════════');
    
  } catch (e: any) {
    console.error('\n❌ Error:', e.message);
    if (e.logs) {
      console.error('\nProgram Logs:');
      e.logs.forEach((log: string) => console.error('  ', log));
    }
  }
}

main().catch(console.error);
