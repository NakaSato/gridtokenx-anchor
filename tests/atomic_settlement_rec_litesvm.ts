// Litesvm coverage for the opt-in REC leg of execute_atomic_settlement (the PRODUCTION
// settle path, commit ef182e6). The currency/energy legs and the REC pins/amount/transfer
// are proven elsewhere; this isolates the new composition: a REC token moves
// seller->buyer escrow, signed by escrow_authority, when the REC group is appended via
// remaining_accounts[0..4] = [rec_mint, seller_rec_escrow, buyer_rec_escrow, rec_token_program].
//
// All token state is fabricated with svm.setAccount (the rec_mint authority is the
// governance poa_config PDA, so it can't be minted to in-test) — no validator, no
// issue_erc funding chain. Orders are real (createSellOrder/createBuyOrder).

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { Governance } from "../target/types/governance";
import { expect } from "chai";
import {
  PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, MINT_SIZE, MintLayout, ACCOUNT_SIZE, AccountLayout,
} from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const tradingIdl = require("../target/idl/trading.json");
const governanceIdl = require("../target/idl/governance.json");

const ZONE = 0;
const MATCH_ENERGY = 100 * 1_000_000_000; // 100 kWh atomic
const REC_AMOUNT = 100_000n;              // MATCH_ENERGY * 1_000 / 1e9 = 100 kWh worth (6-dec)

describe("execute_atomic_settlement REC leg (litesvm)", () => {
  let svm: LiteSVM;
  let trading: Program<Trading>;
  let governance: Program<Governance>;
  let tradingId: PublicKey;
  let governanceId: PublicKey;

  const payer = Keypair.generate();   // market authority + fee payer
  const seller = Keypair.generate();  // sell-order owner
  const buyer = Keypair.generate();   // buy-order owner
  const escrowAuth = Keypair.generate(); // escrow authority — signs the transfers

  let marketPda: PublicKey, zoneMarketPda: PublicKey, recMintPda: PublicKey;
  let currencyMint: PublicKey, energyMint: PublicKey, cfgPda: PublicKey;

  type IxLike = TransactionInstruction | Promise<TransactionInstruction>;
  async function send(ixs: IxLike[], extra: Keypair[] = []) {
    const resolved = await Promise.all(ixs);
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    resolved.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...extra);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    if (res instanceof FailedTransactionMetadata) {
      throw new Error("tx failed: " + res.err().toString() + "\n" + res.meta().logs().join("\n"));
    }
  }

  // Fabricate a mint account directly.
  function setMint(key: PublicKey, decimals: number, program: PublicKey) {
    const buf = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      { mintAuthorityOption: 1, mintAuthority: payer.publicKey, supply: 1_000_000_000_000n,
        decimals, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default },
      buf,
    );
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))),
      data: buf, owner: program, executable: false,
    });
  }

  // Fabricate a token account (mint, owner, amount) at `key`.
  function setTokenAccount(key: PublicKey, mint: PublicKey, owner: PublicKey, amount: bigint, program: PublicKey) {
    const buf = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode(
      { mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, delegatedAmount: 0n,
        state: 1, isNativeOption: 0, isNative: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default },
      buf,
    );
    svm.setAccount(key, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(ACCOUNT_SIZE))),
      data: buf, owner: program, executable: false,
    });
  }

  const orderPda = (user: PublicKey, id: BN) =>
    PublicKey.findProgramAddressSync([Buffer.from("order"), user.toBuffer(), id.toArrayLike(Buffer, "le", 8)], tradingId)[0];

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    trading = new Program(tradingIdl, { connection: {}, publicKey: PublicKey.default } as any);
    governance = new Program(governanceIdl, { connection: {}, publicKey: PublicKey.default } as any);
    tradingId = trading.programId;
    governanceId = governance.programId;
    svm.addProgramFromFile(tradingId, "target/deploy/trading.so");
    svm.addProgramFromFile(governanceId, "target/deploy/governance.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));
    svm.airdrop(seller.publicKey, BigInt(1_000_000_000)); // pays its sell-order rent
    svm.airdrop(buyer.publicKey, BigInt(1_000_000_000));  // pays its buy-order rent

    [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingId);
    [zoneMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(ZONE).toArrayLike(Buffer, "le", 4)], tradingId);
    [recMintPda] = PublicKey.findProgramAddressSync([Buffer.from("rec_mint")], governanceId);
    [cfgPda] = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], governanceId);

    await send([await trading.methods.initializeMarket(16).accounts({ market: marketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()]);
    await send([await trading.methods.initializeZoneMarket(ZONE, 16, new BN(1_000_000)).accounts({ market: marketPda, zoneMarket: zoneMarketPda, authority: payer.publicKey, systemProgram: SystemProgram.programId } as any).instruction()]);

    // Fabricate the governance poa_config (operational) so the gate + create-order pass.
    const now = 1_000_000;
    const cfg = {
      authority: payer.publicKey, authorityName: Array(64).fill(0), nameLen: 0,
      contactInfo: Array(128).fill(0), contactLen: 0, version: 1, maintenanceMode: false,
      ercValidationEnabled: true, minEnergyAmount: new BN(1), maxErcAmount: new BN("100000000000000"),
      ercValidityPeriod: new BN(31_536_000), requireOracleValidation: false, oracleAuthority: PublicKey.default,
      minOracleConfidence: 80, allowCertificateTransfers: true, minQuorumVotes: new BN(100),
      totalErcsIssued: new BN(0), totalErcsValidated: new BN(0), totalErcsRevoked: new BN(0),
      totalEnergyCertified: new BN(0), createdAt: new BN(now), lastUpdated: new BN(now), lastErcIssuedAt: new BN(0),
      pendingAuthority: PublicKey.default, pendingAuthorityProposedAt: new BN(0), pendingAuthorityExpiresAt: new BN(0),
      reserved: Array(5).fill(0),
    };
    const data = await governance.coder.accounts.encode("governanceConfig", cfg as any);
    svm.setAccount(cfgPda, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data, owner: governanceId, executable: false,
    });

    // Mints: currency (classic, 6-dec), energy (Token-2022, 9-dec), rec (Token-2022, 6-dec @ PDA).
    currencyMint = Keypair.generate().publicKey;
    energyMint = Keypair.generate().publicKey;
    setMint(currencyMint, 6, TOKEN_PROGRAM_ID);
    setMint(energyMint, 9, TOKEN_2022_PROGRAM_ID);
    setMint(recMintPda, 6, TOKEN_2022_PROGRAM_ID);
  });

  it("moves REC seller->buyer escrow, signed by escrow_authority", async () => {
    const sellId = new BN(1), buyId = new BN(2);
    // Real orders: sell @50, buy @60 (settle @55 is within both).
    await send([await trading.methods.createSellOrder(sellId, new BN(MATCH_ENERGY), new BN(50)).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, order: orderPda(seller.publicKey, sellId),
      authority: seller.publicKey, governanceConfig: cfgPda, ercCertificate: null, systemProgram: SystemProgram.programId,
    } as any).instruction()], [seller]);
    await send([await trading.methods.createBuyOrder(buyId, new BN(MATCH_ENERGY), new BN(60)).accounts({
      market: marketPda, zoneMarket: zoneMarketPda, order: orderPda(buyer.publicKey, buyId),
      authority: buyer.publicKey, governanceConfig: cfgPda, systemProgram: SystemProgram.programId,
    } as any).instruction()], [buyer]);

    // Escrows (all authority = escrowAuth, like the production custodial layout).
    const buyerCurEscrow = Keypair.generate().publicKey;
    const sellerEngEscrow = Keypair.generate().publicKey;
    const sellerCurAcct = Keypair.generate().publicKey;
    const buyerEngAcct = Keypair.generate().publicKey;
    const feeCol = Keypair.generate().publicKey, wheelCol = Keypair.generate().publicKey, lossCol = Keypair.generate().publicKey;
    const sellerRec = Keypair.generate().publicKey, buyerRec = Keypair.generate().publicKey;
    setTokenAccount(buyerCurEscrow, currencyMint, escrowAuth.publicKey, 1_000_000n, TOKEN_PROGRAM_ID);
    setTokenAccount(sellerEngEscrow, energyMint, escrowAuth.publicKey, BigInt(MATCH_ENERGY), TOKEN_2022_PROGRAM_ID);
    setTokenAccount(sellerCurAcct, currencyMint, seller.publicKey, 0n, TOKEN_PROGRAM_ID);
    setTokenAccount(buyerEngAcct, energyMint, buyer.publicKey, 0n, TOKEN_2022_PROGRAM_ID);
    setTokenAccount(feeCol, currencyMint, payer.publicKey, 0n, TOKEN_PROGRAM_ID);
    setTokenAccount(wheelCol, currencyMint, payer.publicKey, 0n, TOKEN_PROGRAM_ID);
    setTokenAccount(lossCol, currencyMint, payer.publicKey, 0n, TOKEN_PROGRAM_ID);
    setTokenAccount(sellerRec, recMintPda, escrowAuth.publicKey, REC_AMOUNT, TOKEN_2022_PROGRAM_ID);
    setTokenAccount(buyerRec, recMintPda, escrowAuth.publicKey, 0n, TOKEN_2022_PROGRAM_ID);

    const tradeId = Buffer.alloc(16); tradeId.writeBigUInt64LE(123n, 0);
    const [tradeNullifier] = PublicKey.findProgramAddressSync([Buffer.from("trade"), tradeId], tradingId);

    await send([await trading.methods
      .executeAtomicSettlement(new BN(MATCH_ENERGY), new BN(55), new BN(1), new BN(1), [...tradeId])
      .accounts({
        market: marketPda, buyOrder: orderPda(buyer.publicKey, buyId), sellOrder: orderPda(seller.publicKey, sellId),
        tradeNullifier, buyerCurrencyEscrow: buyerCurEscrow, sellerEnergyEscrow: sellerEngEscrow,
        sellerCurrencyAccount: sellerCurAcct, buyerEnergyAccount: buyerEngAcct,
        feeCollector: feeCol, wheelingCollector: wheelCol, lossCollector: lossCol,
        energyMint, currencyMint, escrowAuthority: escrowAuth.publicKey, marketAuthority: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
        governanceConfig: cfgPda,
      } as any)
      .remainingAccounts([
        { pubkey: recMintPda, isSigner: false, isWritable: false },
        { pubkey: sellerRec, isSigner: false, isWritable: true },
        { pubkey: buyerRec, isSigner: false, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      ])
      .instruction()], [escrowAuth]);

    const bal = (k: PublicKey) => Buffer.from(svm.getAccount(k)!.data).readBigUInt64LE(64);
    expect(bal(sellerRec).toString(), "seller REC drained").to.equal("0");
    expect(bal(buyerRec).toString(), "buyer REC received").to.equal(REC_AMOUNT.toString());
  });
});
