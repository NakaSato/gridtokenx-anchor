import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function main() {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Registry;

  console.log("Program ID:", program.programId.toString());

  // Derive Registry PDA
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    program.programId
  );

  console.log("Registry PDA:", registryPda.toString());

  try {
    const registryAccount = await program.account.registry.fetchNullable(registryPda);
    if (registryAccount) {
        console.log("Registry already initialized!");
        return;
    }

    console.log("Initializing registry...");
    const tx = await program.methods
      .initialize()
      .accounts({
        registry: registryPda,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Registry initialized! Tx:", tx);
  } catch (err) {
    console.error("Failed to initialize registry:", err);
    process.exit(1);
  }
}

main();
