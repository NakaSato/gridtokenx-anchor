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
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { createMint, createAccount, mintTo, TOKEN_PROGRAM_ID, createInitializeAccountInstruction, ACCOUNT_SIZE } from "@solana/spl-token";
import BN from "bn.js";

describe("Verify GRX Trading (Fixed Value)", () => {
    let env: TestEnvironment;
    let tradingProgram: Program<Trading>;
    let marketAuthority: Keypair;
    let seller: Keypair;
    let buyer: Keypair;
    let marketAddress: PublicKey;

    // Mints
    let energyMint: PublicKey;
    let grxMint: PublicKey; // GRX Token (Standard Payment)

    // Token Accounts
    let sellerEnergyAccount: PublicKey;
    let sellerGrxAccount: PublicKey;
    let buyerEnergyAccount: PublicKey;
    let buyerGrxAccount: PublicKey;

    // Escrow / Collectors
    let feesCollector: PublicKey;

    // Constants
    const ENERGY_AMOUNT = new BN(1000); // 1 Unit
    const SELL_PRICE = new BN(2_000_000); // 2.00 GRX (Seller Price)
    const BUY_PRICE = new BN(3_000_000); // 3.00 GRX (Buyer Bid)
    // Expectation: Fixed Price Matching should use Seller Price (2.00)
    // NOT VWAP (2.50)

    before(async () => {
        env = await TestEnvironment.create();
        tradingProgram = env.tradingProgram;
        marketAuthority = env.authority;
        seller = Keypair.generate();
        buyer = Keypair.generate();

        await requestAirdrop(env.connection, seller.publicKey);
        await requestAirdrop(env.connection, buyer.publicKey);

        // Derive Market PDA
        [marketAddress] = PublicKey.findProgramAddressSync(
            [Buffer.from("market")],
            tradingProgram.programId
        );

        // Initialize Market if needed
        try {
            await tradingProgram.methods.initializeMarket().accounts({
                // @ts-ignore
                market: marketAddress,
                authority: marketAuthority.publicKey,
                systemProgram: SystemProgram.programId,
            }).signers([marketAuthority]).rpc();
        } catch (e) { }

        // Create Mints
        energyMint = await createMint(env.connection, marketAuthority, marketAuthority.publicKey, null, 3);
        grxMint = await createMint(env.connection, marketAuthority, marketAuthority.publicKey, null, 6);

        // Setup Accounts
        [sellerEnergyAccount, sellerGrxAccount] = await createTokenAccounts(env.connection, seller, energyMint, grxMint);
        [buyerEnergyAccount, buyerGrxAccount] = await createTokenAccounts(env.connection, buyer, energyMint, grxMint);

        feesCollector = await createAssociatedTokenAccount(env.connection, marketAuthority, grxMint, marketAuthority.publicKey);

        // Mint Initial Balances
        await mintTo(env.connection, marketAuthority, energyMint, sellerEnergyAccount, marketAuthority, 5000);
        await mintTo(env.connection, marketAuthority, grxMint, buyerGrxAccount, marketAuthority, 10_000_000);
    });

    it("Matches Orders with Fixed Value (Seller Price)", async () => {
        const market = await tradingProgram.account.market.fetch(marketAddress);
        const count = market.activeOrders;

        // 1. Create Sell Order (Price: 2.00)
        const sellOrderId = new BN(Date.now());
        const [sellOrder] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), seller.publicKey.toBuffer(), sellOrderId.toArrayLike(Buffer, "le", 8)],
            tradingProgram.programId
        );

        await tradingProgram.methods.createSellOrder(
            sellOrderId,
            ENERGY_AMOUNT,
            SELL_PRICE
        ).accounts({
            // @ts-ignore
            market: marketAddress,
            order: sellOrder,
            ercCertificate: null, // Optional
            authority: seller.publicKey,
            systemProgram: SystemProgram.programId,
        }).signers([seller]).rpc();

        // 2. Create Buy Order (Price: 3.00)
        const buyOrderId = new BN(Date.now() + 1);
        const [buyOrder] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), buyer.publicKey.toBuffer(), buyOrderId.toArrayLike(Buffer, "le", 8)],
            tradingProgram.programId
        );

        await tradingProgram.methods.createBuyOrder(
            buyOrderId,
            ENERGY_AMOUNT,
            BUY_PRICE
        ).accounts({
            // @ts-ignore
            market: marketAddress,
            order: buyOrder,
            authority: buyer.publicKey,
            systemProgram: SystemProgram.programId,
        }).signers([buyer]).rpc();

        // 3. Match Orders
        // Derive Trade Record
        const [tradeRecord] = PublicKey.findProgramAddressSync(
            [Buffer.from("trade"), buyOrder.toBuffer(), sellOrder.toBuffer()],
            tradingProgram.programId
        );

        await tradingProgram.methods.matchOrders(
            ENERGY_AMOUNT
        ).accounts({
            // @ts-ignore
            market: marketAddress,
            buyOrder: buyOrder,
            sellOrder: sellOrder,
            tradeRecord: tradeRecord,
            authority: marketAuthority.publicKey,
            systemProgram: SystemProgram.programId,
        }).signers([marketAuthority]).rpc();

        // 4. Verify Trade Record Price
        const trade = await tradingProgram.account.tradeRecord.fetch(tradeRecord);
        console.log("Matched Price:", trade.pricePerKwh.toString());
        console.log("Seller Price:", SELL_PRICE.toString());

        expect(trade.pricePerKwh.toString()).to.equal(SELL_PRICE.toString());
        expect(trade.pricePerKwh.toString()).to.not.equal(BUY_PRICE.toString());

        // Also check Total Value
        const expectedValue = ENERGY_AMOUNT.mul(SELL_PRICE);
        expect(trade.totalValue.toString()).to.equal(expectedValue.toString());
    });
});

async function requestAirdrop(connection, address) {
    const sig = await connection.requestAirdrop(address, 5 * 1e9);
    await connection.confirmTransaction(sig);
}

async function createTokenAccounts(connection, owner, mint1, mint2) {
    const a1 = await createAssociatedTokenAccount(connection, owner, mint1, owner.publicKey);
    const a2 = await createAssociatedTokenAccount(connection, owner, mint2, owner.publicKey);
    return [a1, a2];
}

async function createAssociatedTokenAccount(connection, payer, mint, owner) {
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
        createInitializeAccountInstruction(newAccount.publicKey, mint, owner)
    );
    await anchor.web3.sendAndConfirmTransaction(connection, tx, [payer, newAccount]);
    return newAccount.publicKey;
}
