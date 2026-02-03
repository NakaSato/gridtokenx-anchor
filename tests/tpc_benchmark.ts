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
import type { TpcBenchmark } from "../target/types/tpc_benchmark";

describe("TPC Benchmark Program", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.TpcBenchmark as Program<TpcBenchmark>;
    const authority = provider.wallet as anchor.Wallet;

    let benchmarkConfig: PublicKey;
    let warehouseAccount: PublicKey;
    let districtAccount: PublicKey;
    let customerAccount: PublicKey;

    const W_ID = new BN(1);
    const D_ID = new BN(1);
    const C_ID = new BN(1);

    before(async () => {
        [benchmarkConfig] = PublicKey.findProgramAddressSync([Buffer.from("benchmark")], program.programId);
        [warehouseAccount] = PublicKey.findProgramAddressSync([Buffer.from("warehouse"), W_ID.toArrayLike(Buffer, "le", 8)], program.programId);
        [districtAccount] = PublicKey.findProgramAddressSync([Buffer.from("district"), W_ID.toArrayLike(Buffer, "le", 8), D_ID.toArrayLike(Buffer, "le", 8)], program.programId);
        [customerAccount] = PublicKey.findProgramAddressSync([Buffer.from("customer"), W_ID.toArrayLike(Buffer, "le", 8), D_ID.toArrayLike(Buffer, "le", 8), C_ID.toArrayLike(Buffer, "le", 8)], program.programId);
    });

    it("Initializes benchmark configuration", async () => {
        const config = {
            warehouses: new BN(1),
            districtsPerWarehouse: 10,
            customersPerDistrict: 3000,
            totalItems: 100000,
            durationSeconds: new BN(3600),
            warmupPercent: 5,
            useRealTransactions: false
        };

        try {
            await program.methods.initializeBenchmark(config).accounts({
                benchmark: benchmarkConfig,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();

            const state = await program.account.benchmarkState.fetch(benchmarkConfig);
            assert.ok(state.authority.equals(authority.publicKey));
        } catch (e: any) {
            if (e.message.includes("already in use")) {
                console.log("Benchmark already initialized");
            } else {
                throw e;
            }
        }
    });

    it("Initializes a warehouse", async () => {
        try {
            await program.methods.initializeWarehouse(
                W_ID,
                "Whse 1",
                "Street 1",
                "Street 2",
                "City",
                "ST",
                "12345",
                new BN(10)
            ).accounts({
                warehouse: warehouseAccount,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
        } catch (e: any) {
            if (!e.message.includes("already in use")) throw e;
        }

        const warehouse = await program.account.warehouse.fetch(warehouseAccount);
        assert.equal(warehouse.name, "Whse 1");
    });

    it("Initializes a district", async () => {
        try {
            await program.methods.initializeDistrict(
                W_ID,
                D_ID,
                "District 1",
                "Street 1",
                "Street 2",
                "City",
                "ST",
                "12345",
                new BN(5)
            ).accounts({
                district: districtAccount,
                warehouse: warehouseAccount,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
        } catch (e: any) {
            if (!e.message.includes("already in use")) throw e;
        }

        const district = await program.account.district.fetch(districtAccount);
        assert.equal(district.name, "District 1");
    });

    it("Initializes a customer", async () => {
        try {
            await program.methods.initializeCustomer(
                W_ID,
                D_ID,
                C_ID,
                "First",
                "MD",
                "Last",
                "Street 1",
                "Street 2",
                "City",
                "ST",
                "12345",
                "555-1234",
                { goodCredit: {} },
                new BN(5000),
                new BN(10)
            ).accounts({
                customer: customerAccount,
                district: districtAccount,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
        } catch (e: any) {
            if (!e.message.includes("already in use")) throw e;
        }

        const customer = await program.account.customer.fetch(customerAccount);
        assert.equal(customer.first, "First");
    });

    it("Performs a payment transaction", async () => {
        const H_ID = new BN(Date.now());
        const [historyAccount] = PublicKey.findProgramAddressSync([Buffer.from("history"), W_ID.toArrayLike(Buffer, "le", 8), D_ID.toArrayLike(Buffer, "le", 8), H_ID.toArrayLike(Buffer, "le", 8)], program.programId);

        // Get current balance before payment
        const customerBefore = await program.account.customer.fetch(customerAccount);
        const ytdBefore = customerBefore.ytdPayment.toNumber();

        await program.methods.payment(
            W_ID,
            D_ID,
            C_ID,
            W_ID,
            D_ID,
            H_ID,
            new BN(100),
            false
        ).accounts({
            warehouse: warehouseAccount,
            district: districtAccount,
            customer: customerAccount,
            history: historyAccount,
            customerIndex: null,
            payer: authority.publicKey,
            systemProgram: SystemProgram.programId
        }).rpc();

        const customer = await program.account.customer.fetch(customerAccount);
        // Check that payment was added (increment by 100)
        assert.equal(customer.ytdPayment.toNumber(), ytdBefore + 100);
    });
});
