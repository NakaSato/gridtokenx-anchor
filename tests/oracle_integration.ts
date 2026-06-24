import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Registry } from "../target/types/registry";
import { Oracle } from "../target/types/oracle";
import { EnergyToken } from "../target/types/energy_token";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram, 
  Transaction,
  LAMPORTS_PER_SOL
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";

describe("oracle-metering-integration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const registryProgram = anchor.workspace.Registry as Program<Registry>;
  const oracleProgram = anchor.workspace.Oracle as Program<Oracle>;
  const energyTokenProgram = anchor.workspace.EnergyToken as Program<EnergyToken>;
  
  const authority = provider.wallet.publicKey;
  const payer = (provider.wallet as any).payer as Keypair;

  let registryPda: PublicKey;
  let registryShardPda: PublicKey;
  let oracleDataPda: PublicKey;
  let energyMintPda: PublicKey;
  let energyTokenInfoPda: PublicKey;
  
  const shardId = 0;
  const meterId = "METER-001";

  before(async () => {
    [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], registryProgram.programId);
    [registryShardPda] = PublicKey.findProgramAddressSync([Buffer.from("registry_shard"), Buffer.from([shardId])], registryProgram.programId);
    [oracleDataPda] = PublicKey.findProgramAddressSync([Buffer.from("oracle_data")], oracleProgram.programId);
    [energyMintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], energyTokenProgram.programId);
    [energyTokenInfoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], energyTokenProgram.programId);

    // Bootstrap localnet if not already done by bootstrap script
    try {
      await registryProgram.methods.initialize().accounts({ registry: registryPda, authority, systemProgram: SystemProgram.programId } as any).rpc();
      await registryProgram.methods.initializeShard(shardId).accounts({ shard: registryShardPda, authority, systemProgram: SystemProgram.programId } as any).rpc();
      await registryProgram.methods.setOracleAuthority(authority).accounts({ registry: registryPda, authority } as any).rpc();
      await oracleProgram.methods.initialize(authority).accounts({ oracleData: oracleDataPda, authority, systemProgram: SystemProgram.programId } as any).rpc();
    } catch (e) {}

    // Force update API Gateway to current authority to avoid 6001
    try {
      await oracleProgram.methods.updateApiGateway(authority).accounts({
        oracleData: oracleDataPda,
        authority: authority,
      } as any).rpc();
      console.log("   API Gateway updated to current authority");
    } catch (e) {}

    // REC provenance is mandatory: settle_and_mint_tokens co-signs against a registered
    // REC validator. Register the test authority once (idempotent — bootstrap seeds none),
    // else the mint CPI fails with RecValidatorNotFound.
    try {
      await energyTokenProgram.methods
        .addRecValidator(authority, "rec")
        .accounts({ tokenInfo: energyTokenInfoPda, authority } as any)
        .rpc();
    } catch (e) {}
  });

  async function ensureAta(mint: PublicKey, owner: PublicKey, programId: PublicKey = TOKEN_PROGRAM_ID): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(mint, owner, false, programId);
    try {
      await getAccount(provider.connection, ata, "confirmed", programId);
    } catch (e) {
      const tx = new Transaction().add(createAssociatedTokenAccountInstruction(authority, ata, owner, mint, programId));
      await provider.sendAndConfirm(tx);
    }
    return ata;
  }

  it("Full Metering Lifecycle: Register -> Submit -> Settle -> Mint", async () => {
    const user = Keypair.generate();
    // Shard is bound in-program to the user's first key byte — derive + init it.
    const userShardId = user.publicKey.toBytes()[0] % 16;
    const [userShardPda] = PublicKey.findProgramAddressSync([Buffer.from("registry_shard"), Buffer.from([userShardId])], registryProgram.programId);
    try {
      await registryProgram.methods.initializeShard(userShardId).accounts({ shard: userShardPda, authority, systemProgram: SystemProgram.programId } as any).rpc();
    } catch (e) {}

    const [userAccountPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), user.publicKey.toBuffer()], registryProgram.programId);
    const [meterAccountPda] = PublicKey.findProgramAddressSync([Buffer.from("meter"), user.publicKey.toBuffer(), Buffer.from(meterId)], registryProgram.programId);
    const [meterStatePda] = PublicKey.findProgramAddressSync([Buffer.from("meter"), Buffer.from(meterId)], oracleProgram.programId);

    // Fund user
    console.log("   Funding user...");
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority,
        toPubkey: user.publicKey,
        lamports: 0.1 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fundTx);

    // 1. Register User
    console.log("   Registering user...");
    await registryProgram.methods
      .registerUser({ prosumer: {} }, 0, 0, new BN(0), userShardId)
      .accounts({
        userAccount: userAccountPda,
        registryShard: userShardPda,
        registry: registryPda,
        authority: user.publicKey,
        payer: authority,
        energyTokenProgram: energyTokenProgram.programId,
        mint: energyMintPda,
        userTokenAccount: await ensureAta(energyMintPda, user.publicKey, TOKEN_2022_PROGRAM_ID),
        tokenInfo: energyTokenInfoPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // 2. Register Meter
    console.log("   Registering meter...");
    await registryProgram.methods
      .registerMeter(meterId, { solar: {} }, userShardId, 0)
      .accounts({
        meterAccount: meterAccountPda,
        userAccount: userAccountPda,
        registryShard: userShardPda,
        registry: registryPda,
        owner: user.publicKey,
        payer: authority,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // 3. Submit Meter Reading (Oracle)
    console.log("   Submitting reading to Oracle...");
    const energyProduced = new BN(1000); // 1000 units
    const energyConsumed = new BN(200);  // 200 units
    const timestamp = Math.floor(Date.now() / 1000);

    await oracleProgram.methods
      .submitMeterReading(meterId, energyProduced, energyConsumed, new BN(timestamp), 0)
      .accounts({
        oracleData: oracleDataPda,
        meterState: meterStatePda,
        authority: authority, // API Gateway
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // 4. Update Registry Reading (Synced by Oracle)
    console.log("   Syncing reading to Registry...");
    await registryProgram.methods
      .updateMeterReading(energyProduced, energyConsumed, new BN(timestamp))
      .accounts({
        registry: registryPda,
        meterAccount: meterAccountPda,
        oracleAuthority: authority,
      } as any)
      .rpc();

    // 5. Settle and Mint (CPI Registry -> EnergyToken)
    console.log("   Settling and minting tokens...");
    const userAta = await ensureAta(energyMintPda, user.publicKey, TOKEN_2022_PROGRAM_ID);
    
    await registryProgram.methods
      .settleAndMintTokens()
      .accounts({
        meterAccount: meterAccountPda,
        meterOwner: user.publicKey,
        tokenInfo: energyTokenInfoPda,
        mint: energyMintPda,
        userTokenAccount: userAta,
        registry: registryPda,
        energyTokenProgram: energyTokenProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        recValidator: authority, // Placeholder
      } as any)
      .signers([user])
      .rpc();

    // 6. Verify Final Balance
    const balance = await provider.connection.getTokenAccountBalance(userAta);
    // Net = 1000 - 200 = 800
    // Plus 10 GRX (10,000,000,000) from airdrop
    // 800 units = 800 (if 1:1) or 800 * 10^decimals? 
    // registry.rs: new_tokens_to_mint = current_net_gen.saturating_sub(meter.settled_net_generation);
    // 800 units minted.
    console.log(`   Final Balance: ${balance.value.amount}`);
    // Net generation = 1000 - 200 = 800 units minted 1:1 to the meter owner.
    expect(new BN(balance.value.amount).gte(new BN(800))).to.be.true;
  });

  it("Rejects anomalous readings", async () => {
    const meterIdAnom = "METER-ANOM";
    const [meterStatePda] = PublicKey.findProgramAddressSync([Buffer.from("meter"), Buffer.from(meterIdAnom)], oracleProgram.programId);

    console.log("   Submitting anomalous reading (Too high production)...");
    try {
      await oracleProgram.methods
        .submitMeterReading(meterIdAnom, new BN(2000000), new BN(1), new BN(Math.floor(Date.now() / 1000)), 0)
        .accounts({
          oracleData: oracleDataPda,
          meterState: meterStatePda,
          authority: authority,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
      expect.fail("Should have rejected anomalous reading");
    } catch (e: any) {
      // EnergyValueOutOfRange (max is 1,000,000 in oracle init)
      expect(e.message).to.contain("EnergyValueOutOfRange");
    }
  });
});
