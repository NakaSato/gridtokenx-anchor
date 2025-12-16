import { PublicKey } from "@solana/web3.js";

const ENERGY_TOKEN_PROGRAM_ID = new PublicKey("AZBstnPmUeRJnwv55128awdfi2tmCFzcK4W6NPXbTkWA");

const [mint] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint")],
    ENERGY_TOKEN_PROGRAM_ID
);

console.log(mint.toBase58());
