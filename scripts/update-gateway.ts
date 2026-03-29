import * as anchor from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const oracleProgram = anchor.workspace.Oracle;
  const authority = provider.wallet;
  
  const newGateway = new PublicKey('7rdNNcszvgNcYqQezZicnFHZ9kxyPcSpFCnRNB52meHK');
  
  // Derive Oracle Data PDA
  const [oracleDataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('oracle_data')],
    oracleProgram.programId
  );
  
  console.log('Updating Oracle API Gateway to:', newGateway.toBase58());
  
  try {
    const tx = await oracleProgram.methods
      .updateApiGateway(newGateway)
      .accounts({
        oracleData: oracleDataPda,
        authority: authority.publicKey,
      })
      .rpc();
    
    console.log('✅ API Gateway updated successfully!');
    console.log('   TX:', tx);
    
    // Verify
    const oracleData = await oracleProgram.account.oracleData.fetch(oracleDataPda);
    console.log('   New API Gateway:', oracleData.apiGateway.toBase58());
  } catch (e: any) {
    console.error('❌ Error:', e.message);
  }
}

main().catch(console.error);
