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
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { assert } from "chai";
import type { Trading } from "../target/types/trading";
import type { Governance } from "../target/types/governance";
import { initializeGovernance, getGovernancePda } from "./utils/governance";

describe("Trading Program", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Trading as Program<Trading>;
    const authority = provider.wallet as anchor.Wallet;

    const seller = Keypair.generate();
    const buyer = Keypair.generate();
    const escrowAuthority = Keypair.generate();

    let marketAddress: PublicKey;
    let currencyMint: PublicKey;
    let energyMint: PublicKey;

    let sellerCurrency: PublicKey;
    let buyerCurrency: PublicKey;
    let sellerEnergyEscrow: PublicKey;
    let buyerCurrencyEscrow: PublicKey;
    let feeCollector: PublicKey;
    let wheelingCollector: PublicKey;
    let buyerEnergyAccount: PublicKey;
    let governanceConfig: PublicKey;

    before(async () => {
        [marketAddress] = PublicKey.findProgramAddressSync([Buffer.from("market")], program.programId);

        // Airdrops
        for (const kp of [seller, buyer, escrowAuthority]) {
            const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
            const latest = await provider.connection.getLatestBlockhash();
            await provider.connection.confirmTransaction({ signature: sig, ...latest });
        }

        // Create Mints
        currencyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 6);
        energyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 9, undefined, undefined, TOKEN_2022_PROGRAM_ID);

        // ATAs
        sellerCurrency = await createATA(seller.publicKey, currencyMint, TOKEN_PROGRAM_ID);
        buyerCurrency = await createATA(buyer.publicKey, currencyMint, TOKEN_PROGRAM_ID);
        sellerEnergyEscrow = await createATA(escrowAuthority.publicKey, energyMint, TOKEN_2022_PROGRAM_ID);
        buyerCurrencyEscrow = await createATA(escrowAuthority.publicKey, currencyMint, TOKEN_PROGRAM_ID);
        feeCollector = await createATA(authority.publicKey, currencyMint, TOKEN_PROGRAM_ID);
        wheelingCollector = await createATA(authority.publicKey, currencyMint, TOKEN_PROGRAM_ID);
        buyerEnergyAccount = await createATA(buyer.publicKey, energyMint, TOKEN_2022_PROGRAM_ID);

        // Fund Buyer
        await mintTo(provider.connection, authority.payer, currencyMint, buyerCurrency, authority.payer, 1000000);
        // Fund Escrow for tests
        await mintTo(provider.connection, authority.payer, energyMint, sellerEnergyEscrow, authority.payer, 1000, [], { skipPreflight: true }, TOKEN_2022_PROGRAM_ID);
        await mintTo(provider.connection, authority.payer, currencyMint, buyerCurrencyEscrow, authority.payer, 100000);

        // Initialize Governance
        const governanceProgram = anchor.workspace.Governance as Program<Governance>;
        governanceConfig = await initializeGovernance(provider, governanceProgram);
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

    it("Initializes the market", async () => {
        try {
            await program.methods.initializeMarket().accounts({
                market: marketAddress,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();

            const market = await program.account.market.fetch(marketAddress);
            assert.ok(market.authority.equals(authority.publicKey));
        } catch (e: any) {
            if (e.message.includes("already in use")) {
                console.log("Market already initialized");
            } else {
                throw e;
            }
        }
    });

    it("Creates a sell order", async () => {
        const orderId = new BN(Date.now());
        const [orderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), seller.publicKey.toBuffer(), orderId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );

        await program.methods.createSellOrder(orderId, new BN(100), new BN(50)).accounts({
            market: marketAddress,
            order: orderPda,
            ercCertificate: null,
            authority: seller.publicKey,
            systemProgram: SystemProgram.programId,
            governanceConfig: governanceConfig
        }).signers([seller]).rpc();

        const order = await program.account.order.fetch(orderPda);
        assert.ok(order.seller.equals(seller.publicKey));
        assert.equal(order.amount.toNumber(), 100);
        assert.equal(order.pricePerKwh.toNumber(), 50);
    });

    it("Creates a buy order", async () => {
        const orderId = new BN(Date.now() + 1);
        const [orderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), buyer.publicKey.toBuffer(), orderId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );

        await program.methods.createBuyOrder(orderId, new BN(100), new BN(50)).accounts({
            market: marketAddress,
            order: orderPda,
            authority: buyer.publicKey,
            systemProgram: SystemProgram.programId,
            governanceConfig: governanceConfig
        }).signers([buyer]).rpc();

        const order = await program.account.order.fetch(orderPda);
        assert.ok(order.buyer.equals(buyer.publicKey));
    });

    it("Executes atomic settlement", async () => {
        // Need to recreate the order PDAs or pass them
        // For simplicity in this test, we skip finding them again and just use the ones above if we stored them
        // But since they are based on timestamp, let's just create new ones for this flow
        const sOrderId = new BN(12345);
        const [sOrderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), seller.publicKey.toBuffer(), sOrderId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        await program.methods.createSellOrder(sOrderId, new BN(200), new BN(100)).accounts({
            market: marketAddress,
            order: sOrderPda,
            ercCertificate: null,
            authority: seller.publicKey,
            systemProgram: SystemProgram.programId,
            governanceConfig: governanceConfig
        }).signers([seller]).rpc();

        const bOrderId = new BN(54321);
        const [bOrderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), buyer.publicKey.toBuffer(), bOrderId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        await program.methods.createBuyOrder(bOrderId, new BN(200), new BN(100)).accounts({
            market: marketAddress,
            order: bOrderPda,
            authority: buyer.publicKey,
            systemProgram: SystemProgram.programId,
            governanceConfig: governanceConfig
        }).signers([buyer]).rpc();

        await program.methods.executeAtomicSettlement(
            new BN(200),
            new BN(100),
            new BN(0),
            new BN(0)
        ).accounts({
            market: marketAddress,
            buyOrder: bOrderPda,
            sellOrder: sOrderPda,
            buyerCurrencyEscrow: buyerCurrencyEscrow,
            sellerEnergyEscrow: sellerEnergyEscrow,
            sellerCurrencyAccount: sellerCurrency,
            buyerEnergyAccount: buyerEnergyAccount,
            feeCollector: feeCollector,
            wheelingCollector: wheelingCollector,
            lossCollector: feeCollector,
            energyMint: energyMint,
            currencyMint: currencyMint,
            escrowAuthority: escrowAuthority.publicKey,
            marketAuthority: authority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
            governanceConfig: governanceConfig
        }).signers([escrowAuthority]).rpc();

        const balance = await provider.connection.getTokenAccountBalance(buyerEnergyAccount);
        assert.equal(balance.value.amount, "200");
    });

    it("Updates market parameters", async () => {
        await program.methods.updateMarketParams(50, true, new BN(1), new BN(0)).accounts({
            market: marketAddress,
            authority: authority.publicKey,
            governanceConfig: governanceConfig
        }).rpc();

        const market = await program.account.market.fetch(marketAddress);
        assert.equal(market.marketFeeBps, 50);
        assert.equal(market.clearingEnabled, 1);
    });
});
