import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const governanceProgram = anchor.workspace.Governance;
    const authority = provider.wallet;

    const [poaConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("poa_config")],
        governanceProgram.programId
    );

    console.log("Initializing PoA Config for Governance...");
    
    // Check if it already exists
    try {
        const existing = await governanceProgram.account.poAConfig.fetch(poaConfigPda);
        console.log("PoA config already initialized.", poaConfigPda.toBase58());
        return;
    } catch(e) {}

    try {
        await governanceProgram.methods.initializePoaConfig({
            authorityName: "GridTokenX Admin",
            contactInfo: "admin@gridtokenx.com",
            ercValidationEnabled: true,
            allowCertificateTransfers: true,
            minEnergyAmount: new anchor.BN(100),
            maxErcAmount: new anchor.BN(10000),
            ercValidityPeriod: new anchor.BN(365 * 24 * 60 * 60)
        }).accounts({
            poaConfig: poaConfigPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId
        }).rpc();
        
        console.log("✅ PoA Config successfully initialized at:", poaConfigPda.toBase58());
    } catch(err) {
        console.error("Failed to initialize:", err);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
