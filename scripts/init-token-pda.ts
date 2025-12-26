import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const programId = new PublicKey("5FVExLSAC94gSWH6TJa1TmBDWXuqFe5obZaC5DkqJihU");
  const idl = await Program.fetchIdl(programId, provider);
  const program = new Program(idl!, provider);

  const mintAddress = new PublicKey("HqiAnhHSTabxhWpi9Dg68Tsf2DnytVJESKwDbnUU6HEg");
  
  const [tokenInfo] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_info")],
    programId
  );

  console.log("Initializing token_info PDA:", tokenInfo.toString());
  console.log("Mint:", mintAddress.toString());
  console.log("Authority:", provider.wallet.publicKey.toString());

  try {
    const tx = await program.methods
      .initializeToken()
      .accounts({
        tokenInfo: tokenInfo,
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
