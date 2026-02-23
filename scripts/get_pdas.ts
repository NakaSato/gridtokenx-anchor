import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function main() {
    // Only needed to resolve workspace programs
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const registryProgram = anchor.workspace.Registry;
    const tradingProgram = anchor.workspace.Trading;
    const energyTokenProgram = anchor.workspace.EnergyToken;

    const [registryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry")],
        registryProgram.programId
    );

    const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market")],
        tradingProgram.programId
    );

    const [mintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint_2022")],
        energyTokenProgram.programId
    );

    console.log(`REGISTRY_PDA=${registryPda.toBase58()}`);
    console.log(`MARKET_PDA=${marketPda.toBase58()}`);
    console.log(`ENERGY_TOKEN_MINT=${mintPda.toBase58()}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
