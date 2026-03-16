import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Registry } from "../../target/types/registry";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const registryProgram = anchor.workspace.Registry as Program<Registry>;
  const authority = provider.wallet.publicKey;

  console.log("Initializing Global Registry...");

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    registryProgram.programId
  );

  try {
    await registryProgram.methods
      .initialize()
      .accounts({
        registry: registryPda,
        authority: authority,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log(`Registry initialized at ${registryPda.toBase58()}`);
  } catch (e: any) {
    console.log(`Registry already exists or failed: ${e.message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
