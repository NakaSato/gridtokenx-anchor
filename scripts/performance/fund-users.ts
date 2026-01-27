import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";

async function main() {
    const connection = new Connection("http://127.0.0.1:8899", "confirmed");
    const provider = anchor.AnchorProvider.env();
    const authority = (provider.wallet as any).payer;

    console.log(`Funding users from ${authority.publicKey.toBase58()}...`);

    // In a real cluster airdrop might be limited, but here it's our own PoA
    for (let i = 0; i < 100; i++) {
        const user = Keypair.generate();
        // Since it's PoA, we can just use airdrop if the faucet is active, 
        // or transfer from authority.
        const sig = await connection.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);

        // Print the secret key so we can reuse them if needed, or just keep them in memory for the bench
        console.log(`User ${i}: ${user.publicKey.toBase58()} funded.`);
    }
}

main().catch(console.error);
