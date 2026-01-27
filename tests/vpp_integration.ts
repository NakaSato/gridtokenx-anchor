import * as anchor from "@coral-xyz/anchor";
import {
    TestEnvironment,
    expect,
    describe,
    it,
    before
} from "./setup";
import { BN } from "bn.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";

describe("VPP IoT Verification & REC Minting", () => {
    let env: TestEnvironment;
    let marketplacePda: anchor.web3.PublicKey;
    let meterConfigPda: anchor.web3.PublicKey;
    let meterHistoryPda: anchor.web3.PublicKey;
    let oracle: anchor.web3.Keypair;
    let meter: anchor.web3.PublicKey;
    let tokenMint: anchor.web3.PublicKey;
    let userTokenAccount: anchor.web3.PublicKey;

    before(async () => {
        env = await TestEnvironment.create();
        oracle = env.authority; // Reuse authority as oracle for simplicity
        meter = anchor.web3.Keypair.generate().publicKey;

        // 1. Calculate Meter Config PDA first (needed for token mint authority)
        [meterConfigPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("meter_config"), env.authority.publicKey.toBuffer()],
            env.tradingProgram.programId
        );

        try {
            await (env.tradingProgram.methods as any).initializeMeterConfig(
                new BN(5000), // Max 5kWh change per hour
                60           // Min 1 min between readings
            ).accounts({
                config: meterConfigPda,
                authority: env.authority.publicKey,
            }).signers([env.authority]).rpc();
            console.log("✅ Meter Config initialized");
        } catch (e: any) {
            console.log("⚠️ Meter Config already initialized or failed:", e.message);
        }

        // 2. Create token mint with meterConfigPda as mint authority
        tokenMint = await createMint(
            env.provider.connection,
            env.authority,
            meterConfigPda, // Use meterConfigPda as mint authority (program will sign via CPI)
            null,
            6 // decimals
        );

        // 3. Create user token account
        const ata = await getOrCreateAssociatedTokenAccount(
            env.provider.connection,
            env.authority,
            tokenMint,
            env.authority.publicKey
        );
        userTokenAccount = ata.address;

        // 1. Initialize Carbon Marketplace
        [marketplacePda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("carbon_marketplace"), env.authority.publicKey.toBuffer()],
            env.tradingProgram.programId
        );

        try {
            await (env.tradingProgram.methods as any).initializeCarbonMarketplace(
                100, // 1% minting fee
                100, // 1% trading fee
                1000, // 1 REC per kWh
                450  // 450g CO2 per kWh
            ).accounts({
                marketplace: marketplacePda,
                recMint: anchor.web3.Keypair.generate().publicKey,
                carbonMint: anchor.web3.Keypair.generate().publicKey,
                treasury: env.authority.publicKey,
                authority: env.authority.publicKey,
            }).signers([env.authority]).rpc();
            console.log("✅ Carbon Marketplace initialized");
        } catch (e: any) {
            console.log("⚠️ Carbon Marketplace already initialized or failed:", e.message);
        }

        // 2. Authorize Oracle
        await (env.tradingProgram.methods as any).authorizeOracle(oracle.publicKey).accounts({
            config: meterConfigPda,
            authority: env.authority.publicKey,
        }).signers([env.authority]).rpc();
        console.log("✅ Oracle authorized");

        // 3. Initialize Meter History
        [meterHistoryPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("meter_history"), meter.toBuffer()],
            env.tradingProgram.programId
        );

        await (env.tradingProgram.methods as any).initializeMeterHistory().accounts({
            history: meterHistoryPda,
            meter: meter,
            authority: env.authority.publicKey,
        }).signers([env.authority]).rpc();
        console.log("✅ Meter History initialized");
    });

    it("Verify valid meter reading and mint REC", async () => {
        const timestamp = new BN(Date.now() / 1000);

        // Simulate proof reading
        const proof = {
            commitment: {
                hash: Buffer.alloc(32, 0),
                timestamp: timestamp,
                previous: Buffer.alloc(32, 0),
            },
            rangeProof: Buffer.alloc(128, 0),
            oracleSignature: Buffer.alloc(32, 1), // Dummy non-zero signature
            oraclePubkey: oracle.publicKey,
        };
        (proof.commitment.hash as Buffer)[0] = 100;

        const [readingPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("verified_reading"), meter.toBuffer(), timestamp.toArrayLike(Buffer, "le", 8)],
            env.tradingProgram.programId
        );

        // 1. Verify Reading - now with all required accounts
        await (env.tradingProgram.methods as any).verifyMeterReading(proof, timestamp).accounts({
            config: meterConfigPda,
            history: meterHistoryPda,
            verifiedReading: readingPda,
            authority: env.authority.publicKey,
            tokenMint: tokenMint,
            userTokenAccount: userTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
        }).signers([env.authority]).rpc();

        const readingData = await env.tradingProgram.account.verifiedReading.fetch(readingPda);
        expect(readingData.value.toNumber()).to.equal(100);

        // 2. Mint REC based on verified reading
        const marketState = await env.tradingProgram.account.carbonMarketplace.fetch(marketplacePda);
        const [certPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("rec_cert"), marketplacePda.toBuffer(), marketState.totalMinted.toArrayLike(Buffer, "le", 8)],
            env.tradingProgram.programId
        );

        await (env.tradingProgram.methods as any).mintRecCertificate(
            timestamp.sub(new BN(3600)), // generation start
            timestamp,                    // generation end
        ).accounts({
            marketplace: marketplacePda,
            certificate: certPda,
            issuer: env.testUser.publicKey,
            verifiedReading: readingPda,
            authority: env.authority.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
        }).signers([env.testUser, env.authority]).rpc();

        const certData = await env.tradingProgram.account.recCertificate.fetch(certPda);
        expect(certData.energyAmount.toNumber()).to.equal(100);
        console.log(`✅ Successfully minted REC for verified production: ${certData.energyAmount.toNumber()} units`);
    });
});
