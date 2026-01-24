
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import BN from "bn.js";
import fs from "fs";
import path from "path";

// --- Configuration ---
const CONFIG = {
    rpcUrl: process.env.SOLANA_URL || "http://127.0.0.1:8899",
    // We will pre-create 'concurrency' * 'txsPerClient' pairs.
    // Each worker handles 'txsPerClient' settlements.
    concurrency: 50,
    txsPerClient: 1,
    slotCommitment: "confirmed" as "confirmed" | "finalized" | "processed",
};

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
    console.log("🚀 Starting GridTokenX Trading Benchmark (Mixed Mode)");
    console.log("=====================================================");
    console.log(`RPC URL:     ${CONFIG.rpcUrl}`);
    console.log(`Workers:     ${CONFIG.concurrency}`);
    console.log(`Txs/Worker:  ${CONFIG.txsPerClient}`);
    console.log(`Total Sets:  ${CONFIG.concurrency * CONFIG.txsPerClient}`);

    const connection = new Connection(CONFIG.rpcUrl, CONFIG.slotCommitment);

    // 1. Setup Admin
    const admin = Keypair.generate();
    console.log(`\n🛠  Funding Admin...`);
    {
        const sig = await connection.requestAirdrop(admin.publicKey, 100 * 1_000_000_000);
        const latestInfo = await connection.getLatestBlockhash();
        await connection.confirmTransaction({ signature: sig, ...latestInfo });
    }

    const wallet = new anchor.Wallet(admin);
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: CONFIG.slotCommitment, preflightCommitment: CONFIG.slotCommitment });
    anchor.setProvider(provider);

    // Load Program
    const idlPath = path.resolve("target/idl/trading.json");
    if (!fs.existsSync(idlPath)) { throw new Error("IDL not found at " + idlPath); }
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
    const program = new anchor.Program(idl as any, provider);

    // 2. Setup Market
    console.log("Initializing Market...");
    const [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], program.programId);
    try {
        await program.methods.initializeMarket()
            .accounts({ market: marketPda, authority: admin.publicKey, systemProgram: SystemProgram.programId })
            .signers([admin]).rpc();
    } catch (e) { }

    // 3. Setup Mints
    console.log("Creating Mints...");
    const currencyMint = await createMint(connection, admin, admin.publicKey, null, 6);
    const energyMint = await createMint(connection, admin, admin.publicKey, null, 6);

    // 4. Setup Escrows & Collectors
    console.log("Setting up Admin Accounts...");
    const buyerCurrencyEscrow = await getOrCreateAssociatedTokenAccount(connection, admin, currencyMint, admin.publicKey);
    await mintTo(connection, admin, currencyMint, buyerCurrencyEscrow.address, admin.publicKey, 1_000_000_000_000);

    const sellerEnergyEscrow = await getOrCreateAssociatedTokenAccount(connection, admin, energyMint, admin.publicKey);
    await mintTo(connection, admin, energyMint, sellerEnergyEscrow.address, admin.publicKey, 1_000_000_000_000);

    const feeCollector = await getOrCreateAssociatedTokenAccount(connection, admin, currencyMint, admin.publicKey);
    const wheelingCollector = await getOrCreateAssociatedTokenAccount(connection, admin, currencyMint, admin.publicKey);

    // 5. PHASE 1: SEQUENTIAL PREPARATION
    console.log("\n📦 PHASE 1: PREPARING ORDERS (Sequential)...");

    const masterSeller = Keypair.generate();
    const masterBuyer = Keypair.generate();

    await connection.requestAirdrop(masterSeller.publicKey, 10e9).then(s => connection.confirmTransaction(s));
    await connection.requestAirdrop(masterBuyer.publicKey, 10e9).then(s => connection.confirmTransaction(s));

    const sellerCurrencyDest = await getOrCreateAssociatedTokenAccount(connection, admin, currencyMint, masterSeller.publicKey);
    const buyerEnergyDest = await getOrCreateAssociatedTokenAccount(connection, admin, energyMint, masterBuyer.publicKey);

    // Pre-create all orders
    interface TradePair {
        sellOrder: PublicKey;
        buyOrder: PublicKey;
    }
    const tradePairs: TradePair[] = [];
    const totalPairs = CONFIG.concurrency * CONFIG.txsPerClient;

    for (let i = 0; i < totalPairs; i++) {
        if ((i + 1) % 5 === 0) process.stdout.write(`\rCreating pair ${i + 1}/${totalPairs}...`);

        // Fetch active orders each time to ensure correct seed
        const mAcc = await (program.account as any).market.fetch(marketPda);
        const aoBuf = new BN(mAcc.activeOrders).toArrayLike(Buffer, 'le', 4);

        // Create Sell
        const [sellOrder] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), masterSeller.publicKey.toBuffer(), aoBuf],
            program.programId
        );
        await program.methods.createSellOrder(new BN(100), new BN(50))
            .accounts({
                market: marketPda, order: sellOrder, authority: masterSeller.publicKey,
                ercCertificate: null, systemProgram: SystemProgram.programId
            })
            .signers([masterSeller]).rpc();

        // Fetch again for Buy
        const mAcc2 = await (program.account as any).market.fetch(marketPda);
        const aoBuf2 = new BN(mAcc2.activeOrders).toArrayLike(Buffer, 'le', 4);

        // Create Buy
        const [buyOrder] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), masterBuyer.publicKey.toBuffer(), aoBuf2],
            program.programId
        );
        await program.methods.createBuyOrder(new BN(100), new BN(50))
            .accounts({
                market: marketPda, order: buyOrder, authority: masterBuyer.publicKey,
                systemProgram: SystemProgram.programId
            })
            .signers([masterBuyer]).rpc();

        tradePairs.push({ sellOrder, buyOrder });
    }
    console.log("\nOrders Prepared.");

    // 6. PHASE 2: CONCURRENT SETTLEMENT
    console.log("\n🚀 PHASE 2: BENCHMARKING SETTLEMENT (Concurrent)...");
    const metrics = new Metrics();
    metrics.start();

    // Distribute pairs to workers
    const chunkedPairs: TradePair[][] = [];
    for (let i = 0; i < CONFIG.concurrency; i++) {
        chunkedPairs.push(tradePairs.slice(i * CONFIG.txsPerClient, (i + 1) * CONFIG.txsPerClient));
    }

    const workers = chunkedPairs.map(async (pairs, wIdx) => {
        for (const p of pairs) {
            const start = Date.now();
            try {
                await program.methods.executeAtomicSettlement(new BN(100), new BN(50), new BN(0))
                    .accounts({
                        market: marketPda, buyOrder: p.buyOrder, sellOrder: p.sellOrder,
                        buyerCurrencyEscrow: buyerCurrencyEscrow.address,
                        sellerEnergyEscrow: sellerEnergyEscrow.address,
                        sellerCurrencyAccount: sellerCurrencyDest.address,
                        buyerEnergyAccount: buyerEnergyDest.address,
                        feeCollector: feeCollector.address,
                        wheelingCollector: wheelingCollector.address,
                        energyMint: energyMint, currencyMint: currencyMint,
                        escrowAuthority: admin.publicKey, marketAuthority: admin.publicKey,
                        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
                        secondaryTokenProgram: TOKEN_PROGRAM_ID
                    })
                    .signers([admin])
                    .rpc();

                metrics.recordSuccess();
                metrics.recordLatency(Date.now() - start);
            } catch (e) {
                console.error(`Worker ${wIdx} Error:`, e);
                metrics.recordFail();
            }
        }
    });

    await Promise.all(workers);
    metrics.end();

    // --- Report ---
    console.log("\n📊  Settlement Benchmark Results");
    console.log("==========================================");
    console.log(`Concurrent Workers: ${CONFIG.concurrency}`);
    console.log(`Total Settlements:  ${metrics.successCount}`);
    console.log(`Total Duration:     ${metrics.durationSec.toFixed(2)}s`);
    console.log(`Settlement TPS:     ${metrics.tps.toFixed(2)} tx/s`);
    console.log(`Avg Latency:        ${metrics.avgLatency.toFixed(2)} ms`);
    console.log(`p95 Latency:        ${metrics.p95Latency.toFixed(2)} ms`);
    console.log(`Failures:           ${metrics.failCount}`);
    console.log("==========================================");
}

main().catch(console.error);
