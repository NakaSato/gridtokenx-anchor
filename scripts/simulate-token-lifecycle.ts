import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Registry } from "../target/types/registry";
import { Oracle } from "../target/types/oracle";
import { EnergyToken } from "../target/types/energy_token";
import { Governance } from "../target/types/governance";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";

function findOracleDataPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("oracle_data")], programId);
}

function findMeterStatePda(meterId: string, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("meter"), Buffer.from(meterId)], programId);
}

function findMeterRegistryPda(meterId: string, owner: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("meter"), owner.toBuffer(), Buffer.from(meterId)], programId);
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const registryProgram = anchor.workspace.Registry as Program<Registry>;
  const oracleProgram = anchor.workspace.Oracle as Program<Oracle>;
  const energyTokenProgram = anchor.workspace.EnergyToken as Program<EnergyToken>;
  const governanceProgram = anchor.workspace.Governance as Program<Governance>;
  
  // Load users
  const prosumerKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("test-wallet-prosumer.json", "utf8"))));
  const apiGateway = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("test-api-gateway.json", "utf8"))));

  // Fund the prosumer with some SOL for fees and rent
  console.log(`\n💸 Funding prosumer (${prosumerKey.publicKey.toBase58().substring(0,8)}...) with SOL...`);
  try {
    const balance = await provider.connection.getBalance(prosumerKey.publicKey);
    if (balance < 0.02 * anchor.web3.LAMPORTS_PER_SOL) {
      const fundTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: prosumerKey.publicKey,
          lamports: 0.05 * anchor.web3.LAMPORTS_PER_SOL,
        })
      );
      await provider.sendAndConfirm(fundTx);
      console.log("   ✅ Prosumer funded successfully.");
    } else {
      console.log("   ℹ️ Prosumer already has sufficient balance.");
    }
  } catch (e: any) {
    console.error(`   ❌ Failed to fund prosumer: ${e.message}`);
  }

  const [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], registryProgram.programId);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("grx_vault")], registryProgram.programId);
  const [oracleDataPda] = findOracleDataPda(oracleProgram.programId);
  
  const [tokenInfoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], energyTokenProgram.programId);
  const [mintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], energyTokenProgram.programId);
  const [userAccountPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), prosumerKey.publicKey.toBuffer()], registryProgram.programId);

  const meterId = "METER_SOLAR_1";
  const [oracleMeterStatePda] = findMeterStatePda(meterId, oracleProgram.programId);
  const [registryMeterPda] = findMeterRegistryPda(meterId, prosumerKey.publicKey, registryProgram.programId);

  console.log("🪙  Starting Token Economics Lifecycle Simulation...");

  // 0. Register meter in the registry program
  console.log("\n📋 0. Registering meter in Registry...");
  // Meter shard is bound in-program to the owner's first key byte.
  const shardId = prosumerKey.publicKey.toBytes()[0] % 16;
  const [shardPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry_shard"), Buffer.from([shardId])],
    registryProgram.programId
  );
  try {
    await registryProgram.methods
      .registerMeter(meterId, { solar: {} }, shardId, 0)
      .accounts({
        meterAccount: registryMeterPda,
        userAccount: userAccountPda,
        registryShard: shardPda,
        registry: registryPda,
        owner: prosumerKey.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([prosumerKey])
      .rpc();
    console.log(`   ✅ Meter registered successfully in Registry.`);
  } catch (e: any) {
    if (e.message.includes("already in use")) {
      console.log("   ℹ️ Meter already registered in Registry.");
    } else {
      console.error(`   ❌ Failed to register meter: ${e.message}`);
    }
  }

  // 1. Submit some data to the oracle to generate an unsettled balance
  console.log("\n📡 1. Simulating Oracle data submission...");
  try {
    const timestamp = new BN(Math.floor(Date.now() / 1000));
    await oracleProgram.methods.submitMeterReading(meterId, new BN(12000), new BN(100), timestamp, 999)
      .accounts({
        oracleData: oracleDataPda,
        meterState: oracleMeterStatePda,
        authority: apiGateway.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([apiGateway])
      .rpc();
    console.log("   ✅ Oracle reading submitted (12000 kWh generated).");
  } catch (e: any) {
    console.log("   ⚠️ Oracle reading failed or already submitted.");
  }

  // 1b. Update meter reading in the Registry
  console.log("\n📋 1b. Updating meter reading in Registry...");
  try {
    await registryProgram.methods
      .updateMeterReading(
        new BN(12000), // energyGenerated (kWh)
        new BN(100), // energyConsumed (kWh)
        new BN(Math.floor(Date.now() / 1000))
      )
      .accounts({
        registry: registryPda,
        meterAccount: registryMeterPda,
        oracleAuthority: provider.wallet.publicKey,
      } as any)
      .rpc();
    console.log("   ✅ Registry meter reading updated to 12000 kWh generated.");
  } catch (e: any) {
    console.error(`   ❌ Failed to update registry meter reading: ${e.message}`);
  }

  // 2. Settlement
  console.log("\n🏦 2. Settling balance and minting GRX tokens...");
  let userAta: PublicKey;
  try {
    const ata = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as any).payer,
      mintPda,
      prosumerKey.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    userAta = ata.address;

    const balBefore = await provider.connection.getTokenAccountBalance(userAta);
    console.log(`   Balance before settlement: ${balBefore.value.uiAmount} GRX`);

    const tx = await registryProgram.methods.settleAndMintTokens()
      .accounts({
        registry: registryPda,
        meterAccount: registryMeterPda,
        userTokenAccount: userAta,
        mint: mintPda,
        meterOwner: prosumerKey.publicKey,
        recValidator: provider.wallet.publicKey, // Placeholder if no validators yet
        tokenInfo: tokenInfoPda,
        energyTokenProgram: energyTokenProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([prosumerKey])
      .rpc();
    console.log(`   ✅ Settlement successful. Tx: ${tx}`);

    const balAfter = await provider.connection.getTokenAccountBalance(userAta);
    console.log(`   Balance after settlement: ${balAfter.value.uiAmount} GRX`);
  } catch (e: any) {
    console.error("   ❌ Settlement failed:", e);
  }

  // 2b. Admin Minting GRX to prosumer for staking (since settlement amounts are small delta units)
  console.log("\n🪙  2b. Admin minting 20,000 GRX to prosumer for staking...");
  try {
    const mintAmount = new BN(20_000).mul(new BN(10).pow(new BN(9))); // 20,000 GRX with 9 decimals
    // REC provenance is mandatory (0.5): register the admin wallet as a REC validator first.
    try {
      await energyTokenProgram.methods.addRecValidator(provider.wallet.publicKey, "rec")
        .accounts({ tokenInfo: tokenInfoPda, authority: provider.wallet.publicKey } as any).rpc();
    } catch { /* already registered */ }
    const tx = await energyTokenProgram.methods.mintToWallet(mintAmount)
      .accounts({
        mint: mintPda,
        tokenInfo: tokenInfoPda,
        destination: userAta!,
        destinationOwner: prosumerKey.publicKey,
        authority: provider.wallet.publicKey,
        recValidator: provider.wallet.publicKey, // mandatory registered REC co-signer (0.5)
        payer: (provider.wallet as any).payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    console.log(`   ✅ Successfully minted 20,000 GRX. Tx: ${tx}`);
    const balAfterMint = await provider.connection.getTokenAccountBalance(userAta!);
    console.log(`   Balance after admin mint: ${balAfterMint.value.uiAmount} GRX`);
  } catch (e: any) {
    console.error(`   ❌ Admin minting failed: ${e.message}`);
  }

  // 3. Staking to become REC Validator
  console.log("\n🔐 3. Staking GRX into Global Vault to become Validator...");
  try {
    const stakeAmount = new BN(10_000_000_000_000); // 10,000 GRX
    
    await registryProgram.methods.stakeGrx(stakeAmount)
      .accounts({
        registry: registryPda,
        userAccount: userAccountPda,
        grxVault: vaultPda,
        userGrxAta: userAta!,
        grxMint: mintPda,
        authority: prosumerKey.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([prosumerKey])
      .rpc();
    console.log(`   ✅ Staked 10,000 GRX successfully.`);

    // register_validator now requires a governance-admitted aggregator entry (0.1). Admit the
    // prosumer (governance authority = provider wallet), then pass its AggregatorEntry PDA.
    const [governanceConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], governanceProgram.programId);
    const [aggregatorEntry] = PublicKey.findProgramAddressSync([Buffer.from("aggregator"), prosumerKey.publicKey.toBuffer()], governanceProgram.programId);
    try {
      await governanceProgram.methods.admitAggregator(prosumerKey.publicKey)
        .accounts({ governanceConfig: governanceConfigPda, aggregatorEntry, authority: provider.wallet.publicKey, systemProgram: SystemProgram.programId } as any)
        .rpc();
    } catch { /* already admitted */ }

    await registryProgram.methods.registerValidator()
      .accounts({
        userAccount: userAccountPda,
        aggregatorEntry,
        authority: prosumerKey.publicKey,
      } as any)
      .signers([prosumerKey])
      .rpc();
    console.log(`   ✅ User promoted to REC Validator status.`);
  } catch (e: any) {
    console.error(`   ❌ Staking/Validation failed: ${e.message}`);
  }

  console.log("\n✨ Token Lifecycle Simulation completed!");
}

// Start simulation
main().catch(err => {
  console.error(err);
  process.exit(1);
});
