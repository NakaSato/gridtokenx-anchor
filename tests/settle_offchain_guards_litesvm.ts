// Litesvm coverage for the per-match guards in `batch_settle_offchain_match` — the
// FUND-MOVING settlement path. Until this suite existed, that instruction had no
// in-process coverage at all: its only exerciser (tests/batch_settle_tps.ts) needs a
// live validator, a deployed treasury and a bootstrapped chain, so nothing verified
// its validation against the compiled artifact.
//
// What it pins, per match:
//   1) buyer.user != seller.user            -> SelfTradeNotAllowed
//   2) buyer_payload.side == 0 (Buy)        -> InvalidOrderSide
//   3) seller_payload.side == 1 (Sell)      -> InvalidOrderSide
//   4) neither leg has lapsed               -> OrderExpired
// (2)-(4) existed only on the single-match path; the batch loop had NONE of them, so a
// payload signed as a SELL could be handed in as the BUYER leg and have its CURRENCY
// escrow debited — the opposite of what its owner signed.
//
// The happy-path case is load-bearing, not decoration: it proves the harness really
// reaches the settle logic, so a rejection below is the guard firing and not a
// mis-wired fixture. Every rejection test therefore asserts BOTH the specific error
// AND that no tokens moved.
//
// Setup notes:
//   - Ed25519: litesvm executes the precompile, so both legs are signed for real with
//     Ed25519Program instructions at ix indices 0 (buyer) and 1 (seller) — the order
//     `verify_ed25519_signature(sysvar, i*2 / i*2+1, ...)` expects.
//   - governance_config MUST sit at the canonical [b"governance_config"] PDA owned by
//     the governance program (require_governance_operational binds it), unlike the
//     random-key fixtures the other suites can get away with.
//   - The AggregatorEntry gate reads RAW BYTES (owner + PDA + data[8..40] == payer +
//     data[56] == 1), so it is fabricated byte-wise rather than via the governance IDL.
//   - Escrows/collectors are token accounts AT PDAs (no signer available), so they are
//     fabricated with AccountLayout at their derived addresses, authority =
//     market_authority — exactly what the program's seeds+token constraints require.

import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { Governance } from "../target/types/governance";
import { expect } from "chai";
import {
  PublicKey, Keypair, SystemProgram, TransactionInstruction, Ed25519Program,
  TransactionMessage, VersionedTransaction, AddressLookupTableAccount,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, AccountLayout, ACCOUNT_SIZE, MintLayout, MINT_SIZE,
} from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const tradingIdl = require("../target/idl/trading.json");
const governanceIdl = require("../target/idl/governance.json");

const ZONE = 0;
const SHARD = 0;
const NUM_SHARDS = 16;
const NOW = 1_000_000;

// 1 kWh in 9-dec energy atomic units; price in 6-dec currency units per kWh.
const ONE_KWH = 1_000_000_000;
const MATCH_AMOUNT = ONE_KWH;
const SELL_PRICE = 2_000_000; // 2.00
const BUY_PRICE = 2_100_000;  // 2.10 — crosses
const MATCH_PRICE = SELL_PRICE;

const ENERGY_FUND = 50 * ONE_KWH;
const CURRENCY_FUND = 50_000_000;

// Canonical signed message (settle_offchain.rs OffchainOrderPayload::get_message).
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

describe("batch_settle_offchain_match (litesvm) — per-match guards on the fund path", () => {
  let svm: LiteSVM;
  let trading: Program<Trading>;
  let governance: Program<Governance>;
  let tradingId: PublicKey, governanceId: PublicKey;

  const payer = Keypair.generate();   // the admitted aggregator / settlement payer
  const buyerKp = Keypair.generate();
  const sellerKp = Keypair.generate();

  let marketPda: PublicKey, marketAuthorityPda: PublicKey, zoneMarketPda: PublicKey;
  let marketShardPda: PublicKey, zoneShardPda: PublicKey, tariffPda: PublicKey;
  let govCfgPda: PublicKey, aggEntryPda: PublicKey;
  const currencyMint = Keypair.generate().publicKey; // classic SPL
  const energyMint = Keypair.generate().publicKey;   // Token-2022

  let orderSeq = 0;
  const freshOrderId = () => {
    const b = Buffer.alloc(16);
    b.writeUInt32LE(++orderSeq, 0);
    b.writeUInt32LE(0xa5a5a5a5, 8);
    return b;
  };
  let tradeSeq = 0;
  const freshTradeId = () => {
    const b = Buffer.alloc(16);
    b.writeUInt32LE(++tradeSeq, 0);
    b.writeUInt32LE(0x5a5a5a5a, 8);
    return b;
  };
  let batchSeq = 7000;

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, tradingId)[0];
  const escrowPda = (user: PublicKey, mint: PublicKey) =>
    pda([Buffer.from("escrow"), user.toBuffer(), mint.toBuffer()]);
  const nullifierPda = (user: PublicKey, orderId: Buffer) =>
    pda([Buffer.from("nullifier"), user.toBuffer(), orderId]);
  const tradeNullifierPda = (tradeId: Buffer) => pda([Buffer.from("trade"), tradeId]);
  const collectorPda = (label: string) =>
    pda([Buffer.from(label), currencyMint.toBuffer(), Buffer.from([SHARD])]);
  // The SINGLE-match path predates collector sharding: its seeds carry no shard byte.
  const collectorPdaUnsharded = (label: string) =>
    pda([Buffer.from(label), currencyMint.toBuffer()]);

  // A settle tx does NOT fit in a legacy transaction: 2 inline Ed25519 verify ixs plus
  // ~26 settle accounts serialize to ~1.6 KB against the 1232-byte packet limit (the
  // documented batch-settle single-tx cap). Production compresses the account list with
  // an Address Lookup Table, so this harness must too, or it would only ever test the
  // packet limit. The ALT is fabricated directly at a fresh address per send — an
  // on-chain create+extend would also need a slot warp before the table is usable.
  function altFor(ixs: TransactionInstruction[]): AddressLookupTableAccount {
    const compressible: PublicKey[] = [];
    const seen = new Set<string>([payer.publicKey.toBase58()]); // signers must stay static
    for (const ix of ixs) {
      for (const k of ix.keys) {
        if (k.isSigner) continue;
        if (seen.has(k.pubkey.toBase58())) continue;
        seen.add(k.pubkey.toBase58());
        compressible.push(k.pubkey);
      }
    }
    const key = Keypair.generate().publicKey;
    // LookupTableMeta: u32 state tag, u64 deactivation_slot, u64 last_extended_slot,
    // u8 start index, Option<Pubkey> authority, u16 padding — 56 bytes, then addresses.
    const META = 56;
    const data = Buffer.alloc(META + compressible.length * 32);
    data.writeUInt32LE(1, 0);                              // ProgramState::LookupTable
    data.writeBigUInt64LE(BigInt("18446744073709551615"), 4); // deactivation_slot = never
    data.writeBigUInt64LE(BigInt(0), 12);                  // last_extended_slot (< current)
    data.writeUInt8(0, 20);
    data.writeUInt8(0, 21);                                // authority: None (frozen)
    compressible.forEach((a, i) => a.toBuffer().copy(data, META + i * 32));
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data, owner: new PublicKey("AddressLookupTab1e1111111111111111111111111"),
      executable: false, rentEpoch: 0,
    } as any);
    return new AddressLookupTableAccount({
      key,
      state: {
        deactivationSlot: BigInt("18446744073709551615"),
        lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0,
        authority: undefined, addresses: compressible,
      },
    });
  }

  function sendRaw(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: svm.latestBlockhash(),
      instructions: ixs,
    }).compileToV0Message([altFor(ixs)]);
    const tx = new VersionedTransaction(msg);
    tx.sign([payer, ...signers]);
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

  // ---- fixture installers -------------------------------------------------
  function installMint(key: PublicKey, decimals: number, program: PublicKey) {
    const data = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      {
        mintAuthorityOption: 1, mintAuthority: payer.publicKey, supply: BigInt(0),
        decimals, isInitialized: true, freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      data,
    );
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))),
      data, owner: program, executable: false, rentEpoch: 0,
    } as any);
  }

  function installTokenAccount(addr: PublicKey, mint: PublicKey, amount: number, program: PublicKey) {
    const data = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode(
      {
        mint, owner: marketAuthorityPda, amount: BigInt(amount),
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

  async function installGovernanceConfig() {
    const c = {
      authority: payer.publicKey, authorityName: Array(64).fill(0), nameLen: 0,
      contactInfo: Array(128).fill(0), contactLen: 0, version: 1, maintenanceMode: false,
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
    // require_governance_operational reads data[235] as the maintenance byte and needs
    // len > 235 — assert the fixture actually satisfies that rather than discovering it
    // as an opaque InvalidGovernanceAccount later.
    expect(data.length, "governanceConfig encoding shorter than the handler's 235-byte read")
      .to.be.greaterThan(235);
    expect(data[235], "byte 235 must be the cleared maintenance flag").to.eq(0);
    svm.setAccount(govCfgPda, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data, owner: governanceId, executable: false, rentEpoch: 0,
    } as any);
  }

  // AggregatorEntry as the gate actually reads it (settle_offchain.rs:152):
  // owner == governance, PDA == [b"aggregator", payer], data[8..40] == payer,
  // data[56] == 1 (active), data[58] == segment (0 = Retail).
  function installAggregatorEntry() {
    const data = Buffer.alloc(59);
    payer.publicKey.toBuffer().copy(data, 8);
    data[56] = 1;
    data[58] = 0;
    svm.setAccount(aggEntryPda, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data, owner: governanceId, executable: false, rentEpoch: 0,
    } as any);
  }

  // ---- the instruction under test ----------------------------------------
  interface Leg { kp: Keypair; orderId: Buffer; side: number; price: number; expiresAt: number; }
  const leg = (kp: Keypair, side: number, price: number, over: Partial<Leg> = {}): Leg =>
    ({ kp, orderId: freshOrderId(), side, price, expiresAt: 0, ...over });

  function payloadOf(l: Leg) {
    return {
      orderId: [...l.orderId], user: l.kp.publicKey,
      energyAmount: new BN(MATCH_AMOUNT), pricePerKwh: new BN(l.price),
      side: l.side, zoneId: ZONE, expiresAt: new BN(l.expiresAt),
    };
  }
  function edIxFor(l: Leg) {
    return Ed25519Program.createInstructionWithPrivateKey({
      privateKey: l.kp.secretKey,
      message: orderMessage({
        orderId: l.orderId, user: l.kp.publicKey, energyAmount: MATCH_AMOUNT,
        pricePerKwh: l.price, side: l.side, zoneId: ZONE, expiresAt: l.expiresAt,
      }),
    });
  }

  // Builds [ed25519(buyer), ed25519(seller), batch_settle] for a single-match batch.
  // `buyerLeg` is whatever is passed in the buyer slot — the wrong-side test deliberately
  // puts a SELL-signed payload there, which is the whole point of the side check.
  async function settleIxs(buyerLeg: Leg, sellerLeg: Leg, tradeId = freshTradeId()) {
    const match = {
      buyerPayload: payloadOf(buyerLeg), sellerPayload: payloadOf(sellerLeg),
      matchAmount: new BN(MATCH_AMOUNT), matchPrice: new BN(MATCH_PRICE),
      tradeId: [...tradeId],
    };
    const remaining = [
      // per-match group of 7, in the order the handler binds them
      { pubkey: nullifierPda(buyerLeg.kp.publicKey, buyerLeg.orderId), isWritable: true, isSigner: false },
      { pubkey: nullifierPda(sellerLeg.kp.publicKey, sellerLeg.orderId), isWritable: true, isSigner: false },
      { pubkey: escrowPda(buyerLeg.kp.publicKey, currencyMint), isWritable: true, isSigner: false },
      { pubkey: escrowPda(sellerLeg.kp.publicKey, currencyMint), isWritable: true, isSigner: false },
      { pubkey: escrowPda(sellerLeg.kp.publicKey, energyMint), isWritable: true, isSigner: false },
      { pubkey: escrowPda(buyerLeg.kp.publicKey, energyMint), isWritable: true, isSigner: false },
      { pubkey: tradeNullifierPda(tradeId), isWritable: true, isSigner: false },
      // trailing: governance_config, tariff_config, aggregator_entry
      { pubkey: govCfgPda, isWritable: false, isSigner: false },
      { pubkey: tariffPda, isWritable: false, isSigner: false },
      { pubkey: aggEntryPda, isWritable: false, isSigner: false },
    ];
    const settle = await trading.methods
      .batchSettleOffchainMatch(
        [match] as any, Array(32).fill(0), new BN(0), 0, new BN(++batchSeq), SHARD,
      )
      .accounts({
        market: marketPda, zoneMarket: zoneMarketPda,
        currencyMint, energyMint, marketAuthority: marketAuthorityPda,
        marketShard: marketShardPda, zoneShard: zoneShardPda,
        feeCollector: collectorPda("fee_collector"),
        wheelingCollector: collectorPda("wheeling_collector"),
        lossCollector: collectorPda("loss_collector"),
        payer: payer.publicKey,
        sysvarInstructions: new PublicKey("Sysvar1nstructions1111111111111111111111111"),
        tokenProgram: TOKEN_PROGRAM_ID, secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        treasuryProgram: null, treasuryState: null,
        settlementShard: null, settlementRecord: null,
      } as any)
      .remainingAccounts(remaining)
      .instruction();
    return [edIxFor(buyerLeg), edIxFor(sellerLeg), settle];
  }

  // The single-match path binds market_shard / zone_shard by SEED to the PAYER-derived
  // shard (get_shard_id = pubkey[0] % num_shards, market.rs), unlike the batch path whose
  // shard fields carry no seeds constraint and accept any initialized shard.
  const payerShard = () => payer.publicKey.toBytes()[0] % NUM_SHARDS;

  // [ed25519(buyer), ed25519(seller), settle_offchain_match] for the SINGLE-match path.
  // Its context differs from the batch: named nullifier/escrow fields, unsharded
  // collectors, payer-derived shard seeds, and 4 trailing remaining accounts
  // (governance_config, trade_nullifier, tariff_config, aggregator_entry).
  async function settleSingleIxs(buyerLeg: Leg, sellerLeg: Leg, tradeId = freshTradeId()) {
    const shard = payerShard();
    const settle = await trading.methods
      .settleOffchainMatch(
        payloadOf(buyerLeg) as any, payloadOf(sellerLeg) as any,
        new BN(MATCH_AMOUNT), new BN(MATCH_PRICE), [...tradeId],
      )
      .accounts({
        market: marketPda, zoneMarket: zoneMarketPda,
        buyerNullifier: nullifierPda(buyerLeg.kp.publicKey, buyerLeg.orderId),
        sellerNullifier: nullifierPda(sellerLeg.kp.publicKey, sellerLeg.orderId),
        currencyMint, energyMint, marketAuthority: marketAuthorityPda,
        tokenProgram: TOKEN_PROGRAM_ID, secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
        buyerCurrencyEscrow: escrowPda(buyerLeg.kp.publicKey, currencyMint),
        sellerCurrencyEscrow: escrowPda(sellerLeg.kp.publicKey, currencyMint),
        sellerEnergyEscrow: escrowPda(sellerLeg.kp.publicKey, energyMint),
        buyerEnergyEscrow: escrowPda(buyerLeg.kp.publicKey, energyMint),
        feeCollector: collectorPdaUnsharded("fee_collector"),
        wheelingCollector: collectorPdaUnsharded("wheeling_collector"),
        lossCollector: collectorPdaUnsharded("loss_collector"),
        marketShard: pda([Buffer.from("market_shard"), marketPda.toBuffer(), Buffer.from([shard])]),
        zoneShard: pda([Buffer.from("zone_shard"), zoneMarketPda.toBuffer(), Buffer.from([shard])]),
        payer: payer.publicKey,
        sysvarInstructions: new PublicKey("Sysvar1nstructions1111111111111111111111111"),
        systemProgram: SystemProgram.programId,
        treasuryProgram: null, treasuryState: null,
      } as any)
      .remainingAccounts([
        { pubkey: govCfgPda, isWritable: false, isSigner: false },
        { pubkey: tradeNullifierPda(tradeId), isWritable: true, isSigner: false },
        { pubkey: tariffPda, isWritable: false, isSigner: false },
        { pubkey: aggEntryPda, isWritable: false, isSigner: false },
      ])
      .instruction();
    return [edIxFor(buyerLeg), edIxFor(sellerLeg), settle];
  }

  // Fund the four escrows a match touches, so each case starts from a known state.
  //
  // Resolved by ADDRESS, taking the larger balance, because when buyer and seller are the
  // same wallet (the self-trade case) the buyer's and seller's escrows ARE the same two
  // accounts. Writing them sequentially would let the receiving side's 0 overwrite the
  // paying side's funding, and the settle would then fail on `insufficient funds` — an
  // artefact of the fixture that would mask whether the self-trade guard does anything.
  function fundEscrows(buyer: PublicKey, seller: PublicKey) {
    const plan = new Map<string, { addr: PublicKey; mint: PublicKey; amount: number; prog: PublicKey }>();
    const want = (addr: PublicKey, mint: PublicKey, amount: number, prog: PublicKey) => {
      const k = addr.toBase58();
      const prev = plan.get(k);
      if (!prev || amount > prev.amount) plan.set(k, { addr, mint, amount, prog });
    };
    want(escrowPda(buyer, currencyMint), currencyMint, CURRENCY_FUND, TOKEN_PROGRAM_ID);
    want(escrowPda(seller, currencyMint), currencyMint, 0, TOKEN_PROGRAM_ID);
    want(escrowPda(seller, energyMint), energyMint, ENERGY_FUND, TOKEN_2022_PROGRAM_ID);
    want(escrowPda(buyer, energyMint), energyMint, 0, TOKEN_2022_PROGRAM_ID);
    for (const e of plan.values()) installTokenAccount(e.addr, e.mint, e.amount, e.prog);
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

    marketPda = pda([Buffer.from("market")]);
    marketAuthorityPda = pda([Buffer.from("market_authority")]);
    zoneMarketPda = pda([Buffer.from("zone_market"), marketPda.toBuffer(), new BN(ZONE).toArrayLike(Buffer, "le", 4)]);
    marketShardPda = pda([Buffer.from("market_shard"), marketPda.toBuffer(), Buffer.from([SHARD])]);
    zoneShardPda = pda([Buffer.from("zone_shard"), zoneMarketPda.toBuffer(), Buffer.from([SHARD])]);
    tariffPda = pda([Buffer.from("tariff_config")]);
    govCfgPda = PublicKey.findProgramAddressSync([Buffer.from("governance_config")], governanceId)[0];
    aggEntryPda = PublicKey.findProgramAddressSync(
      [Buffer.from("aggregator"), payer.publicKey.toBuffer()], governanceId)[0];

    // Advance past slot 0: an ALT is only usable once its last_extended_slot is strictly
    // BELOW the current slot, and the fabricated tables above carry last_extended_slot = 0.
    svm.warpToSlot(BigInt(64));
    svm.setClock(new Clock(svm.getClock().slot, 0n, 0n, 0n, BigInt(NOW)));
    await installGovernanceConfig();
    installAggregatorEntry();
    installMint(currencyMint, 6, TOKEN_PROGRAM_ID);
    installMint(energyMint, 9, TOKEN_2022_PROGRAM_ID);

    // Real program instructions for the accounts the program owns.
    send([await trading.methods.initializeMarket(NUM_SHARDS).accounts({
      market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId,
    } as any).instruction()]);
    // capacity 0 -> the cross-zone throttle is off, so no ZoneCapacity account is needed
    // (cross_zone = capacity > 0 && ...), keeping this suite on the intra-zone path.
    send([await trading.methods.initializeZoneMarket(ZONE, NUM_SHARDS, new BN(0), 0).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey,
      systemProgram: SystemProgram.programId,
    } as any).instruction()]);
    send([await trading.methods.initializeMarketShard(SHARD).accounts({
      market: marketPda, marketShard: marketShardPda,
      payer: payer.publicKey, systemProgram: SystemProgram.programId,
    } as any).instruction()]);
    send([await trading.methods.initializeZoneMarketShard(SHARD).accounts({
      zoneMarket: zoneMarketPda, zoneShard: zoneShardPda,
      payer: payer.publicKey, systemProgram: SystemProgram.programId,
    } as any).instruction()]);
    // Zero tariff: wheeling/loss are not what this suite is about, and zeroing them makes
    // the seller's expected proceeds exactly total_value - market_fee.
    send([await trading.methods.initializeTariffConfig(
      payer.publicKey, payer.publicKey, new BN(0), 0,
    ).accounts({
      tariffConfig: tariffPda, market: marketPda, authority: payer.publicKey,
      systemProgram: SystemProgram.programId,
    } as any).instruction()]);

    // The single-match path binds its shards by seed to the payer-derived shard, which is
    // only shard 0 for one payer key in sixteen — initialize it when it differs.
    const ps = payerShard();
    if (ps !== SHARD) {
      send([await trading.methods.initializeMarketShard(ps).accounts({
        market: marketPda,
        marketShard: pda([Buffer.from("market_shard"), marketPda.toBuffer(), Buffer.from([ps])]),
        payer: payer.publicKey, systemProgram: SystemProgram.programId,
      } as any).instruction()]);
      send([await trading.methods.initializeZoneMarketShard(ps).accounts({
        zoneMarket: zoneMarketPda,
        zoneShard: pda([Buffer.from("zone_shard"), zoneMarketPda.toBuffer(), Buffer.from([ps])]),
        payer: payer.publicKey, systemProgram: SystemProgram.programId,
      } as any).instruction()]);
    }

    // Protocol collectors — currency-denominated. Both layouts: sharded (batch path) and
    // unsharded (single path).
    for (const label of ["fee_collector", "wheeling_collector", "loss_collector"]) {
      installTokenAccount(collectorPda(label), currencyMint, 0, TOKEN_PROGRAM_ID);
      installTokenAccount(collectorPdaUnsharded(label), currencyMint, 0, TOKEN_PROGRAM_ID);
    }
  });

  // Load-bearing: proves the harness reaches the settle logic and moves real tokens, so
  // the rejections below are the guards firing rather than a broken fixture.
  it("happy path: an honest cross settles — energy buyer-ward, currency seller-ward", async () => {
    fundEscrows(buyerKp.publicKey, sellerKp.publicKey);
    const buyer = leg(buyerKp, 0, BUY_PRICE);
    const seller = leg(sellerKp, 1, SELL_PRICE);

    const meta = send(await settleIxs(buyer, seller));
    console.log(`\n  [CU] batch_settle_offchain_match (1 match) = ${Number(meta!.computeUnitsConsumed()).toLocaleString()} CU`);

    const feeBps = trading.coder.accounts.decode(
      "market", Buffer.from(svm.getAccount(marketPda)!.data)).marketFeeBps;
    const totalValue = Math.floor((MATCH_AMOUNT * MATCH_PRICE) / ONE_KWH);
    const fee = Math.floor((totalValue * feeBps) / 10_000);

    expect(tokenAmount(escrowPda(buyerKp.publicKey, energyMint)),
      "buyer receives the energy").to.eq(MATCH_AMOUNT);
    expect(tokenAmount(escrowPda(sellerKp.publicKey, energyMint)),
      "seller's energy escrow is debited").to.eq(ENERGY_FUND - MATCH_AMOUNT);
    expect(tokenAmount(escrowPda(sellerKp.publicKey, currencyMint)),
      "seller is paid net of the market fee").to.eq(totalValue - fee);
    expect(tokenAmount(escrowPda(buyerKp.publicKey, currencyMint)),
      "buyer's currency escrow is debited by the gross").to.eq(CURRENCY_FUND - totalValue);
    expect(tokenAmount(collectorPda("fee_collector")), "fee lands in the collector").to.eq(fee);
  });

  it("rejects a self-trade: one wallet on both legs (SelfTradeNotAllowed), no tokens move", async () => {
    // Same wallet buys and sells. Its two escrows are the same accounts on both legs,
    // which is exactly the round-trip the guard exists to stop.
    const solo = Keypair.generate();
    fundEscrows(solo.publicKey, solo.publicKey);
    const before = {
      cur: tokenAmount(escrowPda(solo.publicKey, currencyMint)),
      eng: tokenAmount(escrowPda(solo.publicKey, energyMint)),
    };

    const res = sendRaw(await settleIxs(leg(solo, 0, BUY_PRICE), leg(solo, 1, SELL_PRICE)));
    expect(res instanceof FailedTransactionMetadata, "self-trade must fail").to.be.true;
    expect((res as FailedTransactionMetadata).meta().logs().join("\n")).to.include("SelfTradeNotAllowed");

    expect(tokenAmount(escrowPda(solo.publicKey, currencyMint))).to.eq(before.cur);
    expect(tokenAmount(escrowPda(solo.publicKey, energyMint))).to.eq(before.eng);
  });

  // The batch path used to skip the side check entirely. A payload its owner signed as a
  // SELL is handed in as the BUYER leg here: accepted, it would debit that wallet's
  // CURRENCY escrow — the exact opposite of the intent they signed.
  it("rejects a SELL-signed payload in the buyer slot (InvalidOrderSide), no tokens move", async () => {
    fundEscrows(buyerKp.publicKey, sellerKp.publicKey);
    const before = tokenAmount(escrowPda(buyerKp.publicKey, currencyMint));

    // side = 1 (Sell) in the buyer slot, signed consistently so the Ed25519 check passes
    // and the SIDE guard is what rejects it.
    const res = sendRaw(await settleIxs(leg(buyerKp, 1, BUY_PRICE), leg(sellerKp, 1, SELL_PRICE)));
    expect(res instanceof FailedTransactionMetadata, "wrong-side buyer leg must fail").to.be.true;
    expect((res as FailedTransactionMetadata).meta().logs().join("\n")).to.include("InvalidOrderSide");
    expect(tokenAmount(escrowPda(buyerKp.publicKey, currencyMint))).to.eq(before);
  });

  it("rejects a BUY-signed payload in the seller slot (InvalidOrderSide)", async () => {
    fundEscrows(buyerKp.publicKey, sellerKp.publicKey);
    const res = sendRaw(await settleIxs(leg(buyerKp, 0, BUY_PRICE), leg(sellerKp, 0, SELL_PRICE)));
    expect(res instanceof FailedTransactionMetadata, "wrong-side seller leg must fail").to.be.true;
    expect((res as FailedTransactionMetadata).meta().logs().join("\n")).to.include("InvalidOrderSide");
  });

  // An order its owner let lapse must not settle in a batch when it could not settle
  // alone — the single-match path has always enforced this.
  it("rejects an expired buyer leg (OrderExpired), no tokens move", async () => {
    fundEscrows(buyerKp.publicKey, sellerKp.publicKey);
    const before = tokenAmount(escrowPda(buyerKp.publicKey, currencyMint));

    const expired = leg(buyerKp, 0, BUY_PRICE, { expiresAt: NOW - 1 });
    const res = sendRaw(await settleIxs(expired, leg(sellerKp, 1, SELL_PRICE)));
    expect(res instanceof FailedTransactionMetadata, "expired buyer leg must fail").to.be.true;
    expect((res as FailedTransactionMetadata).meta().logs().join("\n")).to.include("OrderExpired");
    expect(tokenAmount(escrowPda(buyerKp.publicKey, currencyMint))).to.eq(before);
  });

  it("rejects an expired seller leg (OrderExpired)", async () => {
    fundEscrows(buyerKp.publicKey, sellerKp.publicKey);
    const expired = leg(sellerKp, 1, SELL_PRICE, { expiresAt: NOW - 1 });
    const res = sendRaw(await settleIxs(leg(buyerKp, 0, BUY_PRICE), expired));
    expect(res instanceof FailedTransactionMetadata, "expired seller leg must fail").to.be.true;
    expect((res as FailedTransactionMetadata).meta().logs().join("\n")).to.include("OrderExpired");
  });

  // ── The SINGLE-match path (settle_offchain_match) ──────────────────────────
  // A separate instruction with its own context, so the batch cases above say nothing
  // about it. Same happy-path-first discipline: prove the wiring settles, then prove the
  // guard rejects.
  it("single path: an honest cross settles", async () => {
    fundEscrows(buyerKp.publicKey, sellerKp.publicKey);
    const meta = send(await settleSingleIxs(leg(buyerKp, 0, BUY_PRICE), leg(sellerKp, 1, SELL_PRICE)));
    console.log(`  [CU] settle_offchain_match (1 match) = ${Number(meta!.computeUnitsConsumed()).toLocaleString()} CU`);

    const feeBps = trading.coder.accounts.decode(
      "market", Buffer.from(svm.getAccount(marketPda)!.data)).marketFeeBps;
    const totalValue = Math.floor((MATCH_AMOUNT * MATCH_PRICE) / ONE_KWH);

    expect(tokenAmount(escrowPda(buyerKp.publicKey, energyMint)),
      "buyer receives the energy").to.eq(MATCH_AMOUNT);
    expect(tokenAmount(escrowPda(sellerKp.publicKey, currencyMint)),
      "seller is paid net of the market fee")
      .to.eq(totalValue - Math.floor((totalValue * feeBps) / 10_000));
  });

  // A same-wallet self-trade CANNOT settle here — but note WHICH mechanism stops it, since
  // it is not the SelfTradeNotAllowed guard. On this path the escrows are named context
  // fields, so one wallet on both legs makes buyer_currency_escrow and
  // seller_currency_escrow the SAME address, and Anchor's duplicate-mutable-account check
  // (ConstraintDuplicateMutableAccount, 2040) rejects the tx during try_accounts — before
  // the handler body, hence before the guard. The explicit guard is therefore
  // defense-in-depth here and unreachable for this case; it is genuinely load-bearing on
  // the BATCH path, which takes escrows through remaining_accounts where Anchor applies no
  // such constraint (proven by mutation: removing it there lets a self-trade settle).
  // Asserting the real error keeps this test honest — if a refactor ever routes these
  // escrows through remaining_accounts, this assertion flips and the guard becomes the
  // thing that must catch it.
  it("single path: cannot settle a same-wallet self-trade (stopped in account validation)", async () => {
    const solo = Keypair.generate();
    fundEscrows(solo.publicKey, solo.publicKey);
    const before = {
      cur: tokenAmount(escrowPda(solo.publicKey, currencyMint)),
      eng: tokenAmount(escrowPda(solo.publicKey, energyMint)),
    };

    const res = sendRaw(await settleSingleIxs(leg(solo, 0, BUY_PRICE), leg(solo, 1, SELL_PRICE)));
    expect(res instanceof FailedTransactionMetadata, "self-trade must not settle").to.be.true;
    expect((res as FailedTransactionMetadata).meta().logs().join("\n"))
      .to.include("ConstraintDuplicateMutableAccount");

    expect(tokenAmount(escrowPda(solo.publicKey, currencyMint))).to.eq(before.cur);
    expect(tokenAmount(escrowPda(solo.publicKey, energyMint))).to.eq(before.eng);
  });

  // Expiry is a strict `<` against the clock: exactly-at-expiry is already lapsed, one
  // second later is still live. Pins the boundary so a `<=` slip is caught.
  it("expiry boundary: expires_at == now is lapsed, now + 1 still settles", async () => {
    fundEscrows(buyerKp.publicKey, sellerKp.publicKey);
    const atNow = sendRaw(await settleIxs(
      leg(buyerKp, 0, BUY_PRICE, { expiresAt: NOW }), leg(sellerKp, 1, SELL_PRICE)));
    expect(atNow instanceof FailedTransactionMetadata, "expires_at == now must be lapsed").to.be.true;
    expect((atNow as FailedTransactionMetadata).meta().logs().join("\n")).to.include("OrderExpired");

    send(await settleIxs(
      leg(buyerKp, 0, BUY_PRICE, { expiresAt: NOW + 1 }), leg(sellerKp, 1, SELL_PRICE)));
    expect(tokenAmount(escrowPda(buyerKp.publicKey, energyMint)),
      "the still-live order settles").to.eq(MATCH_AMOUNT);
  });
});
