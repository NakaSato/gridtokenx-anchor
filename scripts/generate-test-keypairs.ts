import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const KEYPAIR_DIR = path.join(process.cwd(), "keypairs");

const KEYPAIRS = [
    "governance-authority.json",
    "oracle-authority.json",
    "treasury-wallet.json",
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

if (!fs.existsSync(KEYPAIR_DIR)) {
    fs.mkdirSync(KEYPAIR_DIR, { recursive: true });
}

console.log(`Generating keypairs in ${KEYPAIR_DIR}...`);

KEYPAIRS.forEach(filename => {
    const filePath = path.join(KEYPAIR_DIR, filename);
    if (!fs.existsSync(filePath)) {
        const kp = Keypair.generate();
        const secretKey = Array.from(kp.secretKey);
        fs.writeFileSync(filePath, JSON.stringify(secretKey));
        console.log(`✅ Generated ${filename} (${kp.publicKey.toBase58()})`);
    } else {
        console.log(`ℹ️  ${filename} already exists`);
    }
});

console.log("Done.");
