// §2b batch settlement on a THBG market: exercises
// trading::batch_settle_offchain_match -> treasury::record_settlement_batch,
// which writes a per-(zone,batch) SettlementRecord (Merkle root + VAT) and bumps
// total_settled_thbg.
//
// ✅ RUNTIME-VERIFIED on a live validator (Solana 3.1.10) — 1/1 green.
// Run via the recipe in docs/proposed/implementation-plan.md. IMPORTANT:
// rebuild + redeploy the CURRENT trading.so first (Anchor 1.0 emits to
// programs/trading/target/deploy/ — copy to target/deploy/ before deploy):
//   SOLANA_VALIDATOR_TTL=0 just solana-up
//   (cd programs/trading && cargo build-sbf)
//   cp programs/trading/target/deploy/trading.so target/deploy/trading.so
//   anchor deploy --provider.cluster http://localhost:8899   # or solana program deploy
//   npx tsx scripts/bootstrap.ts && npx tsx scripts/init-treasury.ts
//   npx mocha -r tsx tests/batch_settle_thbg.ts --timeout 1000000
//
// Getting here took four fixes (three test-side, one program-side):
//   1. fundThbg: arg is a THBG *target*; overfund GRX ~300× to clear the
//      grx_per_thbg_rate (×0.004) + 25 bps fee (was funding ~40 THBG when 10k
//      was deposited → TransferChecked insufficient funds).
//   2. createAtaFor → idempotent (energy ATAs were created twice for sellers).
//   3. Legacy Transaction ctor: `recentBlockhash`, not `blockhash` (the ALT
//      bootstrap txs were unsigned otherwise).
//   4. PROGRAM FIX (settle_offchain.rs): the batch path reads each OrderNullifier
//      via Account::try_from and only updated filled_amount — it never created
//      the PDA (the single path uses init_if_needed, which remaining_accounts
//      can't). batch_settle_offchain_match now creates+seeds a fresh nullifier
//      in-loop via a signed system create_account CPI (ensure_nullifier_initialized),
//      so fresh off-chain matches settle. Previously failed with 3012.
//
// Note: a stale deployed binary will resurface the old
// remaining_accounts.len() == match_count*6 failure — always redeploy current.

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { EnergyToken } from "../target/types/energy_token";
import { Treasury } from "../target/types/treasury";
import { Governance } from "../target/types/governance";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableProgram,
  LAMPORTS_PER_SOL,
  Ed25519Program,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";
import { settlementRecordPda } from "../scripts/settlement-pda";

// Mirrors OffchainOrderPayload::get_message() in settle_offchain.rs.
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

describe("batch_settle THBG (§2b, runtime-verified)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const trading = anchor.workspace.Trading as Program<Trading>;
  const energy = anchor.workspace.EnergyToken as Program<EnergyToken>;
  const treasury = anchor.workspace.Treasury as Program<Treasury>;
  const authority = provider.wallet.publicKey;
  const governance = anchor.workspace.Governance as Program<Governance>;
  // Governance poa_config gates settlement (0.3); bootstrap.ts inits it (operational).
  const [governanceConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], governance.programId);
  const payer = (provider.wallet as any).payer as Keypair;

  const zoneId = 0;
  // Unique per run: the SettlementRecord PDA is seeded by (zone, batch) and the
  // local validator ledger persists across runs — a fixed id collides on re-run.
  const batchId = new BN(Date.now() % 1_000_000);

  const tpda = (p: Program<any>, seed: string) =>
    PublicKey.findProgramAddressSync([Buffer.from(seed)], p.programId)[0];

  const marketPda = tpda(trading, "market");
  const marketAuthorityPda = tpda(trading, "market_authority");
  const energyMintPda = tpda(energy, "mint_2022");
  const energyInfoPda = tpda(energy, "token_info_2022");
  const treasuryPda = tpda(treasury, "treasury");
  const thbgMint = tpda(treasury, "thbg_mint");
  const swapVault = tpda(treasury, "swap_vault");
  const zoneMarketPda = PublicKey.findProgramAddressSync(
    [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(zoneId).toArrayLike(Buffer, "le", 4)],
    trading.programId
  )[0];

  const escrowPda = (user: PublicKey, mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("escrow"), user.toBuffer(), mint.toBuffer()], trading.programId)[0];
  const collectorPda = (label: string) =>
    PublicKey.findProgramAddressSync([Buffer.from(label), thbgMint.toBuffer()], trading.programId)[0];
  // §2c Part B: the batch settle path now writes to SHARDED collectors keyed by
  // `payer[0] % NUM_SETTLE_SHARDS` (payer = authority here), and bumps the matching
  // treasury settlement-accumulator shard instead of the global total.
  const NUM_SETTLE_SHARDS = 16;
  const settleShardByte = authority.toBuffer()[0] % NUM_SETTLE_SHARDS;
  const shardedCollectorPda = (label: string) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from(label), thbgMint.toBuffer(), Buffer.from([settleShardByte])],
      trading.programId
    )[0];
  const settleShardPda = PublicKey.findProgramAddressSync(
    [Buffer.from("settle_shard"), Buffer.from([settleShardByte])],
    treasury.programId
  )[0];
  const nullifierPda = (user: PublicKey, orderId: Buffer) =>
    PublicKey.findProgramAddressSync([Buffer.from("nullifier"), user.toBuffer(), orderId], trading.programId)[0];

  // GRX (energy mint) and THBG are both Token-2022; ATAs/escrows use that program.
  const ata = (mint: PublicKey, owner: PublicKey) =>
    getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);

  async function mintEnergyTo(dest: PublicKey, owner: PublicKey, amount: number) {
    await energy.methods.mintToWallet(new BN(amount)).accounts({
      mint: energyMintPda, tokenInfo: energyInfoPda, destination: dest, destinationOwner: owner,
      authority, recValidator: authority, payer: authority, tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any).rpc();
  }

  // Fresh keypair funded with SOL; returns it. (ATAs created on demand.)
  async function freshUser(): Promise<Keypair> {
    const kp = Keypair.generate();
    await provider.sendAndConfirm(new Transaction().add(
      SystemProgram.transfer({ fromPubkey: authority, toPubkey: kp.publicKey, lamports: 0.3 * LAMPORTS_PER_SOL })
    ));
    return kp;
  }

  async function createAtaFor(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
    const a = ata(mint, owner);
    // Idempotent: some owners get the same ATA created twice (e.g. an energy ATA
    // made directly, then again inside fundThbg) — don't fail on the second pass.
    await provider.sendAndConfirm(new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(authority, a, owner, mint, TOKEN_2022_PROGRAM_ID)
    ));
    return a;
  }

  async function deposit(kp: Keypair, walletAta: PublicKey, mint: PublicKey, amount: number) {
    await trading.methods.depositEscrow(new BN(amount)).accounts({
      user: kp.publicKey, mint, userWallet: walletAta, userEscrow: escrowPda(kp.publicKey, mint),
      marketAuthority: marketAuthorityPda, tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any).signers([kp]).rpc();
  }

  // Give `user` at least `thbgTarget` THBG by minting GRX → swapping GRX→THBG.
  // swap_grx_for_thbg: thbg_out = grx_in × grx_per_thbg_rate / 1e9 − fee, with
  // rate = 4_000_000 (⇒ ×0.004) and a 25 bps fee. So ~250 GRX yields ~1 THBG;
  // overfund GRX 300× the THBG target to clear the rate + fee with margin.
  async function fundThbg(kp: Keypair, thbgTarget: number): Promise<PublicKey> {
    const grx = thbgTarget * 300;
    const grxAta = await createAtaFor(energyMintPda, kp.publicKey);
    await mintEnergyTo(grxAta, kp.publicKey, grx);
    const thbgAta = await createAtaFor(thbgMint, kp.publicKey);
    await treasury.methods.swapGrxForThbg(new BN(grx)).accounts({
      treasury: treasuryPda, grxMint: energyMintPda, thbgMint, swapVault,
      userGrxAta: grxAta, userThbgAta: thbgAta, user: kp.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as any).signers([kp]).rpc();
    return thbgAta;
  }

  before(async () => {
    // Assumes bootstrap.ts + init-treasury.ts already ran (treasury inited,
    // market.settlement_thbg_mint = thbgMint). Refresh the reserve attestation so
    // swaps pass the freshness + peg checks.
    await treasury.methods.updateAttestation(new BN(1_000_000_000_000)).accounts({
      treasury: treasuryPda, attestor: authority,
    } as any).rpc();

    // REC provenance is mandatory (0.5): register authority as a REC validator (idempotent).
    try {
      await energy.methods.addRecValidator(authority, "rec")
        .accounts({ tokenInfo: energyInfoPda, authority } as any).rpc();
    } catch { /* already registered */ }

    // THBG collectors for the trading market (currency = THBG). The main (unsharded)
    // collectors remain the canonical sink (sweep destination); the single settle
    // path still uses them.
    try {
      await trading.methods.initializeCollectors().accounts({
        payer: authority, currencyMint: thbgMint,
        feeCollector: collectorPda("fee_collector"), wheelingCollector: collectorPda("wheeling_collector"),
        lossCollector: collectorPda("loss_collector"), marketAuthority: marketAuthorityPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId,
      } as any).rpc();
    } catch { /* already initialized */ }

    // §2c Part B: sharded collectors for the authority's settle shard, plus the
    // treasury settlement-accumulator shard (the sharded batch path writes both).
    try {
      await trading.methods.initializeShardedCollectors(settleShardByte).accounts({
        payer: authority, currencyMint: thbgMint,
        feeCollector: shardedCollectorPda("fee_collector"), wheelingCollector: shardedCollectorPda("wheeling_collector"),
        lossCollector: shardedCollectorPda("loss_collector"), marketAuthority: marketAuthorityPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId,
      } as any).rpc();
    } catch { /* already initialized */ }
    try {
      await treasury.methods.initializeSettlementShard(settleShardByte).accounts({
        treasury: treasuryPda, shard: settleShardPda, authority,
        systemProgram: SystemProgram.programId,
      } as any).rpc();
    } catch { /* already initialized */ }
  });

  // Energy is 9-dec atomic (100 kWh = 100 * 1e9). The currency leg divides by 1e9
  // (ENERGY_AMOUNT_DECIMALS_DIVISOR, settle_offchain.rs:1081): total_value =
  // match_amount * price / 1e9 = 100e9 * 50 / 1e9 = 5000. A raw matchAmount=100
  // would round total_value to 0 (degenerate swap), so it must be atomic.
  const matchAmount = 100 * 1_000_000_000, matchPrice = 50;
  // 6-dec currency value actually settled on-chain (post-divisor).
  const currencyValue = (matchAmount * matchPrice) / 1_000_000_000; // = 5000

  // Seed buyer (THBG) + seller (energy), pre-create both receiving escrows so a
  // settle has somewhere to deliver. Returns the funded keypairs.
  async function seedUsers(): Promise<{ buyer: Keypair; seller: Keypair }> {
    const buyer = await freshUser();
    const seller = await freshUser();
    const buyerThbgAta = await fundThbg(buyer, 10_000);
    const sellerEnergyAta = await createAtaFor(energyMintPda, seller.publicKey);
    // Seller's energy escrow must hold >= matchAmount (the energy leg transfers the
    // full atomic amount, now 100e9). 200 was only enough for the old raw amount.
    await mintEnergyTo(sellerEnergyAta, seller.publicKey, matchAmount);
    await deposit(buyer, buyerThbgAta, thbgMint, 10_000);
    await deposit(seller, sellerEnergyAta, energyMintPda, matchAmount);

    // Receiving escrows (seller currency, buyer energy) must exist before settle.
    const sellerThbgAta = await fundThbg(seller, 10);
    await deposit(seller, sellerThbgAta, thbgMint, 1);
    const buyerEnergyAta = await createAtaFor(energyMintPda, buyer.publicKey);
    await mintEnergyTo(buyerEnergyAta, buyer.publicKey, 1);
    await deposit(buyer, buyerEnergyAta, energyMintPda, 1);
    return { buyer, seller };
  }

  // Build the batch settle ix (+ 2 Ed25519 verify ixs per match) and an activated
  // ALT. `withTreasury` toggles whether the optional treasury accounts are passed —
  // omitting them on a THBG market is the TreasurySettlementRequired guard.
  //
  // The batch path (settle_offchain.rs:595) verifies match i's signatures at
  // absolute instruction indices i*2 (buyer) / i*2+1 (seller), so the Ed25519 ixs
  // must precede the settle ix in that exact interleaved order:
  //   [b0, s0, b1, s1, ..., settleIx]
  // and consumes remaining_accounts in groups of 6 per match.
  async function prepareSettle(
    matches: { buyer: Keypair; seller: Keypair; buyerOrderId: Buffer; sellerOrderId: Buffer }[],
    opts: { withTreasury: boolean; thisBatchId: BN }
  ): Promise<{ edIxs: any[]; settleIx: any; alt: any; settlementRecord: PublicKey }> {
    const edIxs: any[] = [];
    const matchPairs: any[] = [];
    const remaining: any[] = [];
    for (const { buyer, seller, buyerOrderId, sellerOrderId } of matches) {
      const buyerMsg = orderMessage({ orderId: buyerOrderId, user: buyer.publicKey, energyAmount: matchAmount, pricePerKwh: 60, side: 0, zoneId, expiresAt: 0 });
      const sellerMsg = orderMessage({ orderId: sellerOrderId, user: seller.publicKey, energyAmount: matchAmount, pricePerKwh: 50, side: 1, zoneId, expiresAt: 0 });
      edIxs.push(Ed25519Program.createInstructionWithPrivateKey({ privateKey: buyer.secretKey, message: buyerMsg }));
      edIxs.push(Ed25519Program.createInstructionWithPrivateKey({ privateKey: seller.secretKey, message: sellerMsg }));

      const buyerPayload = { orderId: [...buyerOrderId], user: buyer.publicKey, energyAmount: new BN(matchAmount), pricePerKwh: new BN(60), side: 0, zoneId, expiresAt: new BN(0) };
      const sellerPayload = { orderId: [...sellerOrderId], user: seller.publicKey, energyAmount: new BN(matchAmount), pricePerKwh: new BN(50), side: 1, zoneId, expiresAt: new BN(0) };
      // Per-match trade_id (F3c) — unique per pair; keys the TradeNullifier replay guard.
      const tradeId = Buffer.concat([buyerOrderId.subarray(0, 8), sellerOrderId.subarray(0, 8)]);
      const tradeNullifier = PublicKey.findProgramAddressSync([Buffer.from("trade"), tradeId], trading.programId)[0];
      matchPairs.push({ buyerPayload, sellerPayload, matchAmount: new BN(matchAmount), matchPrice: new BN(matchPrice), wheelingCharge: new BN(1), lossCost: new BN(1), tradeId: [...tradeId] });

      // remaining_accounts per match (order from settle_offchain.rs, now 7/pair):
      // [buyer_nullifier, seller_nullifier, buyer_currency_escrow,
      //  seller_currency_escrow, seller_energy_escrow, buyer_energy_escrow, trade_nullifier]
      remaining.push(
        nullifierPda(buyer.publicKey, buyerOrderId),
        nullifierPda(seller.publicKey, sellerOrderId),
        escrowPda(buyer.publicKey, thbgMint),
        escrowPda(seller.publicKey, thbgMint),
        escrowPda(seller.publicKey, energyMintPda),
        escrowPda(buyer.publicKey, energyMintPda),
        tradeNullifier,
      );
    }
    // Pair accounts (match_count*7, incl. per-match trade_nullifier) followed by ONE trailing governance poa_config account (0.3).
    const remainingMeta = [
      ...remaining.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
      { pubkey: governanceConfigPda, isSigner: false, isWritable: false },
    ];

    // Per-payer shards.
    const marketAcct: any = await trading.account.market.fetch(marketPda);
    const zoneAcct: any = await trading.account.zoneMarket.fetch(zoneMarketPda);
    const mShardByte = authority.toBuffer()[0] % (Number(marketAcct.numShards) || 16);
    const zShardByte = authority.toBuffer()[0] % (Number(zoneAcct.numShards) || 16);
    const marketShardPda = PublicKey.findProgramAddressSync([Buffer.from("market_shard"), marketPda.toBuffer(), Buffer.from([mShardByte])], trading.programId)[0];
    const zoneShardPda = PublicKey.findProgramAddressSync([Buffer.from("zone_shard"), zoneMarketPda.toBuffer(), Buffer.from([zShardByte])], trading.programId)[0];
    try { await trading.methods.initializeMarketShard(mShardByte).accounts({ market: marketPda, marketShard: marketShardPda, payer: authority, systemProgram: SystemProgram.programId } as any).rpc(); } catch {}
    try { await trading.methods.initializeZoneMarketShard(zShardByte).accounts({ zoneMarket: zoneMarketPda, zoneShard: zoneShardPda, payer: authority, systemProgram: SystemProgram.programId } as any).rpc(); } catch {}

    const merkleRoot = Array.from({ length: 32 }, (_, i) => (i + 1) & 0xff);
    const vatAmount = new BN(Math.floor(matches.length * currencyValue * 0.07));
    const [settlementRecord] = settlementRecordPda(zoneId, opts.thisBatchId, treasury.programId);

    // Optional treasury accounts: passed as null when exercising the
    // TreasurySettlementRequired guard (THBG market + recording omitted).
    const treasuryAccts = opts.withTreasury
      ? { treasuryProgram: treasury.programId, treasuryState: treasuryPda, settlementShard: settleShardPda, settlementRecord }
      : { treasuryProgram: null, treasuryState: null, settlementShard: null, settlementRecord: null };

    const settleIx = await trading.methods
      .batchSettleOffchainMatch(matchPairs as any, merkleRoot, vatAmount, 700, opts.thisBatchId, settleShardByte)
      .accounts({
        market: marketPda, zoneMarket: zoneMarketPda, currencyMint: thbgMint, energyMint: energyMintPda,
        marketAuthority: marketAuthorityPda, marketShard: marketShardPda, zoneShard: zoneShardPda,
        feeCollector: shardedCollectorPda("fee_collector"), wheelingCollector: shardedCollectorPda("wheeling_collector"),
        lossCollector: shardedCollectorPda("loss_collector"), payer: authority,
        sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_2022_PROGRAM_ID, secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        ...treasuryAccts,
      } as any)
      .remainingAccounts(remainingMeta)
      .instruction();

    // ~20 accounts + 2 Ed25519 ixs overflow a legacy tx → v0 + ALT.
    const altAddrs = [...new Set(settleIx.keys.filter((k: any) => !k.isSigner).map((k: any) => k.pubkey.toBase58()))].map((s) => new PublicKey(s as string));
    const recentSlot = await provider.connection.getSlot();
    const [createAltIx, altAddress] = AddressLookupTableProgram.createLookupTable({ authority, payer: authority, recentSlot });
    const extendAltIx = AddressLookupTableProgram.extendLookupTable({ payer: authority, authority, lookupTable: altAddress, addresses: altAddrs });
    {
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: authority, recentBlockhash: blockhash } as any).add(createAltIx, extendAltIx);
      tx.sign(payer);
      await provider.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    }
    for (let w = 0; w < 3; w++) {
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: authority, recentBlockhash: blockhash } as any).add(SystemProgram.transfer({ fromPubkey: authority, toPubkey: authority, lamports: 1 }));
      tx.sign(payer);
      await provider.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      await new Promise((r) => setTimeout(r, 400));
    }
    let alt: any = null;
    for (let i = 0; i < 40; i++) {
      const r = await provider.connection.getAddressLookupTable(altAddress);
      if (r.value && r.value.state.addresses.length >= altAddrs.length) { alt = r.value; break; }
      await new Promise((r) => setTimeout(r, 400));
    }
    expect(alt, "ALT activated").to.not.be.null;
    return { edIxs, settleIx, alt, settlementRecord };
  }

  it("records a per-(zone,batch) SettlementRecord via record_settlement_batch", async () => {
    const { buyer, seller } = await seedUsers();
    const buyerOrderId = Buffer.alloc(16); buyerOrderId.writeUInt32LE(0xa1, 0);
    const sellerOrderId = Buffer.alloc(16); sellerOrderId.writeUInt32LE(0xb2, 0);
    const { edIxs, settleIx, alt, settlementRecord } =
      await prepareSettle([{ buyer, seller, buyerOrderId, sellerOrderId }], { withTreasury: true, thisBatchId: batchId });

    // §2c Part B: record_settlement_batch_sharded bumps the per-shard accumulator
    // by the gross `value` (= total_value = matchAmount*matchPrice/1e9 = currencyValue),
    // NOT the global total_settled_thbg (which stays flat until aggregate_settlement_shards).
    // Capture
    // both pre-settle figures to assert the shard delta and the global no-op.
    const shardBefore = new BN(
      (await treasury.account.settlementShard.fetch(settleShardPda)).settledThbg.toString()
    );
    const globalBefore = new BN(
      (await treasury.account.treasury.fetch(treasuryPda)).totalSettledThbg.toString()
    );

    let settleSig: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({ payerKey: authority, recentBlockhash: blockhash, instructions: [...edIxs, settleIx] }).compileToV0Message([alt]);
      const vtx = new VersionedTransaction(msg);
      vtx.sign([payer]);
      try {
        const sig = await provider.connection.sendTransaction(vtx, { skipPreflight: true });
        const conf = await provider.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        if (conf.value.err) throw new Error("batch settle failed: " + JSON.stringify(conf.value.err));
        settleSig = sig;
        break;
      } catch (e) {
        if (attempt === 4) throw e;
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    // §2b assertion: the per-(zone,batch) SettlementRecord was written.
    const rec: any = await treasury.account.settlementRecord.fetch(settlementRecord);
    expect(rec.zoneId).to.equal(zoneId);
    expect(rec.batchId.toString()).to.equal(batchId.toString());
    expect(rec.vatRateBps).to.equal(700);
    expect(Buffer.from(rec.merkleRoot).equals(Buffer.from(merkleRoot00()))).to.equal(true);
    expect(rec.totalValue.toString()).to.equal(currencyValue.toString());

    // §2c assertion: the per-shard accumulator advanced by exactly the gross settled
    // value (= rec.total_value = matchAmount*matchPrice/1e9 = currencyValue), and the global total did NOT
    // move (it reconciles only via aggregate_settlement_shards). This is the parallel
    // win: no global write-lock on the settle hot path.
    const shardAfter = new BN(
      (await treasury.account.settlementShard.fetch(settleShardPda)).settledThbg.toString()
    );
    const globalAfter = new BN(
      (await treasury.account.treasury.fetch(treasuryPda)).totalSettledThbg.toString()
    );
    expect(shardAfter.sub(shardBefore).toString()).to.equal(currencyValue.toString());
    expect(globalAfter.sub(globalBefore).toString()).to.equal("0");

    // Buyer received the energy; total settled advanced.
    const buyerEngEscrow = escrowPda(buyer.publicKey, energyMintPda);
    expect(Number((await getAccount(provider.connection, buyerEngEscrow, undefined, TOKEN_2022_PROGRAM_ID)).amount)).to.equal(1 + matchAmount);

    // §2b CU datapoint: batch settle of 1 match (escrow×3 + nullifier create×2 +
    // 2 Ed25519 verifies + record_settlement_batch CPI). Capture the consumed CU
    // and assert it stays inside the 1.4M max budget. (Single-match settle_offchain
    // is ~103k CU per BENCHMARKS.md; the batch path adds the CPI + nullifier inits.)
    expect(settleSig, "settle sig captured for CU read").to.not.be.null;
    const txMeta = await provider.connection.getTransaction(settleSig!, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const cu = txMeta?.meta?.computeUnitsConsumed ?? 0;
    console.log(`  [BENCH_BATCH_SETTLE_CU] matches=1 cu=${cu}`);
    expect(cu, "batch settle CU recorded").to.be.greaterThan(0);
    expect(cu, "batch settle CU under 1.4M max budget").to.be.lessThan(1_400_000);
  });

  it("rejects a THBG-market batch that omits the treasury accounts (TreasurySettlementRequired)", async () => {
    const { buyer, seller } = await seedUsers();
    const buyerOrderId = Buffer.alloc(16); buyerOrderId.writeUInt32LE(0xc3, 0);
    const sellerOrderId = Buffer.alloc(16); sellerOrderId.writeUInt32LE(0xd4, 0);
    // Distinct batch id — irrelevant since the tx rolls back, but avoids any
    // collision with the happy-path SettlementRecord PDA.
    const { edIxs, settleIx, alt } =
      await prepareSettle([{ buyer, seller, buyerOrderId, sellerOrderId }], { withTreasury: false, thisBatchId: batchId.addn(1) });

    // Send (not simulate): a freshly-created ALT isn't resolvable under
    // simulateTransaction's replaceRecentBlockhash path. The require!(!recording_required)
    // guard fires at the end of the batch, reverting the whole tx; the on-chain
    // error code (6033 = TreasurySettlementRequired) surfaces in conf.value.err.
    let err: any = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({ payerKey: authority, recentBlockhash: blockhash, instructions: [...edIxs, settleIx] }).compileToV0Message([alt]);
      const vtx = new VersionedTransaction(msg);
      vtx.sign([payer]);
      // sendTransaction THROWS on a transient ALT "invalid index" (table not yet
      // active) — that's a transport error, not the on-chain reject we want, so
      // retry rather than fail the test. Only conf.value.err is the real verdict.
      let conf: any;
      try {
        const sig = await provider.connection.sendTransaction(vtx, { skipPreflight: true });
        conf = await provider.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      } catch (e) {
        if (attempt === 4) throw e;
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      if (conf.value.err) { err = conf.value.err; break; }
      if (attempt === 4) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    // settleIx is the last instruction (edIxs..., settleIx).
    expect(err, "settle must fail when treasury accounts are omitted").to.not.be.null;
    expect(JSON.stringify(err), JSON.stringify(err)).to.match(/"Custom":6033/);
  });

  // §2b batch-CU curve: a >1-match datapoint is NOT reachable in a single
  // transaction. `batch_settle_offchain_match` introspects the instructions
  // sysvar for 2 inline Ed25519 verify ixs PER match (settle_offchain.rs:598),
  // and that signature/pubkey/message payload (~189 B/ix) lives in the ix data,
  // not in accounts — an ALT can't compress it. With 2 matches the 4 Ed25519 ixs
  // (~760 B) + 2 serialized BatchMatchPairs (~370 B) + the settle ix's account
  // index list + headers overrun the 1232-byte packet (`RangeError: encoding
  // overruns Uint8Array` at MessageV0.serialize). So the single-tx batch is
  // capped at 1 match given the per-match Ed25519-introspection design; a real
  // marginal-CU curve needs a packaging change (pre-verified sig accounts, or an
  // off-chain aggregated multisig) — tracked in BENCHMARKS.md, not asserted here.
});

// merkleRoot used by the happy-path assertion (mirrors prepareSettle's root).
function merkleRoot00(): number[] {
  return Array.from({ length: 32 }, (_, i) => (i + 1) & 0xff);
}
