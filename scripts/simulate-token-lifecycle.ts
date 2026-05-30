import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Registry } from "../target/types/registry";
import { Oracle } from "../target/types/oracle";
import { EnergyToken } from "../target/types/energy_token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
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
  
  // Load users
  const prosumerKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("test-wallet-prosumer.json", "utf8"))));
  const apiGateway = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("test-api-gateway.json", "utf8"))));

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

  // 1. Submit some data to the oracle to generate an unsettled balance
  console.log("\n📡 1. Simulating Oracle data submission...");
  try {
    const timestamp = new BN(Math.floor(Date.now() / 1000));
    await oracleProgram.methods.submitMeterReading(meterId, new BN(5000), new BN(100), timestamp, 999)
      .accounts({
        oracleData: oracleDataPda,
        meterState: oracleMeterStatePda,
        authority: apiGateway.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([apiGateway])
      .rpc();
    console.log("   ✅ Oracle reading submitted (5000 kWh generated).");
  } catch (e: any) {
    console.log("   ⚠️ Oracle reading failed or already submitted.");
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
      TOKEN_2022_PROGRAM_ID
    );
    userAta = ata.address;

    await registryProgram.methods.settleAndMintTokens(meterId)
      .accounts({
        registry: registryPda,
        meterAccount: registryMeterPda,
        oracleMeterState: oracleMeterStatePda,
        userCurrencyAccount: userAta,
        currencyMint: mintPda,
        owner: prosumerKey.publicKey,
        recValidator: provider.wallet.publicKey, // Placeholder if no validators yet
        tokenInfo: tokenInfoPda,
        energyTokenProgram: energyTokenProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .signers([prosumerKey])
      .rpc();
    console.log(`   ✅ Settlement successful. GRX minted to ${userAta.toBase58().substring(0,8)}...`);
  } catch (e: any) {
    console.error(`   ❌ Settlement failed: ${e.message}`);
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
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .signers([prosumerKey])
      .rpc();
    console.log(`   ✅ Staked 10,000 GRX successfully.`);

    await registryProgram.methods.registerValidator()
      .accounts({
        userAccount: userAccountPda,
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

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
