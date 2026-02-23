import * as anchor from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const registryProgram = anchor.workspace.Registry;
  
  // Fetch meter directly
  const meterPda = new PublicKey('5DXfCp5MM67GLHoamdqXHtAU5raXK1KixDWdYU5HBqfo');
  console.log('Fetching meter:', meterPda.toBase58());
  
  try {
    const meter = await registryProgram.account.meterAccount.fetch(meterPda);
    console.log('✅ METER FOUND:');
    console.log('   ID:', Buffer.from(meter.meterId).toString().replace(/\0/g, ''));
    console.log('   Owner:', meter.owner.toBase58());
    console.log('   Type:', Object.keys(meter.meterType)[0]);
    console.log('   Status:', Object.keys(meter.status)[0]);
    console.log('   Generation:', meter.totalGeneration.toString(), 'Wh');
    console.log('   Consumption:', meter.totalConsumption.toString(), 'Wh');
    console.log('   Settled Net Gen:', meter.settledNetGeneration.toString(), 'Wh');
    console.log('   Claimed ERC:', meter.claimedErcGeneration.toString(), 'Wh');
    console.log('   Last Reading:', new Date(meter.lastReadingAt.toNumber() * 1000).toISOString());
    console.log('   Registered:', new Date(meter.registeredAt.toNumber() * 1000).toISOString());
  } catch (e: any) {
    console.error('❌ Error:', e.message);
  }
}

main().catch(console.error);
