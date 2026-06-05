import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Registry } from "../target/types/registry";
import { EnergyToken } from "../target/types/energy_token";
import { PublicKey, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction
} from "@solana/spl-token";
import * as fs from "fs";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const registryProgram = anchor.workspace.Registry as Program<Registry>;
  const energyTokenProgram = anchor.workspace.EnergyToken as Program<EnergyToken>;
  const authority = provider.wallet.publicKey;

  console.log("🚀 Registering test users (Prosumer, Consumer, Industrial)...");

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    registryProgram.programId
  );

  const [tokenInfoPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_info_2022")],
    energyTokenProgram.programId
  );

  const [mintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_2022")],
    energyTokenProgram.programId
  );

  const shardId = 0;
  const [shardPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry_shard"), Buffer.from([shardId])],
    registryProgram.programId
  );

  // Initialize shard if it doesn't exist
  try {
    const shardInfo = await provider.connection.getAccountInfo(shardPda);
    if (!shardInfo) {
      console.log(`\n🏗 Initializing Registry Shard ${shardId}...`);
      await registryProgram.methods
        .initializeShard(shardId)
        .accounts({
          shard: shardPda,
          authority: authority,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
      console.log(`   ✅ Shard ${shardId} initialized`);
    } else {
      console.log(`\nℹ️ Shard ${shardId} already initialized`);
    }
  } catch (e: any) {
    console.log(`   ℹ️ Shard initialization info: ${e.message}`);
  }

  const users = [
    { name: "Prosumer", type: { prosumer: {} } },
    { name: "Consumer", type: { consumer: {} } },
    { name: "Industrial", type: { consumer: {} } },
  ];

  for (const user of users) {
    const keypair = Keypair.generate();
    console.log(`\n👤 Registering ${user.name}...`);
    console.log(`   Public Key: ${keypair.publicKey.toBase58()}`);

    // Shard is bound in-program to the user's first key byte — derive + ensure inited.
    const userShardId = keypair.publicKey.toBytes()[0] % 16;
    const [userShardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry_shard"), Buffer.from([userShardId])],
      registryProgram.programId
    );
    try {
      await registryProgram.methods
        .initializeShard(userShardId)
        .accounts({ shard: userShardPda, authority, systemProgram: SystemProgram.programId } as any)
        .rpc();
    } catch (e) { /* already initialized */ }

    // Save keypair for future use
    fs.writeFileSync(`test-wallet-${user.name.toLowerCase()}.json`, JSON.stringify(Array.from(keypair.secretKey)));

    // Get user's ATA for airdrop
    const userAta = getAssociatedTokenAddressSync(
      mintPda,
      keypair.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    console.log(`   ATA: ${userAta.toBase58()}`);

    // Create ATA first
    try {
      const ataInfo = await provider.connection.getAccountInfo(userAta);
      if (!ataInfo) {
        console.log(`   Creating ATA...`);
        const tx = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            authority,
            userAta,
            keypair.publicKey,
            mintPda,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
        await provider.sendAndConfirm(tx);
        console.log(`   ✅ ATA created`);
      }
    } catch (e: any) {
      console.error(`   ❌ Failed to create ATA:`, e.message);
      continue;
    }

    const userPda = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), keypair.publicKey.toBuffer()],
      registryProgram.programId
    )[0];

    // Registration no longer mints the airdrop inline (a failed mint CPI would abort
    // it). register_user only creates the user record.
    try {
      await registryProgram.methods
        .registerUser(
          user.type as any,
          13000000, // Lat
          100000000, // Long
          new anchor.BN("89283082803ffff", 16), // H3 Index
          userShardId
        )
        .accounts({
          userAccount: userPda,
          registryShard: userShardPda,
          registry: registryPda,
          authority: keypair.publicKey,
          payer: authority,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      console.log(`   ✅ ${user.name} registered successfully!`);
    } catch (e: any) {
      console.error(`   ❌ Failed to register ${user.name}:`, e.message);
      continue;
    }

    // Claim the welcome airdrop in a separate, retryable transaction. Admin-signed
    // (payer is the registry authority); a mint failure here cannot roll back the
    // registration above.
    try {
      await registryProgram.methods
        .claimAirdrop()
        .accounts({
          userAccount: userPda,
          registry: registryPda,
          authority: keypair.publicKey,
          payer: authority,
          energyTokenProgram: energyTokenProgram.programId,
          mint: mintPda,
          userTokenAccount: userAta,
          tokenInfo: tokenInfoPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();

      console.log(`   🎁 ${user.name} airdrop claimed`);
    } catch (e: any) {
      console.error(`   ⚠️ Airdrop claim failed for ${user.name} (registration intact, retryable):`, e.message);
    }
  }

  console.log("\n✨ All users registered!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
