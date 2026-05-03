import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PublicKey, SystemProgram } from "@solana/web3.js";

async function main() {
    // Configure the client to use the local cluster
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Governance;
    const authority = provider.wallet;

    console.log("🚀 Initializing GridTokenX Governance (DAO)...");
    console.log("Authority:", authority.publicKey.toBase58());

    // 1. Derive PoA Config PDA
    const [poaConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("poa_config")],
        program.programId
    );
    console.log("PoA Config PDA:", poaConfigPda.toBase58());

    // 2. Initialize PoA
    try {
        const tx = await program.methods
            .initializePoa()
            .accounts({
                poaConfig: poaConfigPda,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        console.log("✅ Governance initialized successfully!");
        console.log("Transaction Signature:", tx);
    } catch (e: any) {
        if (e.message.includes("already in use")) {
            console.log("ℹ️ Governance already initialized.");
        } else {
            console.error("❌ Failed to initialize governance:");
            console.error(e);
            process.exit(1);
        }
    }

    // 3. Optional: Set Oracle Authority (if we want the simulator/relay to be recognized)
    // For now, the authority is the dev wallet which is also the API Gateway in the simulator tests.
}

main().then(
    () => process.exit(),
    err => {
        console.error(err);
        process.exit(1);
    }
);
