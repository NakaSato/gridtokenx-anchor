import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import BN from "bn.js";
import * as fs from 'fs';
import * as path from 'path';
import {
    Keypair,
    PublicKey,
    SystemProgram,
    LAMPORTS_PER_SOL
} from "@solana/web3.js";
import { assert } from "chai";
import type { TpcBenchmark } from "../target/types/tpc_benchmark";
import { summarize, collectMetadata } from "./utils/bench";

describe("TPC-C Performance Stress Test", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.TpcBenchmark as Program<TpcBenchmark>;
    const authority = provider.wallet as anchor.Wallet;

    // IDs for benchmark entities
    const W_ID = new BN(1);
    const D_ID = new BN(1);
    const CUSTOMER_COUNT = 20;
    const ITEM_COUNT = 100;

    let benchmarkConfig: PublicKey;
    let warehouseAccount: PublicKey;
    let districtAccount: PublicKey;
    let customerAccounts: PublicKey[] = [];
    let itemAccounts: PublicKey[] = [];
    let stockAccounts: PublicKey[] = [];

    before(async () => {
        console.log("Setting up TPC-C Benchmark environment...");

        // 1. Initial PDAs
        [benchmarkConfig] = PublicKey.findProgramAddressSync([Buffer.from("benchmark")], program.programId);
        [warehouseAccount] = PublicKey.findProgramAddressSync([Buffer.from("warehouse"), W_ID.toArrayLike(Buffer, "le", 8)], program.programId);
        [districtAccount] = PublicKey.findProgramAddressSync([Buffer.from("district"), W_ID.toArrayLike(Buffer, "le", 8), D_ID.toArrayLike(Buffer, "le", 8)], program.programId);

        // 2. Initialize Benchmark
        const config = {
            warehouses: new BN(1),
            districtsPerWarehouse: 10,
            customersPerDistrict: 3000,
            totalItems: 100000,
            durationSeconds: new BN(3600),
            warmupPercent: 5,
            useRealTransactions: true
        };

        try {
            await program.methods.initializeBenchmark(config).accounts({
                benchmark: benchmarkConfig,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
            console.log("✓ Benchmark initialized");
        } catch (e) {
            console.log("! Benchmark might already be initialized");
        }

        // 3. Initialize Warehouse
        try {
            await program.methods.initializeWarehouse(
                W_ID, "Whse 1", "Street 1", "Street 2", "City", "ST", "12345", new BN(10)
            ).accounts({
                warehouse: warehouseAccount,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
            console.log("✓ Warehouse initialized");
        } catch (e: any) {
            if (e.message?.includes("already in use")) {
                console.log("✓ Warehouse already initialized");
            } else {
                console.error("! Warehouse init failed:", e.message);
            }
        }

        // 4. Initialize District
        try {
            await program.methods.initializeDistrict(
                W_ID, D_ID, "District 1", "Street 1", "Street 2", "City", "ST", "12345", new BN(5)
            ).accounts({
                district: districtAccount,
                warehouse: warehouseAccount,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
            console.log("✓ District initialized");
        } catch (e: any) {
            if (e.message?.includes("already in use")) {
                console.log("✓ District already initialized");
            } else {
                console.error("! District init failed:", e.message);
            }
        }

        // 5. Initialize Customers
        console.log(`Initializing ${CUSTOMER_COUNT} customers...`);
        for (let i = 1; i <= CUSTOMER_COUNT; i++) {
            const cId = new BN(i);
            const [custPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("customer"), W_ID.toArrayLike(Buffer, "le", 8), D_ID.toArrayLike(Buffer, "le", 8), cId.toArrayLike(Buffer, "le", 8)],
                program.programId
            );
            customerAccounts.push(custPda);

            try {
                await program.methods.initializeCustomer(
                    W_ID, D_ID, cId, "First", "MD", `Last${i}`, "Street", "Street", "City", "ST", "12345", "555-1234", { goodCredit: {} }, new BN(5000), new BN(10)
                ).accounts({
                    customer: custPda,
                    district: districtAccount,
                    authority: authority.publicKey,
                    systemProgram: SystemProgram.programId
                }).rpc();
            } catch (e: any) {
                if (!e.message?.includes("already in use")) {
                    console.error(`! Customer ${i} init failed:`, e.message);
                }
            }
        }

        // 6. Initialize Items and Stocks
        console.log(`Initializing ${ITEM_COUNT} items and stocks...`);
        for (let i = 1; i <= ITEM_COUNT; i++) {
            const iId = new BN(i);
            const [itemPda] = PublicKey.findProgramAddressSync([Buffer.from("item"), iId.toArrayLike(Buffer, "le", 8)], program.programId);
            const [stockPda] = PublicKey.findProgramAddressSync([Buffer.from("stock"), W_ID.toArrayLike(Buffer, "le", 8), iId.toArrayLike(Buffer, "le", 8)], program.programId);
            itemAccounts.push(itemPda);
            stockAccounts.push(stockPda);

            try {
                await program.methods.initializeItem(iId, new BN(i), `Item ${i}`, new BN(100), "Data").accounts({
                    item: itemPda,
                    authority: authority.publicKey,
                    systemProgram: SystemProgram.programId
                }).rpc();
            } catch (e: any) {
                if (!e.message?.includes("already in use")) {
                    console.error(`! Item ${i} init failed:`, e.message);
                }
            }
            try {
                await program.methods.initializeStock(
                    W_ID, iId, new BN(100), "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "Data"
                ).accounts({
                    stock: stockPda,
                    warehouse: warehouseAccount,
                    item: itemPda,
                    authority: authority.publicKey,
                    systemProgram: SystemProgram.programId
                }).rpc();
            } catch (e: any) {
                if (!e.message?.includes("already in use")) {
                    console.error(`! Stock ${i} init failed:`, e.message);
                }
            }
        }
        console.log("✓ Setup complete");
    });

    it("Runs TPC-C Workload Mix (NewOrder and Payment)", async () => {
        // Env-tunable so the same harness serves CI smoke runs and paper-grade runs.
        const TX_COUNT = parseInt(process.env.TPC_TX_COUNT ?? "200", 10);
        const CONCURRENCY = parseInt(process.env.TPC_CONCURRENCY ?? "10", 10);
        console.log(`\n--- STARTING TPC-C STRESS TEST (${TX_COUNT} TXs, Concurrency: ${CONCURRENCY}) ---\n`);

        const latencies: number[] = [];
        const signatures: string[] = [];
        let successCount = 0;
        let failCount = 0;
        const startTime = Date.now();

        for (let i = 0; i < TX_COUNT; i += CONCURRENCY) {
            const batchSize = Math.min(CONCURRENCY, TX_COUNT - i);
            const promises = [];

            for (let j = 0; j < batchSize; j++) {
                const txType = Math.random() < 0.5 ? "NewOrder" : "Payment";
                const custIdx = Math.floor(Math.random() * CUSTOMER_COUNT);
                const cId = new BN(custIdx + 1);
                const custPda = customerAccounts[custIdx];

                const txStart = Date.now();
                let promise;

                if (txType === "NewOrder") {
                    const oId = new BN(Date.now() + i + j);
                    const [orderPda] = PublicKey.findProgramAddressSync([Buffer.from("order"), W_ID.toArrayLike(Buffer, "le", 8), D_ID.toArrayLike(Buffer, "le", 8), oId.toArrayLike(Buffer, "le", 8)], program.programId);
                    const [newOrderPda] = PublicKey.findProgramAddressSync([Buffer.from("new_order"), W_ID.toArrayLike(Buffer, "le", 8), D_ID.toArrayLike(Buffer, "le", 8), oId.toArrayLike(Buffer, "le", 8)], program.programId);

                    // Create 5 order lines
                    const orderLines = [];
                    const remainingAccounts = [];
                    for (let l = 0; l < 5; l++) {
                        const itemIdx = Math.floor(Math.random() * ITEM_COUNT);
                        const iId = new BN(itemIdx + 1);
                        orderLines.push({ iId, supplyWId: W_ID, quantity: 1 });
                        remainingAccounts.push({ pubkey: itemAccounts[itemIdx], isWritable: false, isSigner: false });
                        remainingAccounts.push({ pubkey: stockAccounts[itemIdx], isWritable: true, isSigner: false });
                    }

                    promise = program.methods.newOrder(W_ID, D_ID, cId, oId, orderLines)
                        .accounts({
                            warehouse: warehouseAccount,
                            district: districtAccount,
                            customer: custPda,
                            order: orderPda,
                            newOrder: newOrderPda,
                            authority: authority.publicKey,
                            systemProgram: SystemProgram.programId
                        } as any)
                        .remainingAccounts(remainingAccounts)
                        .rpc()
                        .then((sig) => {
                            latencies.push(Date.now() - txStart);
                            signatures.push(sig);
                            successCount++;
                        })
                        .catch(e => {
                            console.error("NewOrder fail:", e);
                            failCount++;
                        });
                } else {
                    const hId = new BN(Date.now() + i + j);
                    const [historyPda] = PublicKey.findProgramAddressSync([Buffer.from("history"), W_ID.toArrayLike(Buffer, "le", 8), D_ID.toArrayLike(Buffer, "le", 8), hId.toArrayLike(Buffer, "le", 8)], program.programId);

                    promise = program.methods.payment(W_ID, D_ID, cId, W_ID, D_ID, hId, new BN(100), false)
                        .accounts({
                            warehouse: warehouseAccount,
                            district: districtAccount,
                            customer: custPda,
                            history: historyPda,
                            customerIndex: null,
                            payer: authority.publicKey,
                            systemProgram: SystemProgram.programId
                        } as any)
                        .rpc()
                        .then((sig) => {
                            latencies.push(Date.now() - txStart);
                            signatures.push(sig);
                            successCount++;
                        })
                        .catch(e => {
                            console.error("Payment fail:", e);
                            failCount++;
                        });
                }
                promises.push(promise);
            }

            await Promise.allSettled(promises);
            process.stdout.write(".");
        }

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        // summarize() copies before sorting (the old `latencies.sort()[floor(n*0.95)]`
        // mutated the array and could index out of bounds at p95).
        const lat = summarize(latencies);
        const tps = successCount / duration;

        // Compute-unit capture, post-hoc and off the latency path.
        const cuSamples: number[] = [];
        for (const sig of signatures) {
            try {
                const tx = await provider.connection.getTransaction(sig, {
                    commitment: "confirmed",
                    maxSupportedTransactionVersion: 0,
                });
                const consumed = tx?.meta?.computeUnitsConsumed;
                if (typeof consumed === "number") cuSamples.push(consumed);
            } catch {
                /* best-effort */
            }
        }
        const cu = cuSamples.length > 0 ? summarize(cuSamples) : null;

        const timestamp = new Date().toISOString();
        const metadata = await collectMetadata(provider.connection, timestamp);
        const results = {
            timestamp,
            benchmark: "TPC-C",
            metadata,
            workloadMix: "50% NewOrder / 50% Payment",
            txCount: TX_COUNT,
            concurrency: CONCURRENCY,
            successCount,
            failCount,
            successRate: successCount / TX_COUNT,
            durationSeconds: duration,
            throughputTps: tps,
            latencyMs: lat,
            computeUnits: cu,
        };

        console.log(`\n\n--- TPC-C STRESS TEST RESULTS ---`);
        console.log(`commit ${metadata.gitCommit.slice(0, 8)}${metadata.gitDirty ? "-dirty" : ""}  cluster ${metadata.clusterVersion}`);
        console.log(`Duration:       ${duration.toFixed(2)}s`);
        console.log(`Success:        ${successCount} / ${TX_COUNT} (${(100 * successCount / TX_COUNT).toFixed(1)}%)  fail ${failCount}`);
        console.log(`Throughput:     ${tps.toFixed(2)} TPS @ concurrency ${CONCURRENCY}`);
        console.log(`Latency ms:     mean ${lat.mean.toFixed(2)}  stddev ${lat.stddev.toFixed(2)}  p50 ${lat.p50.toFixed(2)}  p95 ${lat.p95.toFixed(2)}  p99 ${lat.p99.toFixed(2)}  ci95 ±${lat.ci95.toFixed(2)}`);
        console.log(`CU/tx:          ${cu ? `mean ${cu.mean.toFixed(0)}  p95 ${cu.p95.toFixed(0)}  max ${cu.max.toFixed(0)}` : "n/a"}`);
        console.log(`---------------------------------\n`);

        // Persist JSON (full distribution + metadata) and a one-row CSV.
        const resultsDir = path.join(process.cwd(), 'test-results', 'tpc');
        fs.mkdirSync(resultsDir, { recursive: true });
        const stamp = timestamp.replace(/[:.]/g, "-");
        fs.writeFileSync(path.join(resultsDir, `tpc-c-${stamp}.json`), JSON.stringify(results, null, 2));
        const csvCols = ["timestamp", "git_commit", "cluster", "tx_count", "concurrency", "success", "fail", "duration_s", "throughput_tps",
            "lat_mean_ms", "lat_stddev_ms", "lat_p50_ms", "lat_p95_ms", "lat_p99_ms", "lat_ci95_ms", "cu_mean", "cu_p95", "cu_max"];
        const csvRow = [timestamp, metadata.gitCommit, metadata.clusterVersion, TX_COUNT, CONCURRENCY, successCount, failCount,
            duration.toFixed(4), tps.toFixed(4), lat.mean, lat.stddev, lat.p50, lat.p95, lat.p99, lat.ci95,
            cu?.mean ?? "", cu?.p95 ?? "", cu?.max ?? ""].join(",");
        fs.writeFileSync(path.join(resultsDir, `tpc-c-${stamp}.csv`), csvCols.join(",") + "\n" + csvRow + "\n");
        console.log(`Results saved to: ${resultsDir}/tpc-c-${stamp}.{json,csv}`);

        assert.isAtLeast(successCount, TX_COUNT * 0.8, "Success rate should be at least 80%");
        assert.isAbove(tps, 5, "Throughput should exceed 5 TPS");
    });
});
