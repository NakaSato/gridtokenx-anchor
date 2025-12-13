
import * as anchor from "@coral-xyz/anchor";
import { BN } from "bn.js";
import {
    TestEnvironment,
    expect
} from "../setup.ts";
import { TestUtils } from "../utils/index.ts";

describe("P2P Trading Negative Scenarios", () => {
    let env: TestEnvironment;
    let prosumer: anchor.web3.Keypair;
    let consumer: anchor.web3.Keypair;
    let maliciousUser: anchor.web3.Keypair;

    let marketPda: anchor.web3.PublicKey;

    before(async () => {
        env = await TestEnvironment.create();

        // Create distinct identities
        prosumer = env.testUser;
        consumer = env.generateTestKeypair();
        maliciousUser = env.generateTestKeypair();

        await env.airdropSol(consumer.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
        await env.airdropSol(maliciousUser.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);

        console.log(`  Initialized Negative Tests with Prosumer: ${prosumer.publicKey.toBase58()}, Consumer: ${consumer.publicKey.toBase58()}, Attacker: ${maliciousUser.publicKey.toBase58()}`);

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
    });

    it("should fail when creating order with invalid amount (0)", async () => {
        const amount = new BN(0);
        const price = new BN(10);

        try {
            // Derive PDA (simplified for negative test, just need valid derivation)
            const marketState = await env.tradingProgram.account.market.fetch(marketPda);
            const orderIndex = marketState.activeOrders;
            const [orderPda] = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("order"), prosumer.publicKey.toBuffer(), new BN(orderIndex).toArrayLike(Buffer, "le", 8)],
                env.tradingProgram.programId
            );

            await env.tradingProgram.methods
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

            throw new Error("Should have failed with InvalidAmount");
        } catch (e: any) {
            expect(e.message).to.contain("InvalidAmount"); // Check against error defined in lib.rs
        }
    });

    it("should fail when creating order with invalid price (0)", async () => {
        const amount = new BN(50);
        const price = new BN(0);

        try {
            const marketState = await env.tradingProgram.account.market.fetch(marketPda);
            const orderIndex = marketState.activeOrders;
            const [orderPda] = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("order"), prosumer.publicKey.toBuffer(), new BN(orderIndex).toArrayLike(Buffer, "le", 8)],
                env.tradingProgram.programId
            );

            await env.tradingProgram.methods
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

            throw new Error("Should have failed with InvalidPrice");
        } catch (e: any) {
            expect(e.message).to.contain("InvalidPrice");
        }
    });

    it("should fail validation when matching orders with Price Mismatch", async () => {
        const amount = new BN(50);
        const sellPrice = new BN(20); // Higher price
        const buyPrice = new BN(10);  // Lower price (mismatch)

        // 1. Create Sell Order
        let sellOrderPda: anchor.web3.PublicKey;
        {
            const marketState = await env.tradingProgram.account.market.fetch(marketPda);
            const orderIndex = marketState.activeOrders;
            [sellOrderPda] = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("order"), prosumer.publicKey.toBuffer(), new BN(orderIndex).toArrayLike(Buffer, "le", 8)],
                env.tradingProgram.programId
            );
            await env.tradingProgram.methods.createSellOrder(amount, sellPrice).accounts({
                market: marketPda, order: sellOrderPda, ercCertificate: null, authority: prosumer.publicKey, systemProgram: anchor.web3.SystemProgram.programId
            }).signers([prosumer]).rpc();
        }

        // 2. Create Buy Order
        let buyOrderPda: anchor.web3.PublicKey;
        {
            const marketState = await env.tradingProgram.account.market.fetch(marketPda);
            const orderIndex = marketState.activeOrders;
            [buyOrderPda] = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("order"), consumer.publicKey.toBuffer(), new BN(orderIndex).toArrayLike(Buffer, "le", 8)],
                env.tradingProgram.programId
            );
            await env.tradingProgram.methods.createBuyOrder(amount, buyPrice).accounts({
                market: marketPda, order: buyOrderPda, authority: consumer.publicKey, systemProgram: anchor.web3.SystemProgram.programId
            }).signers([consumer]).rpc();
        }

        // 3. Try Match
        try {
            const [tradeRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("trade"), buyOrderPda.toBuffer(), sellOrderPda.toBuffer()],
                env.tradingProgram.programId
            );

            await env.tradingProgram.methods
                .matchOrders(amount)
                .accounts({
                    market: marketPda,
                    buyOrder: buyOrderPda,
                    sellOrder: sellOrderPda,
                    tradeRecord: tradeRecordPda,
                    authority: env.authority.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([env.authority])
                .rpc();

            throw new Error("Should have failed with PriceMismatch");
        } catch (e: any) {
            expect(e.message).to.contain("Price mismatch"); // ErrorCode::PriceMismatch
        }
    });

    it("should fail unauthorized cancellation attemp", async () => {
        const amount = new BN(50);
        const price = new BN(10);

        // Create Sell Order
        let sellOrderPda: anchor.web3.PublicKey;
        const marketState = await env.tradingProgram.account.market.fetch(marketPda);
        const orderIndex = marketState.activeOrders;
        [sellOrderPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("order"), prosumer.publicKey.toBuffer(), new BN(orderIndex).toArrayLike(Buffer, "le", 8)],
            env.tradingProgram.programId
        );
        await env.tradingProgram.methods.createSellOrder(amount, price).accounts({
            market: marketPda, order: sellOrderPda, ercCertificate: null, authority: prosumer.publicKey, systemProgram: anchor.web3.SystemProgram.programId
        }).signers([prosumer]).rpc();

        // Try to cancel with malicious user
        try {
            await env.tradingProgram.methods
                .cancelOrder()
                .accounts({
                    market: marketPda,
                    order: sellOrderPda,
                    authority: maliciousUser.publicKey // Wrong signer
                })
                .signers([maliciousUser])
                .rpc();

            throw new Error("Should have failed with UnauthorizedAuthority");
        } catch (e: any) {
            expect(e.message).to.contain("Unauthorized authority");
        }
    });

    it("should fail when trying to match already filled/inactive orders", async () => {
        const amount = new BN(50);
        const price = new BN(10);

        // 1. Create matching orders
        // Sell Order
        let sellOrderPda: anchor.web3.PublicKey;
        {
            const marketState = await env.tradingProgram.account.market.fetch(marketPda);
            const orderIndex = marketState.activeOrders;
            [sellOrderPda] = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("order"), prosumer.publicKey.toBuffer(), new BN(orderIndex).toArrayLike(Buffer, "le", 8)],
                env.tradingProgram.programId
            );
            await env.tradingProgram.methods.createSellOrder(amount, price).accounts({
                market: marketPda, order: sellOrderPda, ercCertificate: null, authority: prosumer.publicKey, systemProgram: anchor.web3.SystemProgram.programId
            }).signers([prosumer]).rpc();
        }

        // Buy Order
        let buyOrderPda: anchor.web3.PublicKey;
        {
            const marketState = await env.tradingProgram.account.market.fetch(marketPda);
            // Re-fetch state because creating sell order incremented activeOrders
            // Actually, does createSellOrder increment activeOrders immediately? Yes.
            // But we need the index. 
            // Wait, createSellOrder and BuyOrder derive PDA from active_orders count BEFORE increment?
            // The instruction logic is:
            // seeds = [..., market.active_orders...], then market.active_orders += 1 inside the instr.
            // So we must fetch the state right before to get the correct seed.
            const orderIndex = marketState.activeOrders;
            [buyOrderPda] = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("order"), consumer.publicKey.toBuffer(), new BN(orderIndex).toArrayLike(Buffer, "le", 8)],
                env.tradingProgram.programId
            );
            await env.tradingProgram.methods.createBuyOrder(amount, price).accounts({
                market: marketPda, order: buyOrderPda, authority: consumer.publicKey, systemProgram: anchor.web3.SystemProgram.programId
            }).signers([consumer]).rpc();
        }

        // 2. Match them first time (should succeed)
        const [tradeRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("trade"), buyOrderPda.toBuffer(), sellOrderPda.toBuffer()],
            env.tradingProgram.programId
        );

        await env.tradingProgram.methods.matchOrders(amount).accounts({
            market: marketPda, buyOrder: buyOrderPda, sellOrder: sellOrderPda, tradeRecord: tradeRecordPda, authority: env.authority.publicKey, systemProgram: anchor.web3.SystemProgram.programId
        }).signers([env.authority]).rpc();

        // 3. Try to match same orders again
        try {
            // Need new trade record PDA (if seeding relies on trade params? No, it relies on order keys. 
            // If we re-use same PDA but it's init-ed, it will fail account exists.
            // But if we want to test logic error 'InactiveOrder', we might face account collision first.
            // The match_orders instruction has `init` on trade_record with seeds [trade, buy, sell]. 
            // So calling it again with same orders will definitely fail with "Account already in use" first unless we close the trade record or use differnt seeds.
            // BUT, the instruction logic *also* checks order status.
            // Anchor account init checks happen before instruction logic.
            // So we will likely get "already in use" error for trade_record, not "InactiveOrder".
            // To test InactiveOrder, we need to match partials or use a different trade record PDA logic? 
            // Or better, just match against a completed order with a NEW buy order?
            // Let's create a NEW buy order and try to match against the ALREADY FILLED sell order.

            // New Buy Order
            let buyOrder2Pda: anchor.web3.PublicKey;
            {
                const marketState2 = await env.tradingProgram.account.market.fetch(marketPda);
                const idx = marketState2.activeOrders;
                [buyOrder2Pda] = anchor.web3.PublicKey.findProgramAddressSync(
                    [Buffer.from("order"), consumer.publicKey.toBuffer(), new BN(idx).toArrayLike(Buffer, "le", 8)],
                    env.tradingProgram.programId
                );
                await env.tradingProgram.methods.createBuyOrder(amount, price).accounts({
                    market: marketPda, order: buyOrder2Pda, authority: consumer.publicKey, systemProgram: anchor.web3.SystemProgram.programId
                }).signers([consumer]).rpc();
            }

            // Try match new buy order with OLD COMPLETED sell order
            // New trade record PDA for (buyOrder2, sellOrder)
            const [tradeRecord2Pda] = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("trade"), buyOrder2Pda.toBuffer(), sellOrderPda.toBuffer()],
                env.tradingProgram.programId
            );

            await env.tradingProgram.methods.matchOrders(amount).accounts({
                market: marketPda, buyOrder: buyOrder2Pda, sellOrder: sellOrderPda, tradeRecord: tradeRecord2Pda, authority: env.authority.publicKey, systemProgram: anchor.web3.SystemProgram.programId
            }).signers([env.authority]).rpc();

            throw new Error("Should have failed with InactiveSellOrder");
        } catch (e: any) {
            // Depending on implementation, it might be "Inactive sell order" or "Inactive buy order"
            expect(e.message).to.contain("Inactive sell order");
        }
    });

});
