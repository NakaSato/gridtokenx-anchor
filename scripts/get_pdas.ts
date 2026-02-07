import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const registryProgram = anchor.workspace.Registry;
    const tradingProgram = anchor.workspace.Trading;

    // Derive Registry PDA
    const [registryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry")],
        registryProgram.programId
    );

    // Derive Market PDA
    const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market")],
        tradingProgram.programId
    );

    console.log(`REGISTRY_PDA=${registryPda.toBase58()}`);
    console.log(`MARKET_PDA=${marketPda.toBase58()}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
