import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import BN from "bn.js";
import {
    Keypair,
    PublicKey,
    SystemProgram,
    LAMPORTS_PER_SOL
} from "@solana/web3.js";
import { assert } from "chai";
import type { Blockbench } from "../target/types/blockbench";

describe("Blockbench Program", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Blockbench as Program<Blockbench>;
    const authority = provider.wallet as anchor.Wallet;

    let benchmarkConfig: PublicKey;
    let metricAccount: PublicKey;
    let ycsbStore: PublicKey;

    before(async () => {
        [benchmarkConfig] = PublicKey.findProgramAddressSync([Buffer.from("blockbench"), authority.publicKey.toBuffer()], program.programId);
        [metricAccount] = PublicKey.findProgramAddressSync([Buffer.from("metric"), authority.publicKey.toBuffer(), new BN(0).toArrayLike(Buffer, "le", 8)], program.programId);
        [ycsbStore] = PublicKey.findProgramAddressSync([Buffer.from("ycsb_store"), authority.publicKey.toBuffer()], program.programId);
    });

    it("Initializes benchmark configuration", async () => {
        const config = {
            workloadType: { doNothing: {} },
            operationCount: new BN(100),
            concurrency: 10,
            durationSeconds: new BN(3600),
            recordCount: 0,
            fieldCount: 1,
            fieldSize: 100,
            distribution: { uniform: {} },
            zipfianConstant: 99
        };

        try {
            await program.methods.initializeBenchmark(config).accounts({
                benchmarkState: benchmarkConfig,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();

            const state = await program.account.blockbenchState.fetch(benchmarkConfig);
            assert.ok(state.authority.equals(authority.publicKey));
        } catch (e: any) {
            if (e.message.includes("already in use")) {
                console.log("Benchmark already initialized");
            } else {
                throw e;
            }
        }
    });

    it("Performs 'do_nothing' benchmark", async () => {
        await program.methods.doNothing().accounts({
            payer: authority.publicKey
        }).rpc();
    });

    it("Performs 'cpu_heavy_sort' benchmark", async () => {
        await program.methods.cpuHeavySort(64, new BN(12345)).accounts({
            payer: authority.publicKey
        }).rpc();
    });

    it("Initializes YCSB store", async () => {
        try {
            await program.methods.ycsbInitStore().accounts({
                ycsbStore: ycsbStore,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
        } catch (e: any) {
            if (e.message.includes("already in use")) {
                console.log("YCSB store already initialized");
            } else {
                throw e;
            }
        }
    });

    it("Performs YCSB insert", async () => {
        const key = Array(32).fill(1) as any;
        const [recordPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("ycsb_record"), ycsbStore.toBuffer(), Buffer.from(key)],
            program.programId
        );
        const value = Buffer.from("test-value");
        try {
            await program.methods.ycsbInsert(key, value).accounts({
                ycsbStore: ycsbStore,
                record: recordPda,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
        } catch (e: any) {
            if (e.message?.includes("already in use")) {
                console.log("⚠️ YCSB record already inserted (previous run)");
            } else {
                throw e;
            }
        }
    });

    it("Performs YCSB read", async () => {
        const key = Array(32).fill(1) as any;
        const [recordPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("ycsb_record"), ycsbStore.toBuffer(), Buffer.from(key)],
            program.programId
        );
        const value = await program.methods.ycsbRead(key).accounts({
            ycsbStore: ycsbStore,
            record: recordPda,
            authority: authority.publicKey
        }).view();
        assert.equal(Buffer.from(value as any).toString(), "test-value");
    });

    it("Records a metric", async () => {
        await program.methods.recordMetric({ cpuHeavy: {} }, new BN(1000), new BN(500), true).accounts({
            benchmarkState: benchmarkConfig,
            authority: authority.publicKey
        }).rpc();
    });

    it("Resets metrics", async () => {
        await program.methods.resetMetrics().accounts({
            benchmarkState: benchmarkConfig,
            authority: authority.publicKey
        }).rpc();
    });
});
