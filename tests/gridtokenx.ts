import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    LAMPORTS_PER_SOL
} from "@solana/web3.js";
import {
    createMint,
    mintTo,
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddressSync,
    getAccount,
    createTransferInstruction,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import BN from "bn.js";
import { assert } from "chai";
import type { Trading } from "../target/types/trading";
import type { Registry } from "../target/types/registry";
import type { EnergyToken } from "../target/types/energy_token";

describe("GridTokenX Full Integration", function () {
    this.timeout(200000); // Long timeout for full flow

    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const tradingProgram = anchor.workspace.Trading as Program<Trading>;
    const registryProgram = anchor.workspace.Registry as Program<Registry>;
    const energyTokenProgram = anchor.workspace.EnergyToken as Program<EnergyToken>;

    const marketAuthority = provider.wallet as anchor.Wallet;

    // Keypairs
    const seller = Keypair.generate();
    const buyer = Keypair.generate();
    const oracle = Keypair.generate();
    const escrowAuthority = Keypair.generate();

    // PDAs and Accounts
    let marketAddress: PublicKey;
    let registryConfig: PublicKey;
    let tokenInfo: PublicKey;
    let energyMint: PublicKey;
    let currencyMint: PublicKey;

    // ATAs
    let sellerEnergy: PublicKey;
    let buyerEnergy: PublicKey;
    let sellerCurrency: PublicKey;
    let buyerCurrency: PublicKey;

    let sellerEnergyEscrow: PublicKey;
    let buyerCurrencyEscrow: PublicKey;
    let feeCollector: PublicKey;
    let wheelingCollector: PublicKey;

    // IDs
    const METER_ID = "METER-01";

    it("1. Setup Infrastructure", async () => {
        // 1.1 Airdrop
        await requestAirdrop(provider.connection, seller.publicKey);
        await requestAirdrop(provider.connection, buyer.publicKey);
        await requestAirdrop(provider.connection, oracle.publicKey);
        await requestAirdrop(provider.connection, escrowAuthority.publicKey);

        // 1.2 Derive PDAs
        [marketAddress] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingProgram.programId);
        [registryConfig] = PublicKey.findProgramAddressSync([Buffer.from("registry")], registryProgram.programId);
        [tokenInfo] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], energyTokenProgram.programId);
        [energyMint] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], energyTokenProgram.programId);

        console.log("Market:", marketAddress.toBase58());
        console.log("Energy Mint:", energyMint.toBase58());

        // 1.3 Initialize Programs (Ignore if already initialized from previous runs)
        await safeRpc(
            registryProgram.methods.initialize().accounts({
                registry: registryConfig,
                authority: marketAuthority.publicKey,
                systemProgram: SystemProgram.programId
            }), "Registry Initialize"
        );

        await safeRpc(
            registryProgram.methods.setOracleAuthority(oracle.publicKey).accounts({
                registry: registryConfig,
                authority: marketAuthority.publicKey
            }), "Set Oracle"
        );

        await safeRpc(
            energyTokenProgram.methods.initializeToken(registryProgram.programId).accounts({
                tokenInfo: tokenInfo,
                mint: energyMint,
                authority: marketAuthority.publicKey,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY
            }), "Energy Token Initialize"
        );

        await safeRpc(
            tradingProgram.methods.initializeMarket().accounts({
                market: marketAddress,
                authority: marketAuthority.publicKey,
                systemProgram: SystemProgram.programId,
            }), "Market Initialize"
        );

        // 1.4 Create Currency Mint (Mock USDC)
        currencyMint = await createMint(
            provider.connection,
            marketAuthority.payer,
            marketAuthority.publicKey,
            null,
            6,
            Keypair.generate(),
            null,
            TOKEN_PROGRAM_ID
        );
        console.log("Currency Mint:", currencyMint.toBase58());

        // 1.5 Setup ATAs
        sellerEnergy = await getOrCreateATA(provider.connection, seller, energyMint, seller.publicKey, TOKEN_2022_PROGRAM_ID);
        buyerEnergy = await getOrCreateATA(provider.connection, buyer, energyMint, buyer.publicKey, TOKEN_2022_PROGRAM_ID);

        sellerCurrency = await getOrCreateATA(provider.connection, seller, currencyMint, seller.publicKey, TOKEN_PROGRAM_ID);
        buyerCurrency = await getOrCreateATA(provider.connection, buyer, currencyMint, buyer.publicKey, TOKEN_PROGRAM_ID);

        // Escrows & Collectors
        sellerEnergyEscrow = await getOrCreateATA(provider.connection, escrowAuthority, energyMint, escrowAuthority.publicKey, TOKEN_2022_PROGRAM_ID);
        buyerCurrencyEscrow = await getOrCreateATA(provider.connection, escrowAuthority, currencyMint, escrowAuthority.publicKey, TOKEN_PROGRAM_ID);

        feeCollector = await getOrCreateATA(provider.connection, marketAuthority.payer, currencyMint, marketAuthority.publicKey, TOKEN_PROGRAM_ID);
        wheelingCollector = await getOrCreateATA(provider.connection, marketAuthority.payer, currencyMint, marketAuthority.publicKey, TOKEN_PROGRAM_ID);

        // 1.6 Fund Buyer with Currency
        await mintTo(provider.connection, marketAuthority.payer, currencyMint, buyerCurrency, marketAuthority.payer, 10000000); // 10k USDC
    });

    it("2. Register and Mint Energy (Seller)", async () => {
        const [sellerUserPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), seller.publicKey.toBuffer()], registryProgram.programId);
        const [meterPda] = PublicKey.findProgramAddressSync([Buffer.from("meter"), seller.publicKey.toBuffer(), Buffer.from(METER_ID)], registryProgram.programId);

        // Register User
        await safeRpc(
            registryProgram.methods.registerUser({ prosumer: {} }, 10.0, 100.0).accounts({
                userAccount: sellerUserPda,
                registry: registryConfig,
                authority: seller.publicKey,
                systemProgram: SystemProgram.programId
            }).signers([seller]), "Register User"
        );

        // Register Meter
        await safeRpc(
            registryProgram.methods.registerMeter(METER_ID, { solar: {} }).accounts({
                meterAccount: meterPda,
                userAccount: sellerUserPda,
                registry: registryConfig,
                owner: seller.publicKey,
                systemProgram: SystemProgram.programId
            }).signers([seller]), "Register Meter"
        );

        // Oracle Update
        console.log("Registry Config:", registryConfig.toBase58());
        console.log("Meter PDA:", meterPda.toBase58());
        console.log("Oracle:", oracle.publicKey.toBase58());

        const updateIxData = registryProgram.coder.instruction.encode("updateMeterReading", {
            energyGenerated: new BN(1000),
            energyConsumed: new BN(0),
            readingTimestamp: new BN(Math.floor(Date.now() / 1000))
        });

        const updateIx = new TransactionInstruction({
            keys: [
                { pubkey: registryConfig, isSigner: false, isWritable: false },
                { pubkey: meterPda, isSigner: false, isWritable: true },
                { pubkey: oracle.publicKey, isSigner: true, isWritable: false }
            ],
            programId: registryProgram.programId,
            data: updateIxData
        });

        const updateTx = new Transaction().add(updateIx);
        await sendAndConfirmTransaction(provider.connection, updateTx, [oracle]);
        console.log("✅ Oracle Update");

        // Mint Tokens
        await registryProgram.methods.settleAndMintTokens().accounts({
            meterAccount: meterPda,
            meterOwner: seller.publicKey,
            tokenInfo: tokenInfo,
            mint: energyMint,
            userTokenAccount: sellerEnergy,
            registry: registryConfig,
            energyTokenProgram: energyTokenProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID
        }).signers([marketAuthority.payer, seller]).rpc();

        const balance = await provider.connection.getTokenAccountBalance(sellerEnergy);
        console.log("Seller Minted Energy:", balance.value.amount);
        assert.equal(balance.value.amount, "1000");
    });

    it("3. P2P Order Creation & Settlement", async () => {
        // 3.1 Fund Escrow (Simulate Frontend Logic)
        // Seller sends 100 Energy to Escrow
        await transferSpl(provider.connection, seller, sellerEnergy, sellerEnergyEscrow, 100, TOKEN_2022_PROGRAM_ID);
        // Buyer sends 5000 Currency (50 * 100) to Escrow
        await transferSpl(provider.connection, buyer, buyerCurrency, buyerCurrencyEscrow, 5000, TOKEN_PROGRAM_ID);

        // 3.2 Create Orders
        const sellOrderId = new BN(Date.now());
        const [sellOrderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), seller.publicKey.toBuffer(), sellOrderId.toArrayLike(Buffer, "le", 8)],
            tradingProgram.programId
        );

        await tradingProgram.methods.createSellOrder(sellOrderId, new BN(100), new BN(50)).accounts({
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

        await tradingProgram.methods.createBuyOrder(buyOrderId, new BN(100), new BN(50)).accounts({
            market: marketAddress,
            order: buyOrderPda,
            authority: buyer.publicKey,
            systemProgram: SystemProgram.programId
        }).signers([buyer]).rpc();

        // 3.3 Execute Settlement
        await tradingProgram.methods.executeAtomicSettlement(
            new BN(100), // Amount
            new BN(50),  // Price
            new BN(0)    // Wheeling
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
            secondaryTokenProgram: TOKEN_2022_PROGRAM_ID
        }).signers([marketAuthority.payer, escrowAuthority]).rpc();

        // 3.4 Verify
        const buyerEnergyBal = await provider.connection.getTokenAccountBalance(buyerEnergy);
        console.log("Buyer Energy After Trade:", buyerEnergyBal.value.amount);
        assert.equal(buyerEnergyBal.value.amount, "100");
    });

});

// --- Helpers ---

async function requestAirdrop(connection: any, address: PublicKey) {
    try {
        const sig = await connection.requestAirdrop(address, 5 * LAMPORTS_PER_SOL);
        const latest = await connection.getLatestBlockhash();
        await connection.confirmTransaction({ signature: sig, ...latest });
    } catch (e) {
        // Ignore
    }
}

async function safeRpc(method: any, name: string) {
    try {
        await method.rpc();
        console.log(`✅ ${name} `);
    } catch (e: any) {
        if (e.message.includes("already in use") || e.message.includes("custom program error: 0x0")) {
            console.log(`⚠️ ${name} (Already Initialized)`);
        } else {
            console.error(`❌ ${name} Failed: `, e);
            throw e;
        }
    }
}

async function getOrCreateATA(connection: any, payer: Keypair, mint: PublicKey, owner: PublicKey, programId: PublicKey) {
    // Correctly detect program ID if possible, otherwise rely on input
    try {
        const mintInfo = await connection.getAccountInfo(mint);
        if (mintInfo && !mintInfo.owner.equals(programId)) {
            console.warn(`⚠️ Mismatch: Mint ${mint.toBase58()} owned by ${mintInfo.owner.toBase58()}, expected ${programId.toBase58()}.using Mint's owner.`);
            programId = mintInfo.owner;
        }
    } catch (e) { /* ignore */ }

    const ata = getAssociatedTokenAddressSync(mint, owner, false, programId, ASSOCIATED_TOKEN_PROGRAM_ID);
    try {
        await getAccount(connection, ata, undefined, programId);
    } catch (e) {
        const ix = createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint, programId, ASSOCIATED_TOKEN_PROGRAM_ID);
        await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer], { skipPreflight: true });
    }
    return ata;
}

async function transferSpl(connection: any, from: Keypair, fromAcc: PublicKey, toAcc: PublicKey, amount: number, programId: PublicKey) {
    // Use imported createTransferInstruction, not anchor.spl.token
    const ix = createTransferInstruction(fromAcc, toAcc, from.publicKey, amount, [], programId);
    await sendAndConfirmTransaction(connection, new Transaction().add(ix), [from]);
}
