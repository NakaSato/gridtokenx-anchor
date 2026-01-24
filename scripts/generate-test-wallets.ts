import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const KEYPAIR_DIR = path.resolve(process.cwd(), "keypairs");

if (!fs.existsSync(KEYPAIR_DIR)) {
    fs.mkdirSync(KEYPAIR_DIR, { recursive: true });
}

const WALLETS = [
    "producer-1.json",
    "producer-2.json",
    "producer-3.json",
    "consumer-1.json",
    "consumer-2.json",
    "wallet-1-keypair.json",
    "wallet-2-keypair.json",
    "test-wallet-3.json",
    "test-wallet-4.json",
    "test-wallet-5.json"
];

console.log("🛠️ Generating missing test wallets...");

WALLETS.forEach(filename => {
    const filePath = path.join(KEYPAIR_DIR, filename);
    if (!fs.existsSync(filePath)) {
        const keypair = Keypair.generate();
        fs.writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)));
        console.log(`✅ Generated: ${filename} -> ${keypair.publicKey.toBase58()}`);
    } else {
        console.log(`ℹ️ Already exists: ${filename}`);
    }
});

console.log("\n✨ All test wallets are ready.");
