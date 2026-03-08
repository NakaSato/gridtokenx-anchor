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

/// Derive a meter PDA from its string ID
function findMeterPda(meterId: string, programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("meter"), Buffer.from(meterId)],
        programId
    );
}

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

    it("Submits meter reading via API Gateway (writes to MeterState PDA)", async () => {
        // First, update the apiGateway to the new one for this test run
        try {
            await program.methods.updateApiGateway(apiGateway.publicKey).accounts({
                oracleData: oracleData,
                authority: authority.publicKey
            }).rpc();
        } catch (e: any) {
            // Ignore if already set
        }

        const meterId = "METER-001";
        const [meterState] = findMeterPda(meterId, program.programId);

        const timestamp = new BN(Math.floor(Date.now() / 1000));
        await program.methods.submitMeterReading(meterId, new BN(100), new BN(50), timestamp).accounts({
            oracleData: oracleData,
            meterState: meterState,
            authority: apiGateway.publicKey,
            systemProgram: SystemProgram.programId,
        }).signers([apiGateway]).rpc();

        // Verify per-meter state (not global counters)
        const meter = await program.account.meterState.fetch(meterState);
        assert.equal(meter.totalEnergyProduced.toNumber(), 100);
        assert.equal(meter.totalEnergyConsumed.toNumber(), 50);
        assert.equal(meter.totalReadings.toNumber(), 1);

        // Global counters should still be 0 (updated via aggregate_readings)
        const data = await program.account.oracleData.fetch(oracleData);
        assert.equal(data.totalGlobalEnergyProduced.toNumber(), 0);
    });

    it("Submits readings for different meters in parallel (Sealevel)", async () => {
        const meters = ["METER-A", "METER-B", "METER-C"];
        const timestamp = new BN(Math.floor(Date.now() / 1000));

        // Build all transactions — each touches a different MeterState PDA
        const txPromises = meters.map((meterId) => {
            const [meterState] = findMeterPda(meterId, program.programId);
            return program.methods
                .submitMeterReading(meterId, new BN(200), new BN(100), timestamp)
                .accounts({
                    oracleData: oracleData,
                    meterState: meterState,
                    authority: apiGateway.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([apiGateway])
                .rpc();
        });

        await Promise.all(txPromises);

        // Verify each meter has its own state
        for (const meterId of meters) {
            const [meterState] = findMeterPda(meterId, program.programId);
            const meter = await program.account.meterState.fetch(meterState);
            assert.equal(meter.totalEnergyProduced.toNumber(), 200);
            assert.equal(meter.totalReadings.toNumber(), 1);
        }
    });

    it("Aggregates readings into global counters (batch)", async () => {
        // Gateway aggregates: 4 meters × their totals
        await program.methods.aggregateReadings(
            new BN(700),  // total_produced (100 + 200*3)
            new BN(350),  // total_consumed (50 + 100*3)
            new BN(4),    // valid_count
            new BN(0),    // rejected_count
        ).accounts({
            oracleData: oracleData,
            authority: apiGateway.publicKey,
        }).signers([apiGateway]).rpc();

        const data = await program.account.oracleData.fetch(oracleData);
        assert.equal(data.totalGlobalEnergyProduced.toNumber(), 700);
        assert.equal(data.totalGlobalEnergyConsumed.toNumber(), 350);
        assert.equal(data.totalValidReadings.toNumber(), 4);
        assert.equal(data.totalReadings.toNumber(), 4);
    });

    it("Fails to submit reading from unauthorized gateway", async () => {
        const other = Keypair.generate();
        const meterId = "METER-001";
        const [meterState] = findMeterPda(meterId, program.programId);
        const timestamp = new BN(Math.floor(Date.now() / 1000));
        try {
            await program.methods.submitMeterReading(meterId, new BN(100), new BN(50), timestamp).accounts({
                oracleData: oracleData,
                meterState: meterState,
                authority: other.publicKey,
                systemProgram: SystemProgram.programId,
            }).signers([other]).rpc();
            assert.fail("Should have failed");
        } catch (e: any) {
            // Success
        }
    });

    it("Triggers market clearing", async () => {
        const epochTimestamp = new BN(Math.floor(Date.now() / 1000));
        await program.methods.triggerMarketClearing(epochTimestamp).accounts({
            oracleData: oracleData,
            authority: apiGateway.publicKey
        }).signers([apiGateway]).rpc();

        const data = await program.account.oracleData.fetch(oracleData);
        assert.ok(data.lastClearing.toNumber() > 0);
        assert.equal(data.lastClearedEpoch.toNumber(), epochTimestamp.toNumber());
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
