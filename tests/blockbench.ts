import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import BN from "bn.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import type { Blockbench } from "../target/types/blockbench";
import { BenchReport, measureOp } from "./utils/bench";

/**
 * BlockBench OLTP microbenchmark (academic configuration).
 *
 * Each operation is driven through {@link measureOp}: a warmup phase (discarded)
 * followed by ITERS measured invocations, yielding a latency distribution
 * (mean/stddev/p50/p95/p99/p99.9 + 95% CI), sequential throughput, and per-tx
 * compute units. Results are tabulated and written to test-results/blockbench/.
 *
 * Tunables via env: BENCH_ITERS, BENCH_WARMUP. Defaults are modest so the suite
 * stays usable in CI; raise them (e.g. BENCH_ITERS=500) for paper-grade runs.
 */
describe("BlockBench OLTP Benchmark", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Blockbench as Program<Blockbench>;
  const authority = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  const ITERS = parseInt(process.env.BENCH_ITERS ?? "100", 10);
  const WARMUP = parseInt(process.env.BENCH_WARMUP ?? "10", 10);

  const report = new BenchReport("blockbench");
  const runStamp = new Date().toISOString();

  let benchmarkConfig: PublicKey;
  let ycsbStore: PublicKey;

  before(async () => {
    [benchmarkConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("blockbench"), authority.publicKey.toBuffer()],
      program.programId,
    );
    [ycsbStore] = PublicKey.findProgramAddressSync(
      [Buffer.from("ycsb_store"), authority.publicKey.toBuffer()],
      program.programId,
    );

    const config = {
      workloadType: { doNothing: {} },
      operationCount: new BN(ITERS),
      concurrency: 1,
      durationSeconds: new BN(3600),
      recordCount: new BN(0),
      fieldCount: 1,
      fieldSize: 100,
      distribution: { uniform: {} },
      zipfianConstant: 99,
    };
    try {
      await program.methods.initializeBenchmark(config).accounts({
        benchmarkState: benchmarkConfig,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      }).rpc();
    } catch (e: any) {
      if (!e.message?.includes("already in use")) throw e;
    }
    try {
      await program.methods.ycsbInitStore().accounts({
        ycsbStore,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      }).rpc();
    } catch (e: any) {
      if (!e.message?.includes("already in use")) throw e;
    }
  });

  after(async () => {
    await report.finalize(connection, runStamp);
  });

  it(`do_nothing — latency floor (${ITERS} iters)`, async () => {
    const r = await measureOp({
      label: "do_nothing",
      iters: ITERS,
      warmup: WARMUP,
      connection,
      captureCu: true,
      fn: () =>
        program.methods.doNothing().accounts({ payer: authority.publicKey }).rpc(),
    });
    report.add(r);
    assert.isAbove(r.iters, 0, "expected at least one successful do_nothing");
  });

  it(`cpu_heavy_sort — compute-bound op (${ITERS} iters)`, async () => {
    const r = await measureOp({
      label: "cpu_heavy_sort",
      iters: ITERS,
      warmup: WARMUP,
      connection,
      captureCu: true,
      // Deterministic seed offset per call keeps the sort identical-cost while
      // varying input so the validator can't trivially cache.
      fn: (i) =>
        program.methods.cpuHeavySort(64, new BN(12345 + i)).accounts({ payer: authority.publicKey }).rpc(),
    });
    report.add(r);
    assert.isAbove(r.iters, 0, "expected at least one successful cpu_heavy_sort");
  });

  it(`ycsb_insert — write workload (${ITERS} iters)`, async () => {
    const r = await measureOp({
      label: "ycsb_insert",
      iters: ITERS,
      warmup: WARMUP,
      connection,
      captureCu: true,
      fn: (i) => {
        // Unique 32-byte key per iteration so every insert hits a fresh PDA.
        const key = Buffer.alloc(32);
        key.writeUInt32LE(i, 0);
        const [recordPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("ycsb_record"), ycsbStore.toBuffer(), key],
          program.programId,
        );
        return program.methods.ycsbInsert(Array.from(key) as any, Buffer.from("v")).accounts({
          ycsbStore,
          record: recordPda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        }).rpc();
      },
    });
    report.add(r);
    assert.isAbove(r.iters, 0, "expected at least one successful ycsb_insert");
  });

  it(`ycsb_read — point read (${ITERS} iters)`, async () => {
    // Seed a single record, then re-read it ITERS times (read-only `.view()`).
    const key = Buffer.alloc(32);
    key.writeUInt32LE(0xffff, 0);
    const [recordPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("ycsb_record"), ycsbStore.toBuffer(), key],
      program.programId,
    );
    try {
      await program.methods.ycsbInsert(Array.from(key) as any, Buffer.from("read-me")).accounts({
        ycsbStore,
        record: recordPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      }).rpc();
    } catch (e: any) {
      if (!e.message?.includes("already in use")) throw e;
    }
    const r = await measureOp({
      label: "ycsb_read",
      iters: ITERS,
      warmup: WARMUP,
      // .view() is a simulated read — no signature, so no CU capture.
      fn: () =>
        program.methods.ycsbRead(Array.from(key) as any).accounts({
          ycsbStore,
          record: recordPda,
          authority: authority.publicKey,
        }).view().then(() => undefined),
    });
    report.add(r);
    assert.isAbove(r.iters, 0, "expected at least one successful ycsb_read");
  });
});
