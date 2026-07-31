// Litesvm coverage for the Order PDA's `expires_at`, driven against the deployed
// trading binary.
//
// Every order-creating instruction used to stamp `clock.unix_timestamp + 86400`,
// so the PDA asserted a 24h lifetime regardless of the expiry the submitting
// client had agreed to. Off-chain, the trading service resolves a real expiry per
// order (`trading_core::order_policy::resolve_expires_at`, 15-min default) and its
// reaper retires the book on it — the two records disagreed by construction, and
// nothing failed loudly when they did. The expiry is now an instruction argument
// (`utils::validate_order_expiry`).
//
// A green `cargo build` proves nothing about what a handler writes into an
// account, so each case below reads the expiry back off the PDA through the IDL:
//
//   1. create_buy_order stores the caller's expiry verbatim (NOT now + 86400)
//   2. record_order_custodial — the custodial path the trading service actually
//      uses — stores it too, and its PDA is seed-bound to `user`, not the funder
//   3. 0 is the no-expiry sentinel, stored as 0 (matches settle_offchain_match's
//      `expires_at == 0 ||` reading of a signed payload)
//   4. a past / present expiry is rejected with OrderExpired (6023) and creates
//      no account, rather than resting an order that can never settle
//
// Setup mirrors tests/price_models_litesvm.ts (fabricated GovernanceConfig,
// market/zone bootstrap, band byte-patch at data offsets 88/96).

import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { Governance } from "../target/types/governance";
import { expect } from "chai";
import { PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const tradingIdl = require("../target/idl/trading.json");
const governanceIdl = require("../target/idl/governance.json");

const ZONE = 0;
const NOW = 1_000_000;

// Wide band so the test price is admissible (2.00–5.00 THBC/kWh, 6-dec).
const P_MIN = 2_000_000;
const P_MAX = 5_000_000;
const PRICE = 3_000_000;
const AMOUNT = 100;

// The off-chain default: 15 min, one interval-clearing window. The point of the
// suite is that THIS lands on chain — not 86400.
const TTL_15_MIN = 900;
const OLD_HARDCODED_TTL = 86_400;

const ORDER_EXPIRED = 6023; // trading IDL error code

describe("order expiry (litesvm) — the caller's expiry reaches the Order PDA", () => {
  let svm: LiteSVM;
  let trading: Program<Trading>;
  let governance: Program<Governance>;
  let tradingId: PublicKey;
  let governanceId: PublicKey;

  const payer = Keypair.generate();
  let marketPda: PublicKey, zoneMarketPda: PublicKey;
  let cfg: PublicKey;

  function sendRaw(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    ixs.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...signers);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res;
  }
  function send(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const r = sendRaw(ixs, signers);
    if (r instanceof FailedTransactionMetadata)
      throw new Error("tx failed: " + r.err().toString() + "\n" + r.meta().logs().join("\n"));
    return r;
  }

  const orderPda = (authority: PublicKey, id: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("order"), authority.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      tradingId
    )[0];

  const decodeOrder = (pda: PublicKey) =>
    trading.coder.accounts.decode("order", Buffer.from(svm.getAccount(pda)!.data));

  const buyIx = (id: number, expiresAt: number) =>
    trading.methods
      .createBuyOrder(new BN(id), new BN(AMOUNT), new BN(PRICE), new BN(expiresAt))
      .accounts({
        market: marketPda, zoneMarket: zoneMarketPda, order: orderPda(payer.publicKey, id),
        authority: payer.publicKey, systemProgram: SystemProgram.programId, governanceConfig: cfg,
      } as any)
      .instruction();

  // The custodial leg: `user` is the non-signing order authority (and part of the
  // PDA seeds); the platform `funder` signs and pays rent.
  const custodialIx = (id: number, user: PublicKey, expiresAt: number) =>
    trading.methods
      .recordOrderCustodial(new BN(id), user, true, new BN(AMOUNT), new BN(PRICE), new BN(expiresAt))
      .accounts({
        market: marketPda, zoneMarket: zoneMarketPda, order: orderPda(user, id),
        funder: payer.publicKey, systemProgram: SystemProgram.programId, governanceConfig: cfg,
      } as any)
      .instruction();

  function patchBand(min: number, max: number) {
    const acc = svm.getAccount(marketPda)!;
    const data = Buffer.from(acc.data);
    data.writeBigUInt64LE(BigInt(min), 88);
    data.writeBigUInt64LE(BigInt(max), 96);
    svm.setAccount(marketPda, { ...acc, data } as any);
    // Guard the blind byte-poke: a Market layout shift would otherwise corrupt an
    // unrelated field while these tests kept passing.
    const m = trading.coder.accounts.decode("market", Buffer.from(svm.getAccount(marketPda)!.data));
    expect(m.minPricePerKwh.toNumber(), "patchBand offset drift (min_price_per_kwh)").to.eq(min);
    expect(m.maxPricePerKwh.toNumber(), "patchBand offset drift (max_price_per_kwh)").to.eq(max);
  }

  async function installConfig(): Promise<PublicKey> {
    const key = Keypair.generate().publicKey;
    const c = {
      authority: PublicKey.default, authorityName: Array(64).fill(0), nameLen: 0,
      contactInfo: Array(128).fill(0), contactLen: 0, version: 1, maintenanceMode: false,
      ercValidationEnabled: true, minEnergyAmount: new BN(0), maxErcAmount: new BN(0),
      ercValidityPeriod: new BN(0), requireOracleValidation: false, oracleAuthority: PublicKey.default,
      minOracleConfidence: 0, allowCertificateTransfers: true, minQuorumVotes: new BN(0),
      totalErcsIssued: new BN(0), totalErcsValidated: new BN(0), totalErcsRevoked: new BN(0),
      totalEnergyCertified: new BN(0), createdAt: new BN(0), lastUpdated: new BN(0),
      lastErcIssuedAt: new BN(0), pendingAuthority: PublicKey.default,
      pendingAuthorityProposedAt: new BN(0), pendingAuthorityExpiresAt: new BN(0),
      reserved: Array(5).fill(0),
    };
    const data = await governance.coder.accounts.encode("governanceConfig", c as any);
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data, owner: governanceId, executable: false, rentEpoch: 0,
    } as any);
    return key;
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
      [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(ZONE).toArrayLike(Buffer, "le", 4)],
      tradingId
    );

    // Pin the chain clock so "now + 900" and "now + 86400" are exact, not racy.
    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));
    cfg = await installConfig();

    send([await trading.methods.initializeMarket(16).accounts({
      market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId,
    } as any).instruction()]);
    send([await trading.methods.initializeZoneMarket(ZONE, 16, new BN(1_000_000_000), 0).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey,
      systemProgram: SystemProgram.programId,
    } as any).instruction()]);
    patchBand(P_MIN, P_MAX);
  });

  it("create_buy_order stores the caller's expiry, not now + 86400", async () => {
    const expiresAt = NOW + TTL_15_MIN;
    send([await buyIx(1, expiresAt)]);

    const o = decodeOrder(orderPda(payer.publicKey, 1));
    expect(o.createdAt.toNumber(), "created_at is the chain clock").to.eq(NOW);
    expect(o.expiresAt.toNumber(), "expires_at is the caller's value").to.eq(expiresAt);
    // The regression this suite exists for: the old handler ignored the argument.
    expect(o.expiresAt.toNumber(), "must not be the old hardcoded 24h TTL").to.not.eq(
      NOW + OLD_HARDCODED_TTL
    );
  });

  it("record_order_custodial stores it too, on a PDA seed-bound to the user", async () => {
    const user = Keypair.generate().publicKey; // never signs
    const expiresAt = NOW + TTL_15_MIN;
    send([await custodialIx(2, user, expiresAt)]);

    const pda = orderPda(user, 2);
    const o = decodeOrder(pda);
    expect(o.expiresAt.toNumber(), "custodial expiry").to.eq(expiresAt);
    expect(o.buyer.toBase58(), "user is the order authority").to.eq(user.toBase58());
    // Seed-bound to the user, not the funder — the funder's derivation is a
    // different account entirely, so a mixed-up seed cannot silently pass.
    expect(pda.toBase58()).to.not.eq(orderPda(payer.publicKey, 2).toBase58());
    expect(svm.getAccount(orderPda(payer.publicKey, 2)), "no PDA under the funder").to.be.null;
  });

  it("0 is the no-expiry sentinel, stored verbatim", async () => {
    send([await buyIx(3, 0)]);
    const o = decodeOrder(orderPda(payer.publicKey, 3));
    // Not now, not now+86400: settle_offchain_match reads 0 as "no expiry", and
    // the order record has to say the same thing.
    expect(o.expiresAt.toNumber(), "0 means no expiry").to.eq(0);
  });

  it("an expiry at or before now is rejected (OrderExpired) and creates no order", async () => {
    for (const [label, expiresAt] of [
      ["exactly now (settlement needs now < expires_at)", NOW],
      ["one second in the past", NOW - 1],
      ["long past", 1],
    ] as [string, number][]) {
      const id = 100 + expiresAt;
      const res = sendRaw([await buyIx(id, expiresAt)]);
      expect(res, `${label}: must fail`).to.be.instanceOf(FailedTransactionMetadata);
      const err = (res as FailedTransactionMetadata).err().toString();
      const logs = (res as FailedTransactionMetadata).meta().logs().join("\n");
      expect(
        err.includes(String(ORDER_EXPIRED)) || logs.includes("OrderExpired"),
        `${label}: expected OrderExpired (${ORDER_EXPIRED}), got ${err}\n${logs}`
      ).to.be.true;
      // Rejected at admission — no rent-paying account left behind.
      expect(svm.getAccount(orderPda(payer.publicKey, id)), `${label}: no order account`).to.be.null;
    }
  });

  it("a far-future expiry is accepted: the cap is the off-chain edge's job", async () => {
    // ORDER_MAX_TTL_SECS bounds client lifetimes off-chain; a second, different
    // horizon here would reject orders the platform itself considers valid.
    const expiresAt = NOW + 30 * 24 * 60 * 60;
    send([await buyIx(4, expiresAt)]);
    expect(decodeOrder(orderPda(payer.publicKey, 4)).expiresAt.toNumber()).to.eq(expiresAt);
  });
});
