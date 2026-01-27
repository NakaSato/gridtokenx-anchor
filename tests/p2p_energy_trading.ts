import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
    TestEnvironment,
    expect,
    describe,
    it,
    before
} from "./setup.ts";
import type { Trading } from "../target/types/trading.ts";
import type { Governance } from "../target/types/governance.ts";
import type { Registry } from "../target/types/registry.ts";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { createMint, createAccount, mintTo, TOKEN_PROGRAM_ID, createInitializeAccountInstruction, ACCOUNT_SIZE } from "@solana/spl-token";
import BN from "bn.js";

// Helper to convert string to bytes32 for PDA seeds if needed, specifically for meter_id
// Actually Anchor client handles string seeds for instructions arguments usually.
// But for PDA derivation we need explicit buffer.

describe("P2P Energy Mint to Trading Flow", () => {
    let env: TestEnvironment;
    let tradingProgram: Program<Trading>;
    let governanceProgram: Program<Governance>;
    let registryProgram: Program<Registry>;

    // Authorities
    let marketAuthority: Keypair;
    let escrowAuthority: Keypair; // API/Escrow Authority

    // Users
    let seller: Keypair;
    let buyer: Keypair;

    // PDAs
    let marketAddress: PublicKey;
    let poaConfig: PublicKey;
    let registryConfig: PublicKey; // Registry Global
    let sellerUserAccount: PublicKey;
    let meterAccount: PublicKey; // Derived PDA

    // Mints
    let energyMint: PublicKey;
    let currencyMint: PublicKey; // Stablecoin

    // Token Accounts
    let sellerEnergyAccount: PublicKey;
    let sellerCurrencyAccount: PublicKey;
    let buyerEnergyAccount: PublicKey;
    let buyerCurrencyAccount: PublicKey;

    // Escrow Accounts (controlled by escrowAuthority)
    let sellerEnergyEscrow: PublicKey;
    let buyerCurrencyEscrow: PublicKey;

    // Collectors
    let feeCollector: PublicKey;
    let wheelingCollector: PublicKey;

    // Order IDs
    let sellOrderId: BN;
    let buyOrderId: BN;

    // Constants
    const ENERGY_AMOUNT = new BN(100);
    const PRICE_PER_KWH = new BN(50); // 0.50 USDC
    const METER_ID = "METER-" + Math.floor(Math.random() * 1000000);
    const CERTIFICATE_ID = "CERT-" + Math.floor(Math.random() * 1000000);

    before(async () => {
        env = await TestEnvironment.create();
        tradingProgram = env.tradingProgram;
        governanceProgram = env.governanceProgram;
        registryProgram = env.registryProgram;
        marketAuthority = env.authority;

        // Setup new users
        seller = Keypair.generate();
        buyer = Keypair.generate();
        escrowAuthority = Keypair.generate();

        // Fund users
        await requestAirdrop(env.connection, seller.publicKey);
        await requestAirdrop(env.connection, buyer.publicKey);
        await requestAirdrop(env.connection, escrowAuthority.publicKey);

        console.log("      Users funded");

        // Derived Addresses
        [marketAddress] = PublicKey.findProgramAddressSync(
            [Buffer.from("market")],
            tradingProgram.programId
        );

        [poaConfig] = PublicKey.findProgramAddressSync(
            [Buffer.from("poa_config")],
            governanceProgram.programId
        );

        [registryConfig] = PublicKey.findProgramAddressSync(
            [Buffer.from("registry")],
            registryProgram.programId
        );

        [sellerUserAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("user"), seller.publicKey.toBuffer()],
            registryProgram.programId
        );

        [meterAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("meter"), seller.publicKey.toBuffer(), Buffer.from(METER_ID)],
            registryProgram.programId
        );

        // Initialize Market if needed
        try {
            // @ts-ignore
            await tradingProgram.methods.initializeMarket().accounts({
                // @ts-ignore
                market: marketAddress,
                authority: marketAuthority.publicKey,
                systemProgram: SystemProgram.programId,
            }).signers([marketAuthority]).rpc();
            console.log("      Market initialized");
        } catch (e) {
            // Market might already exist
        }

        // Initialize Governance if needed
        try {
            // @ts-ignore
            await governanceProgram.methods.initializePoa().accounts({
                // @ts-ignore
                poaConfig,
                authority: marketAuthority.publicKey,
                // @ts-ignore
                systemProgram: SystemProgram.programId,
            }).signers([marketAuthority]).rpc();
            console.log("      Governance initialized");
        } catch (e) {
            // Config might already exist
        }

        // Initialize Registry if needed
        try {
            // @ts-ignore
            await registryProgram.methods.initialize().accounts({
                // @ts-ignore
                registry: registryConfig,
                authority: marketAuthority.publicKey,
                systemProgram: SystemProgram.programId
            }).signers([marketAuthority]).rpc();
            console.log("      Registry initialized");

            // Set Oracle Authority to Market Authority (for simplicity to allow updating readings)
            // @ts-ignore
            await registryProgram.methods.setOracleAuthority(marketAuthority.publicKey).accounts({
                // @ts-ignore
                registry: registryConfig,
                authority: marketAuthority.publicKey
            }).signers([marketAuthority]).rpc();

        } catch (e) {
            // Might exist
        }

        // Register Seller as User
        try {
            await requestAirdrop(env.connection, seller.publicKey); // Ensure seller has enough for rent
            // @ts-ignore
            await registryProgram.methods.registerUser(
                { prosumer: {} }, // UserType Enum
                0.0, // Lat
                0.0  // Long
            ).accounts({
                // @ts-ignore
                userAccount: sellerUserAccount,
                // @ts-ignore
                registry: registryConfig,
                authority: seller.publicKey,
                // @ts-ignore
                systemProgram: SystemProgram.programId
            }).signers([seller]).rpc();
            console.log("      Seller registered in Registry");
        } catch (e) {
            // check error
            console.log("Note: Seller registration error (might be dup):", e);
        }

        // Register Meter
        try {
            // @ts-ignore
            await registryProgram.methods.registerMeter(
                METER_ID,
                { solar: {} } // MeterType Enum
            ).accounts({
                // @ts-ignore
                meterAccount: meterAccount,
                userAccount: sellerUserAccount,
                // @ts-ignore
                registry: registryConfig,
                owner: seller.publicKey,
                systemProgram: SystemProgram.programId
            }).signers([seller]).rpc();
            console.log("      Meter registered");
        } catch (e) {
            console.log("Note: Meter registration error:", e);
        }

        // Update Meter Reading (Inject generation data)
        try {
            const readingTime = new BN(Math.floor(Date.now() / 1000));
            // @ts-ignore
            await registryProgram.methods.updateMeterReading(
                new BN(1000), // energy_generated > 100
                new BN(0),    // energy_consumed
                readingTime
            ).accounts({
                registry: registryConfig,
                meterAccount: meterAccount,
                oracleAuthority: marketAuthority.publicKey
            }).signers([marketAuthority]).rpc();
            console.log("      Meter reading updated (1000 Wh)");
        } catch (e) {
            console.log("Error updating reading:", e);
        }

        // Create Mints
        energyMint = await createMint(env.connection, marketAuthority, marketAuthority.publicKey, null, 3); // 3 decimals (Wh)
        currencyMint = await createMint(env.connection, marketAuthority, marketAuthority.publicKey, null, 6); // 6 decimals (USDC)
        console.log("      Mints created");

        // Setup Token Accounts
        [sellerEnergyAccount, sellerCurrencyAccount] = await createTokenAccounts(env.connection, seller, energyMint, currencyMint);
        [buyerEnergyAccount, buyerCurrencyAccount] = await createTokenAccounts(env.connection, buyer, energyMint, currencyMint);

        // Setup Escrow Accounts (owned by escrowAuthority)
        sellerEnergyEscrow = await createAssociatedTokenAccount(env.connection, escrowAuthority, energyMint, escrowAuthority.publicKey);
        buyerCurrencyEscrow = await createAssociatedTokenAccount(env.connection, escrowAuthority, currencyMint, escrowAuthority.publicKey);

        // Setup Collectors (owned by marketAuthority for simplicity)
        feeCollector = await createAssociatedTokenAccount(env.connection, marketAuthority, currencyMint, marketAuthority.publicKey);
        wheelingCollector = await createAssociatedTokenAccount(env.connection, marketAuthority, currencyMint, marketAuthority.publicKey);

        console.log("      Token accounts setup");
    });

    it("Step 1: Mint Energy & Issue ERC Certificate", async () => {
        // 1. Simulate Minting: Mint Energy Tokens to Seller's Energy Escrow (acting as if it came from the grid/meter)
        // In production, this would be a distinct minting authority.
        await mintTo(
            env.connection,
            marketAuthority,
            energyMint,
            sellerEnergyEscrow,
            marketAuthority,
            ENERGY_AMOUNT.toNumber()
        );

        const balance = await env.connection.getTokenAccountBalance(sellerEnergyEscrow);
        expect(balance.value.amount).to.equal(ENERGY_AMOUNT.toString());

        // 2. Issue ERC Certificate (Governance)
        // We use the real 'meterAccount' PDA initialized in setup.

        const [ercCertificate] = PublicKey.findProgramAddressSync(
            [Buffer.from("erc_certificate"), Buffer.from(CERTIFICATE_ID)],
            governanceProgram.programId
        );

        await governanceProgram.methods.issueErc(
            CERTIFICATE_ID,
            ENERGY_AMOUNT,
            "Solar",
            "Valid Data"
        )
            // @ts-ignore
            .accounts({
                // @ts-ignore
                poaConfig,
                // @ts-ignore
                ercCertificate,
                meterAccount: meterAccount,
                authority: marketAuthority.publicKey,
                // @ts-ignore
                systemProgram: SystemProgram.programId
            }).signers([marketAuthority]).rpc();

        // 3. Validate ERC for Trading
        await governanceProgram.methods.validateErcForTrading().accounts({
            poaConfig,
            ercCertificate,
            authority: marketAuthority.publicKey
        }).signers([marketAuthority]).rpc();

        const cert = await governanceProgram.account.ercCertificate.fetch(ercCertificate);
        expect(cert.validatedForTrading).to.be.true();
    });

    it("Step 2: Create Sell Order", async () => {
        sellOrderId = new BN(Date.now());
        const [orderAddress] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), seller.publicKey.toBuffer(), sellOrderId.toArrayLike(Buffer, "le", 8)],
            tradingProgram.programId
        );

        const [ercCertificate] = PublicKey.findProgramAddressSync(
            [Buffer.from("erc_certificate"), Buffer.from(CERTIFICATE_ID)],
            governanceProgram.programId
        );

        await tradingProgram.methods.createSellOrder(
            sellOrderId,
            ENERGY_AMOUNT,
            PRICE_PER_KWH
        ).accounts({
            // @ts-ignore
            market: marketAddress,
            // @ts-ignore
            order: orderAddress,
            // @ts-ignore
            ercCertificate: ercCertificate, // Pass the cert for validation
            authority: seller.publicKey,
            // @ts-ignore
            systemProgram: SystemProgram.programId
        }).signers([seller]).rpc();

        const order = await tradingProgram.account.order.fetch(orderAddress);
        expect(order.amount.toString()).to.equal(ENERGY_AMOUNT.toString());
        expect(order.pricePerKwh.toString()).to.equal(PRICE_PER_KWH.toString());
    });

    it("Step 3: Create Buy Order", async () => {
        // 1. Prepare Buyer Funds: Mint currency to Buyer's Currency Escrow
        await mintTo(
            env.connection,
            marketAuthority,
            currencyMint,
            buyerCurrencyEscrow,
            marketAuthority,
            ENERGY_AMOUNT.mul(PRICE_PER_KWH).toNumber() * 2 // Enough for fees
        );

        buyOrderId = new BN(Date.now() + 1);
        const [orderAddress] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), buyer.publicKey.toBuffer(), buyOrderId.toArrayLike(Buffer, "le", 8)],
            tradingProgram.programId
        );

        await tradingProgram.methods.createBuyOrder(
            buyOrderId,
            ENERGY_AMOUNT,
            PRICE_PER_KWH
        ).accounts({
            // @ts-ignore
            market: marketAddress,
            // @ts-ignore
            order: orderAddress,
            authority: buyer.publicKey,
            // @ts-ignore
            systemProgram: SystemProgram.programId
        }).signers([buyer]).rpc();

        const order = await tradingProgram.account.order.fetch(orderAddress);
        expect(order.amount.toString()).to.equal(ENERGY_AMOUNT.toString());
    });

    it("Step 4: Match Orders & Atomic Settlement", async () => {
        const [sellOrder] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), seller.publicKey.toBuffer(), sellOrderId.toArrayLike(Buffer, "le", 8)],
            tradingProgram.programId
        );
        const [buyOrder] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), buyer.publicKey.toBuffer(), buyOrderId.toArrayLike(Buffer, "le", 8)],
            tradingProgram.programId
        );

        // A. Atomic Settlement (Match & Settle in one go)
        // match_orders instruction updates status to Completed, preventing executeAtomicSettlement.
        // executeAtomicSettlement handles status update AND token transfer.

        // Note: TradeRecord is not created by executeAtomicSettlement in current program logic, 
        // so we skip verifying the PDA and rely on Balance checks.

        // B. Atomic Settlement
        // Note: executeAtomicSettlement requires secondary_token_program (Energy) and token_program (Currency)
        // and transfers from Escrows to User Accounts.

        await tradingProgram.methods.executeAtomicSettlement(
            ENERGY_AMOUNT, // Amount
            PRICE_PER_KWH, // Price (matched price)
            new BN(0)      // Wheeling charge
        ).accounts({
            // @ts-ignore
            market: marketAddress,
            buyOrder: buyOrder,
            sellOrder: sellOrder,
            buyerCurrencyEscrow: buyerCurrencyEscrow,
            sellerEnergyEscrow: sellerEnergyEscrow,
            sellerCurrencyAccount: sellerCurrencyAccount,
            buyerEnergyAccount: buyerEnergyAccount,
            feeCollector: feeCollector,
            wheelingCollector: wheelingCollector,
            energyMint: energyMint,
            currencyMint: currencyMint,
            escrowAuthority: escrowAuthority.publicKey,
            marketAuthority: marketAuthority.publicKey, // If needed by instruction check?
            tokenProgram: TOKEN_PROGRAM_ID,
            // @ts-ignore
            systemProgram: SystemProgram.programId,
            secondaryTokenProgram: TOKEN_PROGRAM_ID
        }).signers([escrowAuthority, marketAuthority]).rpc(); // Signing with escrowAuth to approve transfers

        // Check Balances
        // Buyer should have Energy
        const buyerEnergyBal = await env.connection.getTokenAccountBalance(buyerEnergyAccount);
        expect(buyerEnergyBal.value.amount).to.equal(ENERGY_AMOUNT.toString());

        // Seller should have Currency (less fees)
        const sellerCurrencyBal = await env.connection.getTokenAccountBalance(sellerCurrencyAccount);
        // Fee is 0.25% (25 bps)
        const totalValue = ENERGY_AMOUNT.mul(PRICE_PER_KWH).toNumber(); // 100 * 50 = 5000
        const fee = Math.floor(totalValue * 25 / 10000); // 12.5 -> 12
        const expectedSellerAmt = totalValue - fee;

        expect(sellerCurrencyBal.value.amount).to.equal(expectedSellerAmt.toString());

        console.log(`      Settlement Complete. Seller received: ${expectedSellerAmt} (Fee: ${fee})`);
    });
});

// Setup Helpers
async function requestAirdrop(connection: anchor.web3.Connection, address: PublicKey) {
    const sig = await connection.requestAirdrop(address, 5 * anchor.web3.LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
}

async function createTokenAccounts(connection: anchor.web3.Connection, owner: Keypair, mint1: PublicKey, mint2: PublicKey) {
    const acc1 = await createAssociatedTokenAccount(connection, owner, mint1, owner.publicKey);
    const acc2 = await createAssociatedTokenAccount(connection, owner, mint2, owner.publicKey);
    return [acc1, acc2];
}

async function createAssociatedTokenAccount(
    connection: anchor.web3.Connection,
    payer: Keypair,
    mint: PublicKey,
    owner: PublicKey
) {
    const newAccount = Keypair.generate();
    const lamports = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);

    const tx = new anchor.web3.Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: newAccount.publicKey,
            lamports,
            space: ACCOUNT_SIZE,
            programId: TOKEN_PROGRAM_ID
        }),
        createInitializeAccountInstruction(
            newAccount.publicKey,
            mint,
            owner
        )
    );

    await anchor.web3.sendAndConfirmTransaction(connection, tx, [payer, newAccount]);
    return newAccount.publicKey;
}
