import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

describe("Island Cluster Rehearsal", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const govProgram = anchor.workspace.Governance as Program<any>;
  const authority = provider.wallet as anchor.Wallet;

  it("provisions the southern island microgrid DAO", async () => {
    console.log("🚀 Initializing Island Microgrid Governance...");

    const islandZones = [
      { id: 101, name: "Koh Samui", incentive: 1150, wheeling: 50 },
      { id: 201, name: "Ko Pha-ngan", incentive: 1150, wheeling: 50 },
      { id: 301, name: "Ko Tao", incentive: 1150, wheeling: 50 },
    ];

    for (const island of islandZones) {
      const [zoneConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("zone_config"), Buffer.from(new Int32Array([island.id]).buffer)],
        govProgram.programId
      );

      const [poaConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("poa_config")],
        govProgram.programId
      );

      console.log(`📍 Initializing ${island.name} (Zone ${island.id})...`);

      // We need to make sure Governance is initialized first
      try {
        await govProgram.methods
          .initialize()
          .accounts({
            poaConfig: poaConfigPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } catch (e) {}

      await govProgram.methods
        .initializeZoneConfig(
          island.id,
          new BN(island.incentive),
          new BN(island.wheeling)
        )
        .accounts({
          zoneConfig: zoneConfigPda,
          poaConfig: poaConfigPda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log(`  ✅ ${island.name} Initialized.`);
    }
  });
});
