// Litesvm negative-coverage for trading `settle_offchain_match`'s validation guards,
// most previously untested. The first full-match settle harness that boots the trading
// market, the energy Token-2022 mint, and the treasury entirely in-process (no live
// validator): init market+zone+shards+collectors+escrows, sign an off-chain match with
// two Ed25519 precompile ixs, then settle. One valid-match template (`buildSettleIxs`)
// drives both a positive control and each guard case via field overrides; the Ed25519
// messages regenerate from the payloads so signatures stay valid while the on-chain
// check rejects the bad parameter.
//
// Guards asserted:
//   - TreasuryCurrencyMismatch (6030): treasury passed but currency != treasury.thbg_mint
//     → reverts at require_keys_eq! (settle_offchain.rs:474) BEFORE any record CPI.
//   - SlippageExceeded: match_price outside [seller_limit, buyer_limit] (both directions).
//   - InvalidOrderSide: a payload with the wrong side flag.
//   - InvalidAmount: a zero match amount.
//   - CapacityExceeded: a cross-zone match overrunning the zone's wheeling capacity.
//
// The ~23-account settle is compressed through a hand-built ALT (see sendV0/installAlt):
// a v0 message can't serialize >1232 bytes even in litesvm (web3.js caps the buffer).

import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import * as anchorPkg from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { EnergyToken } from "../target/types/energy_token";
import { Treasury } from "../target/types/treasury";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableProgram,
  AddressLookupTableAccount,
  Ed25519Program,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
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
const energyIdl = require("../target/idl/energy_token.json");
const treasuryIdl = require("../target/idl/treasury.json");

const ZONE = 0; // intra-zone match → capacity throttle exempt (settle_offchain.rs:369)
let shardByte = 0;
const MATCH_AMOUNT = 100;
const MATCH_PRICE = 50; // total currency = 100*50 = 5000

// Mirrors OffchainOrderPayload::get_message() byte layout in settle_offchain.rs.
function orderMessage(p: {
  orderId: Buffer;
  user: PublicKey;
  energyAmount: number;
  pricePerKwh: number;
  side: number;
  zoneId: number;
  expiresAt: number;
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

describe("trading settle_offchain_match — validation guards (litesvm)", () => {
  let svm: LiteSVM;
  let trading: Program<Trading>;
  let energy: Program<EnergyToken>;
  let treasury: Program<Treasury>;
  let tradingId: PublicKey;
  let energyId: PublicKey;
  let treasuryId: PublicKey;

  const payer = Keypair.generate(); // authority / fee payer / mint authority
  const buyer = Keypair.generate();
  const seller = Keypair.generate();
  const grxMint = Keypair.generate(); // external GRX mint for treasury init (irrelevant to 6030)
  const currencyMintKp = Keypair.generate(); // classic-SPL currency mint M (NOT THBG)

  let currencyMint: PublicKey;
  let marketPda: PublicKey;
  let zoneMarketPda: PublicKey;
  let marketAuthorityPda: PublicKey;
  let marketShardPda: PublicKey;
  let zoneShardPda: PublicKey;
  let energyMintPda: PublicKey;
  let energyInfoPda: PublicKey;
  let treasuryPda: PublicKey;
  let thbgMint: PublicKey;

  // A separate low-capacity zone (zone 7, capacity 50) for the cross-zone CapacityExceeded case.
  const LOW_ZONE = 7;
  const LOW_CAP = 50;
  let lowZonePda: PublicKey;
  let lowZoneShardPda: PublicKey;

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

  // Build an Address Lookup Table directly in litesvm via setAccount — the ~23-account
  // settle ix can't fit a v0 message (web3.js hardcodes a 1232-byte serialize buffer)
  // without compressing non-signer accounts to 1-byte ALT indices. Constructing the
  // table account by hand skips the create+extend+slot-advance RPC dance.
  function installAlt(addrs: PublicKey[]): AddressLookupTableAccount {
    const altKey = Keypair.generate().publicKey;
    const data = Buffer.alloc(56 + 32 * addrs.length);
    data.writeUInt32LE(1, 0); // ProgramState::LookupTable
    data.writeBigUInt64LE(0xffffffffffffffffn, 4); // deactivation_slot = never
    data.writeBigUInt64LE(0n, 12); // last_extended_slot (< current bank slot → active)
    data.writeUInt8(0, 20); // last_extended_slot_start_index
    data.writeUInt8(1, 21); // Option<authority> = Some
    payer.publicKey.toBuffer().copy(data, 22);
    addrs.forEach((a, i) => a.toBuffer().copy(data, 56 + 32 * i));
    svm.setAccount(altKey, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data,
      owner: AddressLookupTableProgram.programId,
      executable: false,
      rentEpoch: 0,
    } as any);
    return new AddressLookupTableAccount({
      key: altKey,
      state: {
        deactivationSlot: 0xffffffffffffffffn,
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: payer.publicKey,
        addresses: addrs,
      },
    });
  }

  // The settle tx (~23 accounts + 2 Ed25519 ixs) overflows the 1232-byte v0 serialize
  // buffer; compress every non-signer account through an ALT. `expectFail` flips the
  // success/failure expectation. litesvm itself has no transport-packet limit.
  function sendV0(ixs: TransactionInstruction[], expectFail: boolean): string {
    const settleKeys = ixs[ixs.length - 1].keys
      .filter((k) => !k.isSigner)
      .map((k) => k.pubkey);
    const altAddrs = [...new Set(settleKeys.map((p) => p.toBase58()))].map((s) => new PublicKey(s));
    const alt = installAlt(altAddrs);
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: svm.latestBlockhash(),
      instructions: ixs,
    }).compileToV0Message([alt]);
    const vtx = new VersionedTransaction(msg);
    vtx.sign([payer]);
    const res = svm.sendTransaction(vtx);
    svm.expireBlockhash();
    const failed = res instanceof FailedTransactionMetadata;
    if (expectFail && !failed) throw new Error("expected tx to fail but it succeeded");
    if (!expectFail && failed) {
      throw new Error("tx failed: " + (res as FailedTransactionMetadata).err().toString() + "\n" + (res as FailedTransactionMetadata).meta().logs().join("\n"));
    }
    return failed ? (res as FailedTransactionMetadata).err().toString() + "\n" + (res as FailedTransactionMetadata).meta().logs().join("\n") : "";
  }

  const tpda = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, tradingId)[0];
  const escrowPda = (user: PublicKey, mint: PublicKey) =>
    tpda([Buffer.from("escrow"), user.toBuffer(), mint.toBuffer()]);
  const collectorPda = (label: string, mint: PublicKey) =>
    tpda([Buffer.from(label), mint.toBuffer()]);
  const nullifierPda = (user: PublicKey, orderId: Buffer) =>
    tpda([Buffer.from("nullifier"), user.toBuffer(), orderId]);

  async function depositEscrow(user: Keypair, mint: PublicKey, wallet: PublicKey, amount: number, prog: PublicKey) {
    const ix = await trading.methods
      .depositEscrow(new BN(amount))
      .accounts({
        user: user.publicKey,
        mint,
        userWallet: wallet,
        userEscrow: escrowPda(user.publicKey, mint),
        marketAuthority: marketAuthorityPda,
        tokenProgram: prog,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();
    send([ix], [user]);
  }

  // Build the [buyerEd, sellerEd, settleIx] instruction set for a settle. `o` overrides
  // let one valid-match template drive both the happy path and every negative guard case
  // — the Ed25519 messages are regenerated from the (possibly overridden) payload fields,
  // so signatures stay valid while the on-chain validation rejects the bad parameter.
  async function buildSettleIxs(
    withTreasury: boolean,
    o: {
      seedA?: number; seedB?: number;
      buyerSide?: number; sellerSide?: number;
      buyerZone?: number; sellerZone?: number;
      buyerExpires?: number; sellerExpires?: number;
      energyAmount?: number; matchAmount?: number; matchPrice?: number;
      zoneMarket?: PublicKey; zoneShard?: PublicKey;
    } = {}
  ): Promise<TransactionInstruction[]> {
    const seedA = o.seedA ?? 0xa1, seedB = o.seedB ?? 0xb2;
    const buyerSide = o.buyerSide ?? 0, sellerSide = o.sellerSide ?? 1;
    const buyerZone = o.buyerZone ?? ZONE, sellerZone = o.sellerZone ?? ZONE;
    const buyerExpires = o.buyerExpires ?? 0, sellerExpires = o.sellerExpires ?? 0;
    const energyAmount = o.energyAmount ?? MATCH_AMOUNT;
    const matchAmount = o.matchAmount ?? MATCH_AMOUNT;
    const matchPrice = o.matchPrice ?? MATCH_PRICE;
    const zoneMarket = o.zoneMarket ?? zoneMarketPda;
    const zoneShard = o.zoneShard ?? zoneShardPda;

    const buyerOrderId = Buffer.alloc(16); buyerOrderId.writeUInt32LE(seedA, 0);
    const sellerOrderId = Buffer.alloc(16); sellerOrderId.writeUInt32LE(seedB, 0);

    const buyerMsg = orderMessage({ orderId: buyerOrderId, user: buyer.publicKey, energyAmount, pricePerKwh: 60, side: buyerSide, zoneId: buyerZone, expiresAt: buyerExpires });
    const sellerMsg = orderMessage({ orderId: sellerOrderId, user: seller.publicKey, energyAmount, pricePerKwh: 50, side: sellerSide, zoneId: sellerZone, expiresAt: sellerExpires });
    const buyerEd = Ed25519Program.createInstructionWithPrivateKey({ privateKey: buyer.secretKey, message: buyerMsg });
    const sellerEd = Ed25519Program.createInstructionWithPrivateKey({ privateKey: seller.secretKey, message: sellerMsg });

    const buyerPayload = { orderId: [...buyerOrderId], user: buyer.publicKey, energyAmount: new BN(energyAmount), pricePerKwh: new BN(60), side: buyerSide, zoneId: buyerZone, expiresAt: new BN(buyerExpires) };
    const sellerPayload = { orderId: [...sellerOrderId], user: seller.publicKey, energyAmount: new BN(energyAmount), pricePerKwh: new BN(50), side: sellerSide, zoneId: sellerZone, expiresAt: new BN(sellerExpires) };

    const settleIx = await trading.methods
      .settleOffchainMatch(buyerPayload as any, sellerPayload as any, new BN(matchAmount), new BN(matchPrice), new BN(1), new BN(1))
      .accounts({
        market: marketPda,
        zoneMarket,
        buyerNullifier: nullifierPda(buyer.publicKey, buyerOrderId),
        sellerNullifier: nullifierPda(seller.publicKey, sellerOrderId),
        currencyMint,
        energyMint: energyMintPda,
        marketAuthority: marketAuthorityPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
        buyerCurrencyEscrow: escrowPda(buyer.publicKey, currencyMint),
        sellerCurrencyEscrow: escrowPda(seller.publicKey, currencyMint),
        sellerEnergyEscrow: escrowPda(seller.publicKey, energyMintPda),
        buyerEnergyEscrow: escrowPda(buyer.publicKey, energyMintPda),
        feeCollector: collectorPda("fee_collector", currencyMint),
        wheelingCollector: collectorPda("wheeling_collector", currencyMint),
        lossCollector: collectorPda("loss_collector", currencyMint),
        marketShard: marketShardPda,
        zoneShard,
        payer: payer.publicKey,
        sysvarInstructions: anchorPkg.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
        treasuryProgram: withTreasury ? treasuryId : null,
        treasuryState: withTreasury ? treasuryPda : null,
      } as any)
      .instruction();

    return [buyerEd, sellerEd, settleIx];
  }

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    trading = new Program(tradingIdl, { connection: {}, publicKey: PublicKey.default } as any);
    energy = new Program(energyIdl, { connection: {}, publicKey: PublicKey.default } as any);
    treasury = new Program(treasuryIdl, { connection: {}, publicKey: PublicKey.default } as any);
    tradingId = trading.programId;
    energyId = energy.programId;
    treasuryId = treasury.programId;
    svm.addProgramFromFile(tradingId, "target/deploy/trading.so");
    svm.addProgramFromFile(energyId, "target/deploy/energy_token.so");
    svm.addProgramFromFile(treasuryId, "target/deploy/treasury.so");

    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));
    svm.airdrop(buyer.publicKey, BigInt(10_000_000_000));
    svm.airdrop(seller.publicKey, BigInt(10_000_000_000));

    currencyMint = currencyMintKp.publicKey;
    [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingId);
    [zoneMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(ZONE).toArrayLike(Buffer, "le", 4)], tradingId);
    [marketAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("market_authority")], tradingId);
    // Settlement derives both shards from the PAYER key (get_shard_id = payer[0] % num_shards).
    shardByte = payer.publicKey.toBuffer()[0] % 16;
    [marketShardPda] = PublicKey.findProgramAddressSync([Buffer.from("market_shard"), marketPda.toBuffer(), Buffer.from([shardByte])], tradingId);
    [zoneShardPda] = PublicKey.findProgramAddressSync([Buffer.from("zone_shard"), zoneMarketPda.toBuffer(), Buffer.from([shardByte])], tradingId);
    [energyMintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], energyId);
    [energyInfoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], energyId);
    [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], treasuryId);
    [thbgMint] = PublicKey.findProgramAddressSync([Buffer.from("thbg_mint")], treasuryId);

    // --- currency mint M (classic SPL, 6 dp, payer = mint authority). NOT the THBG mint. ---
    const mintRent = Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)));
    send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: currencyMint, lamports: mintRent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(currencyMint, 6, payer.publicKey, null, TOKEN_PROGRAM_ID),
    ], [currencyMintKp]);

    // --- external GRX mint (Token-2022, 9 dp) for treasury init ---
    send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: grxMint.publicKey, lamports: mintRent, space: MINT_SIZE, programId: TOKEN_2022_PROGRAM_ID }),
      createInitializeMint2Instruction(grxMint.publicKey, 9, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    ], [grxMint]);

    // --- energy Token-2022 mint + token_info (registry_authority = payer so mint_to_wallet authorizes) ---
    const initEnergy = await energy.methods
      .initializeToken(PublicKey.default, payer.publicKey)
      .accounts({
        tokenInfo: energyInfoPda,
        mint: energyMintPda,
        authority: payer.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        rent: anchorPkg.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .instruction();
    send([initEnergy], []);

    // --- treasury: thbg_mint = [b"thbg_mint"] (the mint 6030 demands the currency equal) ---
    const initTreasury = await treasury.methods
      .initialize(payer.publicKey, marketAuthorityPda, new BN(4_000_000), 25, new BN(3600))
      .accounts({
        treasury: treasuryPda,
        grxMint: grxMint.publicKey,
        thbgMint,
        swapVault: PublicKey.findProgramAddressSync([Buffer.from("swap_vault")], treasuryId)[0],
        stakeVault: PublicKey.findProgramAddressSync([Buffer.from("stake_vault")], treasuryId)[0],
        rewardVault: PublicKey.findProgramAddressSync([Buffer.from("reward_vault")], treasuryId)[0],
        authority: payer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchorPkg.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .instruction();
    send([initTreasury], []);

    // --- trading market + zone + shards + collectors ---
    send([await trading.methods.initializeMarket(16).accounts({ market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()], []);
    send([await trading.methods.initializeZoneMarket(ZONE, 16, new BN(1_000_000)).accounts({ market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()], []);
    // Low-cap zone for the CapacityExceeded case.
    [lowZonePda] = PublicKey.findProgramAddressSync([Buffer.from("zone_market"), marketPda.toBuffer(), new BN(LOW_ZONE).toArrayLike(Buffer, "le", 4)], tradingId);
    [lowZoneShardPda] = PublicKey.findProgramAddressSync([Buffer.from("zone_shard"), lowZonePda.toBuffer(), Buffer.from([shardByte])], tradingId);
    send([await trading.methods.initializeZoneMarket(LOW_ZONE, 16, new BN(LOW_CAP)).accounts({ market: marketPda, zoneMarket: lowZonePda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()], []);
    send([await trading.methods.initializeZoneMarketShard(shardByte).accounts({ zoneMarket: lowZonePda, zoneShard: lowZoneShardPda, payer: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()], []);
    send([await trading.methods.initializeMarketShard(shardByte).accounts({ market: marketPda, marketShard: marketShardPda, payer: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()], []);
    send([await trading.methods.initializeZoneMarketShard(shardByte).accounts({ zoneMarket: zoneMarketPda, zoneShard: zoneShardPda, payer: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()], []);
    send([await trading.methods.initializeCollectors().accounts({ payer: payer.publicKey, currencyMint, feeCollector: collectorPda("fee_collector", currencyMint), wheelingCollector: collectorPda("wheeling_collector", currencyMint), lossCollector: collectorPda("loss_collector", currencyMint), marketAuthority: marketAuthorityPda, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId } as any).instruction()], []);

    // --- fund + deposit escrows ---
    // Buyer: currency wallet (5000 for trade + receiving energy escrow seed).
    const buyerCurAta = getAssociatedTokenAddressSync(currencyMint, buyer.publicKey, false, TOKEN_PROGRAM_ID);
    const buyerEngAta = getAssociatedTokenAddressSync(energyMintPda, buyer.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const sellerEngAta = getAssociatedTokenAddressSync(energyMintPda, seller.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const sellerCurAta = getAssociatedTokenAddressSync(currencyMint, seller.publicKey, false, TOKEN_PROGRAM_ID);

    send([
      createAssociatedTokenAccountInstruction(payer.publicKey, buyerCurAta, buyer.publicKey, currencyMint, TOKEN_PROGRAM_ID),
      createMintToInstruction(currencyMint, buyerCurAta, payer.publicKey, 10_000, [], TOKEN_PROGRAM_ID),
      createAssociatedTokenAccountInstruction(payer.publicKey, sellerCurAta, seller.publicKey, currencyMint, TOKEN_PROGRAM_ID),
      createMintToInstruction(currencyMint, sellerCurAta, payer.publicKey, 10, [], TOKEN_PROGRAM_ID),
    ], []);

    // Energy ATAs must exist before mint_to_wallet (it does not create the destination).
    send([
      createAssociatedTokenAccountInstruction(payer.publicKey, sellerEngAta, seller.publicKey, energyMintPda, TOKEN_2022_PROGRAM_ID),
      createAssociatedTokenAccountInstruction(payer.publicKey, buyerEngAta, buyer.publicKey, energyMintPda, TOKEN_2022_PROGRAM_ID),
    ], []);

    // Energy wallets via the energy program's mint_to_wallet (seller gets 200, buyer 1 to seed escrow).
    const mintEnergy = async (dest: PublicKey, owner: PublicKey, amount: number) => {
      const ix = await energy.methods
        .mintToWallet(new BN(amount))
        .accounts({
          mint: energyMintPda,
          tokenInfo: energyInfoPda,
          destination: dest,
          destinationOwner: owner,
          authority: payer.publicKey,
          recValidator: null,
          payer: payer.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .instruction();
      send([ix], []);
    };
    await mintEnergy(sellerEngAta, seller.publicKey, 200);
    await mintEnergy(buyerEngAta, buyer.publicKey, 1);

    // Deposits: buyer currency 5000 + energy 1 (receiving seed); seller energy 200 + currency 1 (receiving seed).
    await depositEscrow(buyer, currencyMint, buyerCurAta, 5_000, TOKEN_PROGRAM_ID);
    await depositEscrow(buyer, energyMintPda, buyerEngAta, 1, TOKEN_2022_PROGRAM_ID);
    await depositEscrow(seller, energyMintPda, sellerEngAta, 200, TOKEN_2022_PROGRAM_ID);
    await depositEscrow(seller, currencyMint, sellerCurAta, 1, TOKEN_PROGRAM_ID);

    // Advance the bank slot so the hand-built ALTs (last_extended_slot = 0) resolve as active.
    svm.warpToSlot(100n);
  });

  it("rejects settle when treasury is passed but currency != treasury.thbg_mint (6030)", async () => {
    expect(currencyMint.toBase58()).to.not.equal(thbgMint.toBase58()); // precondition
    const blob = sendV0(await buildSettleIxs(true), true);
    expect(blob, blob).to.match(/TreasuryCurrencyMismatch|6030|0x178e/);
  });

  it("settles the same match when treasury is omitted (non-THBG currency, control)", async () => {
    // Proves the constructed match is valid end-to-end — so the 6030 case above
    // isolates the currency guard, not an unrelated setup error.
    sendV0(await buildSettleIxs(false), false);

    const sellerCurEscrow = escrowPda(seller.publicKey, currencyMint);
    const buyerEngEscrow = escrowPda(buyer.publicKey, energyMintPda);
    // total = 100*50 = 5000; fee=12, wheeling=1, loss=1 → seller nets 4986 (+1 seed).
    const sc = svm.getAccount(sellerCurEscrow)!;
    const sellerCurAmt = Buffer.from(sc.data).readBigUInt64LE(64); // SPL token amount @ offset 64
    expect(sellerCurAmt.toString()).to.equal((1n + 4986n).toString());
    const be = svm.getAccount(buyerEngEscrow)!;
    const buyerEngAmt = Buffer.from(be.data).readBigUInt64LE(64);
    expect(buyerEngAmt.toString()).to.equal((1n + BigInt(MATCH_AMOUNT)).toString());
  });

  // --- Negative coverage for the other settle-path guards (all previously untested).
  // Each reverts before any escrow transfer, so they use distinct order ids but need no
  // extra funding. The Ed25519 sigs stay valid because messages regenerate from payloads.

  it("rejects match_price above the buyer's limit (SlippageExceeded)", async () => {
    const blob = sendV0(await buildSettleIxs(false, { seedA: 0x11, seedB: 0x12, matchPrice: 70 }), true);
    expect(blob, blob).to.match(/SlippageExceeded/);
  });

  it("rejects match_price below the seller's limit (SlippageExceeded)", async () => {
    const blob = sendV0(await buildSettleIxs(false, { seedA: 0x13, seedB: 0x14, matchPrice: 40 }), true);
    expect(blob, blob).to.match(/SlippageExceeded/);
  });

  it("rejects a buyer payload with the wrong side (InvalidOrderSide)", async () => {
    const blob = sendV0(await buildSettleIxs(false, { seedA: 0x15, seedB: 0x16, buyerSide: 1 }), true);
    expect(blob, blob).to.match(/InvalidOrderSide/);
  });

  it("rejects a zero match amount (InvalidAmount)", async () => {
    const blob = sendV0(await buildSettleIxs(false, { seedA: 0x17, seedB: 0x18, matchAmount: 0 }), true);
    expect(blob, blob).to.match(/InvalidAmount/);
  });

  it("rejects a cross-zone match that overruns the zone capacity (CapacityExceeded)", async () => {
    // Cross-zone (both legs in zone 8) settled against the low-cap zone 7 (capacity 50):
    // committed_flow 0 + match_amount 60 > 50 → throttled. Fires before any transfer.
    const blob = sendV0(await buildSettleIxs(false, {
      seedA: 0x19, seedB: 0x1a,
      buyerZone: 8, sellerZone: 8,
      energyAmount: 100, matchAmount: 60,
      zoneMarket: lowZonePda, zoneShard: lowZoneShardPda,
    }), true);
    expect(blob, blob).to.match(/CapacityExceeded/);
  });

  it("rejects re-settling an already-filled order (replay / double-settle)", async () => {
    // The control test settled order a1/b2 — the buyer nullifier now records filled=100
    // (= energy_amount), so remaining is 0. Re-submitting the SAME order ids reverts at
    // the per-order replay guard (match_amount > remaining → InvalidAmount), proving the
    // nullifier blocks double-settlement of a signed order.
    const blob = sendV0(await buildSettleIxs(false), true); // default seeds a1/b2
    expect(blob, blob).to.match(/InvalidAmount/);
  });

  // Keep last: this mutates the bank clock, which would shift expiry for any later test.
  it("rejects a settle past the order's expiry (OrderExpired)", async () => {
    const c = svm.getClock();
    svm.setClock(new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, 1_000_000n));
    const blob = sendV0(await buildSettleIxs(false, { seedA: 0x1b, seedB: 0x1c, buyerExpires: 500_000 }), true);
    expect(blob, blob).to.match(/OrderExpired/);
  });
});
