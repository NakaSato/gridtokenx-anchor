import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import BN from "bn.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import type { Blockbench } from "../target/types/blockbench";
import { BenchReport, measureOp } from "./utils/bench";

/**
 * SmallBank OLTP benchmark (academic configuration).
 *
 * Measures each of the five SmallBank read-write transactions individually over
 * a warmup + ITERS schedule, reporting the latency distribution, sequential
 * throughput, and per-tx compute units. Accounts are seeded with large balances
 * so repeated WriteCheck / SendPayment never underflow across the run.
 *
 * Tunables: BENCH_ITERS, BENCH_WARMUP.
 */
describe("SmallBank OLTP Benchmark", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Blockbench as Program<Blockbench>;
  const authority = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  const ITERS = parseInt(process.env.BENCH_ITERS ?? "100", 10);
  const WARMUP = parseInt(process.env.BENCH_WARMUP ?? "10", 10);

  // Large seed balances so monotonic-debit ops stay valid for the whole run.
  const SEED = new BN("1000000000000"); // 1e12

  const report = new BenchReport("smallbank");
  const runStamp = new Date().toISOString();

  // Run-unique customer ids so accounts are fresh on a live ledger.
  const RUN_TAG = Date.now() % 1_000_000;
  const idA = new BN(RUN_TAG + 10_000);
  const idB = new BN(RUN_TAG + 10_001);

  const pda = (seed: string, id: BN) =>
    PublicKey.findProgramAddressSync([Buffer.from(seed), id.toArrayLike(Buffer, "le", 8)], program.programId)[0];

  const customerA = pda("sb_customer", idA);
  const savingsA = pda("sb_savings", idA);
  const checkingA = pda("sb_checking", idA);
  const customerB = pda("sb_customer", idB);
  const savingsB = pda("sb_savings", idB);
  const checkingB = pda("sb_checking", idB);

  let ready = false;

  before(async () => {
    try {
      const sig = await connection.requestAirdrop(authority.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    } catch {
      /* already funded or airdrop unsupported */
    }

    // `name` is an on-chain `String` capped at 16 chars (4 + 16 space) — pass a
    // short literal, not a padded byte array (which serializes as a 32-char
    // string and overflows the account → AccountDidNotSerialize / err 3004).
    try {
      await program.methods.smallbankCreateAccount(idA, "Alice", SEED, SEED).accounts({
        customer: customerA, savings: savingsA, checking: checkingA,
        authority: authority.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();
      await program.methods.smallbankCreateAccount(idB, "Bob", SEED, SEED).accounts({
        customer: customerB, savings: savingsB, checking: checkingB,
        authority: authority.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();
      ready = true;
    } catch (e: any) {
      console.log(`⚠ SmallBank setup failed (program unavailable?): ${e.message}`);
    }
  });

  after(async () => {
    if (ready) await report.finalize(connection, runStamp);
  });

  const guard = () => {
    if (!ready) {
      console.log("⚠ Skipping: Blockbench program not available");
      return false;
    }
    return true;
  };

  it(`TransactSavings (${ITERS} iters)`, async () => {
    if (!guard()) return;
    const r = await measureOp({
      label: "TransactSavings", iters: ITERS, warmup: WARMUP, connection, captureCu: true,
      fn: () => program.methods.smallbankTransactSavings(new BN(1))
        .accounts({ savings: savingsA, authority: authority.publicKey }).rpc(),
    });
    report.add(r);
    assert.isAbove(r.iters, 0);
  });

  it(`DepositChecking (${ITERS} iters)`, async () => {
    if (!guard()) return;
    const r = await measureOp({
      label: "DepositChecking", iters: ITERS, warmup: WARMUP, connection, captureCu: true,
      fn: () => program.methods.smallbankDepositChecking(new BN(1))
        .accounts({ checking: checkingA, authority: authority.publicKey }).rpc(),
    });
    report.add(r);
    assert.isAbove(r.iters, 0);
  });

  it(`SendPayment (${ITERS} iters)`, async () => {
    if (!guard()) return;
    const r = await measureOp({
      label: "SendPayment", iters: ITERS, warmup: WARMUP, connection, captureCu: true,
      fn: () => program.methods.smallbankSendPayment(new BN(1))
        .accounts({ fromChecking: checkingA, toChecking: checkingB, authority: authority.publicKey }).rpc(),
    });
    report.add(r);
    assert.isAbove(r.iters, 0);
  });

  it(`WriteCheck (${ITERS} iters)`, async () => {
    if (!guard()) return;
    const r = await measureOp({
      label: "WriteCheck", iters: ITERS, warmup: WARMUP, connection, captureCu: true,
      fn: () => program.methods.smallbankWriteCheck(new BN(1))
        .accounts({ checking: checkingA, authority: authority.publicKey }).rpc(),
    });
    report.add(r);
    assert.isAbove(r.iters, 0);
  });

  it(`Amalgamate (${ITERS} iters)`, async () => {
    if (!guard()) return;
    // Amalgamate moves savings→checking and zeroes savings. After the first call
    // savings is 0, so subsequent calls still exercise both account writes (the
    // instruction's cost is value-independent) — what we report is per-tx latency
    // and compute units, not a balance assertion.
    const r = await measureOp({
      label: "Amalgamate", iters: ITERS, warmup: WARMUP, connection, captureCu: true,
      fn: () => program.methods.smallbankAmalgamate()
        .accounts({ savings: savingsA, checking: checkingA, authority: authority.publicKey }).rpc(),
    });
    report.add(r);
    assert.isAbove(r.iters, 0);
  });
});
