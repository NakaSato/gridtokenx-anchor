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

// This verification script verifies settlement using create_stablecoin_buy_order.

describe("Verify THB Settlement", () => {
    let env: TestEnvironment;
    let tradingProgram: Program<Trading>;
    let marketAuthority: Keypair;
    let seller: Keypair;
    let buyer: Keypair;
    let marketAddress: PublicKey;

    // Mints
    let energyMint: PublicKey;
    let thbMint: PublicKey; // Simulating THB Stablecoin (6 decimals)

    // Token Accounts
    let sellerEnergyAccount: PublicKey;
    let sellerThbAccount: PublicKey;
    let buyerEnergyAccount: PublicKey;
    let buyerThbAccount: PublicKey;

    // Escrow / Collectors
    let feesCollector: PublicKey;
    let sellerEnergyEscrow: PublicKey;
    let buyerThbEscrow: PublicKey;

    // Constants
    const THB_DECIMALS = 6;
    const ENERGY_DECIMALS = 3;
    const ENERGY_AMOUNT = new BN(1000); // 1 Unit
    const PRICE_PER_KWH = new BN(2_500_000); // 2.50 THB
    const THB_RATE = new BN(1_000_000_000); // 1:1 Rate

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
            // @ts-ignore
            await tradingProgram.methods.initializeMarket().accounts({
                // @ts-ignore
                market: marketAddress,
                authority: marketAuthority.publicKey,
                systemProgram: SystemProgram.programId,
            }).signers([marketAuthority]).rpc();
        } catch (e) { }

        // Create Mints
        energyMint = await createMint(env.connection, marketAuthority, marketAuthority.publicKey, null, ENERGY_DECIMALS);
        thbMint = await createMint(env.connection, marketAuthority, marketAuthority.publicKey, null, THB_DECIMALS);

        // Setup Accounts
        [sellerEnergyAccount, sellerThbAccount] = await createTokenAccounts(env.connection, seller, energyMint, thbMint);
        [buyerEnergyAccount, buyerThbAccount] = await createTokenAccounts(env.connection, buyer, energyMint, thbMint);

        feesCollector = await createAssociatedTokenAccount(env.connection, marketAuthority, thbMint, marketAuthority.publicKey);

        // Setup Escrows (Owned by Authority for API settlement)
        sellerEnergyEscrow = await createAssociatedTokenAccount(env.connection, marketAuthority, energyMint, marketAuthority.publicKey);
        buyerThbEscrow = await createAssociatedTokenAccount(env.connection, marketAuthority, thbMint, marketAuthority.publicKey);

        // Mint Initial Balances
        // Seller has Energy, transfers to Escrow
        await mintTo(env.connection, marketAuthority, energyMint, sellerEnergyEscrow, marketAuthority, ENERGY_AMOUNT.toNumber());

        // Buyer has THB, transfers to Escrow
        await mintTo(env.connection, marketAuthority, thbMint, buyerThbEscrow, marketAuthority, 5_000_000_000);

        // Configure THB
        const [tokenConfig] = PublicKey.findProgramAddressSync(
            [Buffer.from("token_config"), marketAddress.toBuffer(), Buffer.from([3])],
            tradingProgram.programId
        );

        try {
            await tradingProgram.methods.configurePaymentToken(
                3, new BN(100), 200
            ).accounts({
                // @ts-ignore
                market: marketAddress,
                // @ts-ignore
                tokenConfig: tokenConfig,
                tokenMint: thbMint,
                authority: marketAuthority.publicKey,
                systemProgram: SystemProgram.programId,
            }).signers([marketAuthority]).rpc();
        } catch (e) { }
    });

    it("Executes Settlement 1 Token -> THB", async () => {
        const market = await tradingProgram.account.market.fetch(marketAddress);
        const count = market.activeOrders; // e.g. 0

        // 1. Create Sell Order (Index 0)
        let buf = Buffer.alloc(4); buf.writeUInt32LE(count);
        const [sellOrder] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), seller.publicKey.toBuffer(), buf],
            tradingProgram.programId
        );
        const [sellPaymentInfo] = PublicKey.findProgramAddressSync(
            [Buffer.from("payment_info"), sellOrder.toBuffer()],
            tradingProgram.programId
        );

        await tradingProgram.methods.createStablecoinSellOrder(
            ENERGY_AMOUNT, PRICE_PER_KWH, 3
        ).accounts({
            // @ts-ignore
            market: marketAddress,
            // @ts-ignore
            order: sellOrder,
            paymentInfo: sellPaymentInfo,
            // @ts-ignore
            tokenConfig: PublicKey.findProgramAddressSync([Buffer.from("token_config"), marketAddress.toBuffer(), Buffer.from([3])], tradingProgram.programId)[0],
            authority: seller.publicKey,
            systemProgram: SystemProgram.programId,
        }).signers([seller]).rpc();

        // 2. Create Buy Order (Index 1)
        const count2 = count + 1;
        let buf2 = Buffer.alloc(4); buf2.writeUInt32LE(count2);
        const [buyOrder] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), buyer.publicKey.toBuffer(), buf2],
            tradingProgram.programId
        );

        // WE EXPECT THIS TO BE PROBLEMATIC if execute_stablecoin_settlement needs it.
        const [buyPaymentInfo] = PublicKey.findProgramAddressSync(
            [Buffer.from("payment_info"), buyOrder.toBuffer()],
            tradingProgram.programId
        );

        await tradingProgram.methods.createStablecoinBuyOrder(
            ENERGY_AMOUNT, PRICE_PER_KWH, 3
        ).accounts({
            // @ts-ignore
            market: marketAddress,
            // @ts-ignore
            order: buyOrder,
            paymentInfo: buyPaymentInfo,
            // @ts-ignore
            tokenConfig: PublicKey.findProgramAddressSync([Buffer.from("token_config"), marketAddress.toBuffer(), Buffer.from([3])], tradingProgram.programId)[0],
            authority: buyer.publicKey,
            systemProgram: SystemProgram.programId,
        }).signers([buyer]).rpc();

        console.log("Orders created. Attempting settlement...");

        // 3. Settlement
        await tradingProgram.methods.executeStablecoinSettlement(
            ENERGY_AMOUNT,
            THB_RATE
        ).accounts({
            // @ts-ignore
            market: marketAddress,
            buyOrder: buyOrder,
            sellOrder: sellOrder,
            buyPaymentInfo: buyPaymentInfo, // Likely uninitialized
            sellPaymentInfo: sellPaymentInfo,

            stablecoinMint: thbMint,
            energyMint: energyMint,

            buyerStablecoin: buyerThbEscrow,
            sellerStablecoin: sellerThbAccount,

            buyerEnergy: buyerEnergyAccount,
            sellerEnergy: sellerEnergyEscrow,

            feeCollector: feesCollector,

            escrowAuthority: marketAuthority.publicKey,
            authority: marketAuthority.publicKey,

            tokenProgram: TOKEN_PROGRAM_ID,
            energyTokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        }).signers([marketAuthority]).rpc();

        // Verify
        const sellerBal = await env.connection.getTokenAccountBalance(sellerThbAccount);
        console.log("Seller Balance:", sellerBal.value.amount);
        expect(sellerBal.value.amount).to.not.equal("0");
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
