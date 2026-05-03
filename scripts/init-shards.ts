import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Registry } from "../target/types/registry";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const registryProgram = anchor.workspace.Registry as Program<Registry>;
  const authority = provider.wallet.publicKey;

  console.log("Initializing 16 Registry Shards...");

  for (let i = 0; i < 16; i++) {
    const [shardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry_shard"), Buffer.from([i])],
      registryProgram.programId
    );

    try {
      await registryProgram.methods
        .initializeShard(i)
        .accounts({
          shard: shardPda,
          authority: authority,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      console.log(`Shard ${i} initialized at ${shardPda.toBase58()}`);
    } catch (e: any) {
      console.log(`Shard ${i} already exists or failed: ${e.message}`);
    }
  }

  console.log("Registry Shards initialized successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
