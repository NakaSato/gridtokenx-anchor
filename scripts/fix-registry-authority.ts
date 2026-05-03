import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import type { EnergyToken } from "../target/types/energy_token";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.EnergyToken as Program<EnergyToken>;
  const authority = provider.wallet;

  console.log("Using authority:", authority.publicKey.toString());
  console.log("Program ID:", program.programId.toString());

  // PDAs
  const [tokenInfo] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_info_2022")],
    program.programId
  );

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    new PublicKey("7JsfJPuJvhkY376RAzQExbdFbZMgdGc2cWLic25SE1tq") // Registry Program ID
  );

  console.log("Token Info PDA:", tokenInfo.toString());
  console.log("New Registry Authority (PDA):", registryPda.toString());

  try {
    const tx = await program.methods
      .setRegistryAuthority(registryPda)
      .accounts({
        tokenInfo,
        authority: authority.publicKey,
      })
      .rpc();

    console.log("Successfully updated registry authority!");
    console.log("Transaction signature:", tx);
  } catch (err) {
    console.error("Failed to update registry authority:", err);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
