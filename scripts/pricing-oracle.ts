import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Trading } from "../target/types/trading";
import { PublicKey } from "@solana/web3.js";

/**
 * Dynamic Pricing Oracle Simulation
 * 
 * Simulates real-time grid conditions:
 * - Supply (Solar/Wind Generation)
 * - Demand (Consumption)
 * - Congestion (Grid Load)
 * 
 * Updates the on-chain Pricing Config.
 */
async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.Trading as Program<Trading>;

    // Config
    const MARKET_PDA = PublicKey.findProgramAddressSync([Buffer.from("market")], program.programId)[0];
    const [pricingConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pricing_config"), MARKET_PDA.toBuffer()],
        program.programId
    );

    console.log("Starting Pricing Oracle...");
    console.log("Market:", MARKET_PDA.toString());
    console.log("Pricing Config:", pricingConfigPda.toString());

    // Initialize if needed (Check if exists)
    try {
        await program.account.pricingConfig.fetch(pricingConfigPda);
        console.log("Pricing Config found.");
    } catch (e) {
        console.log("Pricing Config not found. Initializing...");
        try {
            await program.methods
                .initializePricingConfig(
                    new anchor.BN(4000000), // Base: 4.00 THB (6 decimals)
                    new anchor.BN(2000000), // Min: 2.00
                    new anchor.BN(8000000), // Max: 8.00
                    700 // UTC+7
                )
                .accounts({
                    pricingConfig: pricingConfigPda,
                    market: MARKET_PDA,
                    authority: provider.wallet.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .rpc();
            console.log("✅ Initialized Pricing Config.");
        } catch (initErr) {
            console.error("Failed to init config (maybe market missing?):", initErr);
            return;
        }
    }

    // Simulation Loop
    let time = 0;
    while (true) {
        // Simulate Sine Wave for Supply/Demand
        // Supply: Peak at noon (Solar)
        // Demand: Peak at evening

        const hour = (new Date().getUTCHours() + 7) % 24; // Local hour

        // Mock Values
        const baseSupply = 100000;
        const baseDemand = 90000;

        // Fluctuation
        const supplyInfo = baseSupply + Math.floor(Math.sin(time * 0.1) * 20000);
        const demandInfo = baseDemand + Math.floor(Math.cos(time * 0.1) * 20000);
        const congestion = 100 + Math.floor(Math.random() * 20); // 1.00x - 1.20x

        console.log(`[ORACLE] Time: ${hour}:00 | Supply: ${supplyInfo} | Demand: ${demandInfo} | Congestion: ${congestion}`);

        try {
            const tx = await program.methods
                .updateMarketData(
                    new anchor.BN(supplyInfo),
                    new anchor.BN(demandInfo),
                    congestion
                )
                .accounts({
                    pricingConfig: pricingConfigPda,
                    authority: provider.wallet.publicKey,
                })
                .rpc();

            console.log(`  ✅ Update Tx: ${tx}`);

            // Log new price (need to fetch to see calc, or calculate locally)
            const account = await program.account.pricingConfig.fetch(pricingConfigPda);
            // In a real app we'd fetch the calculated snapshot or price field, 
            // but the contract updates `PricingConfig` but `calculate_price` is a pure view usually.
            // Wait, pricing.rs does update `last_update` but doesn't store "current_price" in state explicitly except in snapshots.
            // Ah, actually calculate_price is called during the tx but return value isn't stored in `PricingConfig` struct visibly?
            // Let's check `PricingConfig` struct again. It has `base_price`, etc. 
            // The `calculator::calculate_price` is used by `create_price_snapshot`. 
            // It is NOT stored in `PricingConfig` directly as a field "current_price".
            // So to see it, we might need to fetch a snapshot or trust the event `PriceUpdated`.
            // The event `PriceUpdated` works!
        } catch (e) {
            console.error("  ❌ Update Failed:", e);
        }

        time++;
        // Sleep 60s
        await new Promise(r => setTimeout(r, 60000));
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
