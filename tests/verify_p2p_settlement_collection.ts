import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Connection, Transaction } from "@solana/web3.js";
import {
    createMint,
    mintTo,
    createTransferInstruction,
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import BN from "bn.js";
import type { Trading } from "../target/types/trading.ts";
import type { Registry } from "../target/types/registry.ts";
import type { EnergyToken } from "../target/types/energy_token.ts";

describe("Verify P2P Settlement Collection", () => {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const tradingProgram = anchor.workspace.Trading as Program<Trading>;
    const registryProgram = anchor.workspace.Registry as Program<Registry>;
    const energyTokenProgram = anchor.workspace.EnergyToken as Program<EnergyToken>;

    const marketAuthority = provider.wallet as anchor.Wallet;

    // Test Variables
    const METER_ID = "METER-TEST-COLLECT";
    const GEN_AMOUNT = 500;
    const FUNDS_AMOUNT = 2000 * 1000000;
    const TRADE_AMOUNT = 100;
    const PRICE = 2_500_000; // 2.5 USDC

    let seller: Keypair;
    let buyer: Keypair;
    let escrowAuthority: Keypair;

    let marketAddress: PublicKey;
    let registryConfig: PublicKey;
    let tokenInfo: PublicKey;
    let energyMint: PublicKey;
    let currencyMint: PublicKey;

    let sellerEnergy: PublicKey;
    let sellerCurrency: PublicKey;
    let buyerEnergy: PublicKey;
    let buyerCurrency: PublicKey;

    let sellerEnergyEscrow: PublicKey;
    let buyerCurrencyEscrow: PublicKey;
    let feeCollector: PublicKey;
    let wheelingCollector: PublicKey;

    let sellOrderPda: PublicKey;
    let buyOrderPda: PublicKey;

    it("Setup: Initializes Environment and Accounts", async () => {
        // --- PDA Derivations ---
        [marketAddress] = PublicKey.findProgramAddressSync(
            [Buffer.from("market")],
            tradingProgram.programId
        );
        [registryConfig] = PublicKey.findProgramAddressSync(
            [Buffer.from("registry")],
            registryProgram.programId
        );
        [tokenInfo] = PublicKey.findProgramAddressSync(
            [Buffer.from("token_info_2022")],
            energyTokenProgram.programId
        );
        [energyMint] = PublicKey.findProgramAddressSync(
            [Buffer.from("mint_2022")],
            energyTokenProgram.programId
        );

        seller = Keypair.generate();
        buyer = Keypair.generate();
        escrowAuthority = Keypair.generate();

        console.log("Seller:", seller.publicKey.toBase58());
        console.log("Buyer:", buyer.publicKey.toBase58());

        // Airdrop
        await requestAirdrop(provider.connection, seller.publicKey);
        await requestAirdrop(provider.connection, buyer.publicKey);
        await requestAirdrop(provider.connection, escrowAuthority.publicKey);

        // Initialize Registry
        try {
            await registryProgram.methods.initialize()
                .accounts({
                    registry: registryConfig,
                    authority: marketAuthority.publicKey,
                    systemProgram: SystemProgram.programId
                }).rpc();
            await registryProgram.methods.setOracleAuthority(marketAuthority.publicKey)
                .accounts({
                    registry: registryConfig,
                    authority: marketAuthority.publicKey
                }).rpc();
        } catch (e) { /* Ignore */ }

        // Initialize Energy Token
        try {
            await energyTokenProgram.methods.initializeToken(registryProgram.programId)
                .accounts({
                    tokenInfo: tokenInfo,
                    mint: energyMint,
                    authority: marketAuthority.publicKey,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_2022_PROGRAM_ID,
                    rent: anchor.web3.SYSVAR_RENT_PUBKEY
                }).rpc();
        } catch (e) {
            // console.log("Energy Token init error (ignore if exists):", e);
        }

        // Verify Mint Exists
        const mintAccountInfo = await provider.connection.getAccountInfo(energyMint);
        if (!mintAccountInfo) {
            throw new Error(`Energy Mint ${energyMint.toBase58()} does not exist! Init failed.`);
        }
        if (!mintAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
            throw new Error(`Energy Mint owned by ${mintAccountInfo.owner.toBase58()}, expected ${TOKEN_2022_PROGRAM_ID.toBase58()}`);
        }
        // console.log("✅ Energy Mint Verified");

        // Initialize Market (Idempotent)
        try {
            await tradingProgram.methods.initializeMarket().accounts({
                market: marketAddress,
                authority: marketAuthority.publicKey,
                systemProgram: SystemProgram.programId,
            }).rpc();
            await tradingProgram.methods.initializePricingConfig(
                new BN(4000000), new BN(2000000), new BN(8000000), 700
            ).accounts({
                pricingConfig: PublicKey.findProgramAddressSync([Buffer.from("pricing_config"), marketAddress.toBuffer()], tradingProgram.programId)[0],
                market: marketAddress,
                authority: marketAuthority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
        } catch (e) { /* Ignore */ }

        // Create Mocks
        currencyMint = await createMint(provider.connection, marketAuthority.payer, marketAuthority.publicKey, null, 6, Keypair.generate(), null, TOKEN_PROGRAM_ID);

        // --- Create ATAs Manually ---
        async function createATA(owner: PublicKey, mint: PublicKey, programId: PublicKey) {
            const ata = getAssociatedTokenAddressSync(mint, owner, false, programId, ASSOCIATED_TOKEN_PROGRAM_ID);
            const ix = createAssociatedTokenAccountInstruction(
                marketAuthority.publicKey, // payer
                ata,
                owner,
                mint,
                programId,
                ASSOCIATED_TOKEN_PROGRAM_ID
            );
            try {
                const tx = new Transaction().add(ix);
                await provider.sendAndConfirm(tx, [], { skipPreflight: true }); // skipPreflight to ignore already exists
            } catch (e) {
                // If already exists, ignore.
            }
            return ata;
        }

        console.log("Creating ATAs...");
        sellerEnergy = await createATA(seller.publicKey, energyMint, TOKEN_2022_PROGRAM_ID);
        buyerEnergy = await createATA(buyer.publicKey, energyMint, TOKEN_2022_PROGRAM_ID);
        sellerEnergyEscrow = await createATA(escrowAuthority.publicKey, energyMint, TOKEN_2022_PROGRAM_ID);

        sellerCurrency = await createATA(seller.publicKey, currencyMint, TOKEN_PROGRAM_ID);
        buyerCurrency = await createATA(buyer.publicKey, currencyMint, TOKEN_PROGRAM_ID);
        buyerCurrencyEscrow = await createATA(escrowAuthority.publicKey, currencyMint, TOKEN_PROGRAM_ID);

        feeCollector = await createATA(marketAuthority.publicKey, currencyMint, TOKEN_PROGRAM_ID);
        wheelingCollector = await createATA(marketAuthority.publicKey, currencyMint, TOKEN_PROGRAM_ID);

        // Mint Currency
        await mintTo(provider.connection, marketAuthority.payer, currencyMint, buyerCurrency, marketAuthority.payer, FUNDS_AMOUNT);
        console.log("✅ Setup Complete");
    });

    it("Minting: Mints Energy to Seller via Registry", async () => {
        const [sellerUserPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("user"), seller.publicKey.toBuffer()],
            registryProgram.programId
        );
        const [meterPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("meter"), seller.publicKey.toBuffer(), Buffer.from(METER_ID)],
            registryProgram.programId
        );

        // Register
        try {
            await registryProgram.methods.registerUser({ prosumer: {} }, 13.0, 100.0)
                .accounts({
                    userAccount: sellerUserPda,
                    registry: registryConfig,
                    authority: seller.publicKey,
                    systemProgram: SystemProgram.programId
                }).signers([seller]).rpc();
        } catch (e) { }

        try {
            await registryProgram.methods.registerMeter(METER_ID, { solar: {} })
                .accounts({
                    meterAccount: meterPda,
                    userAccount: sellerUserPda,
                    registry: registryConfig,
                    owner: seller.publicKey,
                    systemProgram: SystemProgram.programId
                }).signers([seller]).rpc();
        } catch (e) { }

        // Update & Mint
        await registryProgram.methods.updateMeterReading(
            new BN(GEN_AMOUNT), new BN(0), new BN(Math.floor(Date.now() / 1000))
        ).accounts({
            registry: registryConfig,
            meterAccount: meterPda,
            oracleAuthority: marketAuthority.publicKey
        }).rpc();

        // Settle
        await registryProgram.methods.settleAndMintTokens()
            .accounts({
                meterAccount: meterPda,
                meterOwner: seller.publicKey,
                tokenInfo: tokenInfo,
                mint: energyMint,
                userTokenAccount: sellerEnergy,
                authority: marketAuthority.publicKey,
                energyTokenProgram: energyTokenProgram.programId,
                tokenProgram: TOKEN_2022_PROGRAM_ID
            })
            .signers([marketAuthority.payer, seller])
            .rpc();
    });

    it("Trading: Locks Assets and Creates Orders", async () => {
        // Lock Energy (Token 2022)
        await transferSpl(provider.connection, seller, sellerEnergy, sellerEnergyEscrow, GEN_AMOUNT, TOKEN_2022_PROGRAM_ID);

        // Lock Currency (Token Standard)
        const totalCost = new BN(TRADE_AMOUNT).mul(new BN(PRICE));
        await transferSpl(provider.connection, buyer, buyerCurrency, buyerCurrencyEscrow, totalCost.toNumber(), TOKEN_PROGRAM_ID);

        // Orders
        const sellOrderId = new BN(Date.now());
        [sellOrderPda] = PublicKey.findProgramAddressSync(
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
        [buyOrderPda] = PublicKey.findProgramAddressSync(
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
    });

    it("Settlement: Executes Atomic Collection", async () => {
        await tradingProgram.methods.executeAtomicSettlement(
            new BN(TRADE_AMOUNT),
            new BN(PRICE),
            new BN(0)
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
            tokenProgram: TOKEN_PROGRAM_ID, // Currency Token Program
            systemProgram: SystemProgram.programId,
            secondaryTokenProgram: TOKEN_2022_PROGRAM_ID // Energy Token Program
        })
            .signers([marketAuthority.payer, escrowAuthority])
            .rpc();
    });

    it("Verify: Balances Verified", async () => {
        const buyerEnergyBal = await provider.connection.getTokenAccountBalance(buyerEnergy);
        const sellerCurrencyBal = await provider.connection.getTokenAccountBalance(sellerCurrency);

        console.log(`   Buyer Energy Balance: ${buyerEnergyBal.value.amount}`);
        console.log(`   Seller Currency Balance: ${sellerCurrencyBal.value.amount}`);

        if (buyerEnergyBal.value.amount != TRADE_AMOUNT.toString()) {
            throw new Error("Buyer did not receive energy");
        }
        if (sellerCurrencyBal.value.amount === "0") {
            throw new Error("Seller did not receive payment");
        }
    });

});

async function requestAirdrop(connection: any, address: PublicKey) {
    const sig = await connection.requestAirdrop(address, 2 * 1_000_000_000);
    await connection.confirmTransaction(sig);
}

async function transferSpl(connection: any, from: Keypair, fromAcc: PublicKey, toAcc: PublicKey, amount: number, programId: PublicKey = TOKEN_PROGRAM_ID) {
    const tx = new anchor.web3.Transaction().add(
        createTransferInstruction(fromAcc, toAcc, from.publicKey, amount, [], programId)
    );
    await anchor.web3.sendAndConfirmTransaction(connection, tx, [from]);
}
