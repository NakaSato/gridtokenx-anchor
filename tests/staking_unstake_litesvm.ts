// Litesvm port of the registry unstake happy-path that tests/staking.ts must skip
// against a live validator: unstake_grx enforces UNSTAKE_COOLDOWN_SECS (24h) and a
// live validator offers no clock control. Litesvm's setClock lets us warp past the
// cooldown and exercise both the successful withdrawal and the validator
// demote-on-unstake branch (Active -> Suspended when remaining stake < MIN).
//
// Everything is built as raw instructions (anchor `.instruction()` + spl-token ix
// builders) and sent through `svm.sendTransaction` — no live Connection / `.rpc()`.

import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
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
  unpackAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const idl = require("../target/idl/registry.json");

const UNSTAKE_COOLDOWN_SECS = 24 * 60 * 60; // mirrors registry::UNSTAKE_COOLDOWN_SECS
const MIN_VALIDATOR_STAKE = new BN("10000000000000"); // 10,000 GRX (9 decimals)
const GRX = (n: number) => new BN(n).mul(new BN("1000000000")); // n GRX -> base units

describe("registry_staking unstake (litesvm, clock-warped)", () => {
  let svm: LiteSVM;
  let program: Program<Registry>;
  let programId: PublicKey;

  const payer = Keypair.generate(); // funds + registry/mint authority
  const user = Keypair.generate();
  const mint = Keypair.generate();

  let registryPda: PublicKey;
  let vaultPda: PublicKey;
  let userPda: PublicKey;
  let userShardPda: PublicKey;
  let userAta: PublicKey;

  // Send a built tx through litesvm; throw with logs on failure.
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
    svm.expireBlockhash(); // fresh blockhash so the next tx isn't deduped
    return res;
  }

  function fetchUser() {
    const acc = svm.getAccount(userPda);
    if (!acc) throw new Error("userPda not found");
    const data = Buffer.from(acc.data);
    try {
      return program.coder.accounts.decode("userAccount", data);
    } catch {
      return program.coder.accounts.decode("UserAccount", data);
    }
  }

  function ataAmount(): bigint {
    const acc = svm.getAccount(userAta)!;
    const parsed = unpackAccount(
      userAta,
      { ...acc, data: Buffer.from(acc.data) } as any,
      TOKEN_2022_PROGRAM_ID
    );
    return parsed.amount;
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
    [userPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), user.publicKey.toBuffer()],
      programId
    );
    const userShardId = user.publicKey.toBytes()[0] % 16;
    [userShardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry_shard"), Buffer.from([userShardId])],
      programId
    );
    userAta = getAssociatedTokenAddressSync(
      mint.publicKey,
      user.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    // --- Token-2022 mint + user ATA + 11,000 GRX to the user ---
    const mintRent = Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)));
    send(
      [
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: mint.publicKey,
          lamports: mintRent,
          space: MINT_SIZE,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(
          mint.publicKey,
          9,
          payer.publicKey,
          null,
          TOKEN_2022_PROGRAM_ID
        ),
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          userAta,
          user.publicKey,
          mint.publicKey,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        ),
        createMintToInstruction(
          mint.publicKey,
          userAta,
          payer.publicKey,
          BigInt(GRX(11000).toString()),
          [],
          TOKEN_2022_PROGRAM_ID
        ),
      ],
      [mint]
    );

    // --- Registry init: registry, user shard, register user, vault ---
    const initIx = await program.methods
      .initialize()
      .accounts({
        registry: registryPda,
        authority: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const shardIx = await program.methods
      .initializeShard(userShardId)
      .accounts({
        shard: userShardPda,
        authority: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    send([initIx, shardIx], []);

    const registerUserIx = await program.methods
      .registerUser({ prosumer: {} }, 0, 0, new BN(0), userShardId)
      .accounts({
        userAccount: userPda,
        registryShard: userShardPda,
        registry: registryPda,
        authority: user.publicKey, // the user being registered (not a signer per IDL)
        payer: payer.publicKey, // funds the account (the signer)
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    send([registerUserIx], []);

    const vaultIx = await program.methods
      .initializeVault()
      .accounts({
        registry: registryPda,
        grxVault: vaultPda,
        grxMint: mint.publicKey,
        authority: payer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchorPkg.web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();
    send([vaultIx], []);

    // --- Stake exactly MIN, then become an Active validator ---
    const stakeIx = await program.methods
      .stakeGrx(MIN_VALIDATOR_STAKE)
      .accounts({
        registry: registryPda,
        userAccount: userPda,
        grxVault: vaultPda,
        userGrxAta: userAta,
        grxMint: mint.publicKey,
        authority: user.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
    send([stakeIx], [user]);

    const regValidatorIx = await program.methods
      .registerValidator()
      .accounts({ userAccount: userPda, authority: user.publicKey })
      .instruction();
    send([regValidatorIx], [user]);
  });

  it("is staked and Active before unstaking", () => {
    const u = fetchUser();
    expect(u.stakedGrx.toString()).to.equal(MIN_VALIDATOR_STAKE.toString());
    expect(Object.keys(u.validatorStatus)[0]).to.equal("active");
  });

  it("unstakes after warping past the cooldown and demotes the validator", async () => {
    const unstakeAmt = GRX(100); // 10,000 -> 9,900 (< MIN) => demote to Suspended
    const beforeStake = new BN(fetchUser().stakedGrx.toString());
    const beforeAta = ataAmount();

    // Warp the clock past UNSTAKE_COOLDOWN_SECS so the cooldown gate passes.
    const c = svm.getClock();
    svm.setClock(
      new Clock(
        c.slot + 100n,
        c.epochStartTimestamp,
        c.epoch,
        c.leaderScheduleEpoch,
        c.unixTimestamp + BigInt(UNSTAKE_COOLDOWN_SECS + 1)
      )
    );

    const unstakeIx = await program.methods
      .unstakeGrx(unstakeAmt)
      .accounts({
        userAccount: userPda,
        grxVault: vaultPda,
        registry: registryPda,
        userGrxAta: userAta,
        grxMint: mint.publicKey,
        authority: user.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
    send([unstakeIx], [user]);

    const u = fetchUser();
    expect(new BN(u.stakedGrx.toString()).toString()).to.equal(
      beforeStake.sub(unstakeAmt).toString()
    );
    expect(ataAmount() - beforeAta).to.equal(BigInt(unstakeAmt.toString()));
    // Remaining stake (9,900 GRX) < MIN_VALIDATOR_STAKE -> demoted.
    expect(Object.keys(u.validatorStatus)[0]).to.equal("suspended");
  });

  // Regression: the dust-stake cooldown bypass. stake_grx must re-anchor
  // last_stake_at on EVERY stake (not only on the 0 -> nonzero transition).
  // The account still holds ~9,900 GRX (nonzero) from the prior test, so this
  // top-up is exactly the "add onto an existing balance" case the old code
  // failed to re-lock. With the fix, an immediate unstake at the same clock
  // must be rejected by the 24h cooldown — UnstakingLocked.
  it("re-locks the cooldown on a top-up onto an existing balance", async () => {
    const topUp = GRX(50);
    const stakedBefore = new BN(fetchUser().stakedGrx.toString());
    expect(stakedBefore.gtn(0), "account must already hold a nonzero stake").to.equal(true);

    // No clock advance: stake_grx sets last_stake_at = current (warped) clock,
    // and the unstake below runs at the same timestamp => cooldown not elapsed.
    const stakeIx = await program.methods
      .stakeGrx(topUp)
      .accounts({
        registry: registryPda,
        userAccount: userPda,
        grxVault: vaultPda,
        userGrxAta: userAta,
        grxMint: mint.publicKey,
        authority: user.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
    send([stakeIx], [user]);

    const unstakeIx = await program.methods
      .unstakeGrx(topUp)
      .accounts({
        userAccount: userPda,
        grxVault: vaultPda,
        registry: registryPda,
        userGrxAta: userAta,
        grxMint: mint.publicKey,
        authority: user.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();

    let locked = false;
    try {
      send([unstakeIx], [user]);
    } catch (e) {
      locked = true;
      expect(String(e)).to.match(/UnstakingLocked/);
    }
    expect(locked, "top-up must re-anchor the cooldown (no instant unstake)").to.equal(true);

    // Stake is unchanged (the unstake was rejected), balance still held in vault.
    expect(fetchUser().stakedGrx.toString()).to.equal(
      stakedBefore.add(topUp).toString()
    );
  });
});
