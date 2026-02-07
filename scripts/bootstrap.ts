import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const registryProgram = anchor.workspace.Registry;
    const tradingProgram = anchor.workspace.Trading;
    const authority = provider.wallet;

    console.log("🚀 Initializing Registry and Trading programs...");

    // 1. Initialize Registry
    const [registryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry")],
        registryProgram.programId
    );

    try {
        await registryProgram.methods.initialize().accounts({
            registry: registryPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId
        }).rpc();
        console.log("✅ Registry initialized.");
    } catch (e: any) {
        if (e.message.includes("already in use")) {
            console.log("ℹ️ Registry already initialized.");
        } else {
            throw e;
        }
    }

    // 2. Initialize Market
    const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market")],
        tradingProgram.programId
    );

    try {
        await tradingProgram.methods.initializeMarket().accounts({
            market: marketPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId
        }).rpc();
        console.log("✅ Market initialized.");
    } catch (e: any) {
        if (e.message.includes("already in use")) {
            console.log("ℹ️ Market already initialized.");
        } else {
            throw e;
        }
    }

    console.log("🎯 Blockchain bootstrap completed successfully.");
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
