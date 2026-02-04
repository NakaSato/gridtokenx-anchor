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
import type { Governance } from "../target/types/governance";

describe("Governance Program", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Governance as Program<Governance>;
    const authority = provider.wallet as anchor.Wallet;

    const newAuthority = Keypair.generate();
    const CERT_ID = "CERT-001";

    let poaConfig: PublicKey;
    let ercCertificate: PublicKey;

    before(async () => {
        [poaConfig] = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], program.programId);
        [ercCertificate] = PublicKey.findProgramAddressSync([Buffer.from("erc_certificate"), Buffer.from(CERT_ID)], program.programId);

        // Airdrop to newAuthority
        const sig = await provider.connection.requestAirdrop(newAuthority.publicKey, 1 * LAMPORTS_PER_SOL);
        const latest = await provider.connection.getLatestBlockhash();
        await provider.connection.confirmTransaction({ signature: sig, ...latest });

        // Register a meter for ERC issuance test
        const registryProgram = anchor.workspace.Registry as Program;
        const [registryConfig] = PublicKey.findProgramAddressSync([Buffer.from("registry")], registryProgram.programId);
        const [userAccount] = PublicKey.findProgramAddressSync([Buffer.from("user"), authority.publicKey.toBuffer()], registryProgram.programId);
        const [meterAccount] = PublicKey.findProgramAddressSync([Buffer.from("meter"), authority.publicKey.toBuffer(), Buffer.from("MOCK-001")], registryProgram.programId);

        try {
            await registryProgram.methods.initialize().accounts({
                registry: registryConfig,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
        } catch (e) { }

        try {
            await registryProgram.methods.registerUser({ prosumer: {} }, 0, 0).accounts({
                userAccount: userAccount,
                registry: registryConfig,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
        } catch (e) { }

        try {
            await registryProgram.methods.registerMeter("MOCK-001", { solar: {} }).accounts({
                meterAccount: meterAccount,
                userAccount: userAccount,
                registry: registryConfig,
                owner: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();

            // Give it some generation so we can issue ERC
            const oracle = Keypair.generate();
            await registryProgram.methods.setOracleAuthority(oracle.publicKey).accounts({
                registry: registryConfig,
                authority: authority.publicKey
            }).rpc();

            await registryProgram.methods.updateMeterReading(new BN(5000), new BN(0), new BN(Math.floor(Date.now() / 1000))).accounts({
                registry: registryConfig,
                meterAccount: meterAccount,
                oracleAuthority: oracle.publicKey
            }).signers([oracle]).rpc();
        } catch (e) { }
    });

    it("Initializes POA configuration", async () => {
        try {
            await program.methods.initializePoa().accounts({
                poaConfig: poaConfig,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();

            const config = await program.account.poAConfig.fetch(poaConfig);
            assert.ok(config.authority.equals(authority.publicKey));
        } catch (e: any) {
            if (e.message.includes("already in use")) {
                console.log("POA already initialized");
            } else {
                throw e;
            }
        }
    });

    it("Issues an ERC certificate", async () => {
        const [mockMeterPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("meter"), authority.publicKey.toBuffer(), Buffer.from("MOCK-001")],
            (anchor.workspace.Registry as Program).programId
        );

        try {
            await program.methods.issueErc(
                CERT_ID,
                new BN(1000),
                "Solar",
                "Verified by Oracle"
            ).accounts({
                ercCertificate: ercCertificate,
                poaConfig: poaConfig,
                authority: authority.publicKey,
                meterAccount: mockMeterPda, // CHECK: Manual validation
                systemProgram: SystemProgram.programId
            }).rpc();
        } catch (e: any) {
            if (e.message?.includes("already in use")) {
                console.log("⚠️ ERC certificate already issued (previous run)");
            } else {
                throw e;
            }
        }

        const cert = await program.account.ercCertificate.fetch(ercCertificate);
        assert.equal(cert.certificateId, CERT_ID);
        assert.equal(cert.energyAmount.toNumber(), 1000);
        assert.deepEqual(cert.status, { valid: {} });
    });

    it("Validates ERC for trading", async () => {
        try {
            await program.methods.validateErcForTrading().accounts({
                ercCertificate: ercCertificate,
                poaConfig: poaConfig,
                authority: authority.publicKey
            }).rpc();
        } catch (e: any) {
            // Already validated from previous run - this is expected
            if (!e.message?.includes("AlreadyValidated")) throw e;
            console.log("⚠️ ERC already validated (previous run)");
        }

        const cert = await program.account.ercCertificate.fetch(ercCertificate);
        assert.isTrue(cert.validatedForTrading);
    });

    it("Emergency pause and unpause", async () => {
        await program.methods.emergencyPause().accounts({
            poaConfig: poaConfig,
            authority: authority.publicKey
        }).rpc();

        let config = await program.account.poAConfig.fetch(poaConfig);
        assert.isTrue(config.emergencyPaused);

        await program.methods.emergencyUnpause().accounts({
            poaConfig: poaConfig,
            authority: authority.publicKey
        }).rpc();

        config = await program.account.poAConfig.fetch(poaConfig);
        assert.isFalse(config.emergencyPaused);
    });

    it("Updates governance configuration", async () => {
        await program.methods.updateGovernanceConfig(false).accounts({
            poaConfig: poaConfig,
            authority: authority.publicKey
        }).rpc();

        const config = await program.account.poAConfig.fetch(poaConfig);
        assert.isFalse(config.ercValidationEnabled);
    });

    it("Sets maintenance mode", async () => {
        await program.methods.setMaintenanceMode(true).accounts({
            poaConfig: poaConfig,
            authority: authority.publicKey
        }).rpc();

        const config = await program.account.poAConfig.fetch(poaConfig);
        assert.isTrue(config.maintenanceMode);

        // Turn off
        await program.methods.setMaintenanceMode(false).accounts({
            poaConfig: poaConfig,
            authority: authority.publicKey
        }).rpc();
    });

    it("Updates ERC limits", async () => {
        await program.methods.updateErcLimits(
            new BN(10),
            new BN(1000000),
            new BN(3600 * 24 * 365)
        ).accounts({
            poaConfig: poaConfig,
            authority: authority.publicKey
        }).rpc();

        const config = await program.account.poAConfig.fetch(poaConfig);
        assert.equal((config.minEnergyAmount as BN).toNumber(), 10);
        assert.equal((config.maxErcAmount as BN).toNumber(), 1000000);
    });

    it("Proposes and cancels authority change", async () => {
        await program.methods.proposeAuthorityChange(newAuthority.publicKey).accounts({
            poaConfig: poaConfig,
            authority: authority.publicKey
        }).rpc();

        let config = await program.account.poAConfig.fetch(poaConfig);
        assert.ok(config.pendingAuthority && config.pendingAuthority.equals(newAuthority.publicKey));

        await program.methods.cancelAuthorityChange().accounts({
            poaConfig: poaConfig,
            authority: authority.publicKey
        }).rpc();

        config = await program.account.poAConfig.fetch(poaConfig);
        assert.isNull(config.pendingAuthority);
    });
});
