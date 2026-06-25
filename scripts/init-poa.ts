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
  const [governanceConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('poa_config')],
    governanceProgram.programId
  );
  
  console.log('\nPDAs:');
  console.log('  PoA Config PDA:', governanceConfigPda.toBase58());
  
  // Initialize PoA Config
  console.log('\n🚀 Initializing PoA Config on-chain...');
  try {
    const tx = await governanceProgram.methods
      .initializeGovernance()
      .accounts({
        governanceConfig: governanceConfigPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log('✅ PoA Config initialized successfully!');
    console.log('   TX:', tx);
    console.log('   PoA Config PDA:', governanceConfigPda.toBase58());
    
    // Fetch the account
    const governanceConfig = await governanceProgram.account.governanceConfig.fetch(governanceConfigPda);
    console.log('\n📊 PoA Config Data:');
    console.log('   Authority:', governanceConfig.authority.toBase58());
    console.log('   Authority Name:', governanceConfig.authorityName);
    console.log('   Maintenance Mode:', governanceConfig.maintenanceMode);
    console.log('   ERC Validation:', governanceConfig.ercValidationEnabled);
    console.log('   Min Energy Amount:', governanceConfig.minEnergyAmount.toString());
    console.log('   Max ERC Amount:', governanceConfig.maxErcAmount.toString());
    console.log('   ERC Validity Period:', governanceConfig.ercValidityPeriod.toString(), 'seconds');
    console.log('   Total ERCs Issued:', governanceConfig.totalErcsIssued);
    console.log('   Total ERCs Validated:', governanceConfig.totalErcsValidated);
    console.log('   Total ERCs Revoked:', governanceConfig.totalErcsRevoked);
    console.log('   Total Energy Certified:', governanceConfig.totalEnergyCertified.toString());
    console.log('   Certificate Transfers:', governanceConfig.allowCertificateTransfers ? 'Allowed' : 'Blocked');
    console.log('   Version:', governanceConfig.version);
    
  } catch (e: any) {
    console.error('❌ Error:', e.message);
    if (e.message.includes('already in use')) {
      console.log('ℹ️  PoA Config already exists. Fetching...');
      const governanceConfig = await governanceProgram.account.governanceConfig.fetch(governanceConfigPda);
      console.log('   Authority:', governanceConfig.authority.toBase58());
      console.log('   Maintenance Mode:', governanceConfig.maintenanceMode);
      console.log('   ERC Validation:', governanceConfig.ercValidationEnabled);
    } else {
      throw e;
    }
  }
}

main().catch(console.error);
