import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import BN from 'bn.js';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const registryProgram = anchor.workspace.Registry;
  const energyTokenProgram = anchor.workspace.EnergyToken;
  const tradingProgram = anchor.workspace.Trading;
  const governanceProgram = anchor.workspace.Governance;
  const oracleProgram = anchor.workspace.Oracle;

  const authority = provider.wallet.publicKey;
  console.log('Authority:', authority.toBase58());

  // Airdrop SOL to authority if needed to pay for transaction fees
  try {
    const balance = await provider.connection.getBalance(authority);
    if (balance < 1 * anchor.web3.LAMPORTS_PER_SOL) {
      console.log('  Funding authority with airdrop...');
      const signature = await provider.connection.requestAirdrop(
        authority,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      const latestBlockHash = await provider.connection.getLatestBlockhash();
      await provider.connection.confirmTransaction({
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
        signature: signature,
      });
      console.log('  ✅ Authority funded');
    }
  } catch (e: any) {
    console.log('  ⚠️  Airdrop failed (might be on a network without airdrop), continuing...');
  }

  // 1. Initialize Registry
  console.log('\n[1/5] Initializing Global Registry...');
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('registry')],
    registryProgram.programId
  );
  try {
    const tx = await registryProgram.methods
      .initialize()
      .accounts({
        registry: registryPda,
        authority: authority,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log('  ✅ Registry initialized:', registryPda.toBase58());
  } catch (e: any) {
    console.log('  ℹ️  Registry already exists or failed:', e.message);
  }

  // 2. Initialize Energy Token
  console.log('\n[2/5] Initializing Energy Token Mint...');
  const [tokenInfoPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_info_2022')],
    energyTokenProgram.programId
  );
  const [mintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint_2022')],
    energyTokenProgram.programId
  );
  try {
    const tx = await energyTokenProgram.methods
      .initializeToken(registryProgram.programId, authority)
      .accounts({
        tokenInfo: tokenInfoPda,
        mint: mintPda,
        authority: authority,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), // Try standard Token Program
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    console.log('  ✅ Energy Token initialized');
    console.log('     Mint PDA:', mintPda.toBase58());
  } catch (e: any) {
    if (e.message.includes('InvalidProgramId') || e.message.includes('Program ID was not as expected')) {
       console.log('  ⚠️  Token-2022 might be required or standard Token failed. Attempting with Token-2022...');
       try {
         const tx = await energyTokenProgram.methods
          .initializeToken(registryProgram.programId, authority)
          .accounts({
            tokenInfo: tokenInfoPda,
            mint: mintPda,
            authority: authority,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'), // Standard Token-2022
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .rpc();
          console.log('  ✅ Energy Token initialized with Token-2022');
       } catch (e2: any) {
          console.log('  ℹ️  Energy Token already exists or failed:', e2.message);
       }
    } else {
      console.log('  ℹ️  Energy Token already exists or failed:', e.message);
    }
  }

  // 3. Initialize Governance (PoA)
  console.log('\n[3/5] Initializing Governance PoA...');
  const [poaConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('poa_config')],
    governanceProgram.programId
  );
  try {
    const tx = await governanceProgram.methods
      .initializePoa()
      .accounts({
        poaConfig: poaConfigPda,
        authority: authority,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log('  ✅ PoA Config initialized:', poaConfigPda.toBase58());
  } catch (e: any) {
    console.log('  ℹ️  PoA Config already exists or failed:', e.message);
  }

  // 4. Initialize Trading Market
  console.log('\n[4/5] Initializing Trading Market...');
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market')],
    tradingProgram.programId
  );
  try {
    const tx = await tradingProgram.methods
      .initializeMarket(10) // num_shards = 10
      .accounts({
        market: marketPda,
        authority: authority,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log('  ✅ Market initialized:', marketPda.toBase58());
  } catch (e: any) {
    console.log('  ℹ️  Market already exists or failed:', e.message);
  }

  // 4b. Initialize Zones 1, 2, 3
  for (const zoneId of [1, 2, 3]) {
    console.log(`  Initializing Zone ${zoneId} Market...`);
    const [zoneMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('zone_market'), marketPda.toBuffer(), new BN(zoneId).toArrayLike(Buffer, 'le', 4)],
      tradingProgram.programId
    );
    console.log(`     Zone ${zoneId} PDA: ${zoneMarketPda.toBase58()}`);
    try {
      const tx = await tradingProgram.methods
        .initializeZoneMarket(zoneId, 1) // 1 shard per zone
        .accounts({
          market: marketPda,
          zoneMarket: zoneMarketPda,
          authority: authority,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      console.log(`  ✅ Zone ${zoneId} Market initialized`);
    } catch (e: any) {
      console.log(`  ℹ️  Zone ${zoneId} Market already exists or failed:`, e.message);
    }
  }

  // 5. Initialize Oracle
  console.log('\n[5/5] Initializing Oracle Config...');
  const [oracleDataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('oracle_data')],
    oracleProgram.programId
  );
  try {
    const tx = await oracleProgram.methods
      .initialize(authority) // api_gateway = authority for now
      .accounts({
        oracleData: oracleDataPda,
        authority: authority,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log('  ✅ Oracle initialized:', oracleDataPda.toBase58());
  } catch (e: any) {
    console.log('  ℹ️  Oracle already exists or failed:', e.message);
  }

  console.log('\n🚀 Blockchain bootstrap completed successfully!');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('\n❌ Bootstrap failed:', err);
  process.exit(1);
});
