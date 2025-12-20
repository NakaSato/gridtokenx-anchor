import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function main() {
    const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");

    const registryProgramId = new PublicKey("9wvMT6f2Y7A37LB8y5LEQRSJxbnwLYqw1Bqq1RBtD3oM");
    const [registryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry")],
        registryProgramId
    );

    console.log("Registry PDA:", registryPda.toBase58());

    const accountInfo = await connection.getAccountInfo(registryPda);
    if (!accountInfo) {
        console.log("Registry account not found!");
        return;
    }

    console.log("Account data length:", accountInfo.data.length);
    console.log("Account owner:", accountInfo.owner.toBase58());

    // Skip 8-byte discriminator, then read first pubkey (authority)
    const authorityBytes = accountInfo.data.slice(8, 8 + 32);
    const authority = new PublicKey(authorityBytes);
    console.log("\n📍 Registry Authority:", authority.toBase58());

    // Read oracle_authority (next is Option<Pubkey> - 1 byte flag + 32 bytes if present)
    const oracleFlag = accountInfo.data[8 + 32];
    if (oracleFlag === 1) {
        const oracleBytes = accountInfo.data.slice(8 + 32 + 1, 8 + 32 + 1 + 32);
        const oracle = new PublicKey(oracleBytes);
        console.log("📍 Oracle Authority:", oracle.toBase58());
    } else {
        console.log("📍 Oracle Authority: NOT SET");
    }
}

main();
