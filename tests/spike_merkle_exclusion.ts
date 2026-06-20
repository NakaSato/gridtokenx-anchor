// §3 FEASIBILITY SPIKE — T3.1 (THROWAWAY PoC, not production, not wired into any
// program). Prototype an INDEXED Merkle tree giving proof-of-EXCLUSION, so a
// challenger can prove a match was DROPPED from a settlement batch (i.e. a
// match-id the operator committed to settle but that is absent from the batch's
// committed leaf set).
//
// Why indexed, not a sparse 2^256 SMT: an indexed Merkle tree stores leaves as a
// sorted linked list — each leaf = (value, nextValue, nextIndex) — so the tree
// depth is log2(#elements), not 256. Non-membership of `q` is proven by an
// INCLUSION proof of the unique "low leaf" L with L.value < q < L.nextValue
// (or L.value < q and L.nextValue == 0 for the max), which is O(log n) hashes —
// the shape that matters for the on-chain CU budget in T3.2. (On-chain we'd swap
// sha256 for the keccak syscall; sha256 here keeps the spike dependency-free.)
//
// Run: npx mocha -r tsx tests/spike_merkle_exclusion.ts --timeout 60000
// No validator required (T3.1 is correctness only; T3.2 measures CU on-chain).

import { createHash } from "crypto";
import { expect } from "chai";

const DEPTH = 10; // up to 1024 leaves; batches are far smaller
const LEAVES = 1 << DEPTH;
const EMPTY = Buffer.alloc(32); // default value for unfilled slots

function sha256(...parts: Buffer[]): Buffer {
  return createHash("sha256").update(Buffer.concat(parts)).digest();
}
function be32(x: bigint): Buffer {
  const b = Buffer.alloc(32);
  let v = x;
  for (let i = 31; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
}

interface Leaf { value: bigint; nextValue: bigint; nextIndex: number; }
const leafHash = (l: Leaf): Buffer => sha256(be32(l.value), be32(l.nextValue), be32(BigInt(l.nextIndex)));

// Inclusion proof over a fixed-depth binary tree built from a leaf-hash array.
function merkleRoot(leafHashes: Buffer[]): Buffer {
  let level = leafHashes;
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256(level[i], level[i + 1]));
    level = next;
  }
  return level[0];
}
function merkleProof(leafHashes: Buffer[], index: number): Buffer[] {
  const proof: Buffer[] = [];
  let level = leafHashes;
  let idx = index;
  while (level.length > 1) {
    const sib = idx ^ 1;
    proof.push(level[sib]);
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256(level[i], level[i + 1]));
    level = next;
    idx >>= 1;
  }
  return proof;
}
function verifyProof(leaf: Buffer, index: number, proof: Buffer[], root: Buffer): boolean {
  let h = leaf;
  let idx = index;
  for (const sib of proof) {
    h = (idx & 1) === 0 ? sha256(h, sib) : sha256(sib, h);
    idx >>= 1;
  }
  return h.equals(root);
}

// Indexed Merkle tree: leaf 0 is the sentinel {0,0,0}; inserts maintain the
// sorted linked list via the low leaf.
class IndexedMerkleTree {
  leaves: Leaf[] = [{ value: 0n, nextValue: 0n, nextIndex: 0 }];

  private slotHashes(): Buffer[] {
    const arr = new Array<Buffer>(LEAVES).fill(EMPTY);
    this.leaves.forEach((l, i) => { arr[i] = leafHash(l); });
    return arr;
  }
  root(): Buffer { return merkleRoot(this.slotHashes()); }

  // Index of the low leaf for `v`: value < v AND (nextValue > v OR nextValue == 0).
  private lowIndex(v: bigint): number {
    for (let i = 0; i < this.leaves.length; i++) {
      const l = this.leaves[i];
      if (l.value < v && (l.nextValue > v || l.nextValue === 0n)) return i;
    }
    throw new Error("no low leaf (duplicate or malformed)");
  }

  insert(v: bigint) {
    if (this.leaves.some((l) => l.value === v)) throw new Error("duplicate");
    const li = this.lowIndex(v);
    const low = this.leaves[li];
    const newIndex = this.leaves.length;
    this.leaves.push({ value: v, nextValue: low.nextValue, nextIndex: low.nextIndex });
    low.nextValue = v;
    low.nextIndex = newIndex;
  }

  // Inclusion (membership) proof for a present value.
  membershipProof(v: bigint): { index: number; leaf: Leaf; proof: Buffer[] } {
    const index = this.leaves.findIndex((l) => l.value === v);
    if (index < 0) throw new Error("not present — cannot make membership proof");
    return { index, leaf: this.leaves[index], proof: merkleProof(this.slotHashes(), index) };
  }

  // Non-membership (exclusion) proof for an absent value: the low leaf + its
  // inclusion proof. The verifier checks the range to conclude `v` is absent.
  exclusionProof(v: bigint): { index: number; lowLeaf: Leaf; proof: Buffer[] } {
    const index = this.lowIndex(v);
    return { index, lowLeaf: this.leaves[index], proof: merkleProof(this.slotHashes(), index) };
  }
}

// Verifier-side checks (what an on-chain program would do in T3.2).
function verifyMembership(v: bigint, p: { index: number; leaf: Leaf; proof: Buffer[] }, root: Buffer): boolean {
  return p.leaf.value === v && verifyProof(leafHash(p.leaf), p.index, p.proof, root);
}
function verifyExclusion(v: bigint, p: { index: number; lowLeaf: Leaf; proof: Buffer[] }, root: Buffer): boolean {
  const L = p.lowLeaf;
  const rangeOk = L.value < v && (L.nextValue > v || L.nextValue === 0n);
  return rangeOk && verifyProof(leafHash(L), p.index, p.proof, root);
}

describe("§3 spike T3.1 — indexed Merkle exclusion proof (THROWAWAY)", () => {
  // The committed set = match-ids the operator claims to have settled in a batch.
  const settled = [50n, 120n, 200n, 999n, 1500n];
  const tree = new IndexedMerkleTree();
  before(() => { for (const v of settled) tree.insert(v); });

  it("membership proof verifies for a settled match-id", () => {
    const root = tree.root();
    expect(verifyMembership(200n, tree.membershipProof(200n), root)).to.equal(true);
  });

  it("exclusion proof verifies for a DROPPED match-id between two settled ids", () => {
    const root = tree.root();
    // 150 was supposed to settle but is absent (dropped) — prove it.
    const p = tree.exclusionProof(150n);
    expect(verifyExclusion(150n, p, root)).to.equal(true);
    // The low leaf bounding 150 must be {120 -> 200}.
    expect(p.lowLeaf.value).to.equal(120n);
    expect(p.lowLeaf.nextValue).to.equal(200n);
  });

  it("exclusion proof verifies below the minimum and above the maximum", () => {
    const root = tree.root();
    expect(verifyExclusion(10n, tree.exclusionProof(10n), root), "below min").to.equal(true);   // bounded by sentinel 0 -> 50
    expect(verifyExclusion(9000n, tree.exclusionProof(9000n), root), "above max").to.equal(true); // bounded by 1500 -> 0
  });

  it("FORGES rejected: cannot prove exclusion of a present id", () => {
    const root = tree.root();
    // Attacker claims 200 (which IS settled) was dropped. The honest low leaf for
    // 200 is {120 -> 200}: range check needs 200 < nextValue(200) → false.
    const mp = tree.membershipProof(120n);
    const forged = { index: mp.index, lowLeaf: mp.leaf, proof: mp.proof };
    expect(verifyExclusion(200n, forged, root)).to.equal(false);
  });

  it("FORGED rejected: tampered low leaf fails the root check", () => {
    const root = tree.root();
    const p = tree.exclusionProof(150n);
    // Attacker widens the range by lying about nextValue (claim 120 -> 5000 so
    // any q in (120,5000) looks absent). The tampered leaf no longer hashes to a
    // node on the committed path → root mismatch.
    const tampered = { ...p, lowLeaf: { ...p.lowLeaf, nextValue: 5000n } };
    expect(verifyExclusion(3000n, tampered, root)).to.equal(false);
  });
});
