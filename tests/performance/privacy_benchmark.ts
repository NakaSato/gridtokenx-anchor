
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo, setAuthority, AuthorityType } from "@solana/spl-token";
import BN from "bn.js";
import fs from "fs";
import path from "path";

// --- Configuration ---
const CONFIG = {
    rpcUrl: process.env.SOLANA_URL || "http://127.0.0.1:8899", // Default to local PoA cluster
    batchSize: 10,       // Transactions per batch
    totalBatches: 5,     // Total batches to run
    warmupBatches: 1,    // Discard first N batches from metrics
    slotCommitment: "confirmed" as "confirmed" | "finalized" | "processed",
};

// --- Helpers for Privacy Data ---
const create32ByteBuffer = (val: number = 0) => {
    const buf = Buffer.alloc(32);
    buf.fill(val);
    return [...buf];
};

const createDummyCommitment = () => ({
    point: create32ByteBuffer(1)
});

const createDummyRangeProof = () => ({
    proofData: create32ByteBuffer(2),
    commitment: createDummyCommitment()
});

const createDummyEqualityProof = () => ({
    challenge: create32ByteBuffer(3),
    response: create32ByteBuffer(4)
});

const createDummyTransferProof = () => ({
    amountCommitment: createDummyCommitment(),
    amountRangeProof: createDummyRangeProof(),
    remainingRangeProof: createDummyRangeProof(),
    balanceProof: createDummyEqualityProof()
});

// --- Metrics Tracker ---
class Metrics {
    latencies: number[] = [];
    startTime: number = 0;
    endTime: number = 0;
    successCount: number = 0;
    failCount: number = 0;

    start() { this.startTime = Date.now(); }
    end() { this.endTime = Date.now(); }

    recordLatency(ms: number) { this.latencies.push(ms); }
    recordSuccess() { this.successCount++; }
    recordFail() { this.failCount++; }

    get durationSec() { return (this.endTime - this.startTime) / 1000; }
    get tps() { return this.successCount / this.durationSec; }
    get avgLatency() { return this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length; }
    get p95Latency() {
        if (this.latencies.length === 0) return 0;
        const sorted = [...this.latencies].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length * 0.95)];
    }
}

async function main() {
    console.log("🚀 Starting GridTokenX Privacy Benchmark");
    console.log("==========================================");
    console.log(`RPC URL: ${CONFIG.rpcUrl}`);
    console.log(`Batch Size: ${CONFIG.batchSize}`);
    console.log(`Total Batches: ${CONFIG.totalBatches}`);

    // Setup Connection & Provider
    // Setup Connection
    const connection = new Connection(CONFIG.rpcUrl, CONFIG.slotCommitment);

    // 1. Setup & Fund Admin Wallet (Fee Payer)
    const admin = Keypair.generate();
    console.log("\n🛠  Setting up Benchmark Environment...");
    console.log(`Fund admin: ${admin.publicKey.toBase58()}`);

    const adminAirdropSig = await connection.requestAirdrop(admin.publicKey, 10 * 1_000_000_000); // 10 SOL
    const latestBlockHashAdmin = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
        blockhash: latestBlockHashAdmin.blockhash,
        lastValidBlockHeight: latestBlockHashAdmin.lastValidBlockHeight,
        signature: adminAirdropSig
    });

    // Initialize Provider with FUNDED admin wallet
    const wallet = new anchor.Wallet(admin);
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: CONFIG.slotCommitment });
    anchor.setProvider(provider);

    // Load Program
    const idlPath = path.resolve("target/idl/trading.json");
    if (!fs.existsSync(idlPath)) {
        throw new Error("IDL not found at " + idlPath);
    }
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
    const program = new anchor.Program(idl as any, provider);

    // 2. Create Mint
    const mint = await createMint(connection, admin, admin.publicKey, null, 6);
    console.log(`Mint created: ${mint.toBase58()}`);

    const user = Keypair.generate();
    const userAirdropSig = await connection.requestAirdrop(user.publicKey, 5 * 1_000_000_000);
    const latestBlockHash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
        signature: userAirdropSig
    });

    // Robust wait for balance
    let retries = 10;
    while (retries > 0) {
        const bal = await connection.getBalance(user.publicKey);
        if (bal > 0) break;
        await new Promise(r => setTimeout(r, 500));
        retries--;
    }
    console.log(`Funded user: ${user.publicKey.toBase58()} (Balance: ${await connection.getBalance(user.publicKey)})`);

    // 4. Setup User Token Account
    const userTa = await getOrCreateAssociatedTokenAccount(connection, admin, mint, user.publicKey);
    await mintTo(connection, admin, mint, userTa.address, admin.publicKey, 1_000_000_000); // 1000 tokens

    // 5. Init Private Balance
    const [privateBalancePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("private_balance"), user.publicKey.toBuffer(), mint.toBuffer()],
        program.programId
    );

    try {
        await program.methods.initializePrivateBalance(
            createDummyCommitment(),
            create32ByteBuffer(),
            [...Buffer.alloc(24)]
        )
            .accounts({
                privateBalance: privateBalancePda,
                mint: mint,
                owner: user.publicKey,
                systemProgram: SystemProgram.programId
            })
            .signers([user])
            .rpc();
        console.log("Private Balance Initialized");
    } catch (e: any) {
        console.error("Init failed:", e);
        return;
    }

    // --- Benchmark Loop ---
    const metrics = new Metrics();

    console.log("\n🔥  Warming up...");
    // Warmup (Shield Only)
    for (let i = 0; i < CONFIG.warmupBatches; i++) {
        await runBatch(program, user, privateBalancePda, mint, userTa.address, CONFIG.batchSize);
    }

    console.log("\n🏁  Running Benchmark...");
    metrics.start();

    for (let i = 0; i < CONFIG.totalBatches; i++) {
        process.stdout.write(`Batch ${i + 1}/${CONFIG.totalBatches}... `);
        const batchStart = Date.now();

        await runBatch(program, user, privateBalancePda, mint, userTa.address, CONFIG.batchSize, metrics);

        const batchDuration = Date.now() - batchStart;
        console.log(`Done (${(batchDuration / 1000).toFixed(2)}s)`);
    }

    metrics.end();

    // --- Report ---
    console.log("\n📊  Benchmark Results");
    console.log("==========================================");
    console.log(`Total Transactions: ${metrics.successCount}`);
    console.log(`Total Duration:     ${metrics.durationSec.toFixed(2)}s`);
    console.log(`Throughput (TPS):   ${metrics.tps.toFixed(2)} tx/s`);
    console.log(`Avg Latency:        ${metrics.avgLatency.toFixed(2)} ms`);
    console.log(`p95 Latency:        ${metrics.p95Latency.toFixed(2)} ms`);
    console.log(`Failures:           ${metrics.failCount}`);
    console.log("==========================================");
}

async function runBatch(
    program: anchor.Program,
    user: Keypair,
    privateBalancePda: PublicKey,
    mint: PublicKey,
    userTa: PublicKey,
    size: number,
    metrics?: Metrics
) {
    const promises = [];

    for (let i = 0; i < size; i++) {
        // We will benchmark 'Shield' transactions as they represent a heavy write op 
        // with CPI to Token Program + Privacy State Update.
        // We run them sequentially here to measure "Latency per tx" correctly under load, 
        // or Promise.all for "Max Throughput".
        // Let's do sequential to get accurate latency numbers, as Promise.all locally might hit RPC rate limits 
        // or nonce issues without careful management.

        const start = Date.now();
        try {
            await program.methods.shieldTokens(
                new BN(100), // Amount
                createDummyCommitment(),
                create32ByteBuffer(5),
                createDummyRangeProof()
            )
                .accounts({
                    privateBalance: privateBalancePda,
                    mint: mint,
                    userTokenAccount: userTa,
                    owner: user.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([user])
                .rpc();

            if (metrics) {
                metrics.recordSuccess();
                metrics.recordLatency(Date.now() - start);
            }
        } catch (e) {
            if (metrics) metrics.recordFail();
            // console.error(e);
        }
    }
}

main().catch(console.error);
