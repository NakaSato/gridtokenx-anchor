import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const registryProgram = anchor.workspace.Registry;
    const tradingProgram = anchor.workspace.Trading;
    const energyTokenProgram = anchor.workspace.EnergyToken;
    const authority = provider.wallet;

    console.log("🚀 Initializing Registry, Trading, and EnergyToken programs...");

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

    // 3. Initialize EnergyToken (creates the Token-2022 mint PDA)
    const [tokenInfo] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_info_2022")],
        energyTokenProgram.programId
    );
    const [mintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint_2022")],
        energyTokenProgram.programId
    );

    try {
        await energyTokenProgram.methods.initializeToken(registryProgram.programId).accounts({
            tokenInfo: tokenInfo,
            mint: mintPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        }).rpc();
        console.log("✅ EnergyToken initialized. Mint PDA:", mintPda.toBase58());
    } catch (e: any) {
        if (e.message.includes("already in use")) {
            console.log("ℹ️ EnergyToken already initialized. Mint PDA:", mintPda.toBase58());
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
