import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
    Keypair,
    PublicKey,
    SystemProgram,
    LAMPORTS_PER_SOL
} from "@solana/web3.js";
import {
    createMint,
    mintTo,
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID
} from "@solana/spl-token";
import { assert } from "chai";
import type { Trading } from "../target/types/trading";
import type { Governance } from "../target/types/governance";
import { initializeGovernance } from "./utils/governance";

describe("API P2P Trading", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Trading as Program<Trading>;
    const authority = provider.wallet as anchor.Wallet;

    // Accounts
    const seller = Keypair.generate();
    const buyer = Keypair.generate();
    const apiGateway = Keypair.generate(); // Simulated API Gateway
    const unauthorizedGateway = Keypair.generate();

    // Distinct Collectors
    const feeCollectorKeypair = Keypair.generate();
    const wheelingCollectorKeypair = Keypair.generate();
    const lossCollectorKeypair = Keypair.generate();

    let marketAddress: PublicKey;
    let currencyMint: PublicKey;
    let energyMint: PublicKey;

    // ATAs
    let sellerCurrency: PublicKey;
    let buyerCurrency: PublicKey;
    let sellerEnergyEscrow: PublicKey;
    let buyerCurrencyEscrow: PublicKey;
    let feeCollector: PublicKey;
    let wheelingCollector: PublicKey;
    let lossCollector: PublicKey;
    let buyerEnergyAccount: PublicKey;
    let governanceConfig: PublicKey;

    before(async () => {
        [marketAddress] = PublicKey.findProgramAddressSync([Buffer.from("market")], program.programId);

        // Fund accounts
        for (const kp of [seller, buyer, apiGateway, unauthorizedGateway]) {
            const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
            const latest = await provider.connection.getLatestBlockhash();
            await provider.connection.confirmTransaction({ signature: sig, ...latest });
        }

        // Create Mints
        currencyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 6);
        energyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 9, undefined, undefined, TOKEN_2022_PROGRAM_ID);

        // Create ATAs
        // Note: For API trading, the "Escrow Authority" is effectively the API Gateway that holds the keys to the escrow wallets
        const escrowAuthority = apiGateway.publicKey;

        sellerCurrency = await createATA(seller.publicKey, currencyMint, TOKEN_PROGRAM_ID);
        buyerCurrency = await createATA(buyer.publicKey, currencyMint, TOKEN_PROGRAM_ID);

        // Escrows are owned by the API Gateway (or a PDA controlled by it, but for simplicity here, the keypair itself)
        sellerEnergyEscrow = await createATA(escrowAuthority, energyMint, TOKEN_2022_PROGRAM_ID);
        buyerCurrencyEscrow = await createATA(escrowAuthority, currencyMint, TOKEN_PROGRAM_ID);

        // Distinct collectors
        feeCollector = await createATA(feeCollectorKeypair.publicKey, currencyMint, TOKEN_PROGRAM_ID);
        wheelingCollector = await createATA(wheelingCollectorKeypair.publicKey, currencyMint, TOKEN_PROGRAM_ID);
        lossCollector = await createATA(lossCollectorKeypair.publicKey, currencyMint, TOKEN_PROGRAM_ID);

        buyerEnergyAccount = await createATA(buyer.publicKey, energyMint, TOKEN_2022_PROGRAM_ID);

        // Fund Accounts
        // Buyer needs currency in their main account (conceptually) but for the atomic settlement, 
        // the API Gateway has already moved funds into the `buyerCurrencyEscrow`.
        await mintTo(provider.connection, authority.payer, currencyMint, buyerCurrencyEscrow, authority.payer, 1000000);

        // Seller needs energy in the escrow
        await mintTo(provider.connection, authority.payer, energyMint, sellerEnergyEscrow, authority.payer, 10000, [], { skipPreflight: true }, TOKEN_2022_PROGRAM_ID);

        // Initialize Governance & Market
        const governanceProgram = anchor.workspace.Governance as Program<Governance>;
        governanceConfig = await initializeGovernance(provider, governanceProgram);

        // Initialize Market if not exists
        try {
            await program.methods.initializeMarket().accounts({
                market: marketAddress,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
        } catch (e: any) {
            if (!e.message.includes("already in use")) throw e;
        }

        // Set fee to 10% (1000 bps) for easy calculation
        await program.methods.updateMarketParams(1000, true).accounts({
            market: marketAddress,
            authority: authority.publicKey,
            governanceConfig: governanceConfig
        }).rpc();
    });

    async function createATA(owner: PublicKey, mint: PublicKey, programId: PublicKey) {
        const ata = getAssociatedTokenAddressSync(mint, owner, false, programId);
        const info = await provider.connection.getAccountInfo(ata);
        if (!info) {
            const ix = createAssociatedTokenAccountInstruction(authority.publicKey, ata, owner, mint, programId);
            await anchor.web3.sendAndConfirmTransaction(provider.connection, new anchor.web3.Transaction().add(ix), [authority.payer]);
        }
        return ata;
    }

    async function getBalance(ata: PublicKey): Promise<number> {
        return Number((await provider.connection.getTokenAccountBalance(ata)).value.amount);
    }

    it("Executes Authorized Settlement with Fees", async () => {
        const orderId = new BN(Date.now());

        // 1. Create Orders
        const [sellOrderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), seller.publicKey.toBuffer(), orderId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        await program.methods.createSellOrder(orderId, new BN(500), new BN(10)).accounts({
            market: marketAddress,
            order: sellOrderPda,
            ercCertificate: null,
            authority: seller.publicKey,
            systemProgram: SystemProgram.programId,
            governanceConfig: governanceConfig
        }).signers([seller]).rpc();

        const [buyOrderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), buyer.publicKey.toBuffer(), orderId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        await program.methods.createBuyOrder(orderId, new BN(500), new BN(10)).accounts({
            market: marketAddress,
            order: buyOrderPda,
            authority: buyer.publicKey,
            systemProgram: SystemProgram.programId,
            governanceConfig: governanceConfig
        }).signers([buyer]).rpc();

        // 2. Execute Settlement via API Gateway
        // Trade: 100 Energy @ $10/unit = $1000 Total Value
        // Fee (10%): $100
        // Wheeling: $50
        // Loss: $20
        // Net to Seller: 1000 - 100 - 50 - 20 = $830

        const amount = new BN(100);
        const price = new BN(10);
        const wheelingCharge = new BN(50);
        const lossCost = new BN(20);

        const preSellerBalance = await getBalance(sellerCurrency);
        const preFeeBalance = await getBalance(feeCollector);
        const preWheelingBalance = await getBalance(wheelingCollector);
        const preLossBalance = await getBalance(lossCollector);

        await program.methods.executeAtomicSettlement(
            amount,
            price,
            wheelingCharge,
            lossCost
        ).accounts({
            market: marketAddress,
            buyOrder: buyOrderPda,
            sellOrder: sellOrderPda,
            buyerCurrencyEscrow: buyerCurrencyEscrow,
            sellerEnergyEscrow: sellerEnergyEscrow,
            sellerCurrencyAccount: sellerCurrency,
            buyerEnergyAccount: buyerEnergyAccount,
            feeCollector: feeCollector,
            wheelingCollector: wheelingCollector,
            lossCollector: lossCollector,
            energyMint: energyMint,
            currencyMint: currencyMint,
            escrowAuthority: apiGateway.publicKey, // API Gateway signs this
            marketAuthority: authority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
            governanceConfig: governanceConfig
        }).signers([apiGateway]).rpc();

        // 3. Verify Balances
        const postSellerBalance = await getBalance(sellerCurrency);
        const postFeeBalance = await getBalance(feeCollector);
        const postWheelingBalance = await getBalance(wheelingCollector);
        const postLossBalance = await getBalance(lossCollector);

        assert.equal(postSellerBalance - preSellerBalance, 830, "Seller receivable mismatch");
        assert.equal(postFeeBalance - preFeeBalance, 100, "Fee mismatch");
        assert.equal(postWheelingBalance - preWheelingBalance, 50, "Wheeling mismatch");
        assert.equal(postLossBalance - preLossBalance, 20, "Loss mismatch");
    });

    it("Rejects Unauthorized Gateway", async () => {
        // Same setup but sign with unauthorized keypair
        const orderId = new BN(Date.now() + 100);

        const [sellOrderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), seller.publicKey.toBuffer(), orderId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        await program.methods.createSellOrder(orderId, new BN(100), new BN(10)).accounts({
            market: marketAddress,
            order: sellOrderPda,
            ercCertificate: null,
            authority: seller.publicKey,
            systemProgram: SystemProgram.programId,
            governanceConfig: governanceConfig
        }).signers([seller]).rpc();

        const [buyOrderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), buyer.publicKey.toBuffer(), orderId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        await program.methods.createBuyOrder(orderId, new BN(100), new BN(10)).accounts({
            market: marketAddress,
            order: buyOrderPda,
            authority: buyer.publicKey,
            systemProgram: SystemProgram.programId,
            governanceConfig: governanceConfig
        }).signers([buyer]).rpc();

        try {
            await program.methods.executeAtomicSettlement(
                new BN(10), new BN(10), new BN(0), new BN(0)
            ).accounts({
                market: marketAddress,
                buyOrder: buyOrderPda,
                sellOrder: sellOrderPda,
                buyerCurrencyEscrow: buyerCurrencyEscrow,
                sellerEnergyEscrow: sellerEnergyEscrow,
                sellerCurrencyAccount: sellerCurrency,
                buyerEnergyAccount: buyerEnergyAccount,
                feeCollector: feeCollector,
                wheelingCollector: wheelingCollector,
                lossCollector: lossCollector,
                energyMint: energyMint,
                currencyMint: currencyMint,
                escrowAuthority: unauthorizedGateway.publicKey,
                marketAuthority: authority.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
                governanceConfig: governanceConfig
            }).signers([unauthorizedGateway]).rpc();

            assert.fail("Should have failed");
        } catch (e: any) {
            assert.ok(true);
        }
    });
});
