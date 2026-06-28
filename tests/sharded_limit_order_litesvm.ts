// Litesvm coverage for submit_limit_order_sharded (instructions/submit_sharded_limit_order.rs),
// previously untested. Unlike submit_limit_order this path has NO maintenance / amount / price /
// bounds guards and does NOT read governance_config — it only inits the Order PDA and stamps
// zone_shard.last_update (per-shard write to avoid contention on the global market). So coverage
// here is the happy-path order initialization for both sides + the missing-shard account guard.

import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const tradingIdl = require("../target/idl/trading.json");

const ZONE = 0;
const SHARD = 0;
const BUY = 0, SELL = 1;
const NOW = 1_000_000;

describe("trading submit_limit_order_sharded (litesvm)", () => {
  let svm: LiteSVM;
  let trading: Program<Trading>;
  let tradingId: PublicKey;

  const payer = Keypair.generate();
  let marketPda: PublicKey;
  let zoneMarketPda: PublicKey;
  let zoneShardPda: PublicKey;

  function trySend(ixs: TransactionInstruction[], signers: Keypair[]): FailedTransactionMetadata | null {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    ixs.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...signers);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res instanceof FailedTransactionMetadata ? res : null;
  }
  function send(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const f = trySend(ixs, signers);
    if (f) throw new Error("tx failed: " + f.err().toString() + "\n" + f.meta().logs().join("\n"));
  }
  function sendExpectFail(ixs: TransactionInstruction[], signers: Keypair[] = []): string {
    const f = trySend(ixs, signers);
    if (!f) throw new Error("expected tx to fail but it succeeded");
    return f.err().toString() + "\n" + f.meta().logs().join("\n");
  }

  const orderPda = (orderId: number) =>
    PublicKey.findProgramAddressSync([Buffer.from("order"), payer.publicKey.toBuffer(), new BN(orderId).toArrayLike(Buffer, "le", 8)], tradingId)[0];
  const shardPdaFor = (shard: number) =>
    PublicKey.findProgramAddressSync([Buffer.from("zone_shard"), zoneMarketPda.toBuffer(), Buffer.from([shard])], tradingId)[0];

  const order = (orderId: number) => trading.coder.accounts.decode("order", Buffer.from(svm.getAccount(orderPda(orderId))!.data));
  const zoneShard = () => trading.coder.accounts.decode("zoneMarketShard", Buffer.from(svm.getAccount(zoneShardPda)!.data));

  const shardedIx = (orderId: number, side: number, amount: number, price: number, shard: number) =>
    trading.methods.submitLimitOrderSharded(new BN(orderId), side, new BN(amount), new BN(price), shard).accounts({
      order: orderPda(orderId), zoneMarket: zoneMarketPda, zoneShard: shardPdaFor(shard),
      authority: payer.publicKey, systemProgram: SystemProgram.programId, governanceConfig: payer.publicKey,
    } as any).instruction();

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    trading = new Program(tradingIdl, { connection: {}, publicKey: PublicKey.default } as any);
    tradingId = trading.programId;
    svm.addProgramFromFile(tradingId, "target/deploy/trading.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));

    [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingId);
    [zoneMarketPda] = PublicKey.findProgramAddressSync([Buffer.from("zone_market"), marketPda.toBuffer(), new BN(ZONE).toArrayLike(Buffer, "le", 4)], tradingId);
    zoneShardPda = shardPdaFor(SHARD);

    send([await trading.methods.initializeMarket(16).accounts({ market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()]);
    send([await trading.methods.initializeZoneMarket(ZONE, 16, new BN(1_000_000)).accounts({ market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()]);
    send([await trading.methods.initializeZoneMarketShard(SHARD).accounts({ zoneMarket: zoneMarketPda, zoneShard: zoneShardPda, payer: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()]);

    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));
  });

  it("submits a sharded BUY limit order (control)", async () => {
    send([await shardedIx(1, BUY, 100, 50, SHARD)]);
    const o = order(1);
    expect(o.orderId.toNumber()).to.equal(1);
    expect(o.amount.toNumber()).to.equal(100);
    expect(o.pricePerKwh.toNumber()).to.equal(50);
    expect(new PublicKey(o.buyer).toBase58()).to.equal(payer.publicKey.toBase58());
    expect(zoneShard().lastUpdate.toNumber()).to.equal(NOW);
  });

  it("submits a sharded SELL limit order (control)", async () => {
    send([await shardedIx(2, SELL, 80, 60, SHARD)]);
    const o = order(2);
    expect(new PublicKey(o.seller).toBase58()).to.equal(payer.publicKey.toBase58());
    expect(o.amount.toNumber()).to.equal(80);
  });

  it("rejects submission against an uninitialized zone shard (AccountOwnedByWrongProgram)", async () => {
    // shard 7 was never initialized → the PDA is still a System-owned empty account, so the
    // mut zone_shard (AccountLoader) fails ownership validation before the body runs.
    const blob = sendExpectFail([await shardedIx(3, BUY, 100, 50, 7)]);
    expect(blob, blob).to.match(/AccountOwnedByWrongProgram|3007|AccountNotInitialized|3012/i);
  });
});
