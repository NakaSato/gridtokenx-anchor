import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
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
        } catch (e) { }

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
        } catch (e) { }

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
            } catch (e) { }
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

                await program.methods.initializeStock(
                    W_ID, iId, new BN(100), "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "Data"
                ).accounts({
                    stock: stockPda,
                    warehouse: warehouseAccount,
                    item: itemPda,
                    authority: authority.publicKey,
                    systemProgram: SystemProgram.programId
                }).rpc();
            } catch (e) { }
        }
        console.log("✓ Setup complete");
    });

    it("Runs TPC-C Workload Mix (NewOrder and Payment)", async () => {
        const TX_COUNT = 200;
        const CONCURRENCY = 10;
        console.log(`\n--- STARTING TPC-C STRESS TEST (${TX_COUNT} TXs, Concurrency: ${CONCURRENCY}) ---\n`);

        const latencies: number[] = [];
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
                        .then(() => {
                            latencies.push(Date.now() - txStart);
                            successCount++;
                        })
                        .catch(e => {
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
                        .then(() => {
                            latencies.push(Date.now() - txStart);
                            successCount++;
                        })
                        .catch(e => {
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
        const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
        const tps = successCount / duration;

        const results = {
            timestamp: new Date().toISOString(),
            benchmark: "TPC-C",
            txCount: TX_COUNT,
            successCount,
            failCount,
            duration,
            tps,
            avgLatencyMs: avgLatency
        };

        console.log(`\n\n--- TPC-C STRESS TEST RESULTS ---`);
        console.log(`Duration:       ${duration.toFixed(2)}s`);
        console.log(`Success Count:  ${successCount}`);
        console.log(`Fail Count:     ${failCount}`);
        console.log(`Throughput:     ${tps.toFixed(2)} TPS`);
        console.log(`Avg Latency:    ${avgLatency.toFixed(2)}ms`);
        console.log(`---------------------------------\n`);

        // Save results to file
        const resultsDir = path.join(process.cwd(), 'test-results', 'tpc');
        if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir, { recursive: true });
        }
        const filepath = path.join(resultsDir, `tpc-c-results-${Date.now()}.json`);
        fs.writeFileSync(filepath, JSON.stringify(results, null, 2));
        console.log(`Results saved to: ${filepath}`);

        assert.isAtLeast(successCount, TX_COUNT * 0.8, "Success rate should be at least 80%");
    });
});
