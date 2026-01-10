
import * as anchor from "@coral-xyz/anchor";
import { BN } from "bn.js";
import {
    TestEnvironment,
    expect
} from "../setup.ts";

describe("P2P Trading Performance Benchmarks", () => {
    let env: TestEnvironment;
    let prosumer: anchor.web3.Keypair;
    let consumer: anchor.web3.Keypair;
    let marketPda: anchor.web3.PublicKey;

    const ORDER_COUNT = 10; // Number of orders for batch testing

    before(async () => {
        env = await TestEnvironment.create();
        prosumer = env.testUser;
        consumer = env.generateTestKeypair();
        await env.airdropSol(consumer.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);

        // Initialize Market
        [marketPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("market")],
            env.tradingProgram.programId
        );

        try {
            await env.tradingProgram.account.market.fetch(marketPda);
        } catch (e) {
            await env.tradingProgram.methods
                .initializeMarket()
                .accounts({
                    market: marketPda,
                    authority: env.authority.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([env.authority])
                .rpc();
        }

        console.log(`\n  🚀 Starting Benchmarks with ${ORDER_COUNT} iterations per operation...`);
    });

    it("Measure Limit Order Creation Latency", async () => {
        const amount = new BN(50);
        const price = new BN(10);

        const start = Date.now();
        const signatures: string[] = [];

        // We need to fetch market state to get the correct order index for each one
        // This simulates a real scenario where we need to know the index.
        // However, fetching in loop adds read latency. For write throughput, strictly speaking we want to measure the write instruction.
        // But the PDA derivation depends on the on-chain counter.
        // To optimize, we can pre-fetch and increment locally if we were the only writer, but here we just loop.

        for (let i = 0; i < ORDER_COUNT; i++) {
            // We fetch the count inside the loop to be correct with the contract logic
            // (real app would probably cache limit or use optimistic concurrency)
            const marketState = await env.tradingProgram.account.market.fetch(marketPda);
            const orderIndex = marketState.activeOrders;

            const [orderPda] = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("order"), prosumer.publicKey.toBuffer(), new BN(orderIndex).toArrayLike(Buffer, "le", 8)],
                env.tradingProgram.programId
            );

            const tx = await env.tradingProgram.methods
                .createSellOrder(amount, price)
                .accounts({
                    market: marketPda,
                    order: orderPda,
                    ercCertificate: null,
                    authority: prosumer.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([prosumer])
                .rpc();

            signatures.push(tx);
        }

        const end = Date.now();
        const totalTime = end - start;
        const avgTime = totalTime / ORDER_COUNT;
        const tps = 1000 / avgTime;

        console.log(`\n  📊 [Order Creation] Results:`);
        console.log(`    Total Time: ${totalTime} ms`);
        console.log(`    Avg Latency: ${avgTime.toFixed(2)} ms/order`);
        console.log(`    Approx TPS: ${tps.toFixed(2)} ops/sec`);

        expect(signatures.length).to.equal(ORDER_COUNT);
    });

    it("Measure Order Matching Latency", async () => {
        // Setup: We need buy orders to match the sell orders created above.
        // Or create pairs.
        // The sell orders from previous test are still there (active).
        // Let's create matching buy orders and match them.

        const amount = new BN(50);
        const price = new BN(10); // Match price

        const start = Date.now();
        let matchCount = 0;

        // We assume there are at least ORDER_COUNT sell orders from previous test.
        // We will loop and match them.
        // NOTE: In the negative test implementation I noticed creation increments index. I need to find the specific order PDAs.
        // Getting all accounts is slow.
        // Instead, I'll create new pairs to separate the "Match" benchmark from "Creation" benchmark clean-up issues.

        // Actually, let's just do a distinct loop for matching:
        // Create Sell + Create Buy + Match -> Measure the Match step only? 
        // Or measure the full lifecycle?
        // Let's measure the "Match" instruction latency specifically.
        // So we prep the orders first efficiently.

        console.log(`    ℹ️  Pre-creating ${ORDER_COUNT} pairs for matching benchmark...`);
        const pairs: { sellOrder: anchor.web3.PublicKey, buyOrder: anchor.web3.PublicKey }[] = [];

        for (let i = 0; i < ORDER_COUNT; i++) {
            // 1. Sell
            let marketState = await env.tradingProgram.account.market.fetch(marketPda);
            let idx = marketState.activeOrders;
            const [sellPda] = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("order"), prosumer.publicKey.toBuffer(), new BN(idx).toArrayLike(Buffer, "le", 8)],
                env.tradingProgram.programId
            );
            await env.tradingProgram.methods.createSellOrder(amount, price).accounts({
                market: marketPda, order: sellPda, ercCertificate: null, authority: prosumer.publicKey, systemProgram: anchor.web3.SystemProgram.programId
            }).signers([prosumer]).rpc();

            // 2. Buy
            marketState = await env.tradingProgram.account.market.fetch(marketPda);
            idx = marketState.activeOrders;
            const [buyPda] = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("order"), consumer.publicKey.toBuffer(), new BN(idx).toArrayLike(Buffer, "le", 8)],
                env.tradingProgram.programId
            );
            await env.tradingProgram.methods.createBuyOrder(amount, price).accounts({
                market: marketPda, order: buyPda, authority: consumer.publicKey, systemProgram: anchor.web3.SystemProgram.programId
            }).signers([consumer]).rpc();

            pairs.push({ sellOrder: sellPda, buyOrder: buyPda });
        }

        console.log(`    ℹ️  Starting Match Benchmark...`);
        const matchStart = Date.now();

        for (const pair of pairs) {
            const [tradeRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("trade"), pair.buyOrder.toBuffer(), pair.sellOrder.toBuffer()],
                env.tradingProgram.programId
            );

            await env.tradingProgram.methods
                .matchOrders(amount)
                .accounts({
                    market: marketPda,
                    buyOrder: pair.buyOrder,
                    sellOrder: pair.sellOrder,
                    tradeRecord: tradeRecordPda,
                    authority: env.authority.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([env.authority])
                .rpc();

            matchCount++;
        }

        const matchEnd = Date.now();
        const totalTime = matchEnd - matchStart;
        const avgTime = totalTime / ORDER_COUNT;
        const tps = 1000 / avgTime;

        console.log(`\n  📊 [Order Matching] Results:`);
        console.log(`    Total Time: ${totalTime} ms`);
        console.log(`    Avg Latency: ${avgTime.toFixed(2)} ms/match`);
        console.log(`    Approx TPS: ${tps.toFixed(2)} ops/sec`);

        expect(matchCount).to.equal(ORDER_COUNT);
    });
});
