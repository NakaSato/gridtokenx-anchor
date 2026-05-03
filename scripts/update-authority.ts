import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Registry } from "../target/types/registry";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const registryProgram = anchor.workspace.Registry as Program<Registry>;
  const authority = provider.wallet.publicKey;
  const newAuthority = new PublicKey("2ndDBhSWDXPAsgvkVVzsNJLfAAX9mKZkU9z5JaeSkQE4");

  console.log(`Updating Registry Authority from ${authority.toBase58()} to ${newAuthority.toBase58()}...`);

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    registryProgram.programId
  );

  try {
    const data = Buffer.concat([
      Buffer.from([32, 46, 64, 28, 149, 75, 243, 88]), // update_authority discriminator
      newAuthority.toBuffer()
    ]);

    const tx = new anchor.web3.Transaction().add({
      keys: [
        { pubkey: registryPda, isWritable: true, isSigner: false },
        { pubkey: authority, isWritable: false, isSigner: true },
      ],
      programId: registryProgram.programId,
      data: data,
    });

    const signature = await provider.sendAndConfirm(tx);
    console.log(`Authority updated! Signature: ${signature}`);
  } catch (e: any) {
    console.error(`Failed to update authority: ${e.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
