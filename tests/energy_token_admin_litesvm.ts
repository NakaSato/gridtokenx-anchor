// Litesvm coverage for two previously-untested energy-token admin instructions:
// set_registry_authority (lib.rs:536) and create_token_mint (lib.rs:132).
//
// set_registry_authority: admin-only setter for token_info.registry_authority (the key
// the registry CPI must match in mint_tokens_direct — see mint_tokens_direct_litesvm.ts).
//
// create_token_mint: attaches Metaplex metadata to the mint. The ENTIRE body is gated on
// `metadata_program.executable`, and no Metaplex program is loaded on localnet/litesvm, so
// the body is a NO-OP here — only the account CONSTRAINTS (mint == token_info.mint,
// token_info.authority == authority) are exercised. The CPI branch is verified by
// compilation only (as the source comment notes).

import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import * as anchorPkg from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { EnergyToken } from "../target/types/energy_token";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const idl = require("../target/idl/energy_token.json");

describe("energy-token admin: set_registry_authority + create_token_mint (litesvm)", () => {
  let svm: LiteSVM;
  let program: Program<EnergyToken>;
  let programId: PublicKey;

  const payer = Keypair.generate();   // token admin authority + funder
  const attacker = Keypair.generate();
  const newRegistry = Keypair.generate().publicKey;
  const fakeMetadataProgram = Keypair.generate().publicKey; // non-executable → metadata branch skipped

  let mintPda: PublicKey;
  let infoPda: PublicKey;

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

  const tokenInfo = () => program.coder.accounts.decode("tokenInfo", Buffer.from(svm.getAccount(infoPda)!.data));

  const setRegistryIx = (authority: PublicKey, newAuth: PublicKey) =>
    program.methods.setRegistryAuthority(newAuth).accounts({ tokenInfo: infoPda, authority } as any).instruction();

  const createMintIx = (authority: PublicKey) =>
    program.methods.createTokenMint("GridToken", "GRID", "https://x").accounts({
      mint: mintPda, tokenInfo: infoPda, metadata: Keypair.generate().publicKey, payer: payer.publicKey,
      authority, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022_PROGRAM_ID,
      metadataProgram: fakeMetadataProgram, rent: SYSVAR_RENT_PUBKEY, sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
    } as any).instruction();

  before(async () => {
    svm = new LiteSVM().withDefaultPrograms();
    program = new Program(idl, { connection: {}, publicKey: PublicKey.default } as any);
    programId = program.programId;
    svm.addProgramFromFile(programId, "target/deploy/energy_token.so");
    svm.airdrop(payer.publicKey, BigInt(1_000_000_000_000));
    svm.airdrop(attacker.publicKey, BigInt(1_000_000_000));

    [mintPda] = PublicKey.findProgramAddressSync([Buffer.from("mint_2022")], programId);
    [infoPda] = PublicKey.findProgramAddressSync([Buffer.from("token_info_2022")], programId);

    send([await program.methods.initializeToken(PublicKey.default, payer.publicKey).accounts({
      tokenInfo: infoPda, mint: mintPda, authority: payer.publicKey,
      systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022_PROGRAM_ID, rent: anchorPkg.web3.SYSVAR_RENT_PUBKEY,
    } as any).instruction()]);
  });

  // --- set_registry_authority ---

  it("rejects set_registry_authority from a non-admin (UnauthorizedAuthority)", async () => {
    const blob = sendExpectFail([await setRegistryIx(attacker.publicKey, newRegistry)], [attacker]);
    expect(blob, blob).to.match(/UnauthorizedAuthority/);
  });

  it("admin updates the registry authority (control)", async () => {
    send([await setRegistryIx(payer.publicKey, newRegistry)]);
    expect(new PublicKey(tokenInfo().registryAuthority).toBase58()).to.equal(newRegistry.toBase58());
  });

  // --- create_token_mint (body no-op on localnet; only constraints fire) ---

  it("rejects create_token_mint from a non-admin authority (UnauthorizedAuthority)", async () => {
    const blob = sendExpectFail([await createMintIx(attacker.publicKey)], [attacker]);
    expect(blob, blob).to.match(/UnauthorizedAuthority/);
  });

  it("admin create_token_mint passes the constraints (no-op metadata branch on localnet)", async () => {
    send([await createMintIx(payer.publicKey)]);
  });
});
