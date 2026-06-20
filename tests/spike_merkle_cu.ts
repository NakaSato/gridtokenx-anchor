// §3 FEASIBILITY SPIKE — T3.2 (THROWAWAY): on-chain CU of indexed-Merkle proof
// verification, the trustless fraud-proof primitive. Calls the throwaway
// blockbench instructions merkle_verify_inclusion / merkle_verify_exclusion
// (sha256 ladder, same scheme as tests/spike_merkle_exclusion.ts) and reads
// computeUnitsConsumed vs the 200k default / 1.4M max budget.
//
// Manual instruction construction (Anchor discriminator + hand-rolled borsh) so
// no IDL regen is needed after adding the instructions — only the .so redeploy.
//
// Run (validator up, current blockbench.so deployed):
//   ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json \
//     npx mocha -r tsx tests/spike_merkle_cu.ts --timeout 600000

import * as anchor from "@anchor-lang/core";
import {
  PublicKey, Keypair, TransactionInstruction, TransactionMessage,
  VersionedTransaction, ComputeBudgetProgram,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { expect } from "chai";

const BLOCKBENCH = new PublicKey("9AM4JkvUkK8ZfRneTAQVahFgPe9rEisNkB9byRfZ4TwT");

const sha256 = (...p: Buffer[]) => createHash("sha256").update(Buffer.concat(p)).digest();
const disc = (name: string) => sha256(Buffer.from(`global:${name}`)).subarray(0, 8);
function be32(x: bigint): Buffer {
  const b = Buffer.alloc(32); let v = x;
  for (let i = 31; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
}
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const vec32 = (items: Buffer[]) => Buffer.concat([u32le(items.length), ...items]);

// --- off-chain indexed Merkle tree (sha256), mirrors the program scheme ---
interface Leaf { value: bigint; nextValue: bigint; nextIndex: number; }
const leafHash = (l: Leaf) => sha256(be32(l.value), be32(l.nextValue), be32(BigInt(l.nextIndex)));

function buildLevelArray(depth: number, leafHashes: Buffer[]): Buffer[] {
  const slots = new Array<Buffer>(1 << depth).fill(Buffer.alloc(32));
  leafHashes.forEach((h, i) => { slots[i] = h; });
  return slots;
}
function root(slots: Buffer[]): Buffer {
  let lvl = slots;
  while (lvl.length > 1) {
    const nx: Buffer[] = [];
    for (let i = 0; i < lvl.length; i += 2) nx.push(sha256(lvl[i], lvl[i + 1]));
    lvl = nx;
  }
  return lvl[0];
}
function proof(slots: Buffer[], index: number): Buffer[] {
  const pr: Buffer[] = []; let lvl = slots; let idx = index;
  while (lvl.length > 1) {
    pr.push(lvl[idx ^ 1]);
    const nx: Buffer[] = [];
    for (let i = 0; i < lvl.length; i += 2) nx.push(sha256(lvl[i], lvl[i + 1]));
    lvl = nx; idx >>= 1;
  }
  return pr;
}

class IMT {
  leaves: Leaf[] = [{ value: 0n, nextValue: 0n, nextIndex: 0 }];
  insert(v: bigint) {
    const li = this.leaves.findIndex((l) => l.value < v && (l.nextValue > v || l.nextValue === 0n));
    const low = this.leaves[li];
    const ni = this.leaves.length;
    this.leaves.push({ value: v, nextValue: low.nextValue, nextIndex: low.nextIndex });
    low.nextValue = v; low.nextIndex = ni;
  }
  slots(depth: number) { return buildLevelArray(depth, this.leaves.map(leafHash)); }
  lowIndex(v: bigint) { return this.leaves.findIndex((l) => l.value < v && (l.nextValue > v || l.nextValue === 0n)); }
}

describe("§3 spike T3.2 — on-chain Merkle proof verify CU (THROWAWAY)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const authority = provider.wallet.publicKey;
  const payer = (provider.wallet as any).payer as Keypair;

  // High fixed CU limit so the tx isn't capped; we read the CONSUMED amount.
  const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

  async function sendAndCU(ix: TransactionInstruction): Promise<{ err: any; cu: number }> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({ payerKey: authority, recentBlockhash: blockhash, instructions: [cuLimitIx, ix] }).compileToV0Message();
      const vtx = new VersionedTransaction(msg);
      vtx.sign([payer]);
      try {
        const sig = await provider.connection.sendTransaction(vtx, { skipPreflight: true });
        const conf = await provider.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        const tx = await provider.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        return { err: conf.value.err, cu: tx?.meta?.computeUnitsConsumed ?? 0 };
      } catch (e) { if (attempt === 3) throw e; await new Promise((r) => setTimeout(r, 400)); }
    }
    throw new Error("unreachable");
  }

  const payerMeta = { pubkey: authority, isSigner: true, isWritable: true };
  function inclusionIx(leaf: Buffer, index: number, pr: Buffer[], rt: Buffer): TransactionInstruction {
    const data = Buffer.concat([disc("merkle_verify_inclusion"), leaf, u32le(index), vec32(pr), rt]);
    return new TransactionInstruction({ programId: BLOCKBENCH, keys: [payerMeta], data });
  }
  function exclusionIx(low: Leaf, query: bigint, index: number, pr: Buffer[], rt: Buffer): TransactionInstruction {
    const data = Buffer.concat([
      disc("merkle_verify_exclusion"),
      be32(low.value), be32(low.nextValue), u32le(low.nextIndex),
      be32(query), u32le(index), vec32(pr), rt,
    ]);
    return new TransactionInstruction({ programId: BLOCKBENCH, keys: [payerMeta], data });
  }

  // Committed batch of settled match-ids; a few are missing (would be "dropped").
  const settled: bigint[] = [];
  for (let i = 1; i <= 40; i++) settled.push(BigInt(i * 10)); // 10,20,...,400
  const tree = new IMT();
  before(() => { for (const v of settled) tree.insert(v); });

  const DEPTHS = [10, 14]; // up to 1024 and 16384 leaves/batch

  for (const depth of DEPTHS) {
    it(`inclusion proof verifies on-chain (depth ${depth})`, async () => {
      const slots = tree.slots(depth);
      const rt = root(slots);
      const idx = tree.leaves.findIndex((l) => l.value === 200n); // a settled id
      const { err, cu } = await sendAndCU(inclusionIx(leafHash(tree.leaves[idx]), idx, proof(slots, idx), rt));
      console.log(`  [BENCH_MERKLE_CU] op=inclusion depth=${depth} proof_len=${depth} cu=${cu}`);
      expect(err, "valid inclusion must succeed: " + JSON.stringify(err)).to.equal(null);
      expect(cu).to.be.greaterThan(0).and.lessThan(1_400_000);
    });

    it(`exclusion (fraud) proof verifies on-chain (depth ${depth})`, async () => {
      const slots = tree.slots(depth);
      const rt = root(slots);
      const q = 155n; // a "dropped" id: absent, bounded by 150 -> 160
      const li = tree.lowIndex(q);
      const { err, cu } = await sendAndCU(exclusionIx(tree.leaves[li], q, li, proof(slots, li), rt));
      console.log(`  [BENCH_MERKLE_CU] op=exclusion depth=${depth} proof_len=${depth} cu=${cu}`);
      expect(err, "valid exclusion must succeed: " + JSON.stringify(err)).to.equal(null);
      expect(cu).to.be.greaterThan(0).and.lessThan(1_400_000);
    });
  }

  it("FORGED inclusion rejected on-chain (bad proof reverts)", async () => {
    const depth = 10;
    const slots = tree.slots(depth);
    const rt = root(slots);
    const idx = tree.leaves.findIndex((l) => l.value === 200n);
    const pr = proof(slots, idx);
    pr[0] = Buffer.alloc(32, 0xff); // tamper a sibling
    const { err } = await sendAndCU(inclusionIx(leafHash(tree.leaves[idx]), idx, pr, rt));
    expect(err, "forged inclusion must revert").to.not.equal(null);
  });

  it("FORGED exclusion rejected on-chain (claim a present id is absent)", async () => {
    const depth = 10;
    const slots = tree.slots(depth);
    const rt = root(slots);
    // Claim 200 (present) is absent, using its honest low leaf {190 -> 200}.
    const lowIdx = tree.leaves.findIndex((l) => l.value === 190n);
    const { err } = await sendAndCU(exclusionIx(tree.leaves[lowIdx], 200n, lowIdx, proof(slots, lowIdx), rt));
    expect(err, "forged exclusion must revert (range check)").to.not.equal(null);
  });
});
