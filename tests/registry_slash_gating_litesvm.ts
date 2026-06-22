// Litesvm coverage for the registry slash/stake GATING guards that protect the
// validator-bond security model, previously untested:
//   - SlashDestinationNotSet  — the registry refuses to slash until a destination is set.
//   - InvalidSlashDestination — a slash may only pay its fund remainder to the configured
//     destination (no misroute to an attacker account).
//   - InsufficientStakingBalance — unstake can't withdraw more than the staked bond.
//
// The slash-distribution math + InvalidSlashFraction/NotActiveValidator are covered by
// tests/slash_distribution_litesvm.ts. Here the validator stays Active throughout (every
// slash attempt reverts), so the guards are isolated. Guard order (slash_validator,
// lib.rs:844-867): InvalidSlashFraction → UnauthorizedAuthority → SlashDestinationNotSet
// → InvalidSlashDestination → NotActiveValidator, so the destination guards fire on an
// Active validator before the status check.

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import * as anchorPkg from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Registry } from "../target/types/registry";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
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
import { admitAggregator } from "./litesvm-admit";

const require = createRequire(import.meta.url);
const idl = require("../target/idl/registry.json");

const GRX = (n: number) => new BN(n).mul(new BN("1000000000")); // n GRX -> base units

describe("registry slash/stake gating guards (litesvm)", () => {
  let svm: LiteSVM;
  let program: Program<Registry>;
  let programId: PublicKey;

  const payer = Keypair.generate(); // registry/mint authority (the slasher)
  const user = Keypair.generate(); // the validator
  const fundOwner = Keypair.generate();
  const wrongOwner = Keypair.generate();
  const mint = Keypair.generate();

  let registryPda: PublicKey;
  let vaultPda: PublicKey;
  let userPda: PublicKey;
  let userShardPda: PublicKey;
  let userAta: PublicKey;
  let fundAta: PublicKey;
  let wrongAta: PublicKey;

  function trySend(ixs: TransactionInstruction[], signers: Keypair[]): FailedTransactionMetadata | null {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    ixs.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...signers);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res instanceof FailedTransactionMetadata ? res : null;
  }
  function send(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const f = trySend(ixs, signers);
    if (f) throw new Error("tx failed: " + f.err().toString() + "\n" + f.meta().logs().join("\n"));
  }
  function sendExpectFail(ixs: TransactionInstruction[], signers: Keypair[] = []): string {
    const f = trySend(ixs, signers);
    if (!f) throw new Error("expected tx to fail but it succeeded");
    return f.err().toString() + "\n" + f.meta().logs().join("\n");
  }

  function slashIx(slashDestination: PublicKey, slashBps = 1000, provenLoss = GRX(1000)) {
    return program.methods
      .slashValidator(slashBps, provenLoss)
      .accounts({
        targetAuthority: user.publicKey,
        targetUserAccount: userPda,
        grxVault: vaultPda,
        registry: registryPda,
        slashDestination,
        victimTokenAccount: fundAta,
        grxMint: mint.publicKey,
        authority: payer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
  }

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    program = new Program(idl, { connection: {}, publicKey: PublicKey.default } as any);
    programId = program.programId;
    svm.addProgramFromFile(programId, "target/deploy/registry.so");

    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));
    svm.airdrop(user.publicKey, BigInt(1_000_000_000));

    [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], programId);
    [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("grx_vault")], programId);
    [userPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), user.publicKey.toBuffer()], programId);
    const userShardId = user.publicKey.toBytes()[0] % 16;
    [userShardPda] = PublicKey.findProgramAddressSync([Buffer.from("registry_shard"), Buffer.from([userShardId])], programId);
    userAta = getAssociatedTokenAddressSync(mint.publicKey, user.publicKey, false, TOKEN_2022_PROGRAM_ID);
    fundAta = getAssociatedTokenAddressSync(mint.publicKey, fundOwner.publicKey, false, TOKEN_2022_PROGRAM_ID);
    wrongAta = getAssociatedTokenAddressSync(mint.publicKey, wrongOwner.publicKey, false, TOKEN_2022_PROGRAM_ID);

    const mintRent = Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)));
    send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports: mintRent, space: MINT_SIZE, programId: TOKEN_2022_PROGRAM_ID }),
      createInitializeMint2Instruction(mint.publicKey, 9, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
      createAssociatedTokenAccountInstruction(payer.publicKey, userAta, user.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
      createAssociatedTokenAccountInstruction(payer.publicKey, fundAta, fundOwner.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
      createAssociatedTokenAccountInstruction(payer.publicKey, wrongAta, wrongOwner.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
      createMintToInstruction(mint.publicKey, userAta, payer.publicKey, BigInt(GRX(31000).toString()), [], TOKEN_2022_PROGRAM_ID),
    ], [mint]);

    send([
      await program.methods.initialize().accounts({ registry: registryPda, authority: payer.publicKey, systemProgram: SystemProgram.programId }).instruction(),
      await program.methods.initializeShard(userShardId).accounts({ shard: userShardPda, authority: payer.publicKey, systemProgram: SystemProgram.programId }).instruction(),
    ]);
    send([await program.methods.registerUser({ prosumer: {} }, 0, 0, new BN(0), userShardId).accounts({
      userAccount: userPda, registryShard: userShardPda, registry: registryPda, authority: user.publicKey, payer: payer.publicKey, systemProgram: SystemProgram.programId,
    }).instruction()]);
    send([await program.methods.initializeVault().accounts({
      registry: registryPda, grxVault: vaultPda, grxMint: mint.publicKey, authority: payer.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: anchorPkg.web3.SYSVAR_RENT_PUBKEY,
    }).instruction()]);
    send([await program.methods.stakeGrx(GRX(30000)).accounts({
      registry: registryPda, userAccount: userPda, grxVault: vaultPda, userGrxAta: userAta, grxMint: mint.publicKey, authority: user.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
    }).instruction()], [user]);
    send([await program.methods.registerValidator().accounts({ userAccount: userPda, aggregatorEntry: admitAggregator(svm, user.publicKey), authority: user.publicKey }).instruction()], [user]);
    // NOTE: slash destination intentionally NOT set yet — exercised by the first test.
  });

  it("refuses to slash before a slash destination is configured (SlashDestinationNotSet)", async () => {
    // dest != victim (fundAta) to avoid the duplicate-mutable-account constraint; the
    // has_slash_destination check fires before the destination-key match anyway.
    const blob = sendExpectFail([await slashIx(wrongAta)]);
    expect(blob, blob).to.match(/SlashDestinationNotSet/);
  });

  it("refuses to slash to a destination other than the configured one (InvalidSlashDestination)", async () => {
    // Configure the fund destination, then attempt a slash routed to a different account.
    send([await program.methods.setSlashDestination(fundAta).accounts({ registry: registryPda, authority: payer.publicKey }).instruction()]);
    const blob = sendExpectFail([await slashIx(wrongAta)]); // wrongAta != registry.slash_destination
    expect(blob, blob).to.match(/InvalidSlashDestination/);
  });

  it("rejects unstaking more than the staked bond (InsufficientStakingBalance)", async () => {
    const ix = await program.methods
      .unstakeGrx(GRX(30000).add(new BN(1))) // staked is exactly 30,000
      .accounts({
        registry: registryPda, userAccount: userPda, grxVault: vaultPda, userGrxAta: userAta,
        grxMint: mint.publicKey, authority: user.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
    const blob = sendExpectFail([ix], [user]);
    expect(blob, blob).to.match(/InsufficientStakingBalance/);
  });

  it("refuses register_validator without a governance-admitted aggregator entry (AggregatorNotAdmitted)", async () => {
    // An entry account not owned by the governance program must be rejected — the
    // validator bond cannot be self-granted by anyone holding MIN stake. The gate runs
    // even though `user` is already Active from the before-all setup.
    const bogusEntry = Keypair.generate().publicKey; // never admitted; owner = system program
    const ix = await program.methods
      .registerValidator()
      .accounts({ userAccount: userPda, aggregatorEntry: bogusEntry, authority: user.publicKey })
      .instruction();
    const blob = sendExpectFail([ix], [user]);
    expect(blob, blob).to.match(/AggregatorNotAdmitted/);
  });
});
