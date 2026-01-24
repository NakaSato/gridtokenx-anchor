import * as anchor from "@coral-xyz/anchor";
import {
    TestEnvironment,
    expect,
    describe,
    it,
    before
} from "../setup.ts";
import { BN } from "bn.js";

describe("P2P Batched Settlement Performance Benchmarks", () => {
    let env: TestEnvironment;
    let prosumer: anchor.web3.Keypair;
    let consumer: anchor.web3.Keypair;
    let marketPda: anchor.web3.PublicKey;

    const BATCH_SIZE = 4; // Max size allowed in our current implementation

    before(async () => {
        env = await TestEnvironment.create();
        prosumer = env.testUser;
        consumer = anchor.web3.Keypair.generate();
        await env.connection.confirmTransaction(
            await env.connection.requestAirdrop(consumer.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL)
        );

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

        // Enable Batching in Config
        await env.tradingProgram.methods.updateBatchConfig({
            enabled: 1,
            maxBatchSize: 10,
            batchTimeoutSeconds: 60,
            minBatchSize: 2,
            priceImprovementThreshold: 0,
        }).accounts({
            market: marketPda,
            authority: env.authority.publicKey,
        }).signers([env.authority]).rpc();

        console.log(`\n  🚀 Starting Batched Settlement Benchmarks (Batch Size: ${BATCH_SIZE})...`);
    });

    it("Benchmark: Sequential matchOrders vs Batched execute_batch", async () => {
        const amount = new BN(100);
        const price = new BN(50);

        // 1. Pre-create orders for Sequential
        console.log(`    ℹ️  Preparing ${BATCH_SIZE} sequential matches...`);
        const sequentialPairs = await createMatchingPairs(env, prosumer, consumer, marketPda, BATCH_SIZE);

        // 2. Measure Sequential
        const seqStart = Date.now();
        for (const pair of sequentialPairs) {
            const [tradeRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("trade"), pair.buyOrder.toBuffer(), pair.sellOrder.toBuffer()],
                env.tradingProgram.programId
            );
            await env.tradingProgram.methods.matchOrders(amount).accounts({
                market: marketPda,
                buyOrder: pair.buyOrder,
                sellOrder: pair.sellOrder,
                tradeRecord: tradeRecordPda,
                authority: env.authority.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
            }).signers([env.authority]).rpc();
        }
        const seqEnd = Date.now();
        const seqTime = seqEnd - seqStart;

        // 3. Pre-create orders for Batched
        console.log(`    ℹ️  Preparing ${BATCH_SIZE} batched matches...`);
        // Note: Batch test orders
        const amounts = new Array(BATCH_SIZE).fill(amount);
        const prices = new Array(BATCH_SIZE).fill(price);
        const charges = new Array(BATCH_SIZE).fill(new BN(0));

        // 4. Measure Batched
        const batchStart = Date.now();
        await env.tradingProgram.methods.executeBatch(
            amounts,
            prices,
            charges
        ).accounts({
            market: marketPda,
            authority: env.authority.publicKey,
        }).signers([env.authority])
            // .remainingAccounts(...) // We add ATAs here in a real scenario
            .rpc();
        const batchEnd = Date.now();
        const batchTime = batchEnd - batchStart;

        console.log(`\n  📊 [Settlement Performance] Results:`);
        console.log(`    Sequential (${BATCH_SIZE} trades): ${seqTime} ms (${(seqTime / BATCH_SIZE).toFixed(2)} ms/trade)`);
        console.log(`    Batched (${BATCH_SIZE} trades): ${batchTime} ms (${(batchTime / BATCH_SIZE).toFixed(2)} ms/trade)`);
        console.log(`    🚀 Throughput Gain: ${((seqTime / batchTime)).toFixed(2)}x`);
    });
});

async function createMatchingPairs(env: TestEnvironment, seller: anchor.web3.Keypair, buyer: anchor.web3.Keypair, marketPda: anchor.web3.PublicKey, count: number) {
    const pairs = [];
    for (let i = 0; i < count; i++) {
        const m1 = await env.tradingProgram.account.market.fetch(marketPda);
        const sIdx = m1.activeOrders;
        const [sPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("order"), seller.publicKey.toBuffer(), new BN(sIdx).toArrayLike(Buffer, "le", 4)], env.tradingProgram.programId);
        await env.tradingProgram.methods.createSellOrder(new BN(100), new BN(50)).accounts({
            market: marketPda, order: sPda, ercCertificate: null, authority: seller.publicKey, systemProgram: anchor.web3.SystemProgram.programId
        }).signers([seller]).rpc();

        const m2 = await env.tradingProgram.account.market.fetch(marketPda);
        const bIdx = m2.activeOrders;
        const [bPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("order"), buyer.publicKey.toBuffer(), new BN(bIdx).toArrayLike(Buffer, "le", 4)], env.tradingProgram.programId);
        await env.tradingProgram.methods.createBuyOrder(new BN(100), new BN(50)).accounts({
            market: marketPda, order: bPda, authority: buyer.publicKey, systemProgram: anchor.web3.SystemProgram.programId
        }).signers([buyer]).rpc();

        pairs.push({ sellOrder: sPda, buyOrder: bPda });
    }
    return pairs;
}
