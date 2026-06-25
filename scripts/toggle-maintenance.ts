import * as anchor from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Governance;
    const authority = provider.wallet;

    const [governanceConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("poa_config")],
        program.programId
    );

    console.log("PoA Config PDA:", governanceConfigPda.toBase58());

    try {
        console.log("Setting maintenance mode to FALSE...");
        const tx = await program.methods
            .setMaintenanceMode(false)
            .accounts({
                governanceConfig: governanceConfigPda,
                authority: authority.publicKey,
            })
            .rpc();

        console.log("✅ Maintenance mode disabled! TX:", tx);
    } catch (e: any) {
        console.error("❌ Failed to toggle maintenance mode:");
        console.error(e);
    }
}

main().catch(console.error);
