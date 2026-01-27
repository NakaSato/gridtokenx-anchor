import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Trading } from "../target/types/trading";
import { PublicKey, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

// Config (Mock Mints for Demo - In prod, fetch from config/env)
// Note: These must match what was used to create the orders!
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // Mainnet mock
const ENERGY_MINT = new PublicKey("12EMWFUfreZR7QkgEs3N34EoJFvQyLfx7iBB5JdbKvib"); // Example

/**
 * Auction Crank / Bot
 * 
 * Runs continuously to:
 * 1. Resolve expired auctions.
 * 2. Settle cleared auctions.
 */
async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.Trading as Program<Trading>;
    const connection = provider.connection;

    console.log("Starting Auction Crank...");
    console.log("Wallet:", provider.wallet.publicKey.toString());

    while (true) {
        try {
            // 1. Fetch all Auction Batches
            // In huge scale, use getProgramAccounts with filters or indexer
            const batches = await program.account.auctionBatch.all();
            const now = Math.floor(Date.now() / 1000);

            for (const batch of batches) {
                const info = batch.account;
                const batchKey = batch.publicKey;
                const isExpired = now >= info.endTime.toNumber();

                // STATE: OPEN (0)
                if (info.state === 0 && isExpired) {
                    console.log(`[RESOLVE] Batch ${batchKey.toString()} expired. Resolving...`);
                    try {
                        const tx = await program.methods
                            .resolveAuction()
                            .accounts({
                                batch: batchKey,
                                authority: provider.wallet.publicKey,
                            })
                            .rpc();
                        console.log(`✅ Resolved: ${tx}`);
                    } catch (e) {
                        console.error(`❌ Failed to resolve batch ${batchKey.toString()}`, e);
                    }
                }

                // STATE: CLEARED (2)
                else if (info.state === 2) {
                    // Check if we have processed this? 
                    // Ideally check if orders > 0. If settled, maybe marked or moved?
                    // In this MVP contract, settlement doesn't delete orders, just transfers.
                    // We need a way to know if it's "Done".
                    // The contract doesn't explicitly have "Settled" state for batch, 
                    // but we can check if we can match any more orders.

                    console.log(`[SETTLE] Batch ${batchKey.toString()} is Cleared. Checking for matches...`);

                    // Logic to find matches
                    // 1. Filter Bids >= Clearing Price
                    // 2. Filter Asks <= Clearing Price
                    // 3. Match them up

                    const clearingPrice = info.clearingPrice.toNumber();
                    if (clearingPrice === 0) {
                        console.log("  Clearing price is 0, nothing to settle (or failed auction).");
                        continue;
                    }

                    const orders = info.orders;
                    let bids = [];
                    let asks = [];

                    orders.forEach((o, index) => {
                        // Skip if already zero amount (if we were updating amounts, but we aren't in MVP struct clearly)
                        // MVP: Just try to settle valid prices
                        if (o.isBid && o.price.toNumber() >= clearingPrice) {
                            bids.push({ ...o, index });
                        } else if (!o.isBid && o.price.toNumber() <= clearingPrice) {
                            asks.push({ ...o, index });
                        }
                    });

                    // Simple Matching: Match Bid[i] with Ask[i]
                    // This is naive. Real logic handles partial fills.
                    // MVP: 1-to-1 full match attempt.
                    const matchCount = Math.min(bids.length, asks.length);

                    if (matchCount === 0) {
                        console.log("  No matches found to settle.");
                    }

                    for (let i = 0; i < matchCount; i++) {
                        const bid = bids[i];
                        const ask = asks[i];
                        const settleAmount = Math.min(bid.amount.toNumber(), ask.amount.toNumber());

                        console.log(`  Matching Bid #${bid.index} (${bid.amount} @ ${bid.price}) <> Ask #${ask.index} (${ask.amount} @ ${ask.price})`);

                        // Derive Vaults
                        const [buyerCurrencyVault] = PublicKey.findProgramAddressSync(
                            [Buffer.from("batch_vault"), batchKey.toBuffer(), USDC_MINT.toBuffer()],
                            program.programId
                        );
                        const [sellerEnergyVault] = PublicKey.findProgramAddressSync(
                            [Buffer.from("batch_vault"), batchKey.toBuffer(), ENERGY_MINT.toBuffer()],
                            program.programId
                        );

                        // Destination Accounts
                        // Seller receives USDC
                        const sellerCurrency = getAssociatedTokenAddressSync(USDC_MINT, ask.orderId);
                        // Buyer receives Energy
                        const buyerEnergy = getAssociatedTokenAddressSync(ENERGY_MINT, bid.orderId);

                        try {
                            const tx = await program.methods
                                .executeSettlement(
                                    bid.index,
                                    ask.index,
                                    new anchor.BN(settleAmount)
                                )
                                .accounts({
                                    batch: batchKey,
                                    buyerCurrencyVault: buyerCurrencyVault,
                                    sellerEnergyVault: sellerEnergyVault,
                                    sellerCurrency: sellerCurrency,
                                    buyerEnergy: buyerEnergy,
                                    currencyMint: USDC_MINT,
                                    energyMint: ENERGY_MINT,
                                    buyerAuthority: bid.orderId,
                                    sellerAuthority: ask.orderId,
                                    tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, // SPL Token Program
                                })
                                .rpc();

                            console.log(`  ✅ Settled! Tx: ${tx}`);
                        } catch (e) {
                            console.error(`  ❌ Settlement Failed:`, e);
                        }
                    }
                }
            }

        } catch (e) {
            console.error("Crank Loop Error:", e);
        }

        // Sleep 10s
        await new Promise(r => setTimeout(r, 10000));
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
