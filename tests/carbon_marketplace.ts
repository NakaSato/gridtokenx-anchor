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
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    mintTo,
    setAuthority,
    AuthorityType
} from "@solana/spl-token";
import { assert } from "chai";
import type { Trading } from "../target/types/trading";

describe("Carbon Marketplace", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Trading as Program<Trading>;
    const authority = provider.wallet as anchor.Wallet;

    const prosumer = Keypair.generate();
    const otherUser = Keypair.generate();
    const oracle = Keypair.generate();
    const treasury = Keypair.generate();
    const configAuthority = Keypair.generate();

    let recMint: PublicKey;
    let carbonMint: PublicKey;
    let marketplacePda: PublicKey;
    let meterConfigPda: PublicKey;
    let meterHistoryPda: PublicKey;
    let verifiedReadingPda: PublicKey;
    let certificatePda: PublicKey;

    const METER_ID = Keypair.generate().publicKey;
    const READING_TS = new BN(Math.floor(Date.now() / 1000));

    async function createATA(owner: PublicKey, mint: PublicKey, programId: PublicKey = TOKEN_PROGRAM_ID) {
        const ata = getAssociatedTokenAddressSync(mint, owner, false, programId);
        const ix = createAssociatedTokenAccountInstruction(authority.publicKey, ata, owner, mint, programId);
        await anchor.web3.sendAndConfirmTransaction(provider.connection, new anchor.web3.Transaction().add(ix), [authority.payer]);
        return ata;
    }

    before(async () => {
        // Airdrops
        for (const kp of [prosumer, otherUser, oracle, treasury, configAuthority]) {
            const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
            const latest = await provider.connection.getLatestBlockhash();
            await provider.connection.confirmTransaction({ signature: sig, ...latest });
        }

        // Mints
        recMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 9);
        carbonMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 6);

        // PDAs
        [marketplacePda] = PublicKey.findProgramAddressSync([Buffer.from("carbon_marketplace"), configAuthority.publicKey.toBuffer()], program.programId);
        [meterConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("meter_config"), configAuthority.publicKey.toBuffer()], program.programId); // Seeds: meter_config, configAuthority
        [meterHistoryPda] = PublicKey.findProgramAddressSync([Buffer.from("meter_history"), METER_ID.toBuffer()], program.programId);

        const tsBuffer = READING_TS.toArrayLike(Buffer, "le", 8);
        [verifiedReadingPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("verified_reading"), METER_ID.toBuffer(), tsBuffer],
            program.programId
        );
    });

    it("Verifies a meter reading and mints tokens", async () => {
        // Setup manual mint first to ensure account exists and has funds
        const prosumerAta = await createATA(prosumer.publicKey, recMint);
        await mintTo(provider.connection, authority.payer, recMint, prosumerAta, authority.payer, 1000);
        let balance = await provider.connection.getTokenAccountBalance(prosumerAta);
        console.log("Initial Prosumer Balance:", balance.value.amount);
        assert.equal(balance.value.amount, "1000");

        // Initialize meter verification setup (Config & History)
        await program.methods.initializeMeterConfig(new BN(10000), 60).accounts({
            config: meterConfigPda,
            authority: configAuthority.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([configAuthority]).rpc();

        await program.methods.authorizeOracle(oracle.publicKey).accounts({
            config: meterConfigPda,
            authority: configAuthority.publicKey
        } as any).signers([configAuthority]).rpc();

        await program.methods.initializeMeterHistory().accounts({
            history: meterHistoryPda,
            meter: METER_ID,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId
        } as any).rpc();

        // Transfer authority to program PDA
        await setAuthority(
            provider.connection,
            authority.payer,
            recMint,
            authority.publicKey,
            AuthorityType.MintTokens,
            meterConfigPda
        );

        // Prepare mock proof
        // Value target: 8160 (Max possible with simple byte sum: 32 * 255)
        const hash = Array(32).fill(255);

        const mockProof = {
            commitment: {
                hash: hash,
                timestamp: READING_TS,
                previous: Array(32).fill(0)
            },
            range_proof: Array(128).fill(0),
            oracleSignature: Array(32).fill(1),
            oraclePubkey: oracle.publicKey
        };

        console.log("Verified Reading PDA:", verifiedReadingPda.toBase58());

        await program.methods.verifyMeterReading(mockProof as any, READING_TS).accounts({
            config: meterConfigPda,
            history: meterHistoryPda,
            verifiedReading: verifiedReadingPda,
            authority: authority.publicKey,
            tokenMint: recMint,
            userTokenAccount: prosumerAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId
        } as any).rpc();

        const reading = await program.account.verifiedReading.fetch(verifiedReadingPda);
        // Contract logic: sum(hash bytes). 32 * 255 = 8160.
        assert.equal(reading.value.toNumber(), 8160);
        assert.equal(reading.anomalyFlags, 0, "Anomalies detected!");

        balance = await provider.connection.getTokenAccountBalance(prosumerAta);
        // Mint amount = value * 1000 = 8160 * 1000 = 8,160,000
        // Previous 1000. Total = 8,161,000
        assert.equal(balance.value.amount, "8161000");
    });

    it("Initializes carbon marketplace", async () => {
        await program.methods.initializeCarbonMarketplace(
            100, // minting fee 1%
            200, // trading fee 2%
            1000, // 1 REC per kWh (scaled by 1000)
            450   // 450g CO2 per kWh
        ).accounts({
            marketplace: marketplacePda,
            recMint: recMint,
            carbonMint: carbonMint,
            treasury: treasury.publicKey,
            authority: configAuthority.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([configAuthority]).rpc();

        const market = await program.account.carbonMarketplace.fetch(marketplacePda);
        assert.ok(market.isActive);
    });

    it("Mints a REC certificate", async () => {
        // Assert verifiedReading account exists
        const readingAccount = await program.account.verifiedReading.fetch(verifiedReadingPda);

        const market = await program.account.carbonMarketplace.fetch(marketplacePda);
        const totalMinted = market.totalMinted;
        const totalMintedBuffer = totalMinted.toArrayLike(Buffer, "le", 8);

        [certificatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("rec_cert"), marketplacePda.toBuffer(), totalMintedBuffer],
            program.programId
        );

        await program.methods.mintRecCertificate(
            READING_TS.subn(3600), // Start
            READING_TS             // End
        ).accounts({
            marketplace: marketplacePda,
            certificate: certificatePda,
            issuer: prosumer.publicKey,
            verifiedReading: verifiedReadingPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([prosumer]).rpc();

        const cert = await program.account.recCertificate.fetch(certificatePda);
        assert.ok(cert.issuer.equals(prosumer.publicKey));
        // REC amount = 8160 * 1000 / 1,000,000 = 8.16 -> 8
        assert.equal(cert.recAmount.toNumber(), 8);
        // Carbon = 8160 * 450 / 1000 = 3672
        assert.equal(cert.carbonOffset.toNumber(), 3672);
    });

    it("Transfers carbon credits (REC tokens)", async () => {
        const amount = new BN(50);
        const buyerAta = await createATA(otherUser.publicKey, recMint);
        const sellerAta = getAssociatedTokenAddressSync(recMint, prosumer.publicKey);

        await program.methods.transferCarbonCredits(amount).accounts({
            sender: prosumer.publicKey,
            receiver: otherUser.publicKey,
            senderRecAccount: sellerAta,
            receiverRecAccount: buyerAta,
            recMint: recMint,
            tokenProgram: TOKEN_PROGRAM_ID
        } as any).signers([prosumer]).rpc();

        const balance = await provider.connection.getTokenAccountBalance(buyerAta);
        assert.equal(balance.value.amount, "50");
    });

    it("Retires a REC certificate for compliance", async () => {
        const [retirementPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("retirement"), certificatePda.toBuffer()],
            program.programId
        );

        const beneficiary = Buffer.alloc(32);
        Buffer.from("GridTokenX Test Beneficiary").copy(beneficiary);

        const compliancePeriod = Buffer.alloc(16);
        Buffer.from("2026-Q1").copy(compliancePeriod);

        await program.methods.retireRecCertificate(
            0, // Voluntary
            Array.from(beneficiary),
            Array.from(compliancePeriod)
        ).accounts({
            marketplace: marketplacePda,
            certificate: certificatePda,
            retirement: retirementPda,
            owner: prosumer.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([prosumer]).rpc();

        const cert = await program.account.recCertificate.fetch(certificatePda);
        assert.ok(cert.isRetired, "Certificate should be retired");
        assert.equal(cert.retirementReason, 0);

        const retirement = await program.account.retirementRecord.fetch(retirementPda);
        assert.equal(retirement.amount.toNumber(), 8);
        assert.equal(retirement.carbonOffset.toNumber(), 3672);
    });
});
