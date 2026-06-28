// Litesvm coverage for the trading CDA order-entry + market-admin instructions that
// had zero test coverage: submit_limit_order, submit_market_order, update_depth,
// update_market_params, set_settlement_thbg_mint.
//
// These are the alternate (CDA / off-chain-matcher) order path, distinct from the
// create_sell_order/create_buy_order legacy path covered in order_guards_litesvm.ts.
// submit_limit_order opens an Order PDA + bumps market.active_orders; submit_market_order
// only checks opposite-side depth and emits (matching is off-chain). update_depth seeds the
// zone_market depth arrays that submit_market_order's liquidity guard reads.
//
// GovernanceConfig is fabricated directly (svm.setAccount + governance coder) so each test
// pins maintenance_mode — same trick as order_guards_litesvm.ts.

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
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
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const tradingIdl = require("../target/idl/trading.json");
const governanceIdl = require("../target/idl/governance.json");

const ZONE = 0;
const BUY = 0, SELL = 1;

describe("trading CDA order-entry + market-admin (litesvm)", () => {
  let svm: LiteSVM;
  let trading: Program<Trading>;
  let governance: Program<Governance>;
  let tradingId: PublicKey;
  let governanceId: PublicKey;

  const payer = Keypair.generate();    // market authority + funder
  const attacker = Keypair.generate(); // non-authority
  const thbgMint = Keypair.generate().publicKey;

  let marketPda: PublicKey;
  let zoneMarketPda: PublicKey;

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

  const orderPda = (auth: PublicKey, orderId: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("order"), auth.toBuffer(), new BN(orderId).toArrayLike(Buffer, "le", 8)], tradingId)[0];

  function market() {
    const a = svm.getAccount(marketPda)!;
    return trading.coder.accounts.decode("market", Buffer.from(a.data));
  }
  function zoneMarket() {
    const a = svm.getAccount(zoneMarketPda)!;
    return trading.coder.accounts.decode("zoneMarket", Buffer.from(a.data));
  }

  async function installConfig(maintenance: boolean): Promise<PublicKey> {
    const key = Keypair.generate().publicKey;
    const cfg = {
      authority: PublicKey.default, authorityName: Array(64).fill(0), nameLen: 0,
      contactInfo: Array(128).fill(0), contactLen: 0, version: 1, maintenanceMode: maintenance,
      ercValidationEnabled: true, minEnergyAmount: new BN(0), maxErcAmount: new BN(0),
      ercValidityPeriod: new BN(0), requireOracleValidation: false, oracleAuthority: PublicKey.default,
      minOracleConfidence: 0, allowCertificateTransfers: true, minQuorumVotes: new BN(0),
      totalErcsIssued: new BN(0), totalErcsValidated: new BN(0), totalErcsRevoked: new BN(0),
      totalEnergyCertified: new BN(0), createdAt: new BN(0), lastUpdated: new BN(0), lastErcIssuedAt: new BN(0),
      pendingAuthority: PublicKey.default, pendingAuthorityProposedAt: new BN(0), pendingAuthorityExpiresAt: new BN(0),
      reserved: Array(5).fill(0),
    };
    const data = await governance.coder.accounts.encode("governanceConfig", cfg as any);
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data, owner: governanceId, executable: false, rentEpoch: 0,
    } as any);
    return key;
  }

  const limitIx = (auth: PublicKey, orderId: number, side: number, amount: number, price: number, cfg: PublicKey) =>
    trading.methods.submitLimitOrder(new BN(orderId), side, new BN(amount), new BN(price)).accounts({
      market: marketPda, order: orderPda(auth, orderId), authority: auth,
      systemProgram: SystemProgram.programId, governanceConfig: cfg,
    } as any).instruction();

  const marketOrderIx = (side: number, amount: number, cfg: PublicKey) =>
    trading.methods.submitMarketOrder(side, new BN(amount)).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey, governanceConfig: cfg,
    } as any).instruction();

  const depthIx = (buyP: number[], buyA: number[], sellP: number[], sellA: number[], cfg: PublicKey) =>
    trading.methods.updateDepth(buyP.map(x => new BN(x)), buyA.map(x => new BN(x)), sellP.map(x => new BN(x)), sellA.map(x => new BN(x))).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey, governanceConfig: cfg,
    } as any).instruction();

  const paramsIx = (auth: PublicKey, fee: number, clearing: boolean, minP: number, maxP: number, cfg: PublicKey) =>
    trading.methods.updateMarketParams(fee, clearing, new BN(minP), new BN(maxP)).accounts({
      market: marketPda, authority: auth, governanceConfig: cfg,
    } as any).instruction();

  const thbgIx = (auth: PublicKey, mint: PublicKey) =>
    trading.methods.setSettlementThbgMint(mint).accounts({ market: marketPda, authority: auth } as any).instruction();

  const priceHistIx = (auth: PublicKey, price: number, volume: number, cfg: PublicKey) =>
    trading.methods.updatePriceHistory(new BN(price), new BN(volume)).accounts({
      market: marketPda, authority: auth, governanceConfig: cfg,
    } as any).instruction();

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    trading = new Program(tradingIdl, { connection: {}, publicKey: PublicKey.default } as any);
    governance = new Program(governanceIdl, { connection: {}, publicKey: PublicKey.default } as any);
    tradingId = trading.programId; governanceId = governance.programId;
    svm.addProgramFromFile(tradingId, "target/deploy/trading.so");
    svm.addProgramFromFile(governanceId, "target/deploy/governance.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));
    svm.airdrop(attacker.publicKey, BigInt(1_000_000_000));

    [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingId);
    [zoneMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(ZONE).toArrayLike(Buffer, "le", 4)], tradingId);

    send([await trading.methods.initializeMarket(16).accounts({ market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()]);
    send([await trading.methods.initializeZoneMarket(ZONE, 16, new BN(1_000_000)).accounts({ market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()]);
  });

  // --- submit_limit_order ---

  it("opens a limit order and bumps market.active_orders (control)", async () => {
    const cfg = await installConfig(false);
    const before = market().activeOrders;
    send([await limitIx(payer.publicKey, 1, BUY, 100, 50, cfg)]);
    expect(svm.getAccount(orderPda(payer.publicKey, 1))).to.not.be.null;
    expect(market().activeOrders).to.equal(before + 1);
  });

  it("rejects a limit order in maintenance mode (MaintenanceMode)", async () => {
    const cfg = await installConfig(true);
    const blob = sendExpectFail([await limitIx(payer.publicKey, 2, BUY, 100, 50, cfg)]);
    expect(blob, blob).to.match(/MaintenanceMode/);
  });

  it("rejects a zero-amount limit order (InvalidAmount)", async () => {
    const cfg = await installConfig(false);
    const blob = sendExpectFail([await limitIx(payer.publicKey, 3, BUY, 0, 50, cfg)]);
    expect(blob, blob).to.match(/InvalidAmount/);
  });

  it("rejects a zero-price limit order (InvalidPrice)", async () => {
    const cfg = await installConfig(false);
    const blob = sendExpectFail([await limitIx(payer.publicKey, 4, BUY, 100, 0, cfg)]);
    expect(blob, blob).to.match(/InvalidPrice/);
  });

  // --- submit_market_order ---

  it("rejects a zero-amount market order (InvalidAmount)", async () => {
    const cfg = await installConfig(false);
    const blob = sendExpectFail([await marketOrderIx(BUY, 0, cfg)]);
    expect(blob, blob).to.match(/InvalidAmount/);
  });

  it("rejects a market buy with no sell-side liquidity (InsufficientLiquidity)", async () => {
    const cfg = await installConfig(false);
    const blob = sendExpectFail([await marketOrderIx(BUY, 100, cfg)]); // sell_side_depth_count == 0
    expect(blob, blob).to.match(/InsufficientLiquidity/);
  });

  // --- update_depth ---

  it("rejects mismatched price/amount vector lengths (InvalidAmount)", async () => {
    const cfg = await installConfig(false);
    const blob = sendExpectFail([await depthIx([], [], [50], [], cfg)]); // sell_prices 1, sell_amounts 0
    expect(blob, blob).to.match(/InvalidAmount/);
  });

  it("seeds sell-side depth (control)", async () => {
    const cfg = await installConfig(false);
    send([await depthIx([], [], [50, 60], [100, 80], cfg)]);
    expect(zoneMarket().sellSideDepthCount).to.equal(2);
  });

  it("accepts a market buy once sell-side depth exists (control)", async () => {
    const cfg = await installConfig(false);
    send([await marketOrderIx(BUY, 100, cfg)]); // now sell_side_depth_count > 0
  });

  it("rejects a market order in maintenance mode (MaintenanceMode)", async () => {
    const cfg = await installConfig(true);
    const blob = sendExpectFail([await marketOrderIx(BUY, 100, cfg)]);
    expect(blob, blob).to.match(/MaintenanceMode/);
  });

  // --- update_market_params ---

  it("rejects update_market_params from a non-authority (has_one)", async () => {
    const cfg = await installConfig(false);
    const blob = sendExpectFail([await paramsIx(attacker.publicKey, 50, true, 10, 100, cfg)], [attacker]);
    expect(blob, blob).to.match(/has_one|2001|UnauthorizedAuthority|ConstraintHasOne/);
  });

  it("updates fee + min/max price bounds (control)", async () => {
    const cfg = await installConfig(false);
    send([await paramsIx(payer.publicKey, 50, true, 10, 100, cfg)]);
    const m = market();
    expect(m.marketFeeBps).to.equal(50);
    expect(m.minPricePerKwh.toNumber()).to.equal(10);
    expect(m.maxPricePerKwh.toNumber()).to.equal(100);
  });

  it("rejects a limit order priced below the new minimum (PriceBelowMinimum)", async () => {
    const cfg = await installConfig(false);
    const blob = sendExpectFail([await limitIx(payer.publicKey, 5, BUY, 100, 5, cfg)]); // 5 < min 10
    expect(blob, blob).to.match(/PriceBelowMinimum/);
  });

  it("rejects a limit order priced above the new maximum (PriceAboveMaximum)", async () => {
    const cfg = await installConfig(false);
    const blob = sendExpectFail([await limitIx(payer.publicKey, 6, BUY, 100, 200, cfg)]); // 200 > max 100
    expect(blob, blob).to.match(/PriceAboveMaximum/);
  });

  it("rejects update_market_params in maintenance mode (MaintenanceMode)", async () => {
    const cfg = await installConfig(true);
    const blob = sendExpectFail([await paramsIx(payer.publicKey, 50, true, 10, 100, cfg)]);
    expect(blob, blob).to.match(/MaintenanceMode/);
  });

  // --- set_settlement_thbg_mint ---

  it("rejects setting the THBG mint to the default pubkey (TreasuryCurrencyMismatch)", async () => {
    const blob = sendExpectFail([await thbgIx(payer.publicKey, PublicKey.default)]);
    expect(blob, blob).to.match(/TreasuryCurrencyMismatch/);
  });

  it("sets the settlement THBG mint (control)", async () => {
    send([await thbgIx(payer.publicKey, thbgMint)]);
    const m = market();
    expect(m.hasSettlementThbgMint).to.equal(1);
    expect(new PublicKey(m.settlementThbgMint).toBase58()).to.equal(thbgMint.toBase58());
  });

  // --- update_price_history ---

  it("rejects update_price_history from a non-authority (has_one)", async () => {
    const cfg = await installConfig(false);
    const blob = sendExpectFail([await priceHistIx(attacker.publicKey, 50, 100, cfg)], [attacker]);
    expect(blob, blob).to.match(/has_one|2001|UnauthorizedAuthority|ConstraintHasOne/);
  });

  it("rejects update_price_history in maintenance mode (MaintenanceMode)", async () => {
    const cfg = await installConfig(true);
    const blob = sendExpectFail([await priceHistIx(payer.publicKey, 50, 100, cfg)]);
    expect(blob, blob).to.match(/MaintenanceMode/);
  });

  it("appends a price point and updates VWAP + last_clearing_price (control)", async () => {
    const cfg = await installConfig(false);
    send([await priceHistIx(payer.publicKey, 50, 100, cfg)]);
    let m = market();
    expect(m.priceHistoryCount).to.equal(1);
    expect(m.lastClearingPrice.toNumber()).to.equal(50);
    expect(m.volumeWeightedPrice.toNumber()).to.equal(50); // (50*100)/100
    // second trade: VWAP = (50*100 + 70*100) / 200 = 60.
    send([await priceHistIx(payer.publicKey, 70, 100, cfg)]);
    m = market();
    expect(m.priceHistoryCount).to.equal(2);
    expect(m.lastClearingPrice.toNumber()).to.equal(70);
    expect(m.volumeWeightedPrice.toNumber()).to.equal(60);
  });
});
