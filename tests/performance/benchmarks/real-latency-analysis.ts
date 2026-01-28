import { Connection, Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from "@solana/web3.js";
import * as fs from 'fs';

const VALIDATOR_URLS = [
    "http://127.0.0.1:8899", // Val 1 (Leader / Entry)
    "http://127.0.0.1:8999", // Val 2
    "http://127.0.0.1:9099"  // Val 3
];

const ITERATIONS = 20;

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log("🚀 Starting Multi-Validator Latency Analysis...");

    // Connect to all validators
    const connections = VALIDATOR_URLS.map(url => new Connection(url, "confirmed"));
    const leaderConn = connections[0];

    // Setup Payer using Faucet Keypair
    const faucetKeypairData = JSON.parse(await fs.promises.readFile('scripts/poa-cluster/genesis/faucet-keypair.json', 'utf-8'));
    const faucet = Keypair.fromSecretKey(new Uint8Array(faucetKeypairData));
    const payer = Keypair.generate();

    console.log(`Funding payer ${payer.publicKey.toBase58()} from faucet...`);
    try {
        const tx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: faucet.publicKey,
                toPubkey: payer.publicKey,
                lamports: 1 * LAMPORTS_PER_SOL,
            })
        );
        tx.recentBlockhash = (await leaderConn.getLatestBlockhash()).blockhash;
        tx.sign(faucet);
        const sig = await leaderConn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
        await leaderConn.confirmTransaction(sig);
    } catch (e) {
        console.error("Funding failed:", e);
        process.exit(1);
    }

    console.log("✅ Connections established. Starting benchmark...");

    const measurements: { val2: number, val3: number }[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
        process.stdout.write(`Iteration ${i + 1}/${ITERATIONS}: `);

        // Create Transaction
        const tx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: payer.publicKey, // Self transfer
                lamports: 1000,
            })
        );
        tx.recentBlockhash = (await leaderConn.getLatestBlockhash()).blockhash;
        tx.sign(payer);

        const startTime = Date.now();

        // Send to Leader (Validator 1)
        const sig = await leaderConn.sendRawTransaction(tx.serialize(), { skipPreflight: true });

        // Poll for confirmation on Val 2 (8999) and Val 3 (9099)
        let val2ConfirmedTime = 0;
        let val3ConfirmedTime = 0;

        const pollStart = Date.now();
        while (val2ConfirmedTime === 0 || val3ConfirmedTime === 0) {
            if (Date.now() - pollStart > 5000) {
                console.log(" Timeout waiting for propagation");
                break;
            }

            if (val2ConfirmedTime === 0) {
                const status = await connections[1].getSignatureStatus(sig);
                if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
                    val2ConfirmedTime = Date.now();
                }
            }

            if (val3ConfirmedTime === 0) {
                const status = await connections[2].getSignatureStatus(sig);
                if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
                    val3ConfirmedTime = Date.now();
                }
            }

            await sleep(10); // Tight poll
        }

        if (val2ConfirmedTime && val3ConfirmedTime) {
            const l2 = val2ConfirmedTime - startTime;
            const l3 = val3ConfirmedTime - startTime;
            measurements.push({ val2: l2, val3: l3 });
            console.log(`Val2: ${l2}ms, Val3: ${l3}ms`);
        } else {
            console.log(" Missed measurement"); // Shouldn't happen on healthy cluster
        }

        await sleep(500); // Cool down
    }

    // Stats
    const avgVal2 = measurements.reduce((a, b) => a + b.val2, 0) / measurements.length;
    const avgVal3 = measurements.reduce((a, b) => a + b.val3, 0) / measurements.length;

    // Std Dev
    const stdDevVal2 = Math.sqrt(measurements.reduce((a, b) => a + Math.pow(b.val2 - avgVal2, 2), 0) / measurements.length);
    const stdDevVal3 = Math.sqrt(measurements.reduce((a, b) => a + Math.pow(b.val3 - avgVal3, 2), 0) / measurements.length);

    console.log("\n📊 Latency Analysis Results:");
    console.log(`Validator 2 (Port 8999): ${avgVal2.toFixed(2)}ms (±${stdDevVal2.toFixed(2)}ms)`);
    console.log(`Validator 3 (Port 9099): ${avgVal3.toFixed(2)}ms (±${stdDevVal3.toFixed(2)}ms)`);
    console.log(`Inter-Validator Propagation: ${Math.abs(avgVal3 - avgVal2).toFixed(2)}ms`);
}

main().catch(console.error);
