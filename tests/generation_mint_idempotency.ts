import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { EnergyToken } from "../target/types/energy_token";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";

// On-chain exactly-once guard for generation mints (energy-token::mint_generation).
// The Aggregator Bridge calls mint_generation once per (meter, window). A replay —
// crash between submit and eviction, or a Redis outage that defeated the bridge's
// MINTED_SET fast-path — must NOT double-mint. These tests assert that the
// per-(meter, window) GenerationMintRecord PDA makes a replay a no-op, and that a
// replayed recipient batched with a fresh one does not starve the fresh mint.
//
// Requires a bootstrapped validator (scripts/bootstrap.ts already run): the GRX
// mint_2022 and token_info_2022 PDAs must exist and `authority` must be the
// token_info authority. Run via `anchor test`.
describe("generation-mint idempotency", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const energyTokenProgram = anchor.workspace.EnergyToken as Program<EnergyToken>;
  const authority = provider.wallet.publicKey;

  let energyMintPda: PublicKey;
  let energyTokenInfoPda: PublicKey;

  // gen_mint record PDA: seeds = [b"gen_mint", meter_id(16), window_start_ms.to_le_bytes()(8)].
  const genMintPda = (meterId: Buffer, windowStartMs: BN) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("gen_mint"), meterId, windowStartMs.toArrayLike(Buffer, "le", 8)],
      energyTokenProgram.programId
    )[0];

  before(async () => {
    [energyMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_2022")],
      energyTokenProgram.programId
    );
    [energyTokenInfoPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_info_2022")],
      energyTokenProgram.programId
    );
  });

  // Fund a fresh recipient keypair and create its energy-mint ATA (empty).
  async function freshRecipient(): Promise<{ kp: Keypair; ata: PublicKey }> {
    const kp = Keypair.generate();
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority,
          toPubkey: kp.publicKey,
          lamports: 0.2 * LAMPORTS_PER_SOL,
        })
      )
    );
    const ata = getAssociatedTokenAddressSync(energyMintPda, kp.publicKey, false, TOKEN_2022_PROGRAM_ID);
    await provider.sendAndConfirm(
      new Transaction().add(
        createAssociatedTokenAccountInstruction(authority, ata, kp.publicKey, energyMintPda, TOKEN_2022_PROGRAM_ID)
      )
    );
    return { kp, ata };
  }

  // Build a single mint_generation instruction for (recipient, meter, window, amount).
  function mintGenerationIx(args: {
    ata: PublicKey;
    owner: PublicKey;
    meterId: Buffer;
    windowStartMs: BN;
    amount: BN;
  }) {
    return energyTokenProgram.methods
      .mintGeneration(Array.from(args.meterId), args.windowStartMs, args.amount)
      .accounts({
        mint: energyMintPda,
        tokenInfo: energyTokenInfoPda,
        destination: args.ata,
        destinationOwner: args.owner,
        mintRecord: genMintPda(args.meterId, args.windowStartMs),
        authority,
        recValidator: null,
        payer: authority,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any);
  }

  const balance = async (ata: PublicKey): Promise<bigint> =>
    (await getAccount(provider.connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;

  // Unique 16-byte meter id per test run so reruns against a long-lived validator
  // don't collide on an already-minted record.
  const meterId = (seed: number): Buffer => {
    const b = Buffer.alloc(16);
    b.writeUInt32LE(Math.floor(Date.now() / 1000), 0);
    b.writeUInt32LE(seed, 12);
    return b;
  };

  it("first mint credits the recipient and stamps the record", async () => {
    const { kp, ata } = await freshRecipient();
    const meter = meterId(1);
    const window = new BN(1_700_000_000_000);
    const amount = new BN(5_000);

    await mintGenerationIx({ ata, owner: kp.publicKey, meterId: meter, windowStartMs: window, amount }).rpc();

    expect(await balance(ata)).to.equal(5_000n);
    const record = await energyTokenProgram.account.generationMintRecord.fetch(genMintPda(meter, window));
    expect(record.minted).to.equal(true);
    expect(record.amount.toString()).to.equal("5000");
    expect(record.windowStartMs.toString()).to.equal(window.toString());
  });

  it("replaying the same (meter, window) is a no-op — no double mint", async () => {
    const { kp, ata } = await freshRecipient();
    const meter = meterId(2);
    const window = new BN(1_700_000_900_000);
    const amount = new BN(7_000);

    await mintGenerationIx({ ata, owner: kp.publicKey, meterId: meter, windowStartMs: window, amount }).rpc();
    expect(await balance(ata)).to.equal(7_000n);

    // Same (meter, window) again: the record already has minted == true, so the
    // instruction short-circuits. The tx succeeds, the balance does NOT grow.
    await mintGenerationIx({ ata, owner: kp.publicKey, meterId: meter, windowStartMs: window, amount }).rpc();
    expect(await balance(ata), "replay must not mint a second time").to.equal(7_000n);
  });

  it("a replayed recipient batched with a fresh one does not starve the fresh mint", async () => {
    // Recipient A already minted in this window; recipient B is fresh. Both
    // mint_generation instructions ride in ONE transaction. A no-ops, B mints —
    // the per-instruction guard must not abort the whole tx (which would block B).
    const a = await freshRecipient();
    const b = await freshRecipient();
    const meterA = meterId(3);
    const meterB = meterId(4);
    const window = new BN(1_700_001_800_000);
    const amount = new BN(9_000);

    // Pre-mint A so its record exists with minted == true.
    await mintGenerationIx({ ata: a.ata, owner: a.kp.publicKey, meterId: meterA, windowStartMs: window, amount }).rpc();
    expect(await balance(a.ata)).to.equal(9_000n);

    const ixA = await mintGenerationIx({ ata: a.ata, owner: a.kp.publicKey, meterId: meterA, windowStartMs: window, amount }).instruction();
    const ixB = await mintGenerationIx({ ata: b.ata, owner: b.kp.publicKey, meterId: meterB, windowStartMs: window, amount }).instruction();

    await provider.sendAndConfirm(new Transaction().add(ixA, ixB));

    expect(await balance(a.ata), "replayed recipient must stay flat").to.equal(9_000n);
    expect(await balance(b.ata), "fresh recipient must mint despite the batched replay").to.equal(9_000n);
  });
});
