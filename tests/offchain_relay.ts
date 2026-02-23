import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
    Keypair,
    PublicKey,
    SystemProgram,
    SYSVAR_INSTRUCTIONS_PUBKEY,
    LAMPORTS_PER_SOL
} from "@solana/web3.js";
import {
    createMint,
    mintTo,
    createAccount,
    getAccount,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import type { Trading } from "../target/types/trading";
import type { Governance } from "../target/types/governance";
import { initializeGovernance, getGovernancePda } from "./utils/governance";
import crypto from "crypto";

async function createATA(owner: PublicKey, mint: PublicKey, programId: PublicKey): Promise<PublicKey> {
    const provider = anchor.AnchorProvider.env();
    const kp = Keypair.generate();
    await createAccount(
        provider.connection,
        (provider.wallet as anchor.Wallet).payer,
        mint,
        owner,
        kp,
        undefined,
        programId
    );
    return kp.publicKey;
}

describe("Offchain Order Relay", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Trading as Program<Trading>;
    const authority = provider.wallet as anchor.Wallet;

    // Test accounts
    let marketAddress: PublicKey;
    let zoneMarketAddress: PublicKey;
    let marketAuthorityPda: PublicKey;
    let escrowAuthority: Keypair;
    let seller = Keypair.generate();
    let buyer = Keypair.generate();

    // Mints & Accounts
    let currencyMint: PublicKey;
    let energyMint: PublicKey;

    let buyerCurrencyAccount: PublicKey;
    let sellerCurrencyAccount: PublicKey;
    let sellerEnergyAccount: PublicKey;
    let buyerEnergyAccount: PublicKey;

    let feeCollector: PublicKey;
    let wheelingCollector: PublicKey;
    let lossCollector: PublicKey;
    let governanceConfig: PublicKey;

    const zoneId = 1;

    before(async () => {
        [marketAddress] = PublicKey.findProgramAddressSync([Buffer.from("market")], program.programId);
        [zoneMarketAddress] = PublicKey.findProgramAddressSync([Buffer.from("zone_market"), marketAddress.toBuffer(), Buffer.from(new Uint32Array([zoneId]).buffer)], program.programId);
        [marketAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("market_authority")], program.programId);

        // Airdrops
        for (const kp of [seller, buyer]) {
            await provider.connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
        }

        // Initialize Governance
        const governanceProgram = anchor.workspace.Governance as Program<Governance>;
        governanceConfig = await initializeGovernance(provider, governanceProgram);

        // Create Mints
        currencyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 6);
        energyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 9, Keypair.generate(), undefined, TOKEN_2022_PROGRAM_ID);

        // Create Accounts
        buyerCurrencyAccount = await createATA(marketAuthorityPda, currencyMint, TOKEN_PROGRAM_ID);
        sellerCurrencyAccount = await createATA(marketAuthorityPda, currencyMint, TOKEN_PROGRAM_ID);
        sellerEnergyAccount = await createATA(marketAuthorityPda, energyMint, TOKEN_2022_PROGRAM_ID);
        buyerEnergyAccount = await createATA(marketAuthorityPda, energyMint, TOKEN_2022_PROGRAM_ID);

        feeCollector = await createATA(marketAuthorityPda, currencyMint, TOKEN_PROGRAM_ID);
        wheelingCollector = await createATA(marketAuthorityPda, currencyMint, TOKEN_PROGRAM_ID);
        lossCollector = await createATA(marketAuthorityPda, currencyMint, TOKEN_PROGRAM_ID);

        // Fund Buyer & Seller
        await mintTo(provider.connection, authority.payer, currencyMint, buyerCurrencyAccount, authority.payer, 1000000);
        await mintTo(provider.connection, authority.payer, energyMint, sellerEnergyAccount, authority.payer, 5000, [], undefined, TOKEN_2022_PROGRAM_ID);

        // Initialize Market
        try {
            await program.methods.initializeMarket().accounts({
                market: marketAddress,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId,
            }).rpc();
        } catch (e) { }

        try {
            await program.methods.initializeZoneMarket(zoneId).accounts({
                market: marketAddress,
                zoneMarket: zoneMarketAddress,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
        } catch (e) { }
    });

    it("Settles offchain matched orders", async () => {
        const buyerOrderIdStr = crypto.randomUUID().replace(/-/g, "");
        const sellerOrderIdStr = crypto.randomUUID().replace(/-/g, "");
        const buyerOrderId = Array.from(Buffer.from(buyerOrderIdStr, "hex"));
        const sellerOrderId = Array.from(Buffer.from(sellerOrderIdStr, "hex"));

        const buyerPayload = {
            orderId: buyerOrderId,
            user: buyer.publicKey,
            energyAmount: new BN(100),
            pricePerKwh: new BN(50),
            side: 0,
            zoneId: zoneId,
            expiresAt: new BN(0)
        };

        const sellerPayload = {
            orderId: sellerOrderId,
            user: seller.publicKey,
            energyAmount: new BN(100),
            pricePerKwh: new BN(50),
            side: 1,
            zoneId: zoneId,
            expiresAt: new BN(0)
        };

        const [buyerNullifier] = PublicKey.findProgramAddressSync(
            [Buffer.from("nullifier"), buyer.publicKey.toBuffer(), Buffer.from(buyerOrderId)],
            program.programId
        );
        const [sellerNullifier] = PublicKey.findProgramAddressSync(
            [Buffer.from("nullifier"), seller.publicKey.toBuffer(), Buffer.from(sellerOrderId)],
            program.programId
        );

        await program.methods.settleOffchainMatch(
            buyerPayload,
            sellerPayload,
            new BN(100),
            new BN(0),
            new BN(0)
        ).accounts({
            market: marketAddress,
            zoneMarket: zoneMarketAddress,
            buyerNullifier,
            sellerNullifier,
            buyerCurrencyAccount,
            sellerCurrencyAccount,
            sellerEnergyAccount,
            buyerEnergyAccount,
            feeCollector,
            wheelingCollector,
            lossCollector,
            currencyMint,
            energyMint,
            marketAuthority: marketAuthorityPda,
            payer: authority.publicKey,
            sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            tokenProgram: TOKEN_PROGRAM_ID,
            secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        }).rpc();

        // Verify balances
        const buyerEnergyCurrent = await provider.connection.getTokenAccountBalance(buyerEnergyAccount);
        assert.equal(buyerEnergyCurrent.value.amount, "100");

        const feeCurrencyCurrent = await provider.connection.getTokenAccountBalance(feeCollector);
        // Assuming 0 market fee if not set up directly in test, but fallback is 0
    });
});
