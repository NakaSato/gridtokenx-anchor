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
import type { Registry } from "../target/types/registry";

describe("Registry Program", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Registry as Program<Registry>;
    const authority = provider.wallet as anchor.Wallet;

    const user = Keypair.generate();
    const oracle = Keypair.generate();
    const METER_ID = "METER-001";

    let registryConfig: PublicKey;
    let userAccount: PublicKey;
    let meterAccount: PublicKey;

    before(async () => {
        [registryConfig] = PublicKey.findProgramAddressSync([Buffer.from("registry")], program.programId);
        [userAccount] = PublicKey.findProgramAddressSync([Buffer.from("user"), user.publicKey.toBuffer()], program.programId);
        [meterAccount] = PublicKey.findProgramAddressSync([Buffer.from("meter"), user.publicKey.toBuffer(), Buffer.from(METER_ID)], program.programId);

        // Airdrop to user
        const sig = await provider.connection.requestAirdrop(user.publicKey, 2 * LAMPORTS_PER_SOL);
        const latest = await provider.connection.getLatestBlockhash();
        await provider.connection.confirmTransaction({ signature: sig, ...latest });
    });

    it("Initializes the registry", async () => {
        try {
            await program.methods.initialize().accounts({
                registry: registryConfig,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();

            const registry = await program.account.registry.fetch(registryConfig);
            assert.ok(registry.authority.equals(authority.publicKey));
        } catch (e: any) {
            if (e.message.includes("already in use")) {
                console.log("Registry already initialized");
            } else {
                throw e;
            }
        }
    });

    it("Sets oracle authority", async () => {
        await program.methods.setOracleAuthority(oracle.publicKey).accounts({
            registry: registryConfig,
            authority: authority.publicKey
        }).rpc();

        const registry = await program.account.registry.fetch(registryConfig);
        assert.ok(registry.oracleAuthority.equals(oracle.publicKey));
        assert.equal(registry.hasOracleAuthority, 1);
    });

    it("Registers a user", async () => {
        await program.methods.registerUser({ prosumer: {} }, 13.7333, 100.5222).accounts({
            userAccount: userAccount,
            registry: registryConfig,
            authority: user.publicKey,
            systemProgram: SystemProgram.programId
        }).signers([user]).rpc();

        const account = await program.account.userAccount.fetch(userAccount);
        assert.ok(account.authority.equals(user.publicKey));
        assert.deepEqual(account.userType, { prosumer: {} });
        assert.equal(account.lat, 13.7333);
        assert.equal(account.long, 100.5222);
    });

    it("Registers a meter", async () => {
        await program.methods.registerMeter(METER_ID, { solar: {} }).accounts({
            meterAccount: meterAccount,
            userAccount: userAccount,
            registry: registryConfig,
            owner: user.publicKey,
            systemProgram: SystemProgram.programId
        }).signers([user]).rpc();

        const account = await program.account.meterAccount.fetch(meterAccount);
        assert.ok(account.owner.equals(user.publicKey));
        assert.deepEqual(account.meterType, { solar: {} });
        assert.equal(account.status.active !== undefined, true);
    });

    it("Updates meter reading", async () => {
        const timestamp = new BN(Math.floor(Date.now() / 1000));
        await program.methods.updateMeterReading(new BN(100), new BN(20), timestamp).accounts({
            registry: registryConfig,
            meterAccount: meterAccount,
            oracleAuthority: oracle.publicKey
        }).signers([oracle]).rpc();

        const account = await program.account.meterAccount.fetch(meterAccount);
        assert.equal(account.totalGeneration.toNumber(), 100);
        assert.equal(account.totalConsumption.toNumber(), 20);
        assert.equal(account.lastReadingAt.toNumber(), timestamp.toNumber());
    });

    it("Updates user status", async () => {
        await program.methods.updateUserStatus({ suspended: {} }).accounts({
            registry: registryConfig,
            userAccount: userAccount,
            authority: authority.publicKey
        }).rpc();

        const account = await program.account.userAccount.fetch(userAccount);
        assert.deepEqual(account.status, { suspended: {} });

        // Change back to active
        await program.methods.updateUserStatus({ active: {} }).accounts({
            registry: registryConfig,
            userAccount: userAccount,
            authority: authority.publicKey
        }).rpc();
    });

    it("Sets meter status", async () => {
        await program.methods.setMeterStatus({ maintenance: {} }).accounts({
            registry: registryConfig,
            meterAccount: meterAccount,
            authority: user.publicKey
        }).signers([user]).rpc();

        const account = await program.account.meterAccount.fetch(meterAccount);
        assert.deepEqual(account.status, { maintenance: {} });

        // Set back to active
        await program.methods.setMeterStatus({ active: {} }).accounts({
            registry: registryConfig,
            meterAccount: meterAccount,
            authority: user.publicKey
        }).signers([user]).rpc();
    });

    it("Gets unsettled balance (view)", async () => {
        // current_net_gen = 100 - 20 = 80
        // settled = 0
        // unsettled = 80
        const unsettled = await program.methods.getUnsettledBalance().accounts({
            meterAccount: meterAccount
        }).view();
        assert.equal(unsettled.toNumber(), 80);
    });

    it("Settles meter balance", async () => {
        await program.methods.settleMeterBalance().accounts({
            meterAccount: meterAccount,
            meterOwner: user.publicKey
        }).signers([user]).rpc();

        const account = await program.account.meterAccount.fetch(meterAccount);
        assert.equal(account.settledNetGeneration.toNumber(), 80);

        const unsettled = await program.methods.getUnsettledBalance().accounts({
            meterAccount: meterAccount
        }).view();
        assert.equal(unsettled.toNumber(), 0);
    });

    it("Deactivates a meter", async () => {
        await program.methods.deactivateMeter().accounts({
            meterAccount: meterAccount,
            userAccount: userAccount,
            registry: registryConfig,
            owner: user.publicKey
        }).signers([user]).rpc();

        const account = await program.account.meterAccount.fetch(meterAccount);
        assert.deepEqual(account.status, { inactive: {} });
    });
});
