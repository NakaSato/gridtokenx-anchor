
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";

async function main() {
    // Configure the client to use the local cluster
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    console.log("🚀 Bootstrapping GridTokenX Localnet Environment...");

    const registryProgram = anchor.workspace.Registry;
    const energyTokenProgram = anchor.workspace.EnergyToken;
    const tradingProgram = anchor.workspace.Trading;

    // --- 1. Initialize Registry ---
    console.log("\n1️⃣  Initializing Registry...");
    const [registryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry")],
        registryProgram.programId
    );

    try {
        const registryAccount = await registryProgram.account.registry.fetchNullable(registryPda);
        if (registryAccount) {
            console.log("   ✅ Registry already initialized.");
        } else {
            console.log("   Creating Registry account...");
            await registryProgram.methods
                .initialize()
                .accounts({
                    registry: registryPda,
                    authority: provider.wallet.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .rpc();
            console.log("   ✅ Registry initialized!");
        }
    } catch (e) {
        console.error("   ❌ Failed to initialize Registry:", e);
    }

    // --- 2. Initialize Energy Token (Mint) ---
    console.log("\n2️⃣  Initializing Energy Token...");
    const [tokenInfoPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_info")],
        energyTokenProgram.programId
    );

    const [mintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint")],
        energyTokenProgram.programId
    );

    try {
        const tokenInfo = await energyTokenProgram.account.tokenInfo.fetchNullable(tokenInfoPda);
        if (tokenInfo) {
            console.log("   ✅ Token Info already initialized.");
        } else {
            console.log("   Initializing Token Mint...");
            await energyTokenProgram.methods
                .initializeToken()
                .accounts({
                    tokenInfo: tokenInfoPda,
                    mint: mintPda,
                    authority: provider.wallet.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                    tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, // Use SPL Token Program (not 2022 unless specified)
                    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
                })
                .rpc();
            console.log("   ✅ Energy Token Initialized!");
        }
    } catch (e) {
        console.error("   ❌ Failed to initialize Energy Token:", e);
    }

    // --- 3. Initialize Trading Market ---
    console.log("\n3️⃣  Initializing Trading Market...");
    // Derive Market PDA
    const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market")],
        tradingProgram.programId
    );

    try {
        const marketAccount = await tradingProgram.account.market.fetchNullable(marketPda);
        if (marketAccount) {
            console.log("   ✅ Market already initialized!");
        } else {
            console.log("   Initializing market...");
            await tradingProgram.methods
                .initializeMarket()
                .accounts({
                    market: marketPda,
                    authority: provider.wallet.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .rpc();
            console.log("   ✅ Market initialized!");
        }
    } catch (err) {
        console.error("   ❌ Failed to initialize market:", err);
    }

    console.log("\n✨ Bootstrap Complete!");
}

main().then(
    () => process.exit(0),
    (err) => {
        console.error(err);
        process.exit(1);
    }
);
