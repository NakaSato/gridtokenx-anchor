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

  // Create user account
  console.log('\n🚀 Creating user account on-chain...');
  try {
    const tx = await registryProgram.methods
      .registerUser(
        { prosumer: {} },  // UserType::Prosumer
        137563000,         // lat_e7: 13.7563°N (Bangkok)
        1005018000,        // long_e7: 100.5018°E
        new BN('8f28308280ddb13', 16)  // h3_index
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

    console.log('✅ User registered successfully!');
    console.log('   TX:', tx);
    console.log('   User PDA:', userPda.toBase58());

    // Fetch the account
    const userAccount = await registryProgram.account.userAccount.fetch(userPda);
    console.log('\n📊 User Account Data:');
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
