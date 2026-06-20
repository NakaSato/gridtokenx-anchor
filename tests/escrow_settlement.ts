import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { EnergyToken } from "../target/types/energy_token";
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
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
  mintTo,
  MINT_SIZE,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";
import * as fs from "fs";

// Mirrors OffchainOrderPayload::get_message() byte layout in settle_offchain.rs.
function orderMessage(p: {
  orderId: Buffer; // 16 bytes
  user: PublicKey;
  energyAmount: number | bigint;
  pricePerKwh: number | bigint;
  side: number;
  zoneId: number;
  expiresAt: number | bigint;
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

describe("escrow-settlement", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const tradingProgram = anchor.workspace.Trading as Program<Trading>;
  const energyTokenProgram = anchor.workspace.EnergyToken as Program<EnergyToken>;
  const authority = provider.wallet.publicKey;
  const payer = (provider.wallet as any).payer as Keypair;

  let marketPda: PublicKey;
  let zoneMarketPda: PublicKey;
  let energyMintPda: PublicKey;
  let energyTokenInfoPda: PublicKey;
  let marketAuthorityPda: PublicKey;
  let currencyMint: PublicKey;
  let currencyMintKeypair: Keypair;

  const zoneId = 0;

  const escrowPda = (user: PublicKey, mint: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), user.toBuffer(), mint.toBuffer()],
      tradingProgram.programId
    )[0];
  const collectorPda = (label: string, mint: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from(label), mint.toBuffer()],
      tradingProgram.programId
    )[0];
  const nullifierPda = (user: PublicKey, orderId: Buffer) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("nullifier"), user.toBuffer(), orderId],
      tradingProgram.programId
    )[0];

  // Currency is a classic SPL mint; the energy mint is Token-2022 (mint_2022).
  // Pick the matching token program per mint so ATAs/escrows/transfers line up.
  const progFor = (mint: PublicKey) =>
    mint.equals(currencyMint) ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  before(async () => {
    [marketPda] = PublicKey.findProgramAddressSync([Buffer.from("market")], tradingProgram.programId);
    [zoneMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("zone_market"), marketPda.toBuffer(), new BN(zoneId).toArrayLike(Buffer, "le", 4)],
      tradingProgram.programId
    );
    [energyMintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], energyTokenProgram.programId);
    [energyTokenInfoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], energyTokenProgram.programId);
    [marketAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("market_authority")], tradingProgram.programId);

    // Load or create the classic-SPL currency mint (shared with trading.ts).
    try {
      currencyMintKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("currency-mint.json", "utf8"))));
      currencyMint = currencyMintKeypair.publicKey;
      await getAccount(provider.connection, getAssociatedTokenAddressSync(currencyMint, authority), "confirmed").catch(() => {});
    } catch (e) {
      currencyMintKeypair = Keypair.generate();
      currencyMint = currencyMintKeypair.publicKey;
    }
    // Ensure the mint account actually exists on this (possibly fresh) chain.
    const info = await provider.connection.getAccountInfo(currencyMint);
    if (!info) {
      const lamports = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
      const tx = new Transaction().add(
        SystemProgram.createAccount({ fromPubkey: authority, newAccountPubkey: currencyMint, space: MINT_SIZE, lamports, programId: TOKEN_PROGRAM_ID }),
        {
          keys: [
            { pubkey: currencyMint, isSigner: false, isWritable: true },
            { pubkey: anchor.web3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          ],
          programId: TOKEN_PROGRAM_ID,
          data: Buffer.from([0, 6, ...authority.toBuffer(), 0]),
        }
      );
      await provider.sendAndConfirm(tx, [currencyMintKeypair]);
      fs.writeFileSync("currency-mint.json", JSON.stringify(Array.from(currencyMintKeypair.secretKey)));
    }

    // One-time collector PDAs for the currency mint.
    try {
      await tradingProgram.methods
        .initializeCollectors()
        .accounts({
          payer: authority,
          currencyMint,
          feeCollector: collectorPda("fee_collector", currencyMint),
          wheelingCollector: collectorPda("wheeling_collector", currencyMint),
          lossCollector: collectorPda("loss_collector", currencyMint),
          marketAuthority: marketAuthorityPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    } catch (e: any) {
      // already initialized
    }
  });

  // Fund a fresh keypair with SOL + an ATA holding `amount` of `mint`.
  async function freshUserWith(mint: PublicKey, amount: number): Promise<{ kp: Keypair; ata: PublicKey }> {
    const kp = Keypair.generate();
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({ fromPubkey: authority, toPubkey: kp.publicKey, lamports: 0.2 * LAMPORTS_PER_SOL })
      )
    );
    const prog = progFor(mint);
    const ata = getAssociatedTokenAddressSync(mint, kp.publicKey, false, prog);
    await provider.sendAndConfirm(
      new Transaction().add(
        createAssociatedTokenAccountInstruction(authority, ata, kp.publicKey, mint, prog)
      )
    );
    if (amount > 0) {
      if (mint.equals(currencyMint)) {
        await mintTo(provider.connection, payer, currencyMint, ata, payer, amount);
      } else {
        // energy mint: go through the program's mintToWallet (Token-2022)
        await energyTokenProgram.methods
          .mintToWallet(new BN(amount))
          .accounts({
            mint: energyMintPda,
            tokenInfo: energyTokenInfoPda,
            destination: ata,
            destinationOwner: kp.publicKey,
            authority,
            payer: authority,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
      }
    }
    return { kp, ata };
  }

  async function deposit(kp: Keypair, ata: PublicKey, mint: PublicKey, amount: number) {
    await tradingProgram.methods
      .depositEscrow(new BN(amount))
      .accounts({
        user: kp.publicKey,
        mint,
        userWallet: ata,
        userEscrow: escrowPda(kp.publicKey, mint),
        marketAuthority: marketAuthorityPda,
        tokenProgram: progFor(mint),
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([kp])
      .rpc();
  }

  it("deposit_escrow funds a per-user escrow; withdraw_escrow returns it", async () => {
    const { kp, ata } = await freshUserWith(currencyMint, 1_000);
    await deposit(kp, ata, currencyMint, 600);

    const esc = escrowPda(kp.publicKey, currencyMint);
    expect(Number((await getAccount(provider.connection, esc)).amount)).to.equal(600);
    expect(Number((await getAccount(provider.connection, ata)).amount)).to.equal(400);

    await tradingProgram.methods
      .withdrawEscrow(new BN(250))
      .accounts({
        user: kp.publicKey,
        mint: currencyMint,
        userEscrow: esc,
        userWallet: ata,
        marketAuthority: marketAuthorityPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([kp])
      .rpc();

    expect(Number((await getAccount(provider.connection, esc)).amount)).to.equal(350);
    expect(Number((await getAccount(provider.connection, ata)).amount)).to.equal(650);
  });

  it("rejects withdrawing someone else's escrow (seeds bind to the signer)", async () => {
    const victim = await freshUserWith(currencyMint, 500);
    await deposit(victim.kp, victim.ata, currencyMint, 500);
    const victimEscrow = escrowPda(victim.kp.publicKey, currencyMint);

    const attacker = await freshUserWith(currencyMint, 0);
    let threw = false;
    try {
      await tradingProgram.methods
        .withdrawEscrow(new BN(500))
        .accounts({
          user: attacker.kp.publicKey,        // attacker signs
          mint: currencyMint,
          userEscrow: victimEscrow,            // but points at victim's escrow
          userWallet: attacker.ata,
          marketAuthority: marketAuthorityPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([attacker.kp])
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(JSON.stringify(e.logs ?? e.message)).to.match(/ConstraintSeeds|seeds constraint|2006/);
    }
    expect(threw, "cross-user withdraw rejected").to.be.true;
    // Victim escrow untouched.
    expect(Number((await getAccount(provider.connection, victimEscrow)).amount)).to.equal(500);
  });

  it("rejects settlement that points a signed buyer at a victim's escrow (theft fix)", async () => {
    const victim = await freshUserWith(currencyMint, 5_000);
    await deposit(victim.kp, victim.ata, currencyMint, 5_000);
    const victimEscrow = escrowPda(victim.kp.publicKey, currencyMint);

    const attacker = Keypair.generate();
    const seller = Keypair.generate();
    const buyerOrderId = Buffer.alloc(16, 1);
    const sellerOrderId = Buffer.alloc(16, 2);

    const buyerPayload = { orderId: [...buyerOrderId], user: attacker.publicKey, energyAmount: new BN(100), pricePerKwh: new BN(60), side: 0, zoneId, expiresAt: new BN(0) };
    const sellerPayload = { orderId: [...sellerOrderId], user: seller.publicKey, energyAmount: new BN(100), pricePerKwh: new BN(50), side: 1, zoneId, expiresAt: new BN(0) };

    let threw = false;
    try {
      await tradingProgram.methods
        .settleOffchainMatch(buyerPayload as any, sellerPayload as any, new BN(100), new BN(55), new BN(1), new BN(1))
        .accounts({
          market: marketPda,
          zoneMarket: zoneMarketPda,
          buyerNullifier: nullifierPda(attacker.publicKey, buyerOrderId),
          sellerNullifier: nullifierPda(seller.publicKey, sellerOrderId),
          currencyMint,
          energyMint: energyMintPda,
          marketAuthority: marketAuthorityPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
          buyerCurrencyEscrow: victimEscrow, // SUBSTITUTION: not derivable from attacker
          sellerCurrencyEscrow: escrowPda(seller.publicKey, currencyMint),
          sellerEnergyEscrow: escrowPda(seller.publicKey, energyMintPda),
          buyerEnergyEscrow: escrowPda(attacker.publicKey, energyMintPda),
          feeCollector: collectorPda("fee_collector", currencyMint),
          wheelingCollector: collectorPda("wheeling_collector", currencyMint),
          lossCollector: collectorPda("loss_collector", currencyMint),
          marketShard: PublicKey.findProgramAddressSync([Buffer.from("market_shard"), marketPda.toBuffer(), Buffer.from([authority.toBuffer()[0] % 16])], tradingProgram.programId)[0],
          zoneShard: PublicKey.findProgramAddressSync([Buffer.from("zone_shard"), zoneMarketPda.toBuffer(), Buffer.from([authority.toBuffer()[0] % 16])], tradingProgram.programId)[0],
          payer: authority,
          sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    } catch (e: any) {
      threw = true;
      // ConstraintSeeds (escrow address mismatch) fires before the ed25519 check.
      // The malicious settle aborts: either ConstraintSeeds on the substituted escrow,
      // or AccountNotInitialized on a downstream escrow the attacker never funded. Either
      // way the transaction reverts and no funds move (asserted below).
      const blob = JSON.stringify(e.logs ?? e.message ?? e);
      expect(blob, blob).to.match(/ConstraintSeeds|seeds constraint|InvalidEscrow|2006|AccountNotInitialized|3012|0xbc4/);
    }
    expect(threw, "escrow substitution rejected").to.be.true;
    // Security property: victim funds untouched.
    expect(Number((await getAccount(provider.connection, victimEscrow)).amount)).to.equal(5_000);
  });

  it("settles a signed off-chain match between two escrows", async () => {
    // Buyer holds currency, seller holds energy; both pre-create their receiving escrows.
    const buyer = await freshUserWith(currencyMint, 10_000);
    const seller = await freshUserWith(energyMintPda, 200);
    // Receiving-side escrows must exist (settle does not init them).
    const sellerCur = await freshUserWith(currencyMint, 10); // seller currency wallet to seed escrow
    const buyerEng = await freshUserWith(energyMintPda, 10); // buyer energy wallet to seed escrow

    await deposit(buyer.kp, buyer.ata, currencyMint, 10_000);
    await deposit(seller.kp, seller.ata, energyMintPda, 200);
    // Seed the receiving escrows under the SAME buyer/seller keys.
    // (re-fund the buyer/seller wallets with the opposite asset, then deposit)
    const buyerEngAta = getAssociatedTokenAddressSync(energyMintPda, buyer.kp.publicKey, false, TOKEN_2022_PROGRAM_ID);
    await provider.sendAndConfirm(new Transaction().add(createAssociatedTokenAccountInstruction(authority, buyerEngAta, buyer.kp.publicKey, energyMintPda, TOKEN_2022_PROGRAM_ID)));
    await energyTokenProgram.methods.mintToWallet(new BN(1)).accounts({ mint: energyMintPda, tokenInfo: energyTokenInfoPda, destination: buyerEngAta, destinationOwner: buyer.kp.publicKey, authority, payer: authority, tokenProgram: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId } as any).rpc();
    await deposit(buyer.kp, buyerEngAta, energyMintPda, 1);

    const sellerCurAta = getAssociatedTokenAddressSync(currencyMint, seller.kp.publicKey, false, TOKEN_PROGRAM_ID);
    await provider.sendAndConfirm(new Transaction().add(createAssociatedTokenAccountInstruction(authority, sellerCurAta, seller.kp.publicKey, currencyMint, TOKEN_PROGRAM_ID)));
    await mintTo(provider.connection, payer, currencyMint, sellerCurAta, payer, 1);
    await deposit(seller.kp, sellerCurAta, currencyMint, 1);

    const buyerOrderId = Buffer.alloc(16); buyerOrderId.writeUInt32LE(0xa1, 0);
    const sellerOrderId = Buffer.alloc(16); sellerOrderId.writeUInt32LE(0xb2, 0);
    const matchAmount = 100, matchPrice = 50;

    const buyerMsg = orderMessage({ orderId: buyerOrderId, user: buyer.kp.publicKey, energyAmount: matchAmount, pricePerKwh: 60, side: 0, zoneId, expiresAt: 0 });
    const sellerMsg = orderMessage({ orderId: sellerOrderId, user: seller.kp.publicKey, energyAmount: matchAmount, pricePerKwh: 50, side: 1, zoneId, expiresAt: 0 });

    const buyerEd = Ed25519Program.createInstructionWithPrivateKey({ privateKey: buyer.kp.secretKey, message: buyerMsg });
    const sellerEd = Ed25519Program.createInstructionWithPrivateKey({ privateKey: seller.kp.secretKey, message: sellerMsg });

    const buyerPayload = { orderId: [...buyerOrderId], user: buyer.kp.publicKey, energyAmount: new BN(matchAmount), pricePerKwh: new BN(60), side: 0, zoneId, expiresAt: new BN(0) };
    const sellerPayload = { orderId: [...sellerOrderId], user: seller.kp.publicKey, energyAmount: new BN(matchAmount), pricePerKwh: new BN(50), side: 1, zoneId, expiresAt: new BN(0) };

    // Settlement writes per-payer shards (selected by payer pubkey % num_shards); they
    // must be initialized first.
    const marketAcct: any = await tradingProgram.account.market.fetch(marketPda);
    const zoneAcct: any = await tradingProgram.account.zoneMarket.fetch(zoneMarketPda);
    const marketShardByte = authority.toBuffer()[0] % (Number(marketAcct.numShards) || 16);
    const zoneShardByte = authority.toBuffer()[0] % (Number(zoneAcct.numShards) || 16);
    const marketShardPda = PublicKey.findProgramAddressSync([Buffer.from("market_shard"), marketPda.toBuffer(), Buffer.from([marketShardByte])], tradingProgram.programId)[0];
    const zoneShardPda = PublicKey.findProgramAddressSync([Buffer.from("zone_shard"), zoneMarketPda.toBuffer(), Buffer.from([zoneShardByte])], tradingProgram.programId)[0];
    try {
      await tradingProgram.methods.initializeMarketShard(marketShardByte).accounts({ market: marketPda, marketShard: marketShardPda, payer: authority, systemProgram: SystemProgram.programId } as any).rpc();
    } catch (e) { /* already initialized */ }
    try {
      await tradingProgram.methods.initializeZoneMarketShard(zoneShardByte).accounts({ zoneMarket: zoneMarketPda, zoneShard: zoneShardPda, payer: authority, systemProgram: SystemProgram.programId } as any).rpc();
    } catch (e) { /* already initialized */ }

    const settleIx = await tradingProgram.methods
      .settleOffchainMatch(buyerPayload as any, sellerPayload as any, new BN(matchAmount), new BN(matchPrice), new BN(1), new BN(1))
      .accounts({
        market: marketPda,
        zoneMarket: zoneMarketPda,
        buyerNullifier: nullifierPda(buyer.kp.publicKey, buyerOrderId),
        sellerNullifier: nullifierPda(seller.kp.publicKey, sellerOrderId),
        currencyMint,
        energyMint: energyMintPda,
        marketAuthority: marketAuthorityPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        secondaryTokenProgram: TOKEN_2022_PROGRAM_ID,
        buyerCurrencyEscrow: escrowPda(buyer.kp.publicKey, currencyMint),
        sellerCurrencyEscrow: escrowPda(seller.kp.publicKey, currencyMint),
        sellerEnergyEscrow: escrowPda(seller.kp.publicKey, energyMintPda),
        buyerEnergyEscrow: escrowPda(buyer.kp.publicKey, energyMintPda),
        feeCollector: collectorPda("fee_collector", currencyMint),
        wheelingCollector: collectorPda("wheeling_collector", currencyMint),
        lossCollector: collectorPda("loss_collector", currencyMint),
        marketShard: marketShardPda,
        zoneShard: zoneShardPda,
        payer: authority,
        sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();

    // The settle path carries ~20 accounts + two Ed25519 verify ixs, which overflows a
    // legacy tx (1232 B). Real callers must use a v0 tx + Address Lookup Table.
    // solana-test-validator can race preflight against a just-fetched blockhash; send
    // legacy txs with skipPreflight + a freshly-fetched blockhash, retrying on failure.
    const sendLegacy = async (...ixs: anchor.web3.TransactionInstruction[]) => {
      let lastErr: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash("confirmed");
        const tx = new Transaction({ feePayer: authority, blockhash, lastValidBlockHeight }).add(...ixs);
        tx.sign(payer);
        try {
          const s = await provider.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
          const conf = await provider.connection.confirmTransaction({ signature: s, blockhash, lastValidBlockHeight }, "confirmed");
          if (conf.value.err) throw new Error("tx failed: " + JSON.stringify(conf.value.err));
          return s;
        } catch (e: any) {
          lastErr = e;
          await new Promise((res) => setTimeout(res, 400));
        }
      }
      throw lastErr;
    };

    const altAddrs = [...new Set(settleIx.keys.filter((k) => !k.isSigner).map((k) => k.pubkey.toBase58()))].map((s) => new PublicKey(s));
    const recentSlot = await provider.connection.getSlot();
    const [createAltIx, altAddress] = AddressLookupTableProgram.createLookupTable({ authority, payer: authority, recentSlot });
    const extendAltIx = AddressLookupTableProgram.extendLookupTable({ payer: authority, authority, lookupTable: altAddress, addresses: altAddrs });
    await sendLegacy(createAltIx, extendAltIx);

    // The ALT extension is only usable once a slot advances past it. Advance the chain
    // with a throwaway tx, then re-fetch the table right before compiling.
    for (let w = 0; w < 3; w++) {
      await sendLegacy(SystemProgram.transfer({ fromPubkey: authority, toPubkey: authority, lamports: 1 }));
    }
    let alt: any = null;
    for (let i = 0; i < 40; i++) {
      const r = await provider.connection.getAddressLookupTable(altAddress);
      if (r.value && r.value.state.addresses.length >= altAddrs.length) { alt = r.value; break; }
      await new Promise((res) => setTimeout(res, 400));
    }
    expect(alt, "ALT activated").to.not.be.null;

    // fee_collector is a shared global PDA — measure the delta so the test is re-runnable.
    const feeCollectorPda = collectorPda("fee_collector", currencyMint);
    const feeBefore = Number((await getAccount(provider.connection, feeCollectorPda)).amount);

    // solana-test-validator can race preflight against a just-fetched blockhash;
    // retry with a freshly-fetched blockhash each attempt.
    let sig: string | null = null;
    let lastErr: any = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash("confirmed");
      const v0msg = new TransactionMessage({
        payerKey: authority,
        recentBlockhash: blockhash,
        instructions: [buyerEd, sellerEd, settleIx],
      }).compileToV0Message([alt]);
      const vtx = new VersionedTransaction(v0msg);
      vtx.sign([payer]);
      try {
        sig = await provider.connection.sendTransaction(vtx, { skipPreflight: true });
        const conf = await provider.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        if (conf.value.err) throw new Error("settle tx failed: " + JSON.stringify(conf.value.err));
        break;
      } catch (e: any) {
        lastErr = e;
        await new Promise((res) => setTimeout(res, 400));
      }
    }
    if (!sig) throw lastErr;

    // total = 100*50 = 5000; fee = 5000*25/10000 = 12; wheeling=1; loss=1; net = 4986.
    // seller/buyer escrows use fresh keys each run (seeded with 1), so absolute checks hold.
    const sellerCurEscrow = escrowPda(seller.kp.publicKey, currencyMint);
    const buyerEngEscrow = escrowPda(buyer.kp.publicKey, energyMintPda);
    expect(Number((await getAccount(provider.connection, sellerCurEscrow)).amount)).to.equal(1 + 4986);
    expect(Number((await getAccount(provider.connection, buyerEngEscrow, undefined, TOKEN_2022_PROGRAM_ID)).amount)).to.equal(1 + matchAmount);
    const feeAfter = Number((await getAccount(provider.connection, feeCollectorPda)).amount);
    expect(feeAfter - feeBefore, "fee collected this settle").to.equal(12);
  });
});
