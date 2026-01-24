
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import BN from "bn.js";
import fs from "fs";
import path from "path";

// --- Configuration ---
const CONFIG = {
    rpcUrl: process.env.SOLANA_URL || "http://127.0.0.1:8899",
    concurrency: 50,     // Number of parallel clients
    txsPerClient: 20,    // Transactions per client
    slotCommitment: "confirmed" as "confirmed" | "finalized" | "processed",
};

// --- Helpers for Privacy Data (Dummy Generation for Simulation) ---
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

// --- Metrics Helper ---
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
    console.log("🚀 Starting GridTokenX Concurrent Privacy Benchmark");
    console.log("=================================================");
    console.log(`RPC URL:     ${CONFIG.rpcUrl}`);
    console.log(`Concurrency: ${CONFIG.concurrency} clients`);
    console.log(`Tx/Client:   ${CONFIG.txsPerClient}`);
    console.log(`Total Txs:   ${CONFIG.concurrency * CONFIG.txsPerClient}`);

    const connection = new Connection(CONFIG.rpcUrl, CONFIG.slotCommitment);

    // 1. Setup Admin (Fee Payer)
    const admin = Keypair.generate();
    console.log(`\n🛠  Funding Admin: ${admin.publicKey.toBase58()}`);
    {
        const sig = await connection.requestAirdrop(admin.publicKey, 100 * 1_000_000_000);
        const latestInfo = await connection.getLatestBlockhash();
        await connection.confirmTransaction({
            blockhash: latestInfo.blockhash,
            lastValidBlockHeight: latestInfo.lastValidBlockHeight,
            signature: sig
        });
    }

    const wallet = new anchor.Wallet(admin);
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: CONFIG.slotCommitment, preflightCommitment: CONFIG.slotCommitment });
    anchor.setProvider(provider);

    // Load Program
    const idlPath = path.resolve("target/idl/trading.json");
    if (!fs.existsSync(idlPath)) { throw new Error("IDL not found at " + idlPath); }
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
    const program = new anchor.Program(idl as any, provider);

    // 2. Setup Mint
    console.log("Creating Mint...");
    const mint = await createMint(connection, admin, admin.publicKey, null, 6);

    // 3. Prepare Clients (Parallel Setup)
    console.log(`Preparing ${CONFIG.concurrency} clients (Funding, Token Accts, Init Privacy)...`);
    const clients: Array<{ keypair: Keypair, userTa: PublicKey, privateBalance: PublicKey }> = [];

    // Generate Keypairs
    for (let i = 0; i < CONFIG.concurrency; i++) {
        clients.push({
            keypair: Keypair.generate(),
            userTa: PublicKey.default,
            privateBalance: PublicKey.default
        });
    }

    // Fund Clients Batch (Sequential to avoid rate limits on airdrop, or parallel if robust)
    // We'll process setup in chunks to be safe.
    for (const client of clients) {
        // Airdrop
        const sig = await connection.requestAirdrop(client.keypair.publicKey, 2 * 1_000_000_000);
        const latest = await connection.getLatestBlockhash();
        await connection.confirmTransaction({ signature: sig, ...latest });
    }

    // Setup Token Accounts & Init Private Balance (Can be parallelized partially)
    const setupPromises = clients.map(async (client) => {
        // Token Account
        const ta = await getOrCreateAssociatedTokenAccount(connection, admin, mint, client.keypair.publicKey);
        await mintTo(connection, admin, mint, ta.address, admin.publicKey, 1_000_000_000);
        client.userTa = ta.address;

        // Init Private Balance
        const [pb] = PublicKey.findProgramAddressSync(
            [Buffer.from("private_balance"), client.keypair.publicKey.toBuffer(), mint.toBuffer()],
            program.programId
        );
        client.privateBalance = pb;

        await program.methods.initializePrivateBalance(
            createDummyCommitment(),
            create32ByteBuffer(),
            [...Buffer.alloc(24)]
        )
            .accounts({
                privateBalance: pb,
                mint: mint,
                owner: client.keypair.publicKey,
                systemProgram: SystemProgram.programId
            })
            .signers([client.keypair])
            .rpc();
    });

    await Promise.all(setupPromises);
    console.log("✅ Clients Ready.");

    // --- Benchmark Execution ---
    console.log("\n🏁  Starting LOAD TEST...");
    const metrics = new Metrics();
    metrics.start();

    // Map each client to a worker promise that executes N transactions sequentially (simulating a user)
    // All clients run in parallel against the chain.
    const clientWorkers = clients.map(async (client, index) => {
        for (let i = 0; i < CONFIG.txsPerClient; i++) {
            const start = Date.now();
            try {
                await program.methods.shieldTokens(
                    new BN(100),
                    createDummyCommitment(),
                    create32ByteBuffer(5),
                    createDummyRangeProof()
                )
                    .accounts({
                        privateBalance: client.privateBalance,
                        mint: mint,
                        userTokenAccount: client.userTa,
                        owner: client.keypair.publicKey,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([client.keypair])
                    .rpc();

                metrics.recordSuccess();
                metrics.recordLatency(Date.now() - start);

                // Logging progress occasionally
                if ((i + 1) % 5 === 0) {
                    // console.log(`Client ${index} sent ${i+1}/${CONFIG.txsPerClient}`);
                }
            } catch (e) {
                // console.error(`Client ${index} Error:`, e);
                metrics.recordFail();
            }
        }
    });

    await Promise.all(clientWorkers);
    metrics.end();

    // --- Report ---
    console.log("\n📊  Concurrent Benchmark Results");
    console.log("=================================================");
    console.log(`Concurrent Clients: ${CONFIG.concurrency}`);
    console.log(`Total Transactions: ${metrics.successCount}`);
    console.log(`Total Duration:     ${metrics.durationSec.toFixed(2)}s`);
    console.log(`Aggregate TPS:      ${metrics.tps.toFixed(2)} tx/s`);
    console.log(`Avg Latency:        ${metrics.avgLatency.toFixed(2)} ms`);
    console.log(`p95 Latency:        ${metrics.p95Latency.toFixed(2)} ms`);
    console.log(`Failures:           ${metrics.failCount}`);
    console.log("=================================================");
}

main().catch(console.error);
