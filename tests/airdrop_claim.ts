import * as anchor from "@anchor-lang/core";
import { Program, EventParser } from "@anchor-lang/core";
import { Registry } from "../target/types/registry";
import { EnergyToken } from "../target/types/energy_token";
import { expect } from "chai";
import { PublicKey, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";
import * as os from "os";

const AIRDROP_AMOUNT = 20_000_000_000; // 20 GRX (see registry AIRDROP_AMOUNT)

/**
 * The welcome airdrop is decoupled from register_user: a failed mint CPI aborts its
 * whole transaction, so bundling it with registration would let a mint failure roll
 * back the user record. These tests prove the decoupled flow:
 *   1. register_user always succeeds and leaves airdrop_claimed = 0 (no mint inline).
 *   2. claim_airdrop mints the airdrop and flips the flag.
 *   3. a second claim is rejected (idempotent / no double-mint).
 */
describe("airdrop_claim", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Registry as Program<Registry>;
  const energyTokenProgram = anchor.workspace.EnergyToken as Program<EnergyToken>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const wallet = provider.wallet;
  const payer = (wallet as any).payer as Keypair;

  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(os.homedir() + "/.config/solana/id.json", "utf-8")))
  );

  const [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], program.programId);
  const [energyMintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], energyTokenProgram.programId);
  const [energyTokenInfoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], energyTokenProgram.programId);

  // Shared across the two tests.
  let userKeypair: Keypair;
  let userPda: PublicKey;
  let userAta: PublicKey;

  it("register_user succeeds without minting (airdrop_claimed = 0)", async () => {
    userKeypair = Keypair.generate();
    while (userKeypair.publicKey.toBytes()[0] % 16 >= 4) userKeypair = Keypair.generate();
    const shardId = userKeypair.publicKey.toBytes()[0] % 16;

    [userPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), userKeypair.publicKey.toBuffer()],
      program.programId
    );
    const [shardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry_shard"), Buffer.from([shardId])],
      program.programId
    );

    try {
      await program.methods
        .initializeShard(shardId)
        .accounts({ shard: shardPda, authority: wallet.publicKey, systemProgram: SystemProgram.programId } as any)
        .rpc();
    } catch (_) { /* already initialized */ }

    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: userKeypair.publicKey, lamports: 10_000_000 })
      )
    );

    // register_user no longer takes any energy-token accounts.
    const ix = await program.methods
      .registerUser({ prosumer: {} }, 13700000, 100500000, new BN(0), shardId)
      .accounts({
        userAccount: userPda,
        registryShard: shardPda,
        registry: registryPda,
        authority: userKeypair.publicKey,
        payer: walletKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();

    await sendAndConfirmTransaction(provider.connection, new Transaction().add(ix), [walletKeypair, userKeypair]);

    const user: any = await program.account.userAccount.fetch(userPda);
    expect(user.authority.toBase58()).to.equal(userKeypair.publicKey.toBase58());
    expect(user.airdropClaimed, "airdrop not yet claimed").to.equal(0);
  });

  it("claim_airdrop mints the airdrop, flips the flag, and emits AirdropClaimed", async () => {
    // The user's energy ATA must exist before the mint CPI.
    const ata = await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, energyMintPda, userKeypair.publicKey, false, undefined, undefined, TOKEN_PROGRAM_ID
    );
    userAta = ata.address;
    expect(userAta.toBase58()).to.equal(
      getAssociatedTokenAddressSync(energyMintPda, userKeypair.publicKey, false, TOKEN_PROGRAM_ID).toBase58()
    );

    const ix = await program.methods
      .claimAirdrop()
      .accounts({
        userAccount: userPda,
        registry: registryPda,
        authority: userKeypair.publicKey,
        payer: walletKeypair.publicKey,
        energyTokenProgram: energyTokenProgram.programId,
        mint: energyMintPda,
        userTokenAccount: userAta,
        tokenInfo: energyTokenInfoPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .instruction();

    const txSig = await sendAndConfirmTransaction(
      provider.connection, new Transaction().add(ix), [walletKeypair, userKeypair]
    );

    // Balance minted.
    const bal = await provider.connection.getTokenAccountBalance(userAta);
    expect(Number(bal.value.amount), "airdrop minted").to.equal(AIRDROP_AMOUNT);

    // Flag flipped.
    const user: any = await program.account.userAccount.fetch(userPda);
    expect(user.airdropClaimed, "claimed flag set").to.equal(1);

    // Event observable (and this time it persists — the tx succeeded).
    const txInfo = await provider.connection.getTransaction(txSig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const parser = new EventParser(program.programId, (program as any).coder);
    const events = [...parser.parseLogs(txInfo!.meta!.logMessages!)];
    const ev = events.find((e) => e.name === "AirdropClaimed" || e.name === "airdropClaimed");
    expect(ev, "AirdropClaimed emitted").to.not.be.undefined;
    expect(ev!.data.user.toBase58()).to.equal(userKeypair.publicKey.toBase58());
  });

  it("rejects a second claim (no double airdrop)", async () => {
    const ix = await program.methods
      .claimAirdrop()
      .accounts({
        userAccount: userPda,
        registry: registryPda,
        authority: userKeypair.publicKey,
        payer: walletKeypair.publicKey,
        energyTokenProgram: energyTokenProgram.programId,
        mint: energyMintPda,
        userTokenAccount: userAta,
        tokenInfo: energyTokenInfoPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .instruction();

    let threw = false;
    try {
      await sendAndConfirmTransaction(provider.connection, new Transaction().add(ix), [walletKeypair, userKeypair]);
    } catch (e: any) {
      threw = true;
      expect(JSON.stringify(e.logs ?? e.message)).to.match(/AirdropAlreadyClaimed/);
    }
    expect(threw, "second claim rejected").to.be.true;

    // Balance unchanged — no second mint.
    const bal = await provider.connection.getTokenAccountBalance(userAta);
    expect(Number(bal.value.amount)).to.equal(AIRDROP_AMOUNT);
  });
});
