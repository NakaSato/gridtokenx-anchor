// Litesvm coverage for the FUNGIBLE REC token (1 token = 1 MWh, 6 decimals).
//
// REC is now a Token-2022 SPL mint (PDA [b"rec_mint"], mint authority = the governance
// [b"poa_config"] PDA). `issue_erc` mints REC to the producer alongside the provenance
// certificate; `retire_rec` burns them. Energy is metered in kWh and the mint has 6
// decimals, so 1 MWh = 1_000_000 base units and 1 kWh = 1_000 base units.
//
// Flow exercised end-to-end in-process (registry + governance + Token-2022):
//   registry: init -> shard -> registerUser -> registerMeter -> oracle reading (net 800)
//   governance: initializeGovernance -> init_rec_mint
//   issue_erc(500 kWh) -> producer REC ATA balance == 500 * 1_000 == 500_000 base units
//   retire_rec(200_000)  -> balance == 300_000
//   retire_rec(0)        -> rejected (InvalidAmount)
//
// Source: programs/governance/src/handlers/erc.rs (issue / init_rec_mint / retire_rec),
//         contexts.rs (IssueErc / InitRecMint / RetireRec).

import { LiteSVM, FailedTransactionMetadata, TransactionMetadata } from "litesvm";
import { Program } from "@anchor-lang/core";
import { Governance } from "../target/types/governance";
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
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const governanceIdl = require("../target/idl/governance.json");
const registryIdl = require("../target/idl/registry.json");

const METER_ID = "MTR-REC-001";
const CERT_ID = "REC-CERT-0001";

describe("governance fungible REC token (litesvm)", () => {
  let svm: LiteSVM;
  let gov: Program<Governance>;
  let reg: Program<Registry>;
  let govId: PublicKey;
  let regId: PublicKey;

  const payer = Keypair.generate(); // registry + governance authority + fee payer
  const user = Keypair.generate(); // meter owner / REC producer
  const oracle = Keypair.generate(); // meter reading oracle

  let registryPda: PublicKey;
  let shardPda: PublicKey;
  let userPda: PublicKey;
  let meterPda: PublicKey;
  let poaPda: PublicKey;
  let recMint: PublicKey;
  let ercPda: PublicKey;
  let userRecAta: PublicKey;
  let shardId: number;

  type IxLike = TransactionInstruction | Promise<TransactionInstruction>;
  async function trySend(ixs: IxLike[], extra: Keypair[] = []): Promise<FailedTransactionMetadata | null> {
    const resolved = await Promise.all(ixs);
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    resolved.forEach((ix) => tx.add(ix));
    tx.sign(payer, ...extra);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res instanceof FailedTransactionMetadata ? res : null;
  }
  async function send(ixs: IxLike[], extra: Keypair[] = []) {
    const f = await trySend(ixs, extra);
    if (f) throw new Error("tx failed: " + f.err().toString() + "\n" + f.meta().logs().join("\n"));
  }
  async function sendExpectFail(ixs: IxLike[], extra: Keypair[] = []): Promise<string> {
    const f = await trySend(ixs, extra);
    if (!f) throw new Error("expected tx to fail but it succeeded");
    return f.err().toString() + "\n" + f.meta().logs().join("\n");
  }
  // Like send(), but returns the single-instruction tx's CU consumed (throws on failure).
  async function sendCU(ixs: IxLike[], extra: Keypair[] = []): Promise<number> {
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
    return Number((res as TransactionMetadata).computeUnitsConsumed());
  }

  const CU_BUDGET = 200_000; // default per-instruction compute budget (SKILL.md invariant #4)

  function recBalance(): bigint {
    const acct = svm.getAccount(userRecAta)!;
    return unpackAccount(userRecAta, { ...acct, data: Buffer.from(acct.data) } as any, TOKEN_2022_PROGRAM_ID).amount;
  }

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms(); // bundles Token-2022 + ATA program

    reg = new Program(registryIdl, { connection: {}, publicKey: PublicKey.default } as any);
    gov = new Program(governanceIdl, { connection: {}, publicKey: PublicKey.default } as any);
    regId = reg.programId;
    govId = gov.programId;
    svm.addProgramFromFile(regId, "target/deploy/registry.so");
    svm.addProgramFromFile(govId, "target/deploy/governance.so");

    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));

    [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], regId);
    [userPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), user.publicKey.toBuffer()], regId);
    shardId = user.publicKey.toBytes()[0] % 16;
    [shardPda] = PublicKey.findProgramAddressSync([Buffer.from("registry_shard"), Buffer.from([shardId])], regId);
    [meterPda] = PublicKey.findProgramAddressSync([Buffer.from("meter"), user.publicKey.toBuffer(), Buffer.from(METER_ID)], regId);
    [poaPda] = PublicKey.findProgramAddressSync([Buffer.from("poa_config")], govId);
    [recMint] = PublicKey.findProgramAddressSync([Buffer.from("rec_mint")], govId);
    [ercPda] = PublicKey.findProgramAddressSync([Buffer.from("erc_certificate"), Buffer.from(CERT_ID)], govId);
    userRecAta = getAssociatedTokenAddressSync(recMint, user.publicKey, false, TOKEN_2022_PROGRAM_ID);

    // --- registry: arm a meter with net generation = 800 ---
    await send([
      await reg.methods.initialize().accounts({ registry: registryPda, authority: payer.publicKey, systemProgram: SystemProgram.programId }).instruction(),
      await reg.methods.initializeShard(shardId).accounts({ shard: shardPda, authority: payer.publicKey, systemProgram: SystemProgram.programId }).instruction(),
    ]);
    await send([await reg.methods.registerUser({ prosumer: {} }, 0, 0, new BN(0), shardId).accounts({
      userAccount: userPda, registryShard: shardPda, registry: registryPda, authority: user.publicKey, payer: payer.publicKey, systemProgram: SystemProgram.programId,
    }).instruction()]);
    await send([await reg.methods.registerMeter(METER_ID, { solar: {} }, shardId, 0).accounts({
      meterAccount: meterPda, userAccount: userPda, registryShard: shardPda, registry: registryPda,
      owner: user.publicKey, payer: payer.publicKey, systemProgram: SystemProgram.programId,
    }).instruction()]);
    await send([await reg.methods.setOracleAuthority(oracle.publicKey).accounts({ registry: registryPda, authority: payer.publicKey }).instruction()]);
    await send([await reg.methods.updateMeterReading(new BN(1000), new BN(200), new BN(1000)).accounts({
      registry: registryPda, meterAccount: meterPda, oracleAuthority: oracle.publicKey,
    } as any).instruction()], [oracle]);

    // --- governance: init config + REC mint ---
    await send([await gov.methods.initializeGovernance().accounts({
      governanceConfig: poaPda, authority: payer.publicKey, systemProgram: SystemProgram.programId,
    }).instruction()]);
    await send([await gov.methods.initRecMint().accounts({
      governanceConfig: poaPda, recMint, authority: payer.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any).instruction()]);
  });

  it("REC mint exists with 6 decimals after init_rec_mint", () => {
    const acct = svm.getAccount(recMint);
    expect(acct, "rec_mint account should exist").to.not.be.null;
    expect(acct!.data[44]).to.equal(6); // SPL Mint layout: decimals byte at offset 44
  });

  it("issue_erc mints 1 token/MWh of REC to the producer (500 kWh -> 500_000 base units)", async () => {
    const cu = await sendCU([await gov.methods.issueErc(CERT_ID, new BN(500), "Solar", "oracle-validated").accounts({
      governanceConfig: poaPda, ercCertificate: ercPda, meterAccount: meterPda, owner: user.publicKey,
      registry: registryPda, registryProgram: regId, recMint, recTokenAccount: userRecAta,
      tokenProgram: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      authority: payer.publicKey, systemProgram: SystemProgram.programId,
    } as any).instruction()], [user]);
    expect(recBalance()).to.equal(500_000n); // 500 kWh * 1_000 = 0.5 MWh
    // issue_erc now also CPIs registry::mark_erc_claimed AND token-2022 mint_to (ATA init):
    // confirm the hot provenance path stays under the 200k CU budget.
    console.log(`    issue_erc (with REC mint + ATA init): ${cu} CU`);
    expect(cu, "issue_erc CU").to.be.lessThan(CU_BUDGET);
  });

  it("retire_rec burns REC supply (200_000 -> balance 300_000)", async () => {
    const cu = await sendCU([await gov.methods.retireRec(new BN(200_000)).accounts({
      recMint, holder: user.publicKey, holderTokenAccount: userRecAta, tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as any).instruction()], [user]);
    expect(recBalance()).to.equal(300_000n);
    console.log(`    retire_rec (burn): ${cu} CU`);
    expect(cu, "retire_rec CU").to.be.lessThan(CU_BUDGET);
  });

  it("rejects retire_rec of zero (InvalidAmount)", async () => {
    const blob = await sendExpectFail([await gov.methods.retireRec(new BN(0)).accounts({
      recMint, holder: user.publicKey, holderTokenAccount: userRecAta, tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as any).instruction()], [user]);
    expect(blob, blob).to.match(/InvalidAmount/);
  });
});
