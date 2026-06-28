// Litesvm coverage for the call-auction instruction WRAPPERS: clear_auction and
// execute_auction_matches. The clearing ALGORITHM (find_clearing_point, curve sorting,
// price improvement) is already covered by Rust unit tests in programs/trading/src/lib.rs
// (`mod tests`). What was wholly untested is the on-chain instruction shell:
//   - the MaintenanceMode kill-switch gate (governance_config.is_operational())
//   - the empty-vector guards (sell_orders / buy_orders / matches non-empty)
//   - the no-intersection path (find_clearing_point → InvalidPrice)
//   - that Market / ZoneMarket aggregate counters are bumped on a successful clear.
//
// Trick (same as order_guards_litesvm.ts): GovernanceConfig is a plain Borsh #[account], so
// we FABRICATE it directly with svm.setAccount + the governance Anchor coder instead of
// driving the governance program — letting each test pin maintenance_mode exactly.
//
// clear_auction is a 6-account, no-Ed25519, no-shard tx → plain send, no ALT.

import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { Governance } from "../target/types/governance";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const tradingIdl = require("../target/idl/trading.json");
const governanceIdl = require("../target/idl/governance.json");

const ZONE = 0;
const NOW = 1_000_000;

describe("trading call-auction instruction wrappers (litesvm)", () => {
  let svm: LiteSVM;
  let trading: Program<Trading>;
  let governance: Program<Governance>;
  let tradingId: PublicKey;
  let governanceId: PublicKey;

  const payer = Keypair.generate();

  let marketPda: PublicKey;
  let zoneMarketPda: PublicKey;

  function send(ixs: TransactionInstruction[], signers: Keypair[]) {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    ixs.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...signers);
    const res = svm.sendTransaction(tx);
    if (res instanceof FailedTransactionMetadata) {
      throw new Error("tx failed: " + res.err().toString() + "\n" + res.meta().logs().join("\n"));
    }
    svm.expireBlockhash();
    return res;
  }

  function sendExpectFail(ixs: TransactionInstruction[], signers: Keypair[]): string {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    ixs.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...signers);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    if (!(res instanceof FailedTransactionMetadata)) throw new Error("expected tx to fail but it succeeded");
    return res.err().toString() + "\n" + res.meta().logs().join("\n");
  }

  // Fabricate a governance GovernanceConfig with the given maintenance flag.
  async function installConfig(maintenance: boolean): Promise<PublicKey> {
    const key = Keypair.generate().publicKey;
    const cfg = {
      authority: PublicKey.default,
      authorityName: Array(64).fill(0),
      nameLen: 0,
      contactInfo: Array(128).fill(0),
      contactLen: 0,
      version: 1,
      maintenanceMode: maintenance,
      ercValidationEnabled: true,
      minEnergyAmount: new BN(0),
      maxErcAmount: new BN(0),
      ercValidityPeriod: new BN(0),
      requireOracleValidation: false,
      oracleAuthority: PublicKey.default,
      minOracleConfidence: 0,
      allowCertificateTransfers: true,
      minQuorumVotes: new BN(0),
      totalErcsIssued: new BN(0),
      totalErcsValidated: new BN(0),
      totalErcsRevoked: new BN(0),
      totalEnergyCertified: new BN(0),
      createdAt: new BN(0),
      lastUpdated: new BN(0),
      lastErcIssuedAt: new BN(0),
      pendingAuthority: PublicKey.default,
      pendingAuthorityProposedAt: new BN(0),
      pendingAuthorityExpiresAt: new BN(0),
      reserved: Array(5).fill(0),
    };
    const data = await governance.coder.accounts.encode("governanceConfig", cfg as any);
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data,
      owner: governanceId,
      executable: false,
      rentEpoch: 0,
    } as any);
    return key;
  }

  // AuctionOrder literal for the instruction arg vectors.
  const auctionOrder = (price: number, amount: number, isBuy: boolean) => ({
    orderKey: Keypair.generate().publicKey,
    pricePerKwh: new BN(price),
    amount: new BN(amount),
    filledAmount: new BN(0),
    user: payer.publicKey,
    isBuy,
  });

  async function clearAuctionIx(sells: any[], buys: any[], cfgKey: PublicKey) {
    return trading.methods
      .clearAuction(sells, buys)
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        authority: payer.publicKey,
        feeCollector: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        governanceConfig: cfgKey,
      } as any)
      .instruction();
  }

  async function executeMatchesIx(matches: any[], clearingPrice: number, cfgKey: PublicKey) {
    return trading.methods
      .executeAuctionMatches(matches, new BN(clearingPrice))
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        authority: payer.publicKey,
        feeCollector: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        governanceConfig: cfgKey,
      } as any)
      .instruction();
  }

  function market() {
    const acct = svm.getAccount(marketPda);
    return trading.coder.accounts.decode("market", Buffer.from(acct!.data));
  }
  function zoneMarket() {
    const acct = svm.getAccount(zoneMarketPda);
    return trading.coder.accounts.decode("zoneMarket", Buffer.from(acct!.data));
  }

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    trading = new Program(tradingIdl, { connection: {}, publicKey: PublicKey.default } as any);
    governance = new Program(governanceIdl, { connection: {}, publicKey: PublicKey.default } as any);
    tradingId = trading.programId;
    governanceId = governance.programId;
    svm.addProgramFromFile(tradingId, "target/deploy/trading.so");
    svm.addProgramFromFile(governanceId, "target/deploy/governance.so");

    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));

    [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingId);
    [zoneMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(ZONE).toArrayLike(Buffer, "le", 4)], tradingId);

    send([await trading.methods.initializeMarket(16).accounts({ market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()], []);
    send([await trading.methods.initializeZoneMarket(ZONE, 16, new BN(1_000_000)).accounts({ market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()], []);

    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));
  });

  it("clears a crossing auction and bumps Market + ZoneMarket counters (control)", async () => {
    const cfg = await installConfig(false);
    const before = market();
    const beforeZone = zoneMarket();
    // sell 100 @ 40, buy 100 @ 50 → crosses; clearing price = 40 (lowest sell that clears).
    const sells = [auctionOrder(40, 100, false)];
    const buys = [auctionOrder(50, 100, true)];
    send([await clearAuctionIx(sells, buys, cfg)], []);

    const after = market();
    const afterZone = zoneMarket();
    expect(after.totalVolume.toNumber()).to.equal(before.totalVolume.toNumber() + 100);
    expect(after.totalTrades).to.equal(before.totalTrades + 1);
    expect(after.lastClearingPrice.toNumber()).to.equal(40);
    expect(afterZone.totalVolume.toNumber()).to.equal(beforeZone.totalVolume.toNumber() + 100);
    expect(afterZone.totalTrades).to.equal(beforeZone.totalTrades + 1);
    expect(afterZone.lastClearingPrice.toNumber()).to.equal(40);
  });

  it("rejects clearing while in maintenance mode (MaintenanceMode)", async () => {
    const cfg = await installConfig(true);
    const blob = sendExpectFail([await clearAuctionIx([auctionOrder(40, 100, false)], [auctionOrder(50, 100, true)], cfg)], []);
    expect(blob, blob).to.match(/MaintenanceMode/);
  });

  it("rejects an empty sell-order vector (InvalidAmount)", async () => {
    const cfg = await installConfig(false);
    const blob = sendExpectFail([await clearAuctionIx([], [auctionOrder(50, 100, true)], cfg)], []);
    expect(blob, blob).to.match(/InvalidAmount/);
  });

  it("rejects an empty buy-order vector (InvalidAmount)", async () => {
    const cfg = await installConfig(false);
    const blob = sendExpectFail([await clearAuctionIx([auctionOrder(40, 100, false)], [], cfg)], []);
    expect(blob, blob).to.match(/InvalidAmount/);
  });

  it("rejects a non-crossing book where no price clears (InvalidPrice)", async () => {
    const cfg = await installConfig(false);
    // every sell priced above every buy → find_clearing_point finds no point → best_price 0.
    const blob = sendExpectFail([await clearAuctionIx([auctionOrder(90, 100, false)], [auctionOrder(10, 100, true)], cfg)], []);
    expect(blob, blob).to.match(/InvalidPrice/);
  });

  it("execute_auction_matches bumps Market counters by the batch (control)", async () => {
    const cfg = await installConfig(false);
    const before = market();
    const matches = [
      { buyOrder: Keypair.generate().publicKey, sellOrder: Keypair.generate().publicKey, amount: new BN(30), price: new BN(40) },
      { buyOrder: Keypair.generate().publicKey, sellOrder: Keypair.generate().publicKey, amount: new BN(20), price: new BN(40) },
    ];
    send([await executeMatchesIx(matches, 40, cfg)], []);
    const after = market();
    expect(after.totalVolume.toNumber()).to.equal(before.totalVolume.toNumber() + 50);
    expect(after.totalTrades).to.equal(before.totalTrades + 2);
  });

  it("execute_auction_matches rejects an empty match vector (InvalidAmount)", async () => {
    const cfg = await installConfig(false);
    const blob = sendExpectFail([await executeMatchesIx([], 40, cfg)], []);
    expect(blob, blob).to.match(/InvalidAmount/);
  });

  it("execute_auction_matches honors the maintenance kill-switch (MaintenanceMode)", async () => {
    const cfg = await installConfig(true);
    const matches = [{ buyOrder: Keypair.generate().publicKey, sellOrder: Keypair.generate().publicKey, amount: new BN(10), price: new BN(40) }];
    const blob = sendExpectFail([await executeMatchesIx(matches, 40, cfg)], []);
    expect(blob, blob).to.match(/MaintenanceMode/);
  });
});
