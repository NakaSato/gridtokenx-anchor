// ERC ownership gate on create_sell_order (litesvm, no validator). Pins the
// 2026-07 hardening: when an order supplies an ErcCertificate, the cert must be
// owned by the order's authority — a validated cert alone is not enough, else any
// user's validated cert would satisfy the green-attribute gate for any seller.
// (create_sell_order.rs:74-82, `require_keys_eq!(erc.owner, authority) -> ErcOwnerMismatch`)
//
// Setup mirrors tests/sharded_match_litesvm.ts: real initializeMarket/ZoneMarket
// bootstrap, fabricated GovernanceConfig (maintenance off) + ErcCertificate
// (validated, far-future expiry), price band byte-patched at data offsets 88/96.

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
const FUTURE = 9_000_000;
const P_MIN = 2_000_000;
const P_MAX = 5_000_000;
const PRICE = 3_000_000;
const ERC_OWNER_MISMATCH = 6050;

describe("create_sell_order — ERC ownership gate", () => {
  let svm: LiteSVM;
  let trading: Program<Trading>;
  let governance: Program<Governance>;
  let tradingId: PublicKey;
  let governanceId: PublicKey;

  const payer = Keypair.generate();      // the seller / order authority
  const stranger = Keypair.generate();   // owns the cert but is not the seller
  let marketPda: PublicKey, zoneMarketPda: PublicKey;
  let cfg: PublicKey;

  function sendRaw(ix: TransactionInstruction) {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    tx.add(ix);
    tx.sign(payer);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res;
  }
  function send(ix: TransactionInstruction) {
    const r = sendRaw(ix);
    if (r instanceof FailedTransactionMetadata)
      throw new Error("tx failed: " + r.err().toString() + "\n" + r.meta().logs().join("\n"));
    return r;
  }
  function expectCustomError(res: any, code: number) {
    expect(res instanceof FailedTransactionMetadata, "expected tx failure").to.eq(true);
    const logs = res.meta().logs().join("\n");
    expect(logs, logs).to.contain(`custom program error: 0x${code.toString(16)}`);
  }

  const orderPda = (id: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("order"), payer.publicKey.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      tradingId)[0];

  const sellIx = (id: number, amt: number, erc: PublicKey) =>
    trading.methods.createSellOrder(new BN(id), new BN(amt), new BN(PRICE)).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, order: orderPda(id), ercCertificate: erc,
      authority: payer.publicKey, systemProgram: SystemProgram.programId, governanceConfig: cfg,
    } as any).instruction();

  function patchBand(min: number, max: number) {
    const acc = svm.getAccount(marketPda)!;
    const data = Buffer.from(acc.data);
    data.writeBigUInt64LE(BigInt(min), 88);
    data.writeBigUInt64LE(BigInt(max), 96);
    svm.setAccount(marketPda, { ...acc, data } as any);
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
      pendingAuthorityProposedAt: new BN(0), pendingAuthorityExpiresAt: new BN(0), reserved: Array(5).fill(0),
    };
    const data = await governance.coder.accounts.encode("governanceConfig", c as any);
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data, owner: governanceId, executable: false, rentEpoch: 0,
    } as any);
    return key;
  }

  // A fully valid, trading-validated cert (status Valid, far-future expiry, amount
  // large enough) whose ONLY variable is `owner`.
  async function installErc(owner: PublicKey): Promise<PublicKey> {
    const key = Keypair.generate().publicKey;
    const e = {
      certificateId: Array(64).fill(0), idLen: 0, authority: payer.publicKey, owner,
      energyAmount: new BN(1_000_000), renewableSource: Array(64).fill(0), sourceLen: 0,
      validationData: Array(256).fill(0), dataLen: 0, issuedAt: new BN(0), expiresAt: new BN(FUTURE),
      status: { valid: {} }, validatedForTrading: true, tradingValidatedAt: null,
      revocationReason: Array(128).fill(0), reasonLen: 0, revokedAt: null, transferCount: 0, lastTransferredAt: null,
    };
    const data = await governance.coder.accounts.encode("ercCertificate", e as any);
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
      [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(ZONE).toArrayLike(Buffer, "le", 4)], tradingId);

    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));
    cfg = await installConfig();

    send(await trading.methods.initializeMarket(16).accounts({
      market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId,
    } as any).instruction());
    send(await trading.methods.initializeZoneMarket(ZONE, 16, new BN(1_000_000_000), 0).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId,
    } as any).instruction());
    patchBand(P_MIN, P_MAX);
  });

  it("1. cert owned by the seller → order created (positive control)", async () => {
    const erc = await installErc(payer.publicKey);
    const res = sendRaw(await sellIx(1, 100, erc));
    expect(res instanceof FailedTransactionMetadata, "expected success").to.eq(false);
  });

  it("2. validated cert owned by SOMEONE ELSE → ErcOwnerMismatch", async () => {
    const erc = await installErc(stranger.publicKey);
    expectCustomError(sendRaw(await sellIx(2, 100, erc)), ERC_OWNER_MISMATCH);
  });
});
