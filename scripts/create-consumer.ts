import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import BN from 'bn.js';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const registryProgram = anchor.workspace.Registry;
  const energyTokenProgram = anchor.workspace.EnergyToken;
  const authority = provider.wallet;
  
  console.log('Creating CONSUMER user...');
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
  
  // Energy token accounts for airdrop
  const [tokenInfo] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_info_2022')],
    energyTokenProgram.programId
  );
  
  const [mintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint_2022')],
    energyTokenProgram.programId
  );
  
  const userTokenAccount = getAssociatedTokenAddressSync(
    mintPda,
    authority.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  console.log('\nPDAs:');
  console.log('  Registry PDA:', registryPda.toBase58());
  console.log('  User PDA:', userPda.toBase58());
  console.log('  Token Info:', tokenInfo.toBase58());
  console.log('  Mint:', mintPda.toBase58());
  console.log('  User Token Account:', userTokenAccount.toBase58());
  
  // Create user account as CONSUMER in Chiang Mai
  console.log('\n🚀 Creating CONSUMER user account on-chain...');
  console.log('   Location: Chiang Mai, Thailand (18.7883°N, 98.9853°E)');
  try {
    const tx = await registryProgram.methods
      .registerUser(
        { consumer: {} },   // UserType::Consumer (can only consume, not produce)
        187883000,          // lat_e7: 18.7883°N (Chiang Mai)
        989853000,          // long_e7: 98.9853°E
        new BN('8f09e854dcb4d09', 16)  // h3_index for Chiang Mai
      )
      .accounts({
        userAccount: userPda,
        registry: registryPda,
        authority: authority.publicKey,
        energyTokenProgram: PublicKey.default, // Skip airdrop
        mint: mintPda,
        tokenInfo: tokenInfo,
        userTokenAccount: userTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log('✅ Consumer user registered successfully!');
    console.log('   TX:', tx);
    console.log('   User PDA:', userPda.toBase58());
    
    // Fetch the account
    const userAccount = await registryProgram.account.userAccount.fetch(userPda);
    console.log('\n📊 Consumer User Account Data:');
    console.log('   Authority:', userAccount.authority.toBase58());
    console.log('   User Type:', Object.keys(userAccount.userType)[0]);
    console.log('   Location:', userAccount.latE7 / 1e7, ',', userAccount.longE7 / 1e7);
    console.log('   Status:', Object.keys(userAccount.status)[0]);
    console.log('   Meter Count:', userAccount.meterCount);
    console.log('   Registered At:', new Date(userAccount.registeredAt.toNumber() * 1000).toISOString());
    
  } catch (e: any) {
    console.error('❌ Error:', e.message);
    if (e.message.includes('already in use')) {
      console.log('ℹ️  User account already exists. Fetching...');
      const userAccount = await registryProgram.account.userAccount.fetch(userPda);
      console.log('   User Type:', Object.keys(userAccount.userType)[0]);
      console.log('   Status:', Object.keys(userAccount.status)[0]);
    } else {
      throw e;
    }
  }
}

main().catch(console.error);
