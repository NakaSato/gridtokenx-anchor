import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const registryProgram = anchor.workspace.Registry;
  const authority = provider.wallet;
  
  console.log('Authority:', authority.publicKey.toBase58());
  console.log('Registry Program:', registryProgram.programId.toBase58());
  
  // Derive PDAs
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('registry')],
    registryProgram.programId
  );
  
  const [userPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('user'), authority.publicKey.toBuffer()],
    registryProgram.programId
  );
  
  // Meter ID (max 32 bytes)
  const meterId = 'METER-001-TEST';
  
  const [meterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('meter'), authority.publicKey.toBuffer(), Buffer.from(meterId)],
    registryProgram.programId
  );
  
  console.log('\nPDAs:');
  console.log('  Registry PDA:', registryPda.toBase58());
  console.log('  User PDA:', userPda.toBase58());
  console.log('  Meter PDA:', meterPda.toBase58());
  console.log('  Meter ID:', meterId);
  
  // Create meter account
  console.log('\n🚀 Creating meter account on-chain...');
  try {
    const tx = await registryProgram.methods
      .registerMeter(
        meterId,           // meter_id: String
        { solar: {} }     // meter_type: MeterType::Solar
      )
      .accounts({
        meterAccount: meterPda,
        userAccount: userPda,
        registry: registryPda,
        owner: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log('✅ Meter registered successfully!');
    console.log('   TX:', tx);
    console.log('   Meter PDA:', meterPda.toBase58());
    
    // Fetch the account
    const meterAccount = await registryProgram.account.meterAccount.fetch(meterPda);
    console.log('\n📊 Meter Account Data:');
    console.log('   ID:', Buffer.from(meterAccount.meterId).toString().replace(/\0/g, ''));
    console.log('   Owner:', meterAccount.owner.toBase58());
    console.log('   Type:', Object.keys(meterAccount.meterType)[0]);
    console.log('   Status:', Object.keys(meterAccount.status)[0]);
    console.log('   Generation:', meterAccount.totalGeneration.toString());
    console.log('   Consumption:', meterAccount.totalConsumption.toString());
    console.log('   Settled Net Gen:', meterAccount.settledNetGeneration.toString());
    console.log('   Registered At:', new Date(meterAccount.registeredAt.toNumber() * 1000).toISOString());
    
  } catch (e: any) {
    console.error('❌ Error:', e.message);
    if (e.message.includes('already in use')) {
      console.log('ℹ️  Meter account already exists. Fetching...');
      const meterAccount = await registryProgram.account.meterAccount.fetch(meterPda);
      console.log('   ID:', Buffer.from(meterAccount.meterId).toString().replace(/\0/g, ''));
      console.log('   Type:', Object.keys(meterAccount.meterType)[0]);
      console.log('   Status:', Object.keys(meterAccount.status)[0]);
    } else {
      throw e;
    }
  }
}

main().catch(console.error);
