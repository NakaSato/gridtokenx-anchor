import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { Governance } from "../target/types/governance";
import type { Trading } from "../target/types/trading";
import type { EnergyToken } from "../target/types/energy_token";
import type { Registry } from "../target/types/registry";

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const authority = provider.wallet;

    console.log("🚀 Bootstrapping GridTokenX Dev Environment...");
    console.log("Authority:", authority.publicKey.toBase58());

    // 1. Initialize Governance
    const governanceProgram = anchor.workspace.Governance as Program<Governance>;
    const [governancePda] = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], governanceProgram.programId);
    console.log("Initializing Governance...");
    try {
        await governanceProgram.methods.initializePoa().accounts({
            poaConfig: governancePda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
        }).rpc();
        console.log("✅ Governance initialized.");
    } catch (e: any) { console.log("ℹ️ Governance already initialized."); }

    // 2. Initialize Registry
    const registryProgram = anchor.workspace.Registry as Program<Registry>;
    const [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], registryProgram.programId);
    console.log("Initializing Registry...");
    try {
        await registryProgram.methods.initialize().accounts({
            registry: registryPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
        }).rpc();
        console.log("✅ Registry initialized.");
    } catch (e: any) { console.log("ℹ️ Registry already initialized."); }

    // 3. Initialize Energy Token
    const energyProgram = anchor.workspace.EnergyToken as Program<EnergyToken>;
    const [tokenInfoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], energyProgram.programId);
    const [mintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], energyProgram.programId);
    console.log("Initializing Energy Token...");
    try {
        await energyProgram.methods.initializeToken(
            registryProgram.programId,
            authority.publicKey // Set registry_authority to dev wallet
        ).accounts({
            tokenInfo: tokenInfoPda,
            mint: mintPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any).rpc();
        console.log("✅ Energy Token initialized.");
    } catch (e: any) {
        console.log("❌ Energy Token initialization failed or already initialized.");
        console.log(e.message);
    }

    // 4. Initialize Trading Market
    const tradingProgram = anchor.workspace.Trading as Program<Trading>;
    const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingProgram.programId);
    console.log("Initializing Trading Market...");
    try {
        await tradingProgram.methods.initializeMarket().accounts({
            market: marketPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
        }).rpc();
        console.log("✅ Trading Market initialized.");
    } catch (e: any) { console.log("ℹ️ Market already initialized."); }

    console.log("✨ Environment bootstrap completed!");
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
