import * as anchor from '@anchor-lang/core';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import BN from 'bn.js';
import * as fs from 'fs';
import { MINT_SIZE, TOKEN_PROGRAM_ID } from '@solana/spl-token';

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
  
  const vaultAuthority = new PublicKey("2ndDBhSWDXPAsgvkVVzsNJLfAAX9mKZkU9z5JaeSkQE4");

  try {
    const tx = await energyTokenProgram.methods
      .initializeToken(registryProgram.programId, registryPda)
      .accounts({
        tokenInfo: tokenInfoPda,
        mint: mintPda,
        authority: authority, // Local wallet signs for initialization
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .rpc();
    
    // Ensure registry_authority is set to Registry PDA (not Vault)
    console.log('  Setting Energy Token Registry Authority to Registry PDA...');
    await energyTokenProgram.methods.setRegistryAuthority(registryPda)
      .accounts({
        tokenInfo: tokenInfoPda,
        authority: authority,
      } as any).rpc();

    console.log('  ✅ Energy Token initialized with Registry PDA as authority');
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
            tokenProgram: new PublicKey('TokenzQdBNbLqP5VEhdkThp9Dz9L33itf29V7D3fR65'), // Standard Token-2022
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

  // 2b. Initialize Currency Token (for payments)
  console.log('\n[2b/5] Initializing Currency Token Mint...');
  
  // Load or generate currency mint keypair
  let currencyMintKeypair: anchor.web3.Keypair;
  try {
    const rawData = fs.readFileSync('currency-mint.json', 'utf8');
    currencyMintKeypair = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(rawData)));
    console.log('  ℹ️  Loaded existing currency mint:', currencyMintKeypair.publicKey.toBase58());
  } catch (e) {
    currencyMintKeypair = anchor.web3.Keypair.generate();
    fs.writeFileSync('currency-mint.json', JSON.stringify(Array.from(currencyMintKeypair.secretKey)));
    console.log('  ℹ️  Generated new currency mint:', currencyMintKeypair.publicKey.toBase58());
  }

  try {
    const mintInfo = await provider.connection.getAccountInfo(currencyMintKeypair.publicKey);
    if (!mintInfo) {
      console.log('  Initializing Currency Token as standard SPL Mint...');
      const lamports = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
      
      const transaction = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: authority,
          newAccountPubkey: currencyMintKeypair.publicKey,
          space: MINT_SIZE,
          lamports,
          programId: TOKEN_PROGRAM_ID,
        }),
        // Initialize mint instruction — using raw instruction to avoid extra dependencies if possible
        {
          keys: [
            { pubkey: currencyMintKeypair.publicKey, isSigner: false, isWritable: true },
            { pubkey: anchor.web3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          ],
          programId: TOKEN_PROGRAM_ID,
          data: Buffer.from([
            0, // InitializeMint instruction index
            6, // decimals (standard for currency like USDC)
            ...authority.toBuffer(),
            1, // hasFreezeAuthority
            ...authority.toBuffer(),
          ]),
        }
      );

      await provider.sendAndConfirm(transaction, [currencyMintKeypair]);
      console.log('  ✅ Currency Token initialized:', currencyMintKeypair.publicKey.toBase58());
    } else {
      console.log('  ℹ️  Currency Token already exists:', currencyMintKeypair.publicKey.toBase58());
    }
  } catch (e: any) {
    console.log('  ❌ Currency Token initialization failed:', e.message);
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
  console.log('     Market PDA:', marketPda.toBase58());
  try {
    const tx = await tradingProgram.methods
      .initializeMarket(4) // 4 shards
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

  // 4b. Initialize Zones 0, 1, 2, 3
  for (const zoneId of [0, 1, 2, 3, 7583, 7584, 7585, 7586, 7587, 7588]) {
    console.log(`  Initializing Zone ${zoneId} Market...`);
    const [zoneMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('zone_market'), marketPda.toBuffer(), new BN(zoneId).toArrayLike(Buffer, 'le', 4)],
      tradingProgram.programId
    );
    console.log(`     Zone ${zoneId} PDA: ${zoneMarketPda.toBase58()}`); // Log zoneMarketPda unconditionally
    try {
      const tx = await tradingProgram.methods
        .initializeZoneMarket(zoneId, 1, new BN(0)) // 1 shard per zone, 0 capacity (infinite)
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
  
  // Allow overriding the API Gateway address for the Oracle
  const apiGatewayStr = process.env.ORACLE_API_GATEWAY || authority.toBase58();
  const apiGateway = new PublicKey(apiGatewayStr);
  console.log('  Authorized API Gateway:', apiGateway.toBase58());

  try {
    const tx = await oracleProgram.methods
      .initialize(apiGateway)
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
