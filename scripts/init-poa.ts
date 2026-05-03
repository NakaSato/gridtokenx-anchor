import * as anchor from '@anchor-lang/core';
import { PublicKey, SystemProgram } from '@solana/web3.js';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const governanceProgram = anchor.workspace.Governance;
  const authority = provider.wallet;
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Initialize PoA Config');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Authority:', authority.publicKey.toBase58());
  console.log('Governance Program:', governanceProgram.programId.toBase58());
  
  // Derive PoA Config PDA
  const [poaConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('poa_config')],
    governanceProgram.programId
  );
  
  console.log('\nPDAs:');
  console.log('  PoA Config PDA:', poaConfigPda.toBase58());
  
  // Initialize PoA Config
  console.log('\n🚀 Initializing PoA Config on-chain...');
  try {
    const tx = await governanceProgram.methods
      .initializePoa()
      .accounts({
        poaConfig: poaConfigPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log('✅ PoA Config initialized successfully!');
    console.log('   TX:', tx);
    console.log('   PoA Config PDA:', poaConfigPda.toBase58());
    
    // Fetch the account
    const poaConfig = await governanceProgram.account.poAConfig.fetch(poaConfigPda);
    console.log('\n📊 PoA Config Data:');
    console.log('   Authority:', poaConfig.authority.toBase58());
    console.log('   Authority Name:', poaConfig.authorityName);
    console.log('   Maintenance Mode:', poaConfig.maintenanceMode);
    console.log('   ERC Validation:', poaConfig.ercValidationEnabled);
    console.log('   Min Energy Amount:', poaConfig.minEnergyAmount.toString());
    console.log('   Max ERC Amount:', poaConfig.maxErcAmount.toString());
    console.log('   ERC Validity Period:', poaConfig.ercValidityPeriod.toString(), 'seconds');
    console.log('   Total ERCs Issued:', poaConfig.totalErcsIssued);
    console.log('   Total ERCs Validated:', poaConfig.totalErcsValidated);
    console.log('   Total ERCs Revoked:', poaConfig.totalErcsRevoked);
    console.log('   Total Energy Certified:', poaConfig.totalEnergyCertified.toString());
    console.log('   Certificate Transfers:', poaConfig.allowCertificateTransfers ? 'Allowed' : 'Blocked');
    console.log('   Version:', poaConfig.version);
    
  } catch (e: any) {
    console.error('❌ Error:', e.message);
    if (e.message.includes('already in use')) {
      console.log('ℹ️  PoA Config already exists. Fetching...');
      const poaConfig = await governanceProgram.account.poAConfig.fetch(poaConfigPda);
      console.log('   Authority:', poaConfig.authority.toBase58());
      console.log('   Maintenance Mode:', poaConfig.maintenanceMode);
      console.log('   ERC Validation:', poaConfig.ercValidationEnabled);
    } else {
      throw e;
    }
  }
}

main().catch(console.error);
