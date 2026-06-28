// Step-1 coverage for Tier-A: init_zone_capacity creates the per-zone ZoneCapacity PDA
// (committed_flow counter split off ZoneMarket). Additive scaffolding — settle path not
// yet migrated (see docs/proposed/settlement-tps-tier-a.md).
import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { expect } from "chai";
import { PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const idl = require("../target/idl/trading.json");

describe("trading init_zone_capacity (litesvm, Tier-A step 1)", () => {
  let svm: LiteSVM; let trading: Program<Trading>; let id: PublicKey;
  const payer = Keypair.generate();
  let marketPda: PublicKey, zoneMarketPda: PublicKey, zoneCapacityPda: PublicKey;
  const ZONE = 0;
  function send(ixs: TransactionInstruction[]) {
    const tx = new Transaction(); tx.recentBlockhash = svm.latestBlockhash(); tx.feePayer = payer.publicKey;
    ixs.forEach(i => tx.add(i)); tx.sign(payer);
    const r = svm.sendTransaction(tx);
    if (r instanceof FailedTransactionMetadata) throw new Error(r.err().toString() + "\n" + r.meta().logs().join("\n"));
    svm.expireBlockhash();
  }
  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    trading = new Program(idl, { connection: {}, publicKey: PublicKey.default } as any);
    id = trading.programId; svm.addProgramFromFile(id, "target/deploy/trading.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));
    [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], id);
    [zoneMarketPda] = PublicKey.findProgramAddressSync([Buffer.from("zone_market"), marketPda.toBuffer(), new BN(ZONE).toArrayLike(Buffer, "le", 4)], id);
    [zoneCapacityPda] = PublicKey.findProgramAddressSync([Buffer.from("zone_capacity"), zoneMarketPda.toBuffer()], id);
    send([await trading.methods.initializeMarket(16).accounts({ market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()]);
    send([await trading.methods.initializeZoneMarket(ZONE, 16, new BN(1_000_000)).accounts({ market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()]);
  });
  it("creates the ZoneCapacity PDA bound to its zone_market, committed_flow 0", async () => {
    send([await trading.methods.initZoneCapacity().accounts({ zoneMarket: zoneMarketPda, zoneCapacity: zoneCapacityPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()]);
    const acct = svm.getAccount(zoneCapacityPda)!;
    const zc = trading.coder.accounts.decode("zoneCapacity", Buffer.from(acct.data));
    expect(new PublicKey(zc.zoneMarket).toBase58()).to.equal(zoneMarketPda.toBase58());
    expect(zc.committedFlow.toNumber()).to.equal(0);
  });
  it("rejects double-init of the same ZoneCapacity (already in use)", async () => {
    const tx = new Transaction(); tx.recentBlockhash = svm.latestBlockhash(); tx.feePayer = payer.publicKey;
    tx.add(await trading.methods.initZoneCapacity().accounts({ zoneMarket: zoneMarketPda, zoneCapacity: zoneCapacityPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction());
    tx.sign(payer);
    const r = svm.sendTransaction(tx);
    expect(r instanceof FailedTransactionMetadata, "expected double-init to fail").to.be.true;
  });
});
