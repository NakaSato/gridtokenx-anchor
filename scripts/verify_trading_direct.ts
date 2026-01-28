import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Trading } from "../target/types/trading";
import fs from "fs";

async function main() {
    console.log("🚀 Starting Direct Trading Verification");

    // 1. Setup Connection & Wallet
    const connection = new anchor.web3.Connection(process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899", "confirmed");
    const walletPath = process.env.ANCHOR_WALLET;

    if (!walletPath) {
        throw new Error("ANCHOR_WALLET env var not set");
    }
    const walletKeypair = anchor.web3.Keypair.fromSecretKey(
        new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
    );
    const wallet = new anchor.Wallet(walletKeypair);
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
    anchor.setProvider(provider);

    // 2. Load Program
    const program = anchor.workspace.Trading as Program<Trading>;
    if (!program) {
        // Fallback for script execution outside workspace context (loading from IDL if needed, but workspace usually works if configured)
        // Actually, in scripts run via tsx/ts-node in the root, we might need manual IDL loading if workspace isn't auto-injected.
        // But let's try assuming standard anchor run environment or manual load.
        console.log("⚠️ anchor.workspace.Trading not found. Attempting to load by ID string...");
        // This part is tricky without the workspace magic. 
        // We'll rely on the user running this in an env where we can fetch the program.
        // Or we constructed it manually in verify_anchor_direct (which worked).
        // Let's check verify_anchor_direct.ts approach.
        // It imported { Trading } from "../target/types/trading".
        // But how did it get the 'program' object?
        // Ah, it used `anchor.workspace.Trading`. If that failed, it would error.
        // Wait, did `verify_anchor_direct.ts` work? Yes.
        // So `anchor.workspace` logic works if `ANCHOR_PROVIDER_URL` is set?
        // Actually, usually `anchor.workspace` requires running via `anchor run` OR robust config.
        // Let's stick to the pattern:
    }

    // Manual Program construction if workspace is empty (common in standalone scripts)
    // We need the IDL.
    const idl = JSON.parse(fs.readFileSync("./target/idl/trading.json", "utf-8"));
    const programId = new anchor.web3.PublicKey("GTuRUUwCfvmqW7knqQtzQLMCy61p4UKUrdT5ssVgZbat");
    const tradingProgram = new Program(idl, provider); // Use the constructor directly

    console.log("✅ Program Loaded:", tradingProgram.programId.toBase58());

    // 3. Derive PDAs
    const [marketPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("market")],
        tradingProgram.programId
    );
    console.log("Market PDA:", marketPda.toBase58());

    // 4. Initialize Market (Idempotent)
    try {
        const marketAccount = await tradingProgram.account.market.fetchNullable(marketPda);
        if (!marketAccount) {
            console.log("📝 Initializing Market...");
            await tradingProgram.methods.initializeMarket()
                .accounts({
                    market: marketPda,
                    authority: wallet.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .rpc();
            console.log("✅ Market Initialized");
        } else {
            console.log("ℹ️ Market already initialized");
        }
    } catch (e: any) {
        console.error("❌ Market Init Failed:", e);
    }

    // 5. Create Sell Order
    const sellOrderId = new BN(Date.now());
    const [sellOrderPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("order"), wallet.publicKey.toBuffer(), sellOrderId.toArrayLike(Buffer, "le", 8)],
        tradingProgram.programId
    );
    console.log("Sell Order PDA:", sellOrderPda.toBase58());

    try {
        console.log("📝 Creating Sell Order...");
        await tradingProgram.methods.createSellOrder(
            sellOrderId,
            new BN(100), // 100 kWh
            new BN(4000000) // 4 USDC
        )
            .accounts({
                market: marketPda,
                order: sellOrderPda,
                ercCertificate: null, // Optional
                authority: wallet.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc();
        console.log("✅ Sell Order Created");
    } catch (e: any) {
        console.error("❌ Sell Order Failed:", e);
    }

    // 6. Create Buy Order (Matching)
    const buyOrderId = new BN(Date.now() + 1); // distinct ID
    const [buyOrderPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("order"), wallet.publicKey.toBuffer(), buyOrderId.toArrayLike(Buffer, "le", 8)],
        tradingProgram.programId
    );

    try {
        console.log("📝 Creating Buy Order...");
        await tradingProgram.methods.createBuyOrder(
            buyOrderId,
            new BN(100), // 100 kWh
            new BN(4000000) // 4 USDC (Matches)
        )
            .accounts({
                market: marketPda,
                order: buyOrderPda,
                authority: wallet.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc();
        console.log("✅ Buy Order Created");
    } catch (e: any) {
        console.error("❌ Buy Order Failed:", e);
    }

    // 7. Match Orders (Since same wallet is buyer and seller, this tests the logic mainly)
    const [tradePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("trade"), buyOrderPda.toBuffer(), sellOrderPda.toBuffer()],
        tradingProgram.programId
    );

    try {
        console.log("📝 Matching Orders...");
        await tradingProgram.methods.matchOrders(
            new BN(50) // Match 50 kWh
        )
            .accounts({
                market: marketPda,
                buyOrder: buyOrderPda,
                sellOrder: sellOrderPda,
                tradeRecord: tradePda,
                authority: wallet.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId
            })
            .rpc();
        console.log("✅ Orders Matched");

        // Fetch trade record to verify
        const trade = await tradingProgram.account.tradeRecord.fetch(tradePda);
        console.log("📊 Trade Value:", trade.totalValue.toString());
        console.log("📊 Trade Amount:", trade.amount.toString());

    } catch (e: any) {
        console.error("❌ Match Orders Failed:", e);
    }
}

main().then(
    () => process.exit(0),
    (err) => {
        console.error(err);
        process.exit(1);
    }
);
