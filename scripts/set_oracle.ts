import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";

/**
 * Set Oracle Authority on Registry Program
 * 
 * This script sets the API Gateway (dev-wallet) as the oracle authority
 * for the Registry program, allowing it to submit meter readings on-chain.
 */
async function main() {
    // Connect to localnet
    const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");

    // Load the authority keypair (should be the same as registry authority)
    const keypairPath = process.env.AUTHORITY_PATH || "../dev-wallet.json";
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    const authorityKeypair = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(keypairData));

    console.log("Authority pubkey:", authorityKeypair.publicKey.toBase58());

    // Set up provider
    const wallet = new anchor.Wallet(authorityKeypair);
    const provider = new anchor.AnchorProvider(connection, wallet, {});
    anchor.setProvider(provider);

    // Registry program ID
    const registryProgramId = new PublicKey("9wvMT6f2Y7A37LB8y5LEQRSJxbnwLYqw1Bqq1RBtD3oM");

    // Derive registry PDA
    const [registryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry")],
        registryProgramId
    );
    console.log("Registry PDA:", registryPda.toBase58());

    // Oracle to set (same as authority for simplicity)
    const oraclePubkey = authorityKeypair.publicKey;
    console.log("Oracle to set:", oraclePubkey.toBase58());

    // Build instruction data: discriminator (8 bytes) + oracle pubkey (32 bytes)
    // Discriminator = sha256("global:set_oracle_authority")[0..8] = 279b426ad5e272ae
    const discriminator = Buffer.from([0x27, 0x9b, 0x42, 0x6a, 0xd5, 0xe2, 0x72, 0xae]);

    const data = Buffer.concat([
        discriminator,
        oraclePubkey.toBuffer(),
    ]);

    // Build instruction
    const instruction = new anchor.web3.TransactionInstruction({
        keys: [
            { pubkey: registryPda, isSigner: false, isWritable: true },
            { pubkey: authorityKeypair.publicKey, isSigner: true, isWritable: false },
        ],
        programId: registryProgramId,
        data,
    });

    // Send transaction
    const tx = new anchor.web3.Transaction().add(instruction);

    try {
        const sig = await provider.sendAndConfirm(tx);
        console.log("✅ Oracle authority set successfully!");
        console.log("Transaction:", sig);
        console.log("\nOracle:", oraclePubkey.toBase58());
    } catch (error: any) {
        if (error.message?.includes("already initialized") || error.logs?.some((log: string) => log.includes("already"))) {
            console.log("Oracle may already be set.");
        } else {
            console.error("❌ Error setting oracle:", error);
            if (error.logs) {
                console.error("Logs:", error.logs);
            }
        }
    }
}

main();
