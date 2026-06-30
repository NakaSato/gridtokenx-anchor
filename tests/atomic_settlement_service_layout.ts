// Live on-chain validation of the trading-service's FIXED execute_atomic_settlement
// path: currency (GRX) accounts under the classic SPL Token program, energy (GRID)
// accounts under Token-2022, and the account layout the service now emits
// (no zone_market, explicit primary token_program, secondary = Token-2022).
//
// Mirrors the production mint types (currency = classic, energy = Token-2022) —
// unlike tests/trading.ts which treats both mints as classic. Uses fresh mints we
// fully control (no dependency on bootstrap mint authorities). Run directly
// against a live validator (Anchor's runner spawns surfpool which isn't installed):
//   ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json \
//     npx mocha -r tsx tests/atomic_settlement_service_layout.ts --timeout 1000000
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { Governance } from "../target/types/governance";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
  createMint,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";

describe("atomic-settlement (service layout: currency=classic, energy=Token-2022)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const tradingProgram = anchor.workspace.Trading as Program<Trading>;
  const governanceProgram = anchor.workspace.Governance as Program<Governance>;

  const authority = provider.wallet.publicKey;
  const payer = (provider.wallet as any).payer as Keypair;

  let marketPda: PublicKey;
  let zoneMarketPda: PublicKey;
  let governanceConfigPda: PublicKey;
  let currencyMint: PublicKey; // classic SPL Token
  let energyMint: PublicKey; // Token-2022

  const zoneId = 0;
  // Energy is 9-decimal atomic (kWh * 1e9). execute_atomic_settlement normalizes the
  // currency leg by 1e9: total = amount * price / 1e9 (commit 6c4118b). So a 100 kWh match
  // must be wired as 100 * 1e9 atomic units, else total rounds to 0 and the seller receives
  // nothing. price stays 6-dec currency (55 → total = 100e9 * 55 / 1e9 = 5500).
  const MATCH_ENERGY = 100 * 1_000_000_000; // 100 kWh atomic

  before(async () => {
    [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingProgram.programId);
    [zoneMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(zoneId).toArrayLike(Buffer, "le", 4)],
      tradingProgram.programId
    );
    [governanceConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], governanceProgram.programId);

    // Fresh mints, mint authority = provider wallet. Currency classic (6 dp),
    // energy Token-2022 (9 dp) — matching the production token programs the
    // service derives ATAs under.
    currencyMint = await createMint(provider.connection, payer, authority, null, 6, undefined, undefined, TOKEN_PROGRAM_ID);
    energyMint = await createMint(provider.connection, payer, authority, null, 9, undefined, undefined, TOKEN_2022_PROGRAM_ID);
  });

  async function ensureAta(mint: PublicKey, owner: PublicKey, programId: PublicKey): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(mint, owner, true, programId);
    try {
      await getAccount(provider.connection, ata, "confirmed", programId);
    } catch (e) {
      await provider.sendAndConfirm(
        new Transaction().add(
          createAssociatedTokenAccountInstruction(authority, ata, owner, mint, programId)
        )
      );
    }
    return ata;
  }

  it("settles a trade: energy seller->buyer, currency buyer->seller+collectors", async () => {
    const prosumer = Keypair.generate(); // seller
    const consumer = Keypair.generate(); // buyer
    const escrowAuth = Keypair.generate();

    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({ fromPubkey: authority, toPubkey: prosumer.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL }),
        SystemProgram.transfer({ fromPubkey: authority, toPubkey: consumer.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL }),
        SystemProgram.transfer({ fromPubkey: authority, toPubkey: escrowAuth.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL })
      )
    );

    // Currency (classic) accounts.
    const buyerCurrencyEscrow = await ensureAta(currencyMint, escrowAuth.publicKey, TOKEN_PROGRAM_ID);
    const sellerCurrencyAccount = await ensureAta(currencyMint, prosumer.publicKey, TOKEN_PROGRAM_ID);
    const feeCollector = await ensureAta(currencyMint, authority, TOKEN_PROGRAM_ID);
    const wheelingCollector = await ensureAta(currencyMint, Keypair.generate().publicKey, TOKEN_PROGRAM_ID);
    const lossCollector = await ensureAta(currencyMint, Keypair.generate().publicKey, TOKEN_PROGRAM_ID);
    // Energy (Token-2022) accounts.
    const sellerEnergyEscrow = await ensureAta(energyMint, escrowAuth.publicKey, TOKEN_2022_PROGRAM_ID);
    const buyerEnergyAccount = await ensureAta(energyMint, consumer.publicKey, TOKEN_2022_PROGRAM_ID);

    // Fund escrows: 1,000,000 currency to buyer, 100 energy to seller.
    await mintTo(provider.connection, payer, currencyMint, buyerCurrencyEscrow, payer, 1_000_000, [], undefined, TOKEN_PROGRAM_ID);
    await mintTo(provider.connection, payer, energyMint, sellerEnergyEscrow, payer, MATCH_ENERGY, [], undefined, TOKEN_2022_PROGRAM_ID);

    // On-chain orders.
    const sellOrderId = new BN(Date.now());
    const [sellOrderPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order"), prosumer.publicKey.toBuffer(), sellOrderId.toArrayLike(Buffer, "le", 8)],
      tradingProgram.programId
    );
    await tradingProgram.methods
      .createSellOrder(sellOrderId, new BN(MATCH_ENERGY), new BN(50))
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        order: sellOrderPda,
        authority: prosumer.publicKey,
        governanceConfig: governanceConfigPda,
        ercCertificate: null,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([prosumer])
      .rpc();

    const buyOrderId = new BN(Date.now() + 1);
    const [buyOrderPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order"), consumer.publicKey.toBuffer(), buyOrderId.toArrayLike(Buffer, "le", 8)],
      tradingProgram.programId
    );
    await tradingProgram.methods
      .createBuyOrder(buyOrderId, new BN(MATCH_ENERGY), new BN(60))
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        order: buyOrderPda,
        authority: consumer.publicKey,
        governanceConfig: governanceConfigPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([consumer])
      .rpc();

    // Per-match TradeNullifier (F3c): created on first settle (init), reverts a replay.
    // Unique per run so the nullifier PDA never collides on a persistent validator (a
    // fixed id makes a re-run revert MatchAlreadySettled; it also clashed with trading.ts).
    const tradeId = Buffer.alloc(16);
    tradeId.writeBigUInt64LE(BigInt(Date.now()), 0);
    const [tradeNullifier] = PublicKey.findProgramAddressSync(
      [Buffer.from("trade"), tradeId],
      tradingProgram.programId
    );

    // Settlement with the SERVICE's account layout: tokenProgram = classic
    // (currency), secondaryTokenProgram = Token-2022 (energy).
    await tradingProgram.methods
      .executeAtomicSettlement(new BN(MATCH_ENERGY), new BN(55), new BN(1), new BN(1), [...tradeId])
      .accounts({
        market: marketPda,
        buyOrder: buyOrderPda,
        sellOrder: sellOrderPda,
        tradeNullifier,
        buyerCurrencyEscrow,
        sellerEnergyEscrow,
        sellerCurrencyAccount,
        buyerEnergyAccount,
        feeCollector,
        wheelingCollector,
        lossCollector,
        energyMint,
        currencyMint,
        escrowAuthority: escrowAuth.publicKey,
        marketAuthority: authority,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
        governanceConfig: governanceConfigPda,
      } as any)
      .signers([escrowAuth])
      .rpc();

    // Buyer received all the energy; seller received currency net of fee+wheeling+loss.
    // total = MATCH_ENERGY * 55 / 1e9 = 5500; seller nets ~5498 (fee + 1 wheeling + 1 loss).
    const buyerEnergy = await provider.connection.getTokenAccountBalance(buyerEnergyAccount);
    const sellerCurrency = await provider.connection.getTokenAccountBalance(sellerCurrencyAccount);
    expect(Number(buyerEnergy.value.amount), "buyer energy").to.equal(MATCH_ENERGY);
    expect(Number(sellerCurrency.value.amount), "seller currency").to.be.at.least(5480);

    const fee = await provider.connection.getTokenAccountBalance(feeCollector);
    expect(Number(fee.value.amount), "fee collected").to.be.greaterThan(0);
  });
});
