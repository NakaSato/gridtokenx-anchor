import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

const ENERGY_TOKEN_PROGRAM_ID = new PublicKey("8jTDw36yCQyYdr9hTtve5D5bFuQdaJ6f3WbdM4iGPHuq");
const REGISTRY_PROGRAM_ID = new PublicKey("3aF9FmyFuGzg4i1TCyySLQM1zWK8UUQyFALxo2f236ye");
const TRADING_PROGRAM_ID = new PublicKey("GTuRUUwCfvmqW7knqQtzQLMCy61p4UKUrdT5ssVgZbat");

async function main() {
    const [mintPda] = await PublicKey.findProgramAddress(
        [Buffer.from("mint_2022")],
        ENERGY_TOKEN_PROGRAM_ID
    );
    const [tokenInfoPda] = await PublicKey.findProgramAddress(
        [Buffer.from("token_info_2022")],
        ENERGY_TOKEN_PROGRAM_ID
    );
    const [registryPda] = await PublicKey.findProgramAddress(
        [Buffer.from("registry")],
        REGISTRY_PROGRAM_ID
    );
    const [marketPda] = await PublicKey.findProgramAddress(
        [Buffer.from("market")],
        TRADING_PROGRAM_ID
    );

    console.log("ENERGY_TOKEN_MINT=" + mintPda.toBase58());
    console.log("ENERGY_TOKEN_INFO=" + tokenInfoPda.toBase58());
    console.log("REGISTRY_PDA=" + registryPda.toBase58());
    console.log("MARKET_PDA=" + marketPda.toBase58());
}

main();
