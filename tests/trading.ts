import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
    TestEnvironment,
    expect,
    describe,
    it,
    before
} from "./setup";
import { Trading } from "../target/types/trading";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import BN from "bn.js";

describe("GridTokenX Enhanced Features Integration Tests", () => {
    let env: TestEnvironment;
    let program: Program<Trading>;
    let marketAddress: PublicKey;
    let marketAuthority: Keypair;
    let user: Keypair;

    // Stablecoin State
    let usdcMint: PublicKey;
    let tokenConfig: PublicKey;

    // Privacy State
    let privacyMint: PublicKey;
    let privateBalance: PublicKey;

    // Pricing State
    let pricingConfig: PublicKey;

    // Metering State
    let meterConfig: PublicKey;
    let meterHistory: PublicKey;
    let meterKeypair: Keypair;

    // Carbon State
    let carbonMarketplaceAddress: PublicKey;

    before(async () => {
        env = await TestEnvironment.create();
        program = env.tradingProgram;
        marketAuthority = env.authority;
        user = env.testUser;

        // Correct Seeds for Market: [b"market"]
        [marketAddress] = PublicKey.findProgramAddressSync(
            [Buffer.from("market")],
            program.programId
        );

        try {
            await program.methods.initializeMarket().accounts({
                //@ts-ignore
                market: marketAddress,
                authority: marketAuthority.publicKey,
                //@ts-ignore
                systemProgram: SystemProgram.programId,
            }).signers([marketAuthority]).rpc();
            console.log("      Market initialized at:", marketAddress.toBase58());
        } catch (e) {
            // console.log("      Market initialization skipped (likely already exists)");
        }

        // Setup mints
        usdcMint = await createMint(env.connection, marketAuthority, marketAuthority.publicKey, null, 6);
        privacyMint = await createMint(env.connection, marketAuthority, marketAuthority.publicKey, null, 9);
    });

    it("1.1 should configure a payment token", async () => {
        const tokenType = 1; // USDC
        [tokenConfig] = PublicKey.findProgramAddressSync(
            [Buffer.from("token_config"), marketAddress.toBuffer(), Buffer.from([tokenType])],
            program.programId
        );

        await program.methods.configurePaymentToken(
            tokenType,
            new BN(100),
            500
        ).accounts({
            market: marketAddress,
            tokenConfig: tokenConfig,
            tokenMint: usdcMint,
            authority: marketAuthority.publicKey,
            //@ts-ignore
            systemProgram: SystemProgram.programId,
        }).signers([marketAuthority]).rpc();

        const config = await program.account.tokenConfig.fetch(tokenConfig);
        expect(config.enabled).to.be.true();
    });

    it("1.2 should create a stablecoin sell order", async () => {
        const market = await program.account.market.fetch(marketAddress);
        const activeOrders = market.activeOrders;
        const activeOrdersBuffer = Buffer.alloc(4);
        activeOrdersBuffer.writeUInt32LE(activeOrders);

        const [orderAddress] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), marketAuthority.publicKey.toBuffer(), activeOrdersBuffer],
            program.programId
        );

        const [paymentInfo] = PublicKey.findProgramAddressSync(
            [Buffer.from("payment_info"), orderAddress.toBuffer()],
            program.programId
        );

        await program.methods.createStablecoinSellOrder(
            new BN(1000),
            new BN(50),
            1
        ).accounts({
            market: marketAddress,
            order: orderAddress,
            paymentInfo: paymentInfo,
            tokenConfig: tokenConfig,
            authority: marketAuthority.publicKey,
            //@ts-ignore
            systemProgram: SystemProgram.programId,
        }).signers([marketAuthority]).rpc();

        const order = await program.account.order.fetch(orderAddress);
        expect(order.amount.toNumber()).to.equal(1000);
    });

    it("2.1 should initialize a private balance", async () => {
        [privateBalance] = PublicKey.findProgramAddressSync(
            [Buffer.from("private_balance"), user.publicKey.toBuffer(), privacyMint.toBuffer()],
            program.programId
        );

        await program.methods.initializePrivateBalance(
            { point: Array(32).fill(1) },
            Array(32).fill(0),
            Array(24).fill(0)
        ).accounts({
            privateBalance,
            mint: privacyMint,
            owner: user.publicKey,
            //@ts-ignore
            systemProgram: SystemProgram.programId,
        }).signers([user]).rpc();

        const balance = await program.account.privateBalance.fetch(privateBalance);
        expect(balance.owner.toBase58()).to.equal(user.publicKey.toBase58());
    });

    it("3.1 should initialize pricing config", async () => {
        [pricingConfig] = PublicKey.findProgramAddressSync(
            [Buffer.from("pricing_config"), marketAddress.toBuffer()],
            program.programId
        );

        await program.methods.initializePricingConfig(
            new BN(4000000),
            new BN(2000000),
            new BN(10000000),
            700
        ).accounts({
            pricingConfig,
            //@ts-ignore
            market: marketAddress,
            authority: marketAuthority.publicKey,
            //@ts-ignore
            systemProgram: SystemProgram.programId,
        }).signers([marketAuthority]).rpc();

        const config = await program.account.pricingConfig.fetch(pricingConfig);
        expect(config.enabled).to.be.true();
    });

    it("3.2 should create a price snapshot", async () => {
        const timestamp = Math.floor(Date.now() / 1000);
        const tsBuffer = Buffer.alloc(8);
        tsBuffer.writeBigInt64LE(BigInt(timestamp));

        const [snapshot] = PublicKey.findProgramAddressSync(
            [Buffer.from("price_snapshot"), marketAddress.toBuffer(), tsBuffer],
            program.programId
        );

        await program.methods.createPriceSnapshot(new BN(timestamp))
            .accounts({
                pricingConfig,
                snapshot,
                authority: marketAuthority.publicKey,
                //@ts-ignore
                systemProgram: SystemProgram.programId,
            }).signers([marketAuthority]).rpc();

        const snap = await program.account.priceSnapshot.fetch(snapshot);
        expect(snap.price.toString()).to.not.equal("0");
    });

    it("4.1 should initialize meter config", async () => {
        [meterConfig] = PublicKey.findProgramAddressSync(
            [Buffer.from("meter_config"), marketAuthority.publicKey.toBuffer()],
            program.programId
        );

        await program.methods.initializeMeterConfig(
            new BN(1000),
            300
        ).accounts({
            config: meterConfig,
            authority: marketAuthority.publicKey,
            //@ts-ignore
            systemProgram: SystemProgram.programId,
        }).signers([marketAuthority]).rpc();
    });

    it("4.2 should initialize meter history", async () => {
        meterKeypair = Keypair.generate();
        const meter = meterKeypair.publicKey;
        [meterHistory] = PublicKey.findProgramAddressSync(
            [Buffer.from("meter_history"), meter.toBuffer()],
            program.programId
        );

        await program.methods.initializeMeterHistory()
            .accounts({
                history: meterHistory,
                //@ts-ignore
                meter,
                authority: marketAuthority.publicKey,
                //@ts-ignore
                systemProgram: SystemProgram.programId,
            }).signers([marketAuthority]).rpc();
    });

    it("5.1 should initialize carbon marketplace", async () => {
        [carbonMarketplaceAddress] = PublicKey.findProgramAddressSync(
            [Buffer.from("carbon_marketplace"), marketAuthority.publicKey.toBuffer()],
            program.programId
        );

        const recMint = Keypair.generate().publicKey;
        const carbonMint = Keypair.generate().publicKey;
        const treasury = Keypair.generate().publicKey;

        await program.methods.initializeCarbonMarketplace(
            100,
            50,
            1000,
            450
        ).accounts({
            marketplace: carbonMarketplaceAddress,
            recMint,
            carbonMint,
            treasury,
            authority: marketAuthority.publicKey,
            //@ts-ignore
            systemProgram: SystemProgram.programId,
        }).signers([marketAuthority]).rpc();

        const market = await program.account.carbonMarketplace.fetch(carbonMarketplaceAddress);
        expect(market.isActive).to.be.true();
    });
});
