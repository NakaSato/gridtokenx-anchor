import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Load program from workspace (requires anchor keys sync/build)
  const program = anchor.workspace.EnergyToken;
  const programId = program.programId;

  // Derive PDAs consistent with tpc-c-anchor.ts
  const [tokenInfo] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_info_2022")],
    programId
  );

  const [mintAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_2022")],
    programId
  );

  console.log("Program ID:", programId.toString());
  console.log("Initializing token_info PDA:", tokenInfo.toString());
  console.log("Mint PDA:", mintAddress.toString());
  console.log("Authority:", provider.wallet.publicKey.toString());

  // Load registry program to get its ID
  const registryProgram = anchor.workspace.Registry;

  try {
    const tx = await program.methods
      .initializeToken(registryProgram.programId)
      .accounts({
        token_info: tokenInfo,
        mint: mintAddress,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    console.log("✅ Token initialized successfully!");
    console.log("Transaction signature:", tx);
  } catch (err: any) {
    if (err.message?.includes("already in use")) {
      console.log("⚠️ Token info already initialized");
    } else {
      console.error("Error:", err);
      throw err;
    }
  }
}

main().catch(console.error);
