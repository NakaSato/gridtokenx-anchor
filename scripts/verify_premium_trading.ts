import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import BN from "bn.js";

async function main() {
    // ── Setup ────────────────────────────────────────────────────────────
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const tradingProgram = anchor.workspace.Trading;
    const authority = provider.wallet;

    console.log("═══════════════════════════════════════════════════════════════");
    console.log("  GridTokenX: Phase 9 Premium Trading Verification");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`  Authority: ${authority.publicKey.toBase58()}`);
    console.log(`  Program:   ${tradingProgram.programId.toBase58()}`);
    console.log("");

    // ── Step 1: Create Mock USDC Mint ───────────────────────────────────
    console.log("[1/5] Creating Mock USDC Mint...");
    const usdcMint = await createMint(
        provider.connection,
        (authority as any).payer,
        authority.publicKey,
        null,
        6
    );
    console.log(`  ✅ USDC Mint created: ${usdcMint.toBase58()}`);

    // ── Step 2: Configure Stablecoin in Market ──────────────────────────
    console.log("\n[2/5] Configuring USDC in Trading Market...");
    const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market")],
        tradingProgram.programId
    );

    const [tokenConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_config"), marketPda.toBuffer(), Buffer.from([2])], // 2 = Usdc
        tradingProgram.programId
    );

    const configAccount = await provider.connection.getAccountInfo(tokenConfigPda);
    if (!configAccount) {
        try {
            const tx = await tradingProgram.methods
                .configurePaymentToken(
                    2, // Usdc
                    new BN(1_000), // Min order size: 1 kWh (assuming 3 decimals)
                    100 // 1% deviation max
                )
                .accounts({
                    market: marketPda,
                    tokenConfig: tokenConfigPda,
                    tokenMint: usdcMint,
                    authority: authority.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();
            console.log(`  ✅ USDC configured for market. TX: ${tx}`);
        } catch (e: any) {
            console.error(`  ❌ Failed to configure token: ${e.message}`);
            throw e;
        }
    } else {
        console.log("  ℹ️ USDC already configured for market.");
    }

    // ── Step 3: Create Stablecoin Sell Order ─────────────────────────────
    console.log("\n[3/5] Creating Stablecoin Sell Order (USDC)...");

    // Get current market state to find active_orders count for seed
    const marketAccount = await tradingProgram.account.market.fetch(marketPda);
    const activeOrdersCount = marketAccount.activeOrders;

    const [orderPdaSell] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("order"),
            authority.publicKey.toBuffer(),
            new BN(activeOrdersCount).toBuffer("le", 4)
        ],
        tradingProgram.programId
    );

    const [paymentInfoPdaSell] = PublicKey.findProgramAddressSync(
        [Buffer.from("payment_info"), orderPdaSell.toBuffer()],
        tradingProgram.programId
    );

    try {
        const tx = await tradingProgram.methods
            .createStablecoinSellOrder(
                new BN(50_000), // 50 kWh
                new BN(250_000), // 0.25 USDC per kWh (6 decimals)
                2 // PaymentToken::Usdc
            )
            .accounts({
                market: marketPda,
                order: orderPdaSell,
                paymentInfo: paymentInfoPdaSell,
                tokenConfig: tokenConfigPda,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId,
            } as any)
            .rpc();
        console.log(`  ✅ Stablecoin Sell Order created. TX: ${tx}`);
        console.log(`  Order PDA: ${orderPdaSell.toBase58()}`);
    } catch (e: any) {
        console.error(`  ❌ Failed to create sell order: ${e.message}`);
        throw e;
    }

    // ── Step 4: Create Stablecoin Buy Order ──────────────────────────────
    console.log("\n[4/5] Creating Stablecoin Buy Order (USDC)...");

    // Fetch updated market state
    const marketAccountUpdated = await tradingProgram.account.market.fetch(marketPda);
    const updatedCount = marketAccountUpdated.activeOrders;

    const [orderPdaBuy] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("order"),
            authority.publicKey.toBuffer(),
            new BN(updatedCount).toBuffer("le", 4)
        ],
        tradingProgram.programId
    );

    const [paymentInfoPdaBuy] = PublicKey.findProgramAddressSync(
        [Buffer.from("payment_info"), orderPdaBuy.toBuffer()],
        tradingProgram.programId
    );

    try {
        const tx = await tradingProgram.methods
            .createStablecoinBuyOrder(
                new BN(20_000), // 20 kWh
                new BN(300_000), // Max 0.30 USDC per kWh
                2 // PaymentToken::Usdc
            )
            .accounts({
                market: marketPda,
                order: orderPdaBuy,
                paymentInfo: paymentInfoPdaBuy,
                tokenConfig: tokenConfigPda,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId,
            } as any)
            .rpc();
        console.log(`  ✅ Stablecoin Buy Order created. TX: ${tx}`);
        console.log(`  Order PDA: ${orderPdaBuy.toBase58()}`);
    } catch (e: any) {
        console.error(`  ❌ Failed to create buy order: ${e.message}`);
        throw e;
    }

    // ── Step 5: Verify Orders On-Chain ──────────────────────────────────
    console.log("\n[5/5] Verifying orders on-chain...");
    const sellOrderData: any = await tradingProgram.account.order.fetch(orderPdaSell);
    const sellPaymentData = await tradingProgram.account.orderPaymentInfo.fetch(paymentInfoPdaSell);

    console.log("  Sell Order Verified:");
    console.log(`    Amount: ${sellOrderData.amount.toString()} kWh`);
    console.log(`    Price:  ${sellOrderData.pricePerKwh.toString()} units`);
    console.log(`    Token:  ${sellPaymentData.paymentMint.toBase58()} (USDC)`);

    console.log("\n✨ Premium Trading Verification Successful!");
    console.log("═══════════════════════════════════════════════════════════════");
}

main().catch(err => {
    console.error("\n❌ Verification Failed:");
    console.error(err);
    process.exit(1);
});
