// Litesvm coverage for the guards on `execute_atomic_settlement` — the custodial
// settlement path that moves tokens against ON-CHAIN Order accounts (as opposed to
// `settle_offchain_match`, which works from signed payloads and is covered by
// tests/settle_offchain_guards_litesvm.ts).
//
// This path had NO in-process coverage, which mattered because it is the one the
// trading service actually calls: two guards were added to it and neither had ever
// been observed firing against the compiled program.
//
// What it pins:
//   1) buyer == seller                      -> SelfTradeNotAllowed
//   2) either order past its expires_at     -> OrderExpired
//
// Unlike the single `settle_offchain_match` path — where one wallet on both legs makes
// two named escrow fields resolve to the same address, so Anchor's
// ConstraintDuplicateMutableAccount fires first and the self-trade guard is unreachable —
// here the escrows and the receiving accounts are separate UncheckedAccounts, so a
// same-wallet trade reaches the handler and the guard is the only thing stopping it.
//
// The happy-path case is load-bearing: it proves the fixture really settles (tokens move),
// so the rejections below are guards firing rather than a mis-wired account.

import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { Governance } from "../target/types/governance";
import { expect } from "chai";
import { PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, AccountLayout, ACCOUNT_SIZE, MintLayout, MINT_SIZE,
} from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const tradingIdl = require("../target/idl/trading.json");
const governanceIdl = require("../target/idl/governance.json");

const ZONE = 0;
const NUM_SHARDS = 16;
const NOW = 1_000_000;
const P_MIN = 1_000_000;
const P_MAX = 5_000_000;

const ONE_KWH = 1_000_000_000;      // 9-dec energy atomic
const AMOUNT = ONE_KWH;
const SELL_PRICE = 2_000_000;       // 6-dec currency per kWh
const BUY_PRICE = 2_100_000;
const MATCH_PRICE = SELL_PRICE;

const CURRENCY_FUND = 50_000_000;
const ENERGY_FUND = 50 * ONE_KWH;

describe("execute_atomic_settlement (litesvm) — guards on the custodial settle path", () => {
  let svm: LiteSVM;
  let trading: Program<Trading>;
  let governance: Program<Governance>;
  let tradingId: PublicKey, governanceId: PublicKey;

  const payer = Keypair.generate();          // market authority + fee payer
  const escrowAuthority = Keypair.generate(); // token authority over both escrows
  const buyerKp = Keypair.generate();
  const sellerKp = Keypair.generate();

  let marketPda: PublicKey, zoneMarketPda: PublicKey, tariffPda: PublicKey, cfg: PublicKey;
  const currencyMint = Keypair.generate().publicKey; // classic SPL
  const energyMint = Keypair.generate().publicKey;   // Token-2022

  // Fresh token accounts per case so balances start known and cases cannot interfere.
  let buyerCurrencyEscrow: PublicKey, sellerEnergyEscrow: PublicKey;
  let sellerCurrencyAccount: PublicKey, buyerEnergyAccount: PublicKey;
  let feeCollector: PublicKey, wheelingCollector: PublicKey, lossCollector: PublicKey;

  let orderSeq = 100;
  let tradeSeq = 0;
  const freshTradeId = () => {
    const b = Buffer.alloc(16);
    b.writeUInt32LE(++tradeSeq, 0);
    b.writeUInt32LE(0xc0ffee, 8);
    return b;
  };

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, tradingId)[0];
  const orderPda = (owner: PublicKey, id: number) =>
    pda([Buffer.from("order"), owner.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)]);

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

  function installMint(key: PublicKey, decimals: number, program: PublicKey) {
    const data = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      {
        mintAuthorityOption: 1, mintAuthority: payer.publicKey, supply: BigInt(0),
        decimals, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default,
      },
      data,
    );
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))),
      data, owner: program, executable: false, rentEpoch: 0,
    } as any);
  }

  // `authority` matters: the two SOURCE escrows must be controlled by escrow_authority,
  // which is the signer the handler passes to every transfer CPI.
  function installTokenAccount(
    addr: PublicKey, mint: PublicKey, amount: number, program: PublicKey, authority: PublicKey,
  ) {
    const data = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode(
      {
        mint, owner: authority, amount: BigInt(amount),
        delegateOption: 0, delegate: PublicKey.default,
        delegatedAmount: BigInt(0), state: 1,
        isNativeOption: 0, isNative: BigInt(0),
        closeAuthorityOption: 0, closeAuthority: PublicKey.default,
      },
      data,
    );
    svm.setAccount(addr, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(ACCOUNT_SIZE))),
      data, owner: program, executable: false, rentEpoch: 0,
    } as any);
  }

  const tokenAmount = (addr: PublicKey) =>
    Number(AccountLayout.decode(Buffer.from(svm.getAccount(addr)!.data)).amount);

  async function installGovernanceConfig(): Promise<PublicKey> {
    const key = Keypair.generate().publicKey;
    const c = {
      authority: payer.publicKey, authorityName: Array(64).fill(0), nameLen: 0,
      contactInfo: Array(128).fill(0), contactLen: 0, version: 1, maintenanceMode: false,
      // Disabled so create_sell_order needs no ErcCertificate (ercCertificate: null).
      ercValidationEnabled: false, minEnergyAmount: new BN(0), maxErcAmount: new BN(0),
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

  function patchBand(min: number, max: number) {
    const acc = svm.getAccount(marketPda)!;
    const data = Buffer.from(acc.data);
    data.writeBigUInt64LE(BigInt(min), 88);
    data.writeBigUInt64LE(BigInt(max), 96);
    svm.setAccount(marketPda, { ...acc, data } as any);
    const m = trading.coder.accounts.decode("market", Buffer.from(svm.getAccount(marketPda)!.data));
    expect(m.minPricePerKwh.toNumber(), "patchBand offset drift").to.eq(min);
  }

  /// Create a real on-chain buy+sell pair and return their PDAs. `expiresAt` is passed
  /// through to the Order PDA (0 = the no-expiry sentinel); a PAST expiry cannot be
  /// created (validate_order_expiry rejects it), so the expiry case creates a live order
  /// and moves the clock instead.
  async function makePair(
    buyOwner: Keypair, sellOwner: Keypair, expiresAt = 0,
  ): Promise<{ buy: PublicKey; sell: PublicKey }> {
    const buyId = ++orderSeq, sellId = ++orderSeq;
    const buy = orderPda(buyOwner.publicKey, buyId);
    const sell = orderPda(sellOwner.publicKey, sellId);
    send([
      await trading.methods
        .createBuyOrder(new BN(buyId), new BN(AMOUNT), new BN(BUY_PRICE), new BN(expiresAt))
        .accounts({
          market: marketPda, zoneMarket: zoneMarketPda, order: buy,
          authority: buyOwner.publicKey, systemProgram: SystemProgram.programId, governanceConfig: cfg,
        } as any).instruction(),
    ], [buyOwner]);
    send([
      await trading.methods
        .createSellOrder(new BN(sellId), new BN(AMOUNT), new BN(SELL_PRICE), new BN(expiresAt))
        .accounts({
          market: marketPda, zoneMarket: zoneMarketPda, order: sell, ercCertificate: null,
          authority: sellOwner.publicKey, systemProgram: SystemProgram.programId, governanceConfig: cfg,
        } as any).instruction(),
    ], [sellOwner]);
    return { buy, sell };
  }

  // `over` swaps the energy mint and its two token accounts together — they must move as a
  // set, because `transfer_checked` rejects a token account whose mint disagrees with the
  // mint passed. The InvalidEnergyMint case uses it to hand the program a fully coherent
  // trade in the WRONG asset, which is exactly what the pin has to catch.
  async function settleIx(
    buy: PublicKey, sell: PublicKey, tradeId = freshTradeId(),
    over: { eMint?: PublicKey; sellerEnergy?: PublicKey; buyerEnergy?: PublicKey } = {},
  ) {
    return trading.methods
      .executeAtomicSettlement(new BN(AMOUNT), new BN(MATCH_PRICE), [...tradeId])
      .accounts({
        market: marketPda, buyOrder: buy, sellOrder: sell,
        tradeNullifier: pda([Buffer.from("trade"), tradeId]),
        buyerCurrencyEscrow: buyerCurrencyEscrow,
        sellerEnergyEscrow: over.sellerEnergy ?? sellerEnergyEscrow,
        sellerCurrencyAccount: sellerCurrencyAccount,
        buyerEnergyAccount: over.buyerEnergy ?? buyerEnergyAccount,
        feeCollector, wheelingCollector, lossCollector,
        energyMint: over.eMint ?? energyMint, currencyMint,
        escrowAuthority: escrowAuthority.publicKey,
        marketAuthority: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
        governanceConfig: cfg,
        tariffConfig: tariffPda,
      } as any)
      .instruction();
  }

  // Re-seed all seven token accounts at fresh addresses, so every case starts from a
  // known state and one case's transfers cannot mask another's.
  function seedAccounts() {
    buyerCurrencyEscrow = Keypair.generate().publicKey;
    sellerEnergyEscrow = Keypair.generate().publicKey;
    sellerCurrencyAccount = Keypair.generate().publicKey;
    buyerEnergyAccount = Keypair.generate().publicKey;
    feeCollector = Keypair.generate().publicKey;
    wheelingCollector = Keypair.generate().publicKey;
    lossCollector = Keypair.generate().publicKey;

    // Sources: authority MUST be escrow_authority — it signs the transfer CPIs.
    installTokenAccount(buyerCurrencyEscrow, currencyMint, CURRENCY_FUND, TOKEN_PROGRAM_ID, escrowAuthority.publicKey);
    installTokenAccount(sellerEnergyEscrow, energyMint, ENERGY_FUND, TOKEN_2022_PROGRAM_ID, escrowAuthority.publicKey);
    // Destinations: any authority.
    installTokenAccount(sellerCurrencyAccount, currencyMint, 0, TOKEN_PROGRAM_ID, sellerKp.publicKey);
    installTokenAccount(buyerEnergyAccount, energyMint, 0, TOKEN_2022_PROGRAM_ID, buyerKp.publicKey);
    for (const c of [feeCollector, wheelingCollector, lossCollector])
      installTokenAccount(c, currencyMint, 0, TOKEN_PROGRAM_ID, payer.publicKey);
  }

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    trading = new Program(tradingIdl, { connection: {}, publicKey: PublicKey.default } as any);
    governance = new Program(governanceIdl, { connection: {}, publicKey: PublicKey.default } as any);
    tradingId = trading.programId;
    governanceId = governance.programId;
    svm.addProgramFromFile(tradingId, "target/deploy/trading.so");
    svm.addProgramFromFile(governanceId, "target/deploy/governance.so");
    for (const kp of [payer, buyerKp, sellerKp, escrowAuthority])
      svm.airdrop(kp.publicKey, BigInt(1_000_000_000_000));

    marketPda = pda([Buffer.from("market")]);
    zoneMarketPda = pda([
      Buffer.from("zone_market"), marketPda.toBuffer(), new BN(ZONE).toArrayLike(Buffer, "le", 4),
    ]);
    tariffPda = pda([Buffer.from("tariff_config")]);

    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));
    cfg = await installGovernanceConfig();
    installMint(currencyMint, 6, TOKEN_PROGRAM_ID);
    installMint(energyMint, 9, TOKEN_2022_PROGRAM_ID);

    send([await trading.methods.initializeMarket(NUM_SHARDS).accounts({
      market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId,
    } as any).instruction()]);
    // This path takes `energy_mint` as an unconstrained account and its escrows are
    // matcher-supplied CHECK accounts, so the market must say which token is energy or the
    // settle fails closed (SettlementEnergyMintUnset). Pinned as its own case at the end.
    send([await trading.methods.setSettlementEnergyMint(energyMint).accounts({
      market: marketPda, authority: payer.publicKey,
    } as any).instruction()]);
    send([await trading.methods.initializeZoneMarket(ZONE, NUM_SHARDS, new BN(0), 0).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey,
      systemProgram: SystemProgram.programId,
    } as any).instruction()]);
    patchBand(P_MIN, P_MAX);
    // Zero tariff so the seller's expected proceeds are exactly value - market_fee.
    send([await trading.methods.initializeTariffConfig(
      payer.publicKey, payer.publicKey, new BN(0), 0,
    ).accounts({
      tariffConfig: tariffPda, market: marketPda, authority: payer.publicKey,
      systemProgram: SystemProgram.programId,
    } as any).instruction()]);
  });

  it("happy path: an honest pair settles — energy to the buyer, currency to the seller", async () => {
    seedAccounts();
    const { buy, sell } = await makePair(buyerKp, sellerKp);
    const meta = send([await settleIx(buy, sell)], [escrowAuthority]);
    console.log(`\n  [CU] execute_atomic_settlement = ${Number(meta!.computeUnitsConsumed()).toLocaleString()} CU`);

    const feeBps = trading.coder.accounts.decode(
      "market", Buffer.from(svm.getAccount(marketPda)!.data)).marketFeeBps;
    const totalValue = Math.floor((AMOUNT * MATCH_PRICE) / ONE_KWH);
    const fee = Math.floor((totalValue * feeBps) / 10_000);

    expect(tokenAmount(buyerEnergyAccount), "buyer receives the energy").to.eq(AMOUNT);
    expect(tokenAmount(sellerEnergyEscrow), "seller's energy escrow debited").to.eq(ENERGY_FUND - AMOUNT);
    expect(tokenAmount(sellerCurrencyAccount), "seller paid net of fee").to.eq(totalValue - fee);
    expect(tokenAmount(feeCollector), "fee collected").to.eq(fee);
  });

  // Reachable here, unlike on the single settle path: source escrows and destination
  // accounts are distinct UncheckedAccounts, so one wallet on both legs does not trip
  // Anchor's duplicate-mutable-account check and the handler's guard is what rejects it.
  it("rejects a self-trade: one wallet on both orders (SelfTradeNotAllowed), no tokens move", async () => {
    seedAccounts();
    const solo = Keypair.generate();
    svm.airdrop(solo.publicKey, BigInt(1_000_000_000_000));
    const { buy, sell } = await makePair(solo, solo);

    const before = {
      cur: tokenAmount(buyerCurrencyEscrow),
      eng: tokenAmount(sellerEnergyEscrow),
      fee: tokenAmount(feeCollector),
    };
    const res = sendRaw([await settleIx(buy, sell)], [escrowAuthority]);
    expect(res instanceof FailedTransactionMetadata, "self-trade must not settle").to.be.true;
    expect((res as FailedTransactionMetadata).meta().logs().join("\n")).to.include("SelfTradeNotAllowed");

    expect(tokenAmount(buyerCurrencyEscrow)).to.eq(before.cur);
    expect(tokenAmount(sellerEnergyEscrow)).to.eq(before.eng);
    expect(tokenAmount(feeCollector)).to.eq(before.fee);
  });

  // A past expiry cannot be created (validate_order_expiry rejects it), so the pair is
  // created live and the clock is moved past it — which also pins that the guard reads
  // Order.expires_at at SETTLEMENT time rather than trusting order creation.
  it("rejects a lapsed order (OrderExpired), and the same pair settles once the clock is back", async () => {
    seedAccounts();
    const expiry = NOW + 100;
    const { buy, sell } = await makePair(buyerKp, sellerKp, expiry);

    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(expiry)));
    const before = tokenAmount(buyerCurrencyEscrow);
    const lapsed = sendRaw([await settleIx(buy, sell)], [escrowAuthority]);
    expect(lapsed instanceof FailedTransactionMetadata, "a lapsed order must not settle").to.be.true;
    expect((lapsed as FailedTransactionMetadata).meta().logs().join("\n")).to.include("OrderExpired");
    expect(tokenAmount(buyerCurrencyEscrow), "nothing moved").to.eq(before);

    // Rewind inside the TTL: the only variable that changed is the clock.
    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(expiry - 1)));
    send([await settleIx(buy, sell)], [escrowAuthority]);
    expect(tokenAmount(buyerEnergyAccount), "the still-live pair settles").to.eq(AMOUNT);

    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));
  });

  // ── The energy-mint pin on the CUSTODIAL path (invariant #8) ───────────────
  // This path TRANSFERS energy rather than burning it, so an unpinned mint cannot destroy
  // a third party's asset — `transfer_checked` binds both accounts to the mint passed, and
  // `escrow_authority` must sign for the source. What it can still do is settle a trade
  // denominated in an arbitrary token and book it as an energy trade: market volume, price
  // history and the treasury's settled value all move for something that was never metered
  // surplus. The pin makes "which token is energy" market policy instead of a caller
  // argument — the same thing this handler already does for `rec_mint`.
  //
  // Worth stating plainly: this is the path the trading service actually calls, so until
  // the pin landed here it protected only the off-chain settle instructions.

  // Found by value, not by a hand-counted offset — Market is zero-copy with manual padding
  // and a literal offset would rot silently. Exactly-one-occurrence keeps it honest.
  function energyPinOffset(data: Buffer): number {
    const needle = energyMint.toBuffer();
    const hits: number[] = [];
    for (let i = 0; i + 32 <= data.length; i++)
      if (data.subarray(i, i + 32).equals(needle)) hits.push(i);
    expect(hits.length, "energy mint must appear exactly once in Market — layout changed?")
      .to.eq(1);
    expect(data[hits[0] + 32], "the flag byte must follow the pinned mint, set").to.eq(1);
    return hits[0] + 32;
  }

  it("refuses to settle when no energy mint is pinned (SettlementEnergyMintUnset), no tokens move", async () => {
    seedAccounts();
    const { buy, sell } = await makePair(buyerKp, sellerKp);
    const acct = svm.getAccount(marketPda)!;
    const original = Buffer.from(acct.data);

    // There is no unpin instruction (set_settlement_energy_mint rejects the default
    // pubkey), so the unset state is reproduced by clearing the flag byte — the state every
    // Market created before this change is already in.
    const cleared = Buffer.from(original);
    cleared[energyPinOffset(cleared)] = 0;
    svm.setAccount(marketPda, { ...acct, data: cleared } as any);

    try {
      const before = {
        energy: tokenAmount(sellerEnergyEscrow),
        currency: tokenAmount(buyerCurrencyEscrow),
      };
      const res = sendRaw([await settleIx(buy, sell)], [escrowAuthority]);
      expect(res instanceof FailedTransactionMetadata, "an unpinned market must not settle").to.be.true;
      expect((res as FailedTransactionMetadata).meta().logs().join("\n"))
        .to.include("SettlementEnergyMintUnset");

      expect(tokenAmount(sellerEnergyEscrow), "no energy moved").to.eq(before.energy);
      expect(tokenAmount(buyerCurrencyEscrow), "no currency moved").to.eq(before.currency);
    } finally {
      svm.setAccount(marketPda, { ...acct, data: original } as any);
    }
  });

  it("refuses to settle a trade in a mint the market did not pin (InvalidEnergyMint)", async () => {
    seedAccounts();
    const { buy, sell } = await makePair(buyerKp, sellerKp);

    // A coherent trade in the wrong asset: decoy mint, decoy escrows holding it, source
    // authority = escrow_authority so the CPI itself would succeed. Everything the runtime
    // checks is satisfied — only the market's policy says no.
    const decoyMint = Keypair.generate().publicKey;
    const decoySellerEnergy = Keypair.generate().publicKey;
    const decoyBuyerEnergy = Keypair.generate().publicKey;
    installMint(decoyMint, 9, TOKEN_2022_PROGRAM_ID);
    installTokenAccount(decoySellerEnergy, decoyMint, ENERGY_FUND, TOKEN_2022_PROGRAM_ID, escrowAuthority.publicKey);
    installTokenAccount(decoyBuyerEnergy, decoyMint, 0, TOKEN_2022_PROGRAM_ID, buyerKp.publicKey);

    const res = sendRaw([await settleIx(buy, sell, freshTradeId(), {
      eMint: decoyMint, sellerEnergy: decoySellerEnergy, buyerEnergy: decoyBuyerEnergy,
    })], [escrowAuthority]);
    expect(res instanceof FailedTransactionMetadata, "an unpinned mint must not settle").to.be.true;
    expect((res as FailedTransactionMetadata).meta().logs().join("\n")).to.include("InvalidEnergyMint");

    expect(tokenAmount(decoySellerEnergy), "the decoy asset did not move").to.eq(ENERGY_FUND);
    expect(tokenAmount(decoyBuyerEnergy), "the buyer received no decoy asset").to.eq(0);
  });
});
