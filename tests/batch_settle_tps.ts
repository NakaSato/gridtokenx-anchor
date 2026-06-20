// §2b batch-settle TPS sweep — throughput of the REAL CDA settlement path
// (trading::batch_settle_offchain_match → treasury::record_settlement_batch),
// not a BlockBench/SmallBank/TPC-C proxy. Each tx settles ONE match: the batch
// instruction takes N matches on-chain but a single tx is capped at 1 match
// (per-match inline Ed25519 verify ix data can't ALT-compress; 2 matches overrun
// the 1232-byte packet — see the batch-settle-single-tx-cap memory / BENCHMARKS.md).
//
// Design: the expensive part (seed buyer/seller, fund escrows, build+activate the
// ALT, build the settle + Ed25519 ixs) is done UP FRONT in setup. The timed phase
// only compiles+signs+sends pre-built v0 txs (CPU-cheap, fresh blockhash per send)
// and waits for confirmation — so the measurement reflects submit→confirm
// throughput of the settle path, not the one-time account seeding. Each settle tx
// is single-use (its nullifiers are consumed), so every concurrency level gets its
// own fresh batch of pre-built txs.
//
// RUNTIME: pre-seeding dominates wall time (~N×(12 seed txs + 1 ALT) per level).
// Keep N modest. Env knobs:
//   BENCH_TPS_N        txs measured per concurrency level (default 8)
//   BENCH_TPS_CONC     comma list of concurrency levels   (default "4,8")
//   BENCH_TPS_WARMUP   discarded settles before timing     (default 2)
//
// Run (validator up, current trading.so deployed, bootstrap + init-treasury done):
//   BENCH_TPS_N=8 BENCH_TPS_CONC=4,8 \
//     ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json \
//     npx mocha -r tsx tests/batch_settle_tps.ts --timeout 3000000

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { EnergyToken } from "../target/types/energy_token";
import { Treasury } from "../target/types/treasury";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableProgram,
  LAMPORTS_PER_SOL,
  Ed25519Program,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";
import { performance } from "perf_hooks";
import { settlementRecordPda } from "../scripts/settlement-pda";

function orderMessage(p: {
  orderId: Buffer; user: PublicKey; energyAmount: number; pricePerKwh: number;
  side: number; zoneId: number; expiresAt: number;
}): Buffer {
  const b = Buffer.alloc(16 + 32 + 8 + 8 + 1 + 4 + 8);
  let o = 0;
  p.orderId.copy(b, o); o += 16;
  p.user.toBuffer().copy(b, o); o += 32;
  b.writeBigUInt64LE(BigInt(p.energyAmount), o); o += 8;
  b.writeBigUInt64LE(BigInt(p.pricePerKwh), o); o += 8;
  b.writeUInt8(p.side, o); o += 1;
  b.writeUInt32LE(p.zoneId, o); o += 4;
  b.writeBigInt64LE(BigInt(p.expiresAt), o); o += 8;
  return b;
}

const envInt = (k: string, d: number) => {
  const v = process.env[k];
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : d;
};

interface PreparedTx { edIxs: any[]; settleIx: any; alt: any; }

describe("batch_settle THBG — TPS sweep (§2b)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const trading = anchor.workspace.Trading as Program<Trading>;
  const energy = anchor.workspace.EnergyToken as Program<EnergyToken>;
  const treasury = anchor.workspace.Treasury as Program<Treasury>;
  const authority = provider.wallet.publicKey;
  const payer = (provider.wallet as any).payer as Keypair;

  const zoneId = 0;
  const N = envInt("BENCH_TPS_N", 8);
  const WARMUP = envInt("BENCH_TPS_WARMUP", 2);
  const CONC = (process.env.BENCH_TPS_CONC || "4,8").split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0);
  // Unique batch-id base per run: SettlementRecord PDA is seeded by (zone,batch)
  // and the local ledger persists across runs, so a fixed id collides on re-run.
  let nextBatchId = Date.now() % 1_000_000;
  const freshBatchId = () => new BN(nextBatchId++);

  const tpda = (p: Program<any>, seed: string) =>
    PublicKey.findProgramAddressSync([Buffer.from(seed)], p.programId)[0];

  const marketPda = tpda(trading, "market");
  const marketAuthorityPda = tpda(trading, "market_authority");
  const energyMintPda = tpda(energy, "mint_2022");
  const energyInfoPda = tpda(energy, "token_info_2022");
  const treasuryPda = tpda(treasury, "treasury");
  const thbgMint = tpda(treasury, "thbg_mint");
  const swapVault = tpda(treasury, "swap_vault");
  const zoneMarketPda = PublicKey.findProgramAddressSync(
    [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(zoneId).toArrayLike(Buffer, "le", 4)],
    trading.programId
  )[0];

  const escrowPda = (user: PublicKey, mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("escrow"), user.toBuffer(), mint.toBuffer()], trading.programId)[0];
  const collectorPda = (label: string) =>
    PublicKey.findProgramAddressSync([Buffer.from(label), thbgMint.toBuffer()], trading.programId)[0];
  const nullifierPda = (user: PublicKey, orderId: Buffer) =>
    PublicKey.findProgramAddressSync([Buffer.from("nullifier"), user.toBuffer(), orderId], trading.programId)[0];
  const ata = (mint: PublicKey, owner: PublicKey) =>
    getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);

  async function mintEnergyTo(dest: PublicKey, owner: PublicKey, amount: number) {
    await energy.methods.mintToWallet(new BN(amount)).accounts({
      mint: energyMintPda, tokenInfo: energyInfoPda, destination: dest, destinationOwner: owner,
      authority, payer: authority, tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any).rpc();
  }
  async function freshUser(): Promise<Keypair> {
    const kp = Keypair.generate();
    await provider.sendAndConfirm(new Transaction().add(
      SystemProgram.transfer({ fromPubkey: authority, toPubkey: kp.publicKey, lamports: 0.3 * LAMPORTS_PER_SOL })
    ));
    return kp;
  }
  async function createAtaFor(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
    const a = ata(mint, owner);
    await provider.sendAndConfirm(new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(authority, a, owner, mint, TOKEN_2022_PROGRAM_ID)
    ));
    return a;
  }
  async function deposit(kp: Keypair, walletAta: PublicKey, mint: PublicKey, amount: number) {
    await trading.methods.depositEscrow(new BN(amount)).accounts({
      user: kp.publicKey, mint, userWallet: walletAta, userEscrow: escrowPda(kp.publicKey, mint),
      marketAuthority: marketAuthorityPda, tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any).signers([kp]).rpc();
  }
  async function fundThbg(kp: Keypair, thbgTarget: number): Promise<PublicKey> {
    const grx = thbgTarget * 300;
    const grxAta = await createAtaFor(energyMintPda, kp.publicKey);
    await mintEnergyTo(grxAta, kp.publicKey, grx);
    const thbgAta = await createAtaFor(thbgMint, kp.publicKey);
    await treasury.methods.swapGrxForThbg(new BN(grx)).accounts({
      treasury: treasuryPda, grxMint: energyMintPda, thbgMint, swapVault,
      userGrxAta: grxAta, userThbgAta: thbgAta, user: kp.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as any).signers([kp]).rpc();
    return thbgAta;
  }

  const matchAmount = 100, matchPrice = 50;

  async function seedPair(): Promise<{ buyer: Keypair; seller: Keypair }> {
    const buyer = await freshUser();
    const seller = await freshUser();
    const buyerThbgAta = await fundThbg(buyer, 10_000);
    const sellerEnergyAta = await createAtaFor(energyMintPda, seller.publicKey);
    await mintEnergyTo(sellerEnergyAta, seller.publicKey, 200);
    await deposit(buyer, buyerThbgAta, thbgMint, 10_000);
    await deposit(seller, sellerEnergyAta, energyMintPda, 200);
    // Receiving escrows (seller currency, buyer energy) must exist before settle.
    const sellerThbgAta = await fundThbg(seller, 10);
    await deposit(seller, sellerThbgAta, thbgMint, 1);
    const buyerEnergyAta = await createAtaFor(energyMintPda, buyer.publicKey);
    await mintEnergyTo(buyerEnergyAta, buyer.publicKey, 1);
    await deposit(buyer, buyerEnergyAta, energyMintPda, 1);
    return { buyer, seller };
  }

  // Build one fully-prepared 1-match settle (edIxs + settleIx + activated ALT).
  async function prepareOne(buyer: Keypair, seller: Keypair, idx: number): Promise<PreparedTx> {
    const oid = (n: number) => { const x = Buffer.alloc(16); x.writeUInt32LE(n, 0); return x; };
    const buyerOrderId = oid(0x1000 + idx * 2);
    const sellerOrderId = oid(0x1001 + idx * 2);
    const buyerMsg = orderMessage({ orderId: buyerOrderId, user: buyer.publicKey, energyAmount: matchAmount, pricePerKwh: 60, side: 0, zoneId, expiresAt: 0 });
    const sellerMsg = orderMessage({ orderId: sellerOrderId, user: seller.publicKey, energyAmount: matchAmount, pricePerKwh: 50, side: 1, zoneId, expiresAt: 0 });
    const edIxs = [
      Ed25519Program.createInstructionWithPrivateKey({ privateKey: buyer.secretKey, message: buyerMsg }),
      Ed25519Program.createInstructionWithPrivateKey({ privateKey: seller.secretKey, message: sellerMsg }),
    ];
    const buyerPayload = { orderId: [...buyerOrderId], user: buyer.publicKey, energyAmount: new BN(matchAmount), pricePerKwh: new BN(60), side: 0, zoneId, expiresAt: new BN(0) };
    const sellerPayload = { orderId: [...sellerOrderId], user: seller.publicKey, energyAmount: new BN(matchAmount), pricePerKwh: new BN(50), side: 1, zoneId, expiresAt: new BN(0) };
    const matchPair = { buyerPayload, sellerPayload, matchAmount: new BN(matchAmount), matchPrice: new BN(matchPrice), wheelingCharge: new BN(1), lossCost: new BN(1) };

    const marketAcct: any = await trading.account.market.fetch(marketPda);
    const zoneAcct: any = await trading.account.zoneMarket.fetch(zoneMarketPda);
    const mShardByte = authority.toBuffer()[0] % (Number(marketAcct.numShards) || 16);
    const zShardByte = authority.toBuffer()[0] % (Number(zoneAcct.numShards) || 16);
    const marketShardPda = PublicKey.findProgramAddressSync([Buffer.from("market_shard"), marketPda.toBuffer(), Buffer.from([mShardByte])], trading.programId)[0];
    const zoneShardPda = PublicKey.findProgramAddressSync([Buffer.from("zone_shard"), zoneMarketPda.toBuffer(), Buffer.from([zShardByte])], trading.programId)[0];
    try { await trading.methods.initializeMarketShard(mShardByte).accounts({ market: marketPda, marketShard: marketShardPda, payer: authority, systemProgram: SystemProgram.programId } as any).rpc(); } catch {}
    try { await trading.methods.initializeZoneMarketShard(zShardByte).accounts({ zoneMarket: zoneMarketPda, zoneShard: zoneShardPda, payer: authority, systemProgram: SystemProgram.programId } as any).rpc(); } catch {}

    const merkleRoot = Array.from({ length: 32 }, (_, i) => (i + 1) & 0xff);
    const vatAmount = new BN(Math.floor(matchAmount * matchPrice * 0.07));
    const thisBatchId = freshBatchId();
    const [settlementRecord] = settlementRecordPda(zoneId, thisBatchId, treasury.programId);

    const remaining = [
      nullifierPda(buyer.publicKey, buyerOrderId),
      nullifierPda(seller.publicKey, sellerOrderId),
      escrowPda(buyer.publicKey, thbgMint),
      escrowPda(seller.publicKey, thbgMint),
      escrowPda(seller.publicKey, energyMintPda),
      escrowPda(buyer.publicKey, energyMintPda),
    ].map((pubkey) => ({ pubkey, isSigner: false, isWritable: true }));

    const settleIx = await trading.methods
      .batchSettleOffchainMatch([matchPair] as any, merkleRoot, vatAmount, 700, thisBatchId)
      .accounts({
        market: marketPda, zoneMarket: zoneMarketPda, currencyMint: thbgMint, energyMint: energyMintPda,
        marketAuthority: marketAuthorityPda, marketShard: marketShardPda, zoneShard: zoneShardPda,
        feeCollector: collectorPda("fee_collector"), wheelingCollector: collectorPda("wheeling_collector"),
        lossCollector: collectorPda("loss_collector"), payer: authority,
        sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_2022_PROGRAM_ID, secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        treasuryProgram: treasury.programId, treasuryState: treasuryPda, settlementRecord,
      } as any)
      .remainingAccounts(remaining)
      .instruction();

    const altAddrs = [...new Set(settleIx.keys.filter((k: any) => !k.isSigner).map((k: any) => k.pubkey.toBase58()))].map((s) => new PublicKey(s as string));
    const recentSlot = await provider.connection.getSlot();
    const [createAltIx, altAddress] = AddressLookupTableProgram.createLookupTable({ authority, payer: authority, recentSlot });
    const extendAltIx = AddressLookupTableProgram.extendLookupTable({ payer: authority, authority, lookupTable: altAddress, addresses: altAddrs });
    {
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: authority, recentBlockhash: blockhash } as any).add(createAltIx, extendAltIx);
      tx.sign(payer);
      await provider.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    }
    // Advance a couple slots so the ALT becomes active.
    for (let w = 0; w < 2; w++) {
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: authority, recentBlockhash: blockhash } as any).add(SystemProgram.transfer({ fromPubkey: authority, toPubkey: authority, lamports: 1 }));
      tx.sign(payer);
      await provider.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      await new Promise((r) => setTimeout(r, 400));
    }
    let alt: any = null;
    for (let i = 0; i < 40; i++) {
      const r = await provider.connection.getAddressLookupTable(altAddress);
      if (r.value && r.value.state.addresses.length >= altAddrs.length) { alt = r.value; break; }
      await new Promise((r) => setTimeout(r, 400));
    }
    expect(alt, "ALT activated").to.not.be.null;
    return { edIxs, settleIx, alt };
  }

  // Confirm-per-tx send (warmup only): blocks until confirmed or throws.
  async function sendSettle(p: PreparedTx): Promise<string> {
    let lastErr: any = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({ payerKey: authority, recentBlockhash: blockhash, instructions: [...p.edIxs, p.settleIx] }).compileToV0Message([p.alt]);
      const vtx = new VersionedTransaction(msg);
      vtx.sign([payer]);
      try {
        const sig = await provider.connection.sendTransaction(vtx, { skipPreflight: true });
        const conf = await provider.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        if (conf.value.err) throw new Error("settle failed: " + JSON.stringify(conf.value.err));
        return sig;
      } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 400)); }
    }
    throw lastErr;
  }

  // Fire one settle WITHOUT awaiting confirmation (open-loop submit). Returns the
  // sig, or null if the RPC rejected the submit outright. The shared blockhash is
  // passed in so the timed burst doesn't pay a getLatestBlockhash RPC per send.
  async function fireSettle(p: PreparedTx, blockhash: string): Promise<string | null> {
    const msg = new TransactionMessage({ payerKey: authority, recentBlockhash: blockhash, instructions: [...p.edIxs, p.settleIx] }).compileToV0Message([p.alt]);
    const vtx = new VersionedTransaction(msg);
    vtx.sign([payer]);
    try { return await provider.connection.sendTransaction(vtx, { skipPreflight: true }); }
    catch { return null; }
  }

  // Poll getSignatureStatuses until every sig is confirmed/finalized or errors,
  // or the deadline passes. Returns the per-sig terminal error (null = success).
  async function awaitConfirmed(sigs: (string | null)[], deadlineMs: number): Promise<(any | "missing")[]> {
    const out: (any | "missing")[] = sigs.map(() => "missing");
    const start = performance.now();
    while (performance.now() - start < deadlineMs) {
      const live = sigs.map((s, i) => ({ s, i })).filter((x) => x.s && out[x.i] === "missing");
      if (live.length === 0) break;
      // getSignatureStatuses caps at 256 sigs/call; our N stays well under that.
      const res = await provider.connection.getSignatureStatuses(live.map((x) => x.s as string));
      res.value.forEach((st, k) => {
        if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
          out[live[k].i] = st.err ?? null;
        }
      });
      if (out.every((e) => e !== "missing")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return out;
  }

  before(async () => {
    await treasury.methods.updateAttestation(new BN(1_000_000_000_000)).accounts({
      treasury: treasuryPda, attestor: authority,
    } as any).rpc();
    try {
      await trading.methods.initializeCollectors().accounts({
        payer: authority, currencyMint: thbgMint,
        feeCollector: collectorPda("fee_collector"), wheelingCollector: collectorPda("wheeling_collector"),
        lossCollector: collectorPda("loss_collector"), marketAuthority: marketAuthorityPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId,
      } as any).rpc();
    } catch { /* already initialized */ }
  });

  it(`sweeps batch-settle TPS over concurrency [${CONC.join(", ")}], N=${N}/level`, async () => {
    // Warmup: a few settles to JIT the path / warm caches (discarded).
    for (let i = 0; i < WARMUP; i++) {
      const { buyer, seller } = await seedPair();
      await sendSettle(await prepareOne(buyer, seller, 900 + i));
    }

    const rows: { conc: number; tps: number; wallMs: number; ok: number; fail: number; cuMean: number; rounds: number; dropped: number; reverted: number }[] = [];
    for (const conc of CONC) {
      // Pre-seed + pre-build N single-use settle txs for THIS level.
      const prepared: PreparedTx[] = [];
      for (let i = 0; i < N; i++) {
        const { buyer, seller } = await seedPair();
        prepared.push(await prepareOne(buyer, seller, i + conc * 1000));
      }

      // Timed phase: open-loop submission. A worker pool of size `conc` keeps that
      // many sends in flight (each send is fire-and-forget, no per-tx confirm
      // wait), then we poll all sigs to confirmed. Wall = first send → all
      // confirmed, so TPS reflects submit→confirm throughput at this concurrency,
      // not the serialized per-tx confirm latency. All N share one blockhash
      // (valid ~60s) to keep getLatestBlockhash out of the hot loop.
      // All N settles write the SAME marketShard + zoneShard PDA (shard byte =
      // payer's first byte, constant for one authority), so they serialize on
      // those accounts and the validator drops the losers of a same-slot write
      // race under burst. We therefore measure GOODPUT: re-fire still-unconfirmed
      // (dropped) sigs over up to `rounds` rounds with a fresh blockhash each
      // round. A sig that lands and REVERTS on-chain (err object) is a real
      // failure and is NOT retried — only "missing" (dropped) ones are.
      const sigs: (string | null)[] = new Array(N).fill(null);
      const errs: (any | "missing")[] = new Array(N).fill("missing");
      const rounds = 3;
      let roundsUsed = 0, dropped = 0, reverted = 0;
      const t0 = performance.now();
      for (let round = 0; round < rounds; round++) {
        const pending = errs.map((e, i) => i).filter((i) => errs[i] === "missing");
        if (pending.length === 0) break;
        roundsUsed = round + 1;
        const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
        let cursor = 0;
        async function worker() {
          while (true) {
            const k = cursor++;
            if (k >= pending.length) return;
            const i = pending[k];
            sigs[i] = await fireSettle(prepared[i], blockhash);
          }
        }
        await Promise.all(Array.from({ length: Math.min(conc, pending.length) }, () => worker()));
        const r = await awaitConfirmed(pending.map((i) => sigs[i]), 60_000);
        pending.forEach((i, k) => { errs[i] = r[k]; });
      }
      const t1 = performance.now();

      const wallMs = t1 - t0;
      const ok = errs.filter((e) => e === null).length;
      dropped = errs.filter((e) => e === "missing").length;
      reverted = errs.filter((e) => e !== null && e !== "missing").length;
      const fail = N - ok;
      const tps = ok / (wallMs / 1000);

      // Post-hoc CU sample over the confirmed settles.
      const okSigs = sigs.filter((s, i) => s && errs[i] === null) as string[];
      let cuSum = 0, cuN = 0;
      for (const sig of okSigs) {
        const m = await provider.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        const cu = m?.meta?.computeUnitsConsumed ?? 0;
        if (cu > 0) { cuSum += cu; cuN++; }
      }
      const cuMean = cuN ? Math.round(cuSum / cuN) : 0;
      rows.push({ conc, tps, wallMs, ok, fail, cuMean, rounds: roundsUsed, dropped, reverted });
      console.log(`  [BENCH_BATCH_TPS] conc=${conc} N=${N} ok=${ok} fail=${fail} (dropped=${dropped} reverted=${reverted}) rounds=${roundsUsed} wall_ms=${Math.round(wallMs)} tps=${tps.toFixed(2)} cu_mean=${cuMean}`);
    }

    console.log("  [BENCH_BATCH_TPS] conc | tps | wall_ms | ok/fail | rounds | dropped | reverted | cu_mean");
    for (const r of rows) console.log(`  [BENCH_BATCH_TPS]  ${r.conc} | ${r.tps.toFixed(2)} | ${Math.round(r.wallMs)} | ${r.ok}/${r.fail} | ${r.rounds} | ${r.dropped} | ${r.reverted} | ${r.cuMean}`);

    // Sanity: at least one level produced confirmed settles and positive TPS.
    expect(rows.some((r) => r.ok > 0 && r.tps > 0), "at least one concurrency level settled").to.equal(true);
  });
});
