// Litesvm coverage for two previously-untested registry admin mutations:
// update_user_status (lib.rs:428) and update_authority (lib.rs:170). Both are gated on
// the caller being the current registry.authority (require_keys_eq → UnauthorizedAuthority).
//
// update_authority is a single-step rotation (not the 2-step propose/approve flow the
// governance program uses) — this locks that the rotation takes effect immediately and the
// old authority is then locked out.

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
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
import BN from "bn.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const idl = require("../target/idl/registry.json");

describe("registry admin mutations: update_user_status + update_authority (litesvm)", () => {
  let svm: LiteSVM;
  let program: Program<Registry>;
  let programId: PublicKey;

  const payer = Keypair.generate();    // initial registry authority + funder
  const user = Keypair.generate();
  const attacker = Keypair.generate();
  const newAuthority = Keypair.generate();

  let registryPda: PublicKey;
  let userPda: PublicKey;
  let shardPda: PublicKey;
  let shardId: number;

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

  const registry = () => program.coder.accounts.decode("registry", Buffer.from(svm.getAccount(registryPda)!.data));
  const userAccount = () => program.coder.accounts.decode("userAccount", Buffer.from(svm.getAccount(userPda)!.data));
  const statusKey = (s: any) => Object.keys(s)[0];

  const statusIx = (authority: PublicKey, status: any) =>
    program.methods.updateUserStatus(status).accounts({ registry: registryPda, userAccount: userPda, authority } as any).instruction();
  const authIx = (authority: PublicKey, newAuth: PublicKey) =>
    program.methods.updateAuthority(newAuth).accounts({ registry: registryPda, authority } as any).instruction();

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    program = new Program(idl, { connection: {}, publicKey: PublicKey.default } as any);
    programId = program.programId;
    svm.addProgramFromFile(programId, "target/deploy/registry.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));
    svm.airdrop(attacker.publicKey, BigInt(1_000_000_000));
    svm.airdrop(newAuthority.publicKey, BigInt(1_000_000_000));

    [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], programId);
    [userPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), user.publicKey.toBuffer()], programId);
    shardId = user.publicKey.toBytes()[0] % 16;
    [shardPda] = PublicKey.findProgramAddressSync([Buffer.from("registry_shard"), Buffer.from([shardId])], programId);

    send([
      await program.methods.initialize().accounts({ registry: registryPda, authority: payer.publicKey, systemProgram: SystemProgram.programId }).instruction(),
      await program.methods.initializeShard(shardId).accounts({ shard: shardPda, authority: payer.publicKey, systemProgram: SystemProgram.programId }).instruction(),
    ]);
    send([await program.methods.registerUser({ prosumer: {} }, 0, 0, new BN(0), shardId).accounts({
      userAccount: userPda, registryShard: shardPda, registry: registryPda, authority: user.publicKey, payer: payer.publicKey, systemProgram: SystemProgram.programId,
    }).instruction()]);
  });

  // --- update_user_status ---

  it("registered user starts Active (precondition)", () => {
    expect(statusKey(userAccount().status)).to.equal("active");
  });

  it("rejects update_user_status from a non-authority (UnauthorizedAuthority)", async () => {
    const blob = sendExpectFail([await statusIx(attacker.publicKey, { suspended: {} })], [attacker]);
    expect(blob, blob).to.match(/UnauthorizedAuthority/);
  });

  it("authority suspends the user (control)", async () => {
    send([await statusIx(payer.publicKey, { suspended: {} })]);
    expect(statusKey(userAccount().status)).to.equal("suspended");
  });

  it("authority reactivates the user (control)", async () => {
    send([await statusIx(payer.publicKey, { active: {} })]);
    expect(statusKey(userAccount().status)).to.equal("active");
  });

  // --- update_authority (single-step rotation) ---

  it("rejects update_authority from a non-authority (UnauthorizedAuthority)", async () => {
    const blob = sendExpectFail([await authIx(attacker.publicKey, attacker.publicKey)], [attacker]);
    expect(blob, blob).to.match(/UnauthorizedAuthority/);
  });

  it("rotates the registry authority (control)", async () => {
    send([await authIx(payer.publicKey, newAuthority.publicKey)]);
    expect(registry().authority.toBase58()).to.equal(newAuthority.publicKey.toBase58());
  });

  it("locks out the old authority after rotation (UnauthorizedAuthority)", async () => {
    const blob = sendExpectFail([await statusIx(payer.publicKey, { suspended: {} })]);
    expect(blob, blob).to.match(/UnauthorizedAuthority/);
  });

  it("the new authority can now drive admin mutations (control)", async () => {
    send([await statusIx(newAuthority.publicKey, { suspended: {} })], [newAuthority]);
    expect(statusKey(userAccount().status)).to.equal("suspended");
  });
});
