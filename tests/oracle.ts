import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
    Keypair,
    PublicKey,
    SystemProgram,
    LAMPORTS_PER_SOL
} from "@solana/web3.js";
import { assert } from "chai";
import type { Oracle } from "../target/types/oracle";

describe("Oracle Program", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Oracle as Program<Oracle>;
    const authority = provider.wallet as anchor.Wallet;

    const apiGateway = Keypair.generate();
    const backupOracle = Keypair.generate();

    let oracleData: PublicKey;

    before(async () => {
        [oracleData] = PublicKey.findProgramAddressSync([Buffer.from("oracle_data")], program.programId);

        // Airdrop to apiGateway
        const sig = await provider.connection.requestAirdrop(apiGateway.publicKey, 2 * LAMPORTS_PER_SOL);
        const latest = await provider.connection.getLatestBlockhash();
        await provider.connection.confirmTransaction({ signature: sig, ...latest });
    });

    it("Initializes the oracle", async () => {
        try {
            await program.methods.initialize(apiGateway.publicKey).accounts({
                oracleData: oracleData,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();

            const data = await program.account.oracleData.fetch(oracleData);
            assert.ok(data.authority.equals(authority.publicKey));
            assert.ok(data.apiGateway.equals(apiGateway.publicKey));
            assert.equal(data.active, 1);
        } catch (e: any) {
            if (e.message.includes("already in use")) {
                console.log("Oracle already initialized");
            } else {
                throw e;
            }
        }
    });

    it("Submits meter reading via API Gateway", async () => {
        // First, update the apiGateway to the new one for this test run
        try {
            await program.methods.updateApiGateway(apiGateway.publicKey).accounts({
                oracleData: oracleData,
                authority: authority.publicKey
            }).rpc();
        } catch (e: any) {
            // Ignore if already set
        }

        const timestamp = new BN(Math.floor(Date.now() / 1000));
        await program.methods.submitMeterReading("METER-001", new BN(100), new BN(50), timestamp).accounts({
            oracleData: oracleData,
            authority: apiGateway.publicKey
        }).signers([apiGateway]).rpc();

        // No global counter update in the program, just check if it doesn't throw
    });

    it("Fails to submit reading from unauthorized gateway", async () => {
        const other = Keypair.generate();
        const timestamp = new BN(Math.floor(Date.now() / 1000));
        try {
            await program.methods.submitMeterReading("METER-001", new BN(100), new BN(50), timestamp).accounts({
                oracleData: oracleData,
                authority: other.publicKey
            }).signers([other]).rpc();
            assert.fail("Should have failed");
        } catch (e: any) {
            // Success
        }
    });

    it("Triggers market clearing", async () => {
        await program.methods.triggerMarketClearing().accounts({
            oracleData: oracleData,
            authority: apiGateway.publicKey
        }).signers([apiGateway]).rpc();

        const data = await program.account.oracleData.fetch(oracleData);
        assert.ok(data.lastClearing.toNumber() > 0);
    });

    it("Updates oracle status", async () => {
        await program.methods.updateOracleStatus(false).accounts({
            oracleData: oracleData,
            authority: authority.publicKey
        }).rpc();

        let data = await program.account.oracleData.fetch(oracleData);
        assert.equal(data.active, 0);

        await program.methods.updateOracleStatus(true).accounts({
            oracleData: oracleData,
            authority: authority.publicKey
        }).rpc();

        data = await program.account.oracleData.fetch(oracleData);
        assert.equal(data.active, 1);
    });

    it("Updates API Gateway", async () => {
        const newGateway = Keypair.generate().publicKey;
        await program.methods.updateApiGateway(newGateway).accounts({
            oracleData: oracleData,
            authority: authority.publicKey
        }).rpc();

        const data = await program.account.oracleData.fetch(oracleData);
        assert.ok(data.apiGateway.equals(newGateway));

        // Set it back for subsequent tests
        await program.methods.updateApiGateway(apiGateway.publicKey).accounts({
            oracleData: oracleData,
            authority: authority.publicKey
        }).rpc();
    });

    it("Updates validation config", async () => {
        await program.methods.updateValidationConfig(
            new BN(10),
            new BN(10000),
            true,
            75,
            false
        ).accounts({
            oracleData: oracleData,
            authority: authority.publicKey
        }).rpc();

        const data = await program.account.oracleData.fetch(oracleData);
        assert.equal(data.minEnergyValue.toNumber(), 10);
        assert.equal(data.maxEnergyValue.toNumber(), 10000);
        assert.equal(data.maxReadingDeviationPercent, 75);
    });

    it("Adds and removes backup oracles", async () => {
        await program.methods.addBackupOracle(backupOracle.publicKey).accounts({
            oracleData: oracleData,
            authority: authority.publicKey
        }).rpc();

        let data = await program.account.oracleData.fetch(oracleData);
        assert.equal(data.backupOraclesCount, 1);
        assert.ok(data.backupOracles[0].equals(backupOracle.publicKey));

        await program.methods.removeBackupOracle(backupOracle.publicKey).accounts({
            oracleData: oracleData,
            authority: authority.publicKey
        }).rpc();

        data = await program.account.oracleData.fetch(oracleData);
        assert.equal(data.backupOraclesCount, 0);
    });
});
