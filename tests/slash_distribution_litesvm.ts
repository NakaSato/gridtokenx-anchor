// Litesvm coverage for the reworked registry `slash_validator`: severity-scaled
// (slash_bps) slashing with capped victim compensation and a transparent fund
// remainder. Exercises a partial slash (validator stays Active), a full slash
// (terminal Slashed), the value-accounting invariant (slashed == comp + fund),
// the capped-compensation rule (comp <= proven_loss), and the bps guard.
//
// Raw instructions via anchor `.instruction()` + spl-token ix builders, sent
// through `svm.sendTransaction` — no live Connection / `.rpc()`.

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
  unpackAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const idl = require("../target/idl/registry.json");

const MIN_VALIDATOR_STAKE = new BN("10000000000000"); // 10,000 GRX (9 decimals)
const GRX = (n: number) => new BN(n).mul(new BN("1000000000")); // n GRX -> base units

describe("registry slash_validator distribution (litesvm)", () => {
  let svm: LiteSVM;
  let program: Program<Registry>;
  let programId: PublicKey;

  const payer = Keypair.generate(); // funds + registry/mint authority (the slasher)
  const user = Keypair.generate(); // the validator being slashed
  const fundOwner = Keypair.generate();
  const victimOwner = Keypair.generate();
  const mint = Keypair.generate();

  let registryPda: PublicKey;
  let vaultPda: PublicKey;
  let userPda: PublicKey;
  let userShardPda: PublicKey;
  let userAta: PublicKey;
  let fundAta: PublicKey;
  let victimAta: PublicKey;

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

  function fetchUser() {
    const acc = svm.getAccount(userPda)!;
    const data = Buffer.from(acc.data);
    try {
      return program.coder.accounts.decode("userAccount", data);
    } catch {
      return program.coder.accounts.decode("UserAccount", data);
    }
  }

  function ataAmount(ata: PublicKey): bigint {
    const acc = svm.getAccount(ata)!;
    return unpackAccount(ata, { ...acc, data: Buffer.from(acc.data) } as any, TOKEN_2022_PROGRAM_ID)
      .amount;
  }

  function status(): string {
    return Object.keys(fetchUser().validatorStatus)[0];
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
    userAta = getAssociatedTokenAddressSync(mint.publicKey, user.publicKey, false, TOKEN_2022_PROGRAM_ID);
    fundAta = getAssociatedTokenAddressSync(mint.publicKey, fundOwner.publicKey, false, TOKEN_2022_PROGRAM_ID);
    victimAta = getAssociatedTokenAddressSync(mint.publicKey, victimOwner.publicKey, false, TOKEN_2022_PROGRAM_ID);

    // Token-2022 mint + ATAs (user/fund/victim) + 31,000 GRX to the validator.
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
        createInitializeMint2Instruction(mint.publicKey, 9, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
        createAssociatedTokenAccountInstruction(payer.publicKey, userAta, user.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
        createAssociatedTokenAccountInstruction(payer.publicKey, fundAta, fundOwner.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
        createAssociatedTokenAccountInstruction(payer.publicKey, victimAta, victimOwner.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
        createMintToInstruction(mint.publicKey, userAta, payer.publicKey, BigInt(GRX(31000).toString()), [], TOKEN_2022_PROGRAM_ID),
      ],
      [mint]
    );

    // Registry init + shard + register validator user + vault.
    const initIx = await program.methods
      .initialize()
      .accounts({ registry: registryPda, authority: payer.publicKey, systemProgram: SystemProgram.programId })
      .instruction();
    const shardIx = await program.methods
      .initializeShard(userShardId)
      .accounts({ shard: userShardPda, authority: payer.publicKey, systemProgram: SystemProgram.programId })
      .instruction();
    send([initIx, shardIx], []);

    const registerUserIx = await program.methods
      .registerUser({ prosumer: {} }, 0, 0, new BN(0), userShardId)
      .accounts({
        userAccount: userPda,
        registryShard: userShardPda,
        registry: registryPda,
        authority: user.publicKey,
        payer: payer.publicKey,
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

    // Stake 30,000 GRX and become an Active validator.
    const stakeIx = await program.methods
      .stakeGrx(GRX(30000))
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

    // Point the slash fund at fundAta.
    const setDestIx = await program.methods
      .setSlashDestination(fundAta)
      .accounts({ registry: registryPda, authority: payer.publicKey })
      .instruction();
    send([setDestIx], []);
  });

  function slashIx(slashBps: number, provenLoss: BN) {
    return program.methods
      .slashValidator(slashBps, provenLoss)
      .accounts({
        targetAuthority: user.publicKey,
        targetUserAccount: userPda,
        grxVault: vaultPda,
        registry: registryPda,
        slashDestination: fundAta,
        victimTokenAccount: victimAta,
        grxMint: mint.publicKey,
        authority: payer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
  }

  it("rejects an out-of-range slash fraction", async () => {
    let failed = false;
    try {
      send([await slashIx(0, GRX(0))], []);
    } catch (e) {
      failed = true;
      expect(String(e)).to.match(/InvalidSlashFraction/);
    }
    expect(failed).to.equal(true);
  });

  it("partial slash: caps comp at proven loss, fund gets remainder, stays Active", async () => {
    // 10% of 30,000 = 3,000 slashed; proven loss 1,000 -> comp 1,000, fund 2,000.
    const beforeFund = ataAmount(fundAta);
    const beforeVictim = ataAmount(victimAta);

    send([await slashIx(1000, GRX(1000))], []);

    expect(ataAmount(victimAta) - beforeVictim).to.equal(BigInt(GRX(1000).toString()));
    expect(ataAmount(fundAta) - beforeFund).to.equal(BigInt(GRX(2000).toString()));
    // 30,000 - 3,000 = 27,000 (>= MIN) -> still Active.
    expect(fetchUser().stakedGrx.toString()).to.equal(GRX(27000).toString());
    expect(status()).to.equal("active");
  });

  it("full slash: terminal Slashed, comp capped, remainder to fund", async () => {
    // 100% of 27,000 slashed; proven loss 5,000 -> comp 5,000, fund 22,000.
    const beforeFund = ataAmount(fundAta);
    const beforeVictim = ataAmount(victimAta);

    send([await slashIx(10000, GRX(5000))], []);

    expect(ataAmount(victimAta) - beforeVictim).to.equal(BigInt(GRX(5000).toString()));
    expect(ataAmount(fundAta) - beforeFund).to.equal(BigInt(GRX(22000).toString()));
    expect(fetchUser().stakedGrx.toString()).to.equal("0");
    expect(status()).to.equal("slashed");
  });

  it("refuses to slash an already-slashed validator", async () => {
    let failed = false;
    try {
      send([await slashIx(5000, GRX(0))], []);
    } catch (e) {
      failed = true;
      expect(String(e)).to.match(/NotActiveValidator/);
    }
    expect(failed).to.equal(true);
  });
});
