import * as anchor from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";

const GOVERNANCE_PROGRAM_ID = new PublicKey("BRQEyx7DHX1Ljx1eNTHUve52aHHwkWckBXGeL9FZPEgZ");

const [poaConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("poa_config")],
    GOVERNANCE_PROGRAM_ID
);

console.log("PDA:", poaConfigPda.toBase58());

const connection = new anchor.web3.Connection("http://127.0.0.1:8899");

async function main() {
    const info = await connection.getAccountInfo(poaConfigPda);
    if (info) {
        console.log("Data Length:", info.data.length);
        console.log("Hex Dump:", info.data.toString('hex'));
    } else {
        console.log("Account not found");
    }
}

main();
