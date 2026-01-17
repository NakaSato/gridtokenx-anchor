import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const KEYPAIR_DIR = path.resolve(process.cwd(), "keypairs");

// Ensure keypairs directory exists
if (!fs.existsSync(KEYPAIR_DIR)) {
    fs.mkdirSync(KEYPAIR_DIR, { recursive: true });
    console.log(`Created directory: ${KEYPAIR_DIR}`);
}

const KEYPAIRS_TO_GENERATE = [
    { name: "oracle-authority.json", description: "Oracle Authority" },
    { name: "dev-wallet.json", description: "Provider Wallet (Update Anchor.toml if needed)" },
    { name: "market-authority.json", description: "Market Authority" } // Additional useful keypair
];

function generateKeypair(filename: string, description: string) {
    const filePath = path.join(KEYPAIR_DIR, filename);

    if (fs.existsSync(filePath)) {
        const keypair = Keypair.fromSecretKey(
            Uint8Array.from(JSON.parse(fs.readFileSync(filePath, "utf-8")))
        );
        console.log(`✅ [Existing] ${description}: ${filePath}`);
        console.log(`   Public Key: ${keypair.publicKey.toBase58()}`);
        return;
    }

    const keypair = Keypair.generate();
    fs.writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)));

    console.log(`✨ [Generated] ${description}: ${filePath}`);
    console.log(`   Public Key: ${keypair.publicKey.toBase58()}`);
}

console.log("🔑 Generating Keypairs...\n");

KEYPAIRS_TO_GENERATE.forEach(kp => {
    generateKeypair(kp.name, kp.description);
});

console.log("\nDone!");
