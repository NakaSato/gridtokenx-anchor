import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Connection } from "@solana/web3.js";
import {
    createMint,
    createAssociatedTokenAccount,
    mintTo,
    createTransferInstruction,
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync
} from "@solana/spl-token";
import BN from "bn.js";
import type { Trading } from "../target/types/trading.ts";
import type { Registry } from "../target/types/registry.ts";
import type { EnergyToken } from "../target/types/energy_token.ts";

// --- Configuration ---
const API_URL = "http://localhost:8899"; // Not really used for RPC directly, using Anchor Provider
const METER_ID = "METER-TEST-COLLECT";

async function main() {
    console.log("🚀 Starting P2P Settlement Collection Verification...");

    // 1. Setup Provider & Programs
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const connection = provider.connection;

    const tradingProgram = anchor.workspace.Trading as Program<Trading>;
    const registryProgram = anchor.workspace.Registry as Program<Registry>;
    const energyTokenProgram = anchor.workspace.EnergyToken as Program<EnergyToken>;

    const marketAuthority = provider.wallet as anchor.Wallet; // Assuming wallet is the authority for tests
    // Or generate a new one and fund it if needed, but using provider wallet is easier for localnet if it has authority.
    // However, existing tests use `env.authority` which might be a specific keypair.
    // Let's assume standard localnet setup where provider wallet is God.

    // Check if we need to initialize market or just use it.
    // We will derive PDAs and try to use them.

    console.log(`Resource: Authority ${marketAuthority.publicKey.toBase58()}`);

    // --- PDA Derivations ---
    const [marketAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from("market")],
        tradingProgram.programId
    );

    const [registryConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from("registry")],
        registryProgram.programId
    );

    const [tokenInfo] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_info_2022")],
        energyTokenProgram.programId
    );

    const [energyMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint_2022")],
        energyTokenProgram.programId
    );

    // --- Setup Actors ---
    const seller = Keypair.generate();
    const buyer = Keypair.generate();
    const escrowAuthority = Keypair.generate(); // For managing API escrows

    console.log("Funding accounts...");
    await requestAirdrop(connection, seller.publicKey);
    await requestAirdrop(connection, buyer.publicKey);
    await requestAirdrop(connection, escrowAuthority.publicKey);

    // --- Initialize Environment (Idempotent) ---
    // We try to init, if fail assume already init.
    try {
        await tradingProgram.methods.initializeMarket().accounts({
            market: marketAddress,
            authority: marketAuthority.publicKey,
            systemProgram: SystemProgram.programId,
        }).rpc();
        console.log("✅ Market Initialized");
    } catch (e) { console.log("ℹ️  Market likely already initialized"); }

    // Create Mock Currency (USDC)
    console.log("Creating Mock Currency...");
    const currencyMint = await createMint(
        connection,
        marketAuthority.payer,
        marketAuthority.publicKey,
        null,
        6
    );
    console.log(`Currency Mint: ${currencyMint.toBase58()}`);

    // --- Token Accounts ---
    // Seller
    const sellerEnergy = await createAssociatedTokenAccount(connection, marketAuthority.payer, energyMint, seller.publicKey);
    const sellerCurrency = await createAssociatedTokenAccount(connection, marketAuthority.payer, currencyMint, seller.publicKey);
    // Buyer
    const buyerEnergy = await createAssociatedTokenAccount(connection, marketAuthority.payer, energyMint, buyer.publicKey);
    const buyerCurrency = await createAssociatedTokenAccount(connection, marketAuthority.payer, currencyMint, buyer.publicKey);

    // Escrows (Owned by Escrow Authority - simulating API Gateway's holding accounts)
    const sellerEnergyEscrow = await createAssociatedTokenAccount(connection, marketAuthority.payer, energyMint, escrowAuthority.publicKey);
    const buyerCurrencyEscrow = await createAssociatedTokenAccount(connection, marketAuthority.payer, currencyMint, escrowAuthority.publicKey);

    // Collectors
    const feeCollector = await createAssociatedTokenAccount(connection, marketAuthority.payer, currencyMint, marketAuthority.publicKey);
    const wheelingCollector = await createAssociatedTokenAccount(connection, marketAuthority.payer, currencyMint, marketAuthority.publicKey); // Reusing auth for simplicity

    // --- Mint Assets ---
    const GEN_AMOUNT = 500; // 500 units energy
    const FUNDS_AMOUNT = 2000 * 1000000; // 2000 USDC

    // 1. Mint Energy to Seller (via Registry/Meter flow or direct if possible??)
    // Direct minting in EnergyToken is restricted. 
    // We must use the Registry flow: Register Meter -> Submit Reading -> Settle & Mint.
    // OR... since this is valid localnet, maybe we can use the `mint_to` of SPL if we owned the mint? 
    // No, Energy Mint authority is PDA `token_info`.
    // So we MUST use Registry flow.

    console.log("Minting Energy via Registry...");
    const [sellerUserPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user"), seller.publicKey.toBuffer()],
        registryProgram.programId
    );
    const [meterPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("meter"), seller.publicKey.toBuffer(), Buffer.from(METER_ID)],
        registryProgram.programId
    );

    // Register User
    try {
        await registryProgram.methods.registerUser({ prosumer: {} }, 13.0, 100.0)
            .accounts({
                userAccount: sellerUserPda,
                registry: registryConfig,
                authority: seller.publicKey,
                systemProgram: SystemProgram.programId
            })
            .signers([seller])
            .rpc();
    } catch (e) { } // Ignore if exists

    // Register Meter
    try {
        await registryProgram.methods.registerMeter(METER_ID, { solar: {} })
            .accounts({
                meterAccount: meterPda,
                userAccount: sellerUserPda,
                registry: registryConfig,
                owner: seller.publicKey,
                systemProgram: SystemProgram.programId
            })
            .signers([seller])
            .rpc();
    } catch (e) { }

    // Update Meter Reading
    try {
        await registryProgram.methods.updateMeterReading(
            new BN(GEN_AMOUNT), new BN(0), new BN(Math.floor(Date.now() / 1000))
        ).accounts({
            registry: registryConfig,
            meterAccount: meterPda,
            oracleAuthority: marketAuthority.publicKey // Assuming provider wallet is oracle auth
        }).rpc();
    } catch (e) {
        console.error("Failed to update meter:", e);
    }

    // Settle & Mint
    try {
        await registryProgram.methods.settleAndMintTokens()
            .accounts({
                meterAccount: meterPda,
                meterOwner: seller.publicKey,
                tokenInfo: tokenInfo,
                mint: energyMint,
                userTokenAccount: sellerEnergy,
                authority: marketAuthority.publicKey, // See previous analysis in p2p_trading.ts, might need signer
                energyTokenProgram: energyTokenProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID
            })
            .signers([seller]) // Seller must sign? No, meterOwner is signer.
            .rpc();
        console.log(`✅ Minted ${GEN_AMOUNT} Energy to Seller`);
    } catch (e) {
        console.error("Minting failed (might verify logic later):", e);
    }

    // 2. Mint Currency to Buyer
    await mintTo(connection, marketAuthority.payer, currencyMint, buyerCurrency, marketAuthority.payer, FUNDS_AMOUNT);
    console.log(`✅ Minted ${FUNDS_AMOUNT / 1000000} USDC to Buyer`);


    // --- Preparation for Trade ---
    // Transfer Assets to Escrows (Simulating "Locked" state)
    // Seller locks Energy
    await transferSpl(connection, seller, sellerEnergy, sellerEnergyEscrow, GEN_AMOUNT);
    console.log("🔒 Seller Energy Locked in Escrow");

    // Buyer locks Currency (Price: 2.5 USDC/kWh * 100 kWh = 250 USDC)
    const TRADE_AMOUNT = 100;
    const PRICE = 2_500_000; // 2.5 USDC
    const TOTAL_COST = new BN(TRADE_AMOUNT).mul(new BN(PRICE));

    await transferSpl(connection, buyer, buyerCurrency, buyerCurrencyEscrow, TOTAL_COST.toNumber());
    console.log(`🔒 Buyer Currency Locked in Escrow (${TOTAL_COST.toNumber() / 1000000} USDC)`);


    // --- Create Orders ---
    console.log("Creating Orders...");
    const sellOrderId = new BN(Date.now());
    const [sellOrderPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("order"), seller.publicKey.toBuffer(), sellOrderId.toArrayLike(Buffer, "le", 8)],
        tradingProgram.programId
    );

    await tradingProgram.methods.createSellOrder(
        sellOrderId, new BN(TRADE_AMOUNT), new BN(PRICE)
    ).accounts({
        market: marketAddress,
        order: sellOrderPda,
        ercCertificate: null,
        authority: seller.publicKey,
        systemProgram: SystemProgram.programId
    }).signers([seller]).rpc();

    const buyOrderId = new BN(Date.now() + 1000);
    const [buyOrderPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("order"), buyer.publicKey.toBuffer(), buyOrderId.toArrayLike(Buffer, "le", 8)],
        tradingProgram.programId
    );

    await tradingProgram.methods.createBuyOrder(
        buyOrderId, new BN(TRADE_AMOUNT), new BN(PRICE)
    ).accounts({
        market: marketAddress,
        order: buyOrderPda,
        authority: buyer.publicKey,
        systemProgram: SystemProgram.programId
    }).signers([buyer]).rpc();
    console.log("✅ Sell and Buy Orders Created");

    // --- EXECUTE SETTLEMENT (COLLECTION) ---
    console.log("🔄 Executing Atomic Settlement (Collection)...");

    try {
        const tx = await tradingProgram.methods.executeAtomicSettlement(
            new BN(TRADE_AMOUNT),
            new BN(PRICE),
            new BN(0) // No wheeling charge for now
        ).accounts({
            market: marketAddress,
            buyOrder: buyOrderPda,
            sellOrder: sellOrderPda,
            buyerCurrencyEscrow: buyerCurrencyEscrow,
            sellerEnergyEscrow: sellerEnergyEscrow,
            sellerCurrencyAccount: sellerCurrency,
            buyerEnergyAccount: buyerEnergy,
            feeCollector: feeCollector,
            wheelingCollector: wheelingCollector,
            energyMint: energyMint,
            currencyMint: currencyMint,
            escrowAuthority: escrowAuthority.publicKey,
            marketAuthority: marketAuthority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            secondaryTokenProgram: TOKEN_PROGRAM_ID // Energy uses same token program usually, but checked in IDL it's passed
        })
            .signers([marketAuthority.payer, escrowAuthority]) // Market auth usually pays rent/fees, Escrow auth signs for transfers
            .rpc();

        console.log(`✅ Settlement Transaction: ${tx}`);
    } catch (e) {
        console.error("❌ Settlement Failed:", e);
        process.exit(1);
    }

    // --- Verification ---
    const buyerEnergyBal = await connection.getTokenAccountBalance(buyerEnergy);
    const sellerCurrencyBal = await connection.getTokenAccountBalance(sellerCurrency);

    console.log("\n📊 Verification Results:");
    console.log(`   Buyer Energy Balance: ${buyerEnergyBal.value.amount} (Expected ${TRADE_AMOUNT})`);
    console.log(`   Seller Currency Balance: ${sellerCurrencyBal.value.amount} (Expected > 0)`);

    if (buyerEnergyBal.value.amount === TRADE_AMOUNT.toString() && sellerCurrencyBal.value.amount !== "0") {
        console.log("✅ P2P Settlement Collection Verified Successfully!");
    } else {
        console.error("❌ Verification Failed: Balances incorrect.");
    }
}

// Helpers
async function requestAirdrop(connection: Connection, address: PublicKey) {
    const sig = await connection.requestAirdrop(address, 2 * 1_000_000_000);
    await connection.confirmTransaction(sig);
}

async function transferSpl(connection: Connection, from: Keypair, fromAcc: PublicKey, toAcc: PublicKey, amount: number) {
    const tx = new anchor.web3.Transaction().add(
        createTransferInstruction(fromAcc, toAcc, from.publicKey, amount)
    );
    await anchor.web3.sendAndConfirmTransaction(connection, tx, [from]);
}

main().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
