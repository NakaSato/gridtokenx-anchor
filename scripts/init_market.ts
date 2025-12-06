
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function main() {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Trading;

  console.log("Program ID:", program.programId.toString());

  // Derive Market PDA
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market")],
    program.programId
  );

  console.log("Market PDA:", marketPda.toString());

  try {
    const marketAccount = await program.account.market.fetchNullable(marketPda);
    if (marketAccount) {
        console.log("Market already initialized!");
        return;
    }

    console.log("Initializing market...");
    const tx = await program.methods
      .initializeMarket()
      .accounts({
        market: marketPda,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Market initialized! Tx:", tx);
  } catch (err) {
    console.error("Failed to initialize market:", err);
  }
}

main();
