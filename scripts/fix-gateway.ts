import * as anchor from '@anchor-lang/core';
import { PublicKey, SystemProgram } from '@solana/web3.js';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const oracleProgram = anchor.workspace.Oracle;
  const authority = provider.wallet;
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Fix Oracle API Gateway');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Authority (Signer):', authority.publicKey.toBase58());
  
  // Target Gateway: 7rdNNcszvgNcYqQezZicnFHZ9kxyPcSpFCnRNB52meHK
  const targetGateway = new PublicKey('7rdNNcszvgNcYqQezZicnFHZ9kxyPcSpFCnRNB52meHK');
  console.log('Target API Gateway:', targetGateway.toBase58());

  // Derive Oracle Data PDA
  const [oracleDataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('oracle_data')],
    oracleProgram.programId
  );
  
  try {
    console.log('\n🚀 Calling updateApiGateway...');
    const tx = await oracleProgram.methods
      .updateApiGateway(targetGateway)
      .accounts({
        oracleData: oracleDataPda,
        authority: authority.publicKey,
      })
      .rpc();
    
    console.log('✅ API Gateway updated successfully!');
    console.log('   TX:', tx);
    
    // Verify
    const oracleData = await oracleProgram.account.oracleData.fetch(oracleDataPda);
    console.log('\n📊 Updated Oracle Data:');
    console.log('   Authority:', oracleData.authority.toBase58());
    console.log('   API Gateway:', oracleData.apiGateway.toBase58());
    
  } catch (e: any) {
    console.error('❌ Error:', e.message);
    if (e.logs) {
        console.log('Logs:', e.logs);
    }
    process.exit(1);
  }
}

main().catch(console.error);
