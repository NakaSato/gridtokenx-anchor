import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

async function main() {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.AnchorProvider.env();
  const authority = provider.wallet.publicKey;

  console.log("=== Registry + Meter Debug ===");
  console.log("Authority:", authority.toString());

  const registryProgramId = new PublicKey(
    "DVoD5K5YRuXXF54a3b6r282jRD8RmtVHGfpw55DHFVDe",
  );

  // @ts-ignore — workspace populated by anchor test harness
  const regProgram = anchor.workspace.Registry;

  const RUN = Date.now().toString(36);
  const METER_ID = `METER-DBG-${RUN}`;

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    registryProgramId,
  );
  const [shardPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry_shard"), Buffer.from([0])],
    registryProgramId,
  );
  const [userPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user"), authority.toBuffer()],
    registryProgramId,
  );
  const [meterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("meter"), authority.toBuffer(), Buffer.from(METER_ID)],
    registryProgramId,
  );

  console.log("\nDerived PDAs:");
  console.log("  registry:       ", registryPda.toString());
  console.log("  registry_shard: ", shardPda.toString());
  console.log("  user_account:   ", userPda.toString());
  console.log("  meter_account:  ", meterPda.toString());

  // ── 1. Check / init registry ──────────────────────────────────────────────
  try {
    const reg = await regProgram.account.registry.fetch(registryPda);
    console.log("\n✓ Registry exists. Authority:", reg.authority.toString());
  } catch (_) {
    console.log("\n✗ Registry missing — initializing...");
    await regProgram.methods
      .initialize()
      .accounts({
        registry: registryPda,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  ✓ Registry initialized");
  }

  // ── 2. Check / init shard 0 ────────────────────────────────────────────────
  try {
    const shard = await regProgram.account.registryShard.fetch(shardPda);
    console.log(`✓ Shard 0 exists. userCount=${shard.userCount}`);
  } catch (_) {
    console.log("✗ Shard 0 missing — initializing...");
    await regProgram.methods
      .initializeShard(0)
      .accounts({
        shard: shardPda,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  ✓ Shard 0 initialized");
  }

  // ── 3. Check / register user ───────────────────────────────────────────────
  try {
    const user = await regProgram.account.userAccount.fetch(userPda);
    console.log("✓ User account exists. Type:", JSON.stringify(user.userType));
  } catch (_) {
    console.log("✗ User account missing — registering...");
    try {
      await regProgram.methods
        .registerUser(
          { prosumer: {} },
          137_000_000,
          100_500_000,
          new BN("617700169958686719"),
          0,
        )
        .accounts({
          userAccount: userPda,
          registryShard: shardPda,
          authority,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("  ✓ User registered");
    } catch (e: any) {
      console.error("  ✗ registerUser failed:", e.message);
      process.exit(1);
    }
  }

  // ── 4. Register fresh meter ────────────────────────────────────────────────
  console.log(`\nRegistering meter: ${METER_ID}`);
  console.log("  meterPda:", meterPda.toString());
  try {
    await regProgram.methods
      .registerMeter(METER_ID, { solar: {} }, 0)
      .accounts({
        meterAccount: meterPda,
        userAccount: userPda,
        registryShard: shardPda,
        registry: registryPda,
        owner: authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  ✓ Meter registered");
  } catch (e: any) {
    console.error("  ✗ registerMeter failed:", e.message);
    process.exit(1);
  }

  // ── 5. Verify meter account on-chain ──────────────────────────────────────
  const meterData = await regProgram.account.meterAccount.fetch(meterPda);
  const idStr = Buffer.from(meterData.meterId).slice(0, 32).toString().replace(/\0/g, "");
  console.log("\nMeter on-chain:");
  console.log("  meterId:          ", idStr);
  console.log("  owner:            ", meterData.owner.toString());
  console.log("  totalGeneration:  ", meterData.totalGeneration.toString());
  console.log("  claimedErc:       ", meterData.claimedErcGeneration.toString());

  // ── 6. Set oracle authority ────────────────────────────────────────────────
  console.log("\nSetting oracle authority to wallet...");
  try {
    await regProgram.methods
      .setOracleAuthority(authority)
      .accounts({ registry: registryPda, authority })
      .rpc();
    console.log("  ✓ Oracle authority set");
  } catch (e: any) {
    console.log("  ⚠ setOracleAuthority:", e.message);
  }

  // ── 7. Seed meter reading ──────────────────────────────────────────────────
  console.log("\nSeeding meter reading (5000 kWh generated, 500 kWh consumed)...");
  try {
    await regProgram.methods
      .updateMeterReading(
        new BN(5000),
        new BN(500),
        new BN(Math.floor(Date.now() / 1000)),
      )
      .accounts({
        registry: registryPda,
        meterAccount: meterPda,
        oracleAuthority: authority,
      })
      .rpc();
    console.log("  ✓ Meter reading updated");
  } catch (e: any) {
    console.error("  ✗ updateMeterReading failed:", e.message);
    process.exit(1);
  }

  // ── 8. Verify final state ──────────────────────────────────────────────────
  const meterFinal = await regProgram.account.meterAccount.fetch(meterPda);
  console.log("\nFinal meter state:");
  console.log("  totalGeneration:  ", meterFinal.totalGeneration.toString());
  console.log("  totalConsumption: ", meterFinal.totalConsumption.toString());
  console.log("  claimedErc:       ", meterFinal.claimedErcGeneration.toString());

  console.log("\n✓ All steps complete. Meter PDA for governance tests:");
  console.log("  METER_ID:  ", METER_ID);
  console.log("  meterPda:  ", meterPda.toString());
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
