// In-process compute-unit profile for the trading CDA order path — market/zone setup,
// escrow deposit/withdraw, create sell/buy order, on-chain match_orders, and cancel.
// Same method as §4-6 (litesvm `computeUnitsConsumed()`, default-feature .so, no localnet).
//
// Account wiring + the fabricated governance PoAConfig / ErcCertificate mirror
// tests/order_guards_litesvm.ts (PoAConfig + ERC are plain Borsh #[account]s, set directly
// via svm.setAccount so create_sell_order's REC gating passes without driving governance).
//
// NOTE: this is the *order book* path. The signature-verifying settlement path
// (settle_offchain_match) is measured on a live validator in §1 (103k CU) — its Ed25519
// precompile cost is not represented here.

import { LiteSVM, Clock, FailedTransactionMetadata, TransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { Governance } from "../target/types/governance";
import { expect } from "chai";
import { PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const tradingIdl = require("../target/idl/trading.json");
const governanceIdl = require("../target/idl/governance.json");

const ZONE = 0;
const NOW = 1_000_000;
const FUTURE = 9_000_000;
const BUDGET = 200_000;

describe("trading CDA order-path CU profile (litesvm)", () => {
  let svm: LiteSVM;
  let trading: Program<Trading>;
  let governance: Program<Governance>;
  let tradingId: PublicKey;
  let governanceId: PublicKey;

  const payer = Keypair.generate();
  const currencyMintKp = Keypair.generate();

  let currencyMint: PublicKey, marketPda: PublicKey, zoneMarketPda: PublicKey, marketAuthorityPda: PublicKey;
  let cfg: PublicKey, erc: PublicKey;

  const profile: Array<{ ix: string; cu: number }> = [];

  function sendRaw(ixs: TransactionInstruction[], signers: Keypair[] = []): FailedTransactionMetadata | TransactionMetadata {
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
    if (r instanceof FailedTransactionMetadata) throw new Error("tx failed: " + r.err().toString() + "\n" + r.meta().logs().join("\n"));
  }
  function cu(label: string, ix: TransactionInstruction, signers: Keypair[] = []): number {
    const r = sendRaw([ix], signers);
    if (r instanceof FailedTransactionMetadata) throw new Error(label + " failed: " + r.err().toString() + "\n" + r.meta().logs().join("\n"));
    const c = Number((r as TransactionMetadata).computeUnitsConsumed());
    profile.push({ ix: label, cu: c });
    return c;
  }

  const orderPda = (auth: PublicKey, orderId: number) =>
    PublicKey.findProgramAddressSync([Buffer.from("order"), auth.toBuffer(), new BN(orderId).toArrayLike(Buffer, "le", 8)], tradingId)[0];
  const escrowPda = () =>
    PublicKey.findProgramAddressSync([Buffer.from("escrow"), payer.publicKey.toBuffer(), currencyMint.toBuffer()], tradingId)[0];

  async function installConfig(maintenance: boolean): Promise<PublicKey> {
    const key = Keypair.generate().publicKey;
    const c = {
      authority: PublicKey.default, authorityName: Array(64).fill(0), nameLen: 0, contactInfo: Array(128).fill(0), contactLen: 0,
      version: 1, maintenanceMode: maintenance, ercValidationEnabled: true, minEnergyAmount: new BN(0), maxErcAmount: new BN(0),
      ercValidityPeriod: new BN(0), requireOracleValidation: false, oracleAuthority: PublicKey.default, minOracleConfidence: 0,
      allowCertificateTransfers: true, minQuorumVotes: new BN(0), totalErcsIssued: new BN(0), totalErcsValidated: new BN(0),
      totalErcsRevoked: new BN(0), totalEnergyCertified: new BN(0), createdAt: new BN(0), lastUpdated: new BN(0), lastErcIssuedAt: new BN(0),
      pendingAuthority: PublicKey.default, pendingAuthorityProposedAt: new BN(0), pendingAuthorityExpiresAt: new BN(0), reserved: Array(5).fill(0),
    };
    const data = await governance.coder.accounts.encode("poAConfig", c as any);
    svm.setAccount(key, { lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))), data, owner: governanceId, executable: false, rentEpoch: 0 } as any);
    return key;
  }

  async function installErc(energyAmount: number): Promise<PublicKey> {
    const key = Keypair.generate().publicKey;
    const e = {
      certificateId: Array(64).fill(0), idLen: 0, authority: payer.publicKey, owner: payer.publicKey, energyAmount: new BN(energyAmount),
      renewableSource: Array(64).fill(0), sourceLen: 0, validationData: Array(256).fill(0), dataLen: 0, issuedAt: new BN(0),
      expiresAt: new BN(FUTURE), status: { valid: {} }, validatedForTrading: true, tradingValidatedAt: null,
      revocationReason: Array(128).fill(0), reasonLen: 0, revokedAt: null, transferCount: 0, lastTransferredAt: null,
    };
    const data = await governance.coder.accounts.encode("ercCertificate", e as any);
    svm.setAccount(key, { lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))), data, owner: governanceId, executable: false, rentEpoch: 0 } as any);
    return key;
  }

  const sellIx = (id: number, amt: number, price: number) =>
    trading.methods.createSellOrder(new BN(id), new BN(amt), new BN(price))
      .accounts({ market: marketPda, zoneMarket: zoneMarketPda, order: orderPda(payer.publicKey, id), ercCertificate: erc, authority: payer.publicKey, systemProgram: SystemProgram.programId, governanceConfig: cfg } as any).instruction();
  const buyIx = (id: number, amt: number, maxPrice: number) =>
    trading.methods.createBuyOrder(new BN(id), new BN(amt), new BN(maxPrice))
      .accounts({ market: marketPda, zoneMarket: zoneMarketPda, order: orderPda(payer.publicKey, id), authority: payer.publicKey, systemProgram: SystemProgram.programId, governanceConfig: cfg } as any).instruction();

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    trading = new Program(tradingIdl, { connection: {}, publicKey: PublicKey.default } as any);
    governance = new Program(governanceIdl, { connection: {}, publicKey: PublicKey.default } as any);
    tradingId = trading.programId;
    governanceId = governance.programId;
    svm.addProgramFromFile(tradingId, "target/deploy/trading.so");
    svm.addProgramFromFile(governanceId, "target/deploy/governance.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));

    currencyMint = currencyMintKp.publicKey;
    [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingId);
    [zoneMarketPda] = PublicKey.findProgramAddressSync([Buffer.from("zone_market"), marketPda.toBuffer(), new BN(ZONE).toArrayLike(Buffer, "le", 4)], tradingId);
    [marketAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("market_authority")], tradingId);

    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));
    cfg = await installConfig(false);
    erc = await installErc(100_000);
  });

  after(() => {
    const w = Math.max(...profile.map((p) => p.ix.length));
    console.log("\n  CU profile (default features, no localnet):");
    for (const p of profile) console.log(`    ${p.ix.padEnd(w)}  ${p.cu.toString().padStart(7)} CU`);
  });

  it("trading.initialize_market", async () => {
    const ix = await trading.methods.initializeMarket(16).accounts({ market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction();
    expect(cu("trading.initialize_market", ix)).to.be.below(BUDGET);
  });

  it("trading.initialize_zone_market", async () => {
    const ix = await trading.methods.initializeZoneMarket(ZONE, 16, new BN(1_000_000)).accounts({ market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction();
    expect(cu("trading.initialize_zone_market", ix)).to.be.below(BUDGET);
  });

  it("trading.deposit_escrow", async () => {
    const mintRent = Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)));
    send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: currencyMint, lamports: mintRent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(currencyMint, 6, payer.publicKey, null, TOKEN_PROGRAM_ID),
    ], [currencyMintKp]);
    const payerAta = getAssociatedTokenAddressSync(currencyMint, payer.publicKey, false, TOKEN_PROGRAM_ID);
    send([
      createAssociatedTokenAccountInstruction(payer.publicKey, payerAta, payer.publicKey, currencyMint, TOKEN_PROGRAM_ID),
      createMintToInstruction(currencyMint, payerAta, payer.publicKey, 1_000_000, [], TOKEN_PROGRAM_ID),
    ]);
    const ix = await trading.methods.depositEscrow(new BN(600)).accounts({
      user: payer.publicKey, mint: currencyMint, userWallet: payerAta, userEscrow: escrowPda(),
      marketAuthority: marketAuthorityPda, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any).instruction();
    expect(cu("trading.deposit_escrow", ix)).to.be.below(BUDGET);
  });

  it("trading.create_sell_order", async () => {
    expect(cu("trading.create_sell_order", await sellIx(1, 100, 50))).to.be.below(BUDGET);
  });

  it("trading.create_buy_order", async () => {
    expect(cu("trading.create_buy_order", await buyIx(2, 100, 50))).to.be.below(BUDGET);
  });

  it("trading.match_orders (CDA)", async () => {
    const buy = orderPda(payer.publicKey, 2), sell = orderPda(payer.publicKey, 1);
    const tradeRecord = PublicKey.findProgramAddressSync([Buffer.from("trade"), buy.toBuffer(), sell.toBuffer()], tradingId)[0];
    const ix = await trading.methods.matchOrders(new BN(100)).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, buyOrder: buy, sellOrder: sell, tradeRecord,
      authority: payer.publicKey, governanceConfig: cfg, systemProgram: SystemProgram.programId,
    } as any).instruction();
    expect(cu("trading.match_orders", ix)).to.be.below(BUDGET);
  });

  it("trading.cancel_order", async () => {
    send([await sellIx(3, 100, 50)]); // fresh Active order
    const ix = await trading.methods.cancelOrder().accounts({
      market: marketPda, zoneMarket: zoneMarketPda, order: orderPda(payer.publicKey, 3), authority: payer.publicKey, governanceConfig: cfg,
    } as any).instruction();
    expect(cu("trading.cancel_order", ix)).to.be.below(BUDGET);
  });

  it("trading.withdraw_escrow", async () => {
    const payerAta = getAssociatedTokenAddressSync(currencyMint, payer.publicKey, false, TOKEN_PROGRAM_ID);
    const ix = await trading.methods.withdrawEscrow(new BN(100)).accounts({
      user: payer.publicKey, mint: currencyMint, userEscrow: escrowPda(), userWallet: payerAta, marketAuthority: marketAuthorityPda, tokenProgram: TOKEN_PROGRAM_ID,
    } as any).instruction();
    expect(cu("trading.withdraw_escrow", ix)).to.be.below(BUDGET);
  });
});
