import * as anchor from "@coral-xyz/anchor";
import { BN } from "bn.js";
import {
    TestEnvironment,
    describe,
    it,
    before,
    expect
} from "../../setup";
import { TestUtils } from "../../utils/index";
import {
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    createMint,
    createAssociatedTokenAccount,
    mintTo
} from "@solana/spl-token";

describe("Atomic Settlement Tests", () => {
    let env: TestEnvironment;
    let buyer: anchor.web3.Keypair;
    let seller: anchor.web3.Keypair;
    let marketPda: anchor.web3.PublicKey;
    let energyMint: anchor.web3.PublicKey;
    let currencyMint: anchor.web3.PublicKey;
    let buyerCurrencyEscrow: anchor.web3.PublicKey;
    let sellerEnergyEscrow: anchor.web3.PublicKey;
    let sellerCurrencyAccount: anchor.web3.PublicKey;
    let buyerEnergyAccount: anchor.web3.PublicKey;
    let feeCollector: anchor.web3.PublicKey;
    let wheelingCollector: anchor.web3.PublicKey;
    let ercCertificatePda: anchor.web3.PublicKey;
    let meterAccountPda: anchor.web3.PublicKey;

    before(async () => {
        env = await TestEnvironment.create();
        buyer = anchor.web3.Keypair.generate();
        seller = anchor.web3.Keypair.generate();

        await env.airdropSol(buyer.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
        await env.airdropSol(seller.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);

        [marketPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("market")],
            env.tradingProgram.programId
        );

        // Initialize Market
        try {
            await env.tradingProgram.methods
                .initializeMarket()
                .accounts({
                    market: marketPda,
                    authority: env.authority.publicKey,
                })
                .signers([env.authority])
                .rpc();
        } catch (e: any) {
            if (!e.message.includes("already in use")) throw e;
        }

        // --- REGISTRY & GOVERNANCE SETUP ---
        console.log("  Setting up Registry and Governance...");

        // PDAs
        const [registryPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("registry")],
            env.registryProgram.programId
        );
        const [poaConfigPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("poa_config")],
            env.governanceProgram.programId
        );

        // Initialize Registry
        try {
            await env.registryProgram.methods
                .initialize()
                .accounts({
                    registry: registryPda,
                    authority: env.authority.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([env.authority])
                .rpc();
        } catch (e: any) { if (!e.message.includes("already in use")) throw e; }

        // Set Oracle Authority (to self for simplicity)
        await env.registryProgram.methods
            .setOracleAuthority(env.authority.publicKey)
            .accounts({
                registry: registryPda,
                authority: env.authority.publicKey,
            })
            .signers([env.authority])
            .rpc();

        // Register Seller as User
        const [userAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("user"), seller.publicKey.toBuffer()],
            env.registryProgram.programId
        );
        // UserType: Prosumer = { prosumer: {} } or enum variant 0? 
        // IDL says Enum. Let's try passing the object structure if generated types support it, or simple 0.
        // IDL for UserType: Prosumer, Consumer.
        // In Anchor TS, enums are usually { prosumer: {} }.
        await env.registryProgram.methods
            .registerUser({ prosumer: {} } as any, 13.7563, 100.5018)
            .accounts({
                userAccount: userAccountPda,
                registry: registryPda,
                authority: seller.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([seller])
            .rpc();

        // Register Meter
        const meterId = `meter-${Date.now()}`;
        [meterAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("meter"), seller.publicKey.toBuffer(), Buffer.from(meterId)],
            env.registryProgram.programId
        );
        await env.registryProgram.methods
            .registerMeter(meterId, { solar: {} } as any)
            .accounts({
                meterAccount: meterAccountPda,
                userAccount: userAccountPda,
                registry: registryPda,
                owner: seller.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([seller])
            .rpc();

        // Update Meter Reading (Generate 1000 units)
        // Oracle = env.authority
        const readingTime = new BN(Math.floor(Date.now() / 1000) + 10);
        await env.registryProgram.methods
            .updateMeterReading(new BN(1000), new BN(0), readingTime)
            .accounts({
                registry: registryPda,
                meterAccount: meterAccountPda,
                oracleAuthority: env.authority.publicKey,
            })
            .signers([env.authority])
            .rpc();

        // Initialize Governance (POA)
        try {
            await env.governanceProgram.methods
                .initializePoa()
                .accounts({
                    poaConfig: poaConfigPda,
                    authority: env.authority.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([env.authority])
                .rpc();
        } catch (e: any) { if (!e.message.includes("already in use")) throw e; }

        // Issue ERC Certificate
        const certificateId = `cert-${Date.now()}`;
        [ercCertificatePda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("erc_certificate"), Buffer.from(certificateId)],
            env.governanceProgram.programId
        );

        try {
            await env.governanceProgram.methods
                .issueErc(certificateId, new BN(1000), "Solar", "{}")
                .accounts({
                    poaConfig: poaConfigPda,
                    ercCertificate: ercCertificatePda,
                    meterAccount: meterAccountPda,
                    authority: env.authority.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([env.authority])
                .rpc();
        } catch (e: any) {
            console.log("Error issuing ERC:", e);
            throw e;
        }

        // Validate ERC for Trading
        await env.governanceProgram.methods
            .validateErcForTrading()
            .accounts({
                poaConfig: poaConfigPda,
                ercCertificate: ercCertificatePda,
                authority: env.authority.publicKey,
            })
            .signers([env.authority])
            .rpc();

        // Create Mints
        console.log("  Creating mints...");
        energyMint = await createMint(
            env.connection,
            env.authority,
            env.authority.publicKey,
            null,
            9,
            undefined,
            undefined,
            TOKEN_2022_PROGRAM_ID
        );

        currencyMint = await createMint(
            env.connection,
            env.authority,
            env.authority.publicKey,
            null,
            6,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );

        // Set up ATAs for users
        console.log("  Setting up user ATAs...");
        sellerCurrencyAccount = await createAssociatedTokenAccount(
            env.connection,
            env.authority,
            currencyMint,
            seller.publicKey,
            undefined,
            TOKEN_PROGRAM_ID
        );

        buyerEnergyAccount = await createAssociatedTokenAccount(
            env.connection,
            env.authority,
            energyMint,
            buyer.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
        );

        // Set up Escrows (Owned by env.authority as the Market Facilitator)
        console.log("  Setting up escrow ATAs...");
        buyerCurrencyEscrow = await createAssociatedTokenAccount(
            env.connection,
            env.authority,
            currencyMint,
            env.authority.publicKey,
            undefined,
            TOKEN_PROGRAM_ID
        );

        sellerEnergyEscrow = await createAssociatedTokenAccount(
            env.connection,
            env.authority,
            energyMint,
            env.authority.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
        );

        // Set up Collectors
        console.log("  Setting up collector ATAs...");
        feeCollector = buyerCurrencyEscrow;

        // In reality, collectors might be different, but for tests we can reuse authority or create new ones
        wheelingCollector = await createAssociatedTokenAccount(
            env.connection,
            env.authority,
            currencyMint,
            anchor.web3.Keypair.generate().publicKey,
            undefined,
            TOKEN_PROGRAM_ID
        );

        // Mint some initial tokens
        console.log("  Minting initial tokens...");
        await mintTo(
            env.connection,
            env.authority,
            currencyMint,
            buyerCurrencyEscrow,
            env.authority,
            100_000_000 // 100 USDC in escrow
        );

        await mintTo(
            env.connection,
            env.authority,
            energyMint,
            sellerEnergyEscrow,
            env.authority,
            50_000_000_000, // 50 GRID in escrow
            [],
            undefined,
            TOKEN_2022_PROGRAM_ID
        );
    });

    it("should successfully matching and settle orders atomically", async () => {
        console.log(`TOKEN_PROGRAM_ID: ${TOKEN_PROGRAM_ID.toBase58()}`);
        console.log(`TOKEN_2022_PROGRAM_ID: ${TOKEN_2022_PROGRAM_ID.toBase58()}`);
        const amount = new BN(100);
        const price = new BN(100);
        const wheeling = new BN(10);

        // 1. Create Placeholder Orders
        let marketAccount = await env.tradingProgram.account.market.fetch(marketPda);
        let activeOrders = new BN(marketAccount.activeOrders);
        console.log(`  Market Active Orders: ${activeOrders.toString()}`);
        console.log(`  Buyer Public Key: ${buyer.publicKey.toBase58()}`);

        const [buyOrderPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [
                Buffer.from("order"),
                buyer.publicKey.toBuffer(),
                activeOrders.toArrayLike(Buffer, 'le', 4)
            ],
            env.tradingProgram.programId
        );
        console.log(`  Derived Buy Order PDA: ${buyOrderPda.toBase58()}`);

        // Predict next ID for sell order (assuming buy order increments it)
        // Wait, does createBuyOrder increment active_orders? 
        // We need to verify if the program logic increments it.
        // Assuming it does.
        const nextActiveOrders = activeOrders.add(new BN(1));

        const [sellOrderPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [
                Buffer.from("order"),
                seller.publicKey.toBuffer(),
                nextActiveOrders.toArrayLike(Buffer, 'le', 4)
            ],
            env.tradingProgram.programId
        );

        console.log("  Creating buy order...");
        await env.tradingProgram.methods
            .createBuyOrder(amount, price)
            .accounts({
                market: marketPda,
                // @ts-ignore
                order: buyOrderPda,
                authority: buyer.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([buyer])
            .rpc();

        console.log("  Creating sell order...");
        await env.tradingProgram.methods
            .createSellOrder(amount, price)
            .accounts({
                market: marketPda,
                // @ts-ignore
                order: sellOrderPda,
                ercCertificate: ercCertificatePda,
                authority: seller.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([seller])
            .rpc();

        // 2. Execute Atomic Settlement
        console.log("  Executing atomic settlement...");
        const builder = env.tradingProgram.methods
            .executeAtomicSettlement(amount, price, wheeling)
            .accounts({
                market: marketPda,
                buyOrder: buyOrderPda,
                sellOrder: sellOrderPda,
                buyerCurrencyEscrow,
                sellerEnergyEscrow,
                sellerCurrencyAccount,
                buyerEnergyAccount,
                feeCollector,
                wheelingCollector,
                energyMint,
                currencyMint,
                escrowAuthority: env.authority.publicKey,
                marketAuthority: env.authority.publicKey,
                // @ts-ignore
                // @ts-ignore
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
                // @ts-ignore
                secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([env.authority]);

        const ix = await builder.instruction();
        console.log("Instruction Keys:");
        ix.keys.forEach((k, i) => {
            console.log(`  [${i}] ${k.pubkey.toBase58()} (Signer: ${k.isSigner}, Writable: ${k.isWritable})`);
        });

        const tx = await builder.rpc();

        expect(tx).to.exist;
        console.log("  Settlement Signature:", tx);

        // 3. Verify Balances
        const sellerCurrencyBalance = await TestUtils.getTokenBalance(env.connection, sellerCurrencyAccount);
        const buyerEnergyBalance = await TestUtils.getTokenBalance(env.connection, buyerEnergyAccount);
        const feeBalance = await TestUtils.getTokenBalance(env.connection, feeCollector);
        const wheelingBalance = await TestUtils.getTokenBalance(env.connection, wheelingCollector);

        console.log("  Results:");
        console.log(`    Seller Currency: ${sellerCurrencyBalance}`);
        console.log(`    Buyer Energy: ${buyerEnergyBalance}`);
        console.log(`    Fee Collector: ${feeBalance}`);
        console.log(`    Wheeling Collector: ${wheelingBalance}`);

        // Price = 5, Wheeling = 1, Fee = (5 * 1% = 0.05?)
        // In the program, fees are calculated based on market params.
        // Let's check the values.
        expect(buyerEnergyBalance).to.equal(Number(amount));
        expect(sellerCurrencyBalance).to.be.greaterThan(0);
        expect(wheelingBalance).to.equal(Number(wheeling));
    });
});
