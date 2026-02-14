import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Governance;

    console.log("🔍 Verifying DAO State...");

    const [poaConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("poa_config")],
        program.programId
    );
    console.log("PoA Config Address:", poaConfigPda.toBase58());

    console.log("Available Accounts:", Object.keys(program.account));

    try {
        // @ts-ignore
        const config = await program.account.poAConfig.fetch(poaConfigPda);
        console.log("✅ DAO Config Found!");
        console.log("----------------------------------------");
        console.log("Authority:", config.authority.toBase58());
        console.log("Emergency Paused:", config.emergencyPaused);
        console.log("ERC Validation Enabled:", config.ercValidationEnabled);
        console.log("Min Energy Amount:", config.minEnergyAmount.toString());
        console.log("Max ERC Amount:", config.maxErcAmount.toString());
        console.log("Validity Period:", config.ercValidityPeriod.toString());
        console.log("----------------------------------------");
    } catch (e) {
        console.error("❌ Failed to fetch DAO config:", e);
    }
}

main().then(
    () => process.exit(),
    err => {
        console.error(err);
        process.exit(1);
    }
);
