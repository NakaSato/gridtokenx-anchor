// Litesvm negative-coverage for trading order-path validation guards, all previously
// untested: the REC/ERC gating on create_sell_order, the maintenance-mode kill switch,
// and the escrow-balance guard on withdraw_escrow.
//
// Trick: GovernanceConfig (governance_config) and ErcCertificate are plain Borsh #[account]s, so
// instead of driving the governance program's issue/config instructions we FABRICATE those
// accounts directly with svm.setAccount + the governance Anchor coder — letting each test
// pin the exact field values (maintenance_mode, ERC status/expiry/validated/amount) a guard
// keys on. governance_config is an UncheckedAccount (manual deserialize, owner unchecked);
// erc_certificate is Account<ErcCertificate> so it must carry the governance owner + disc.
//
// create_sell_order is a 7-account legacy tx (no Ed25519, no shards) → plain send, no ALT.

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
const NOW = 1_000_000; // fixed bank clock so ERC expiry is deterministic
const PAST = 500_000;
const FUTURE = 9_000_000;

describe("trading order-path validation guards (litesvm)", () => {
  let svm: LiteSVM;
  let trading: Program<Trading>;
  let governance: Program<Governance>;
  let tradingId: PublicKey;
  let governanceId: PublicKey;

  const payer = Keypair.generate();
  const currencyMintKp = Keypair.generate();

  let currencyMint: PublicKey;
  let marketPda: PublicKey;
  let zoneMarketPda: PublicKey;
  let marketAuthorityPda: PublicKey;

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

  const orderPda = (auth: PublicKey, orderId: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("order"), auth.toBuffer(), new BN(orderId).toArrayLike(Buffer, "le", 8)],
      tradingId
    )[0];

  // Fabricate a governance GovernanceConfig account with the given maintenance flag (all other
  // fields zero/default — only maintenance_mode gates create_sell_order's MaintenanceMode).
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

  // Fabricate an ErcCertificate with the exact fields a guard keys on.
  async function installErc(o: {
    status: string; // "valid" | "expired" | "revoked" | "pending"
    expiresAt: number | null;
    validated: boolean;
    energyAmount: number;
  }): Promise<PublicKey> {
    const key = Keypair.generate().publicKey;
    const erc = {
      certificateId: Array(64).fill(0),
      idLen: 0,
      authority: payer.publicKey,
      owner: payer.publicKey,
      energyAmount: new BN(o.energyAmount),
      renewableSource: Array(64).fill(0),
      sourceLen: 0,
      validationData: Array(256).fill(0),
      dataLen: 0,
      issuedAt: new BN(0),
      expiresAt: o.expiresAt === null ? null : new BN(o.expiresAt),
      status: { [o.status]: {} },
      validatedForTrading: o.validated,
      tradingValidatedAt: null,
      revocationReason: Array(128).fill(0),
      reasonLen: 0,
      revokedAt: null,
      transferCount: 0,
      lastTransferredAt: null,
    };
    const data = await governance.coder.accounts.encode("ercCertificate", erc as any);
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data,
      owner: governanceId,
      executable: false,
      rentEpoch: 0,
    } as any);
    return key;
  }

  async function sellOrderIx(orderId: number, energyAmount: number, price: number, ercKey: PublicKey | null, cfgKey: PublicKey) {
    return trading.methods
      .createSellOrder(new BN(orderId), new BN(energyAmount), new BN(price))
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        order: orderPda(payer.publicKey, orderId),
        ercCertificate: ercKey,
        authority: payer.publicKey,
        systemProgram: SystemProgram.programId,
        governanceConfig: cfgKey,
      } as any)
      .instruction();
  }

  async function buyOrderIx(orderId: number, energyAmount: number, maxPrice: number, cfgKey: PublicKey) {
    return trading.methods
      .createBuyOrder(new BN(orderId), new BN(energyAmount), new BN(maxPrice))
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        order: orderPda(payer.publicKey, orderId),
        authority: payer.publicKey,
        systemProgram: SystemProgram.programId,
        governanceConfig: cfgKey,
      } as any)
      .instruction();
  }

  async function cancelIx(orderId: number, cfgKey: PublicKey) {
    return trading.methods
      .cancelOrder()
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        order: orderPda(payer.publicKey, orderId),
        authority: payer.publicKey,
        governanceConfig: cfgKey,
      } as any)
      .instruction();
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

    currencyMint = currencyMintKp.publicKey;
    [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingId);
    [zoneMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(ZONE).toArrayLike(Buffer, "le", 4)], tradingId);
    [marketAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("market_authority")], tradingId);

    send([await trading.methods.initializeMarket(16).accounts({ market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()], []);
    send([await trading.methods.initializeZoneMarket(ZONE, 16, new BN(1_000_000)).accounts({ market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()], []);

    // Currency mint + collectors + a funded escrow (for the withdraw_escrow guard).
    const mintRent = Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)));
    send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: currencyMint, lamports: mintRent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(currencyMint, 6, payer.publicKey, null, TOKEN_PROGRAM_ID),
    ], [currencyMintKp]);
    const payerAta = getAssociatedTokenAddressSync(currencyMint, payer.publicKey, false, TOKEN_PROGRAM_ID);
    send([
      createAssociatedTokenAccountInstruction(payer.publicKey, payerAta, payer.publicKey, currencyMint, TOKEN_PROGRAM_ID),
      createMintToInstruction(currencyMint, payerAta, payer.publicKey, 1_000, [], TOKEN_PROGRAM_ID),
    ], []);
    send([await trading.methods.depositEscrow(new BN(600)).accounts({
      user: payer.publicKey, mint: currencyMint, userWallet: payerAta,
      userEscrow: PublicKey.findProgramAddressSync([Buffer.from("escrow"), payer.publicKey.toBuffer(), currencyMint.toBuffer()], tradingId)[0],
      marketAuthority: marketAuthorityPda, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any).instruction()], []);

    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));
  });

  it("creates a sell order under an operational config + valid ERC (control)", async () => {
    const cfg = await installConfig(false);
    const erc = await installErc({ status: "valid", expiresAt: FUTURE, validated: true, energyAmount: 100 });
    send([await sellOrderIx(1, 100, 50, erc, cfg)], []);
    // Order PDA now exists (created).
    expect(svm.getAccount(orderPda(payer.publicKey, 1))).to.not.be.null;
  });

  it("rejects order creation while in maintenance mode (MaintenanceMode)", async () => {
    const cfg = await installConfig(true);
    const blob = sendExpectFail([await sellOrderIx(2, 100, 50, null, cfg)], []);
    expect(blob, blob).to.match(/MaintenanceMode/);
  });

  it("rejects a non-Valid ERC certificate (InvalidErcCertificate)", async () => {
    const cfg = await installConfig(false);
    const erc = await installErc({ status: "expired", expiresAt: FUTURE, validated: true, energyAmount: 100 });
    const blob = sendExpectFail([await sellOrderIx(3, 100, 50, erc, cfg)], []);
    expect(blob, blob).to.match(/InvalidErcCertificate/);
  });

  it("rejects an expired ERC certificate (ErcExpired)", async () => {
    const cfg = await installConfig(false);
    const erc = await installErc({ status: "valid", expiresAt: PAST, validated: true, energyAmount: 100 });
    const blob = sendExpectFail([await sellOrderIx(4, 100, 50, erc, cfg)], []);
    expect(blob, blob).to.match(/ErcExpired/);
  });

  it("rejects an ERC not validated for trading (NotValidatedForTrading)", async () => {
    const cfg = await installConfig(false);
    const erc = await installErc({ status: "valid", expiresAt: FUTURE, validated: false, energyAmount: 100 });
    const blob = sendExpectFail([await sellOrderIx(5, 100, 50, erc, cfg)], []);
    expect(blob, blob).to.match(/NotValidatedForTrading/);
  });

  it("rejects an order exceeding the ERC's certified amount (ExceedsErcAmount)", async () => {
    const cfg = await installConfig(false);
    const erc = await installErc({ status: "valid", expiresAt: FUTURE, validated: true, energyAmount: 50 });
    const blob = sendExpectFail([await sellOrderIx(6, 100, 50, erc, cfg)], []); // 100 > 50
    expect(blob, blob).to.match(/ExceedsErcAmount/);
  });

  it("rejects cancelling an order that is no longer cancellable (OrderNotCancellable)", async () => {
    const cfg = await installConfig(false);
    const erc = await installErc({ status: "valid", expiresAt: FUTURE, validated: true, energyAmount: 100 });
    send([await sellOrderIx(7, 100, 50, erc, cfg)], []);
    send([await cancelIx(7, cfg)], []); // first cancel: Active → Cancelled
    const blob = sendExpectFail([await cancelIx(7, cfg)], []); // second cancel: not Active/PartiallyFilled
    expect(blob, blob).to.match(/OrderNotCancellable/);
  });

  it("rejects matching a buy below the sell price (PriceMismatch)", async () => {
    const cfg = await installConfig(false);
    const erc = await installErc({ status: "valid", expiresAt: FUTURE, validated: true, energyAmount: 100 });
    send([await buyOrderIx(10, 100, 40, cfg)], []);       // buy max 40
    send([await sellOrderIx(11, 100, 50, erc, cfg)], []); // sell at 50
    const buy = orderPda(payer.publicKey, 10), sell = orderPda(payer.publicKey, 11);
    const tradeRecord = PublicKey.findProgramAddressSync([Buffer.from("trade"), buy.toBuffer(), sell.toBuffer()], tradingId)[0];
    const ix = await trading.methods
      .matchOrders(new BN(100))
      .accounts({
        market: marketPda, zoneMarket: zoneMarketPda, buyOrder: buy, sellOrder: sell,
        tradeRecord, authority: payer.publicKey, governanceConfig: cfg, systemProgram: SystemProgram.programId,
      } as any)
      .instruction();
    const blob = sendExpectFail([ix], []); // buy_price 40 < sell_price 50
    expect(blob, blob).to.match(/PriceMismatch/);
  });

  it("rejects withdrawing more than the escrow balance (InsufficientEscrowBalance)", async () => {
    const escrow = PublicKey.findProgramAddressSync([Buffer.from("escrow"), payer.publicKey.toBuffer(), currencyMint.toBuffer()], tradingId)[0];
    const payerAta = getAssociatedTokenAddressSync(currencyMint, payer.publicKey, false, TOKEN_PROGRAM_ID);
    const ix = await trading.methods
      .withdrawEscrow(new BN(10_000)) // escrow holds only 600
      .accounts({
        user: payer.publicKey, mint: currencyMint, userEscrow: escrow, userWallet: payerAta,
        marketAuthority: marketAuthorityPda, tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .instruction();
    const blob = sendExpectFail([ix], []);
    expect(blob, blob).to.match(/InsufficientEscrowBalance/);
  });
});
