//! §3 SPIKE T3.2 — on-chain CU of indexed-Merkle proof verification.
//!
//! THROWAWAY benchmark instructions (not used by any production path) to measure
//! the compute cost of the trustless fraud-proof primitive prototyped off-chain in
//! `tests/spike_merkle_exclusion.ts`:
//!   - inclusion proof verify  (prove a match WAS in the committed batch)
//!   - exclusion proof verify  (prove a match was DROPPED — the fraud proof)
//!
//! Uses the sha256 SYSCALL (`sol_sha256`), which an on-chain verifier would use
//! for the Merkle ladder — its CU is the figure T3.2 needs vs the 200k default /
//! 1.4M max budget. (sha256 also matches the off-chain spike
//! `tests/spike_merkle_exclusion.ts`, so a TS-built proof verifies here directly.
//! keccak is not re-exported by this anchor-lang fork; both hash syscalls have
//! near-identical per-call CU, so the magnitude this measures is representative.)
//! Both instructions REQUIRE the proof to be valid so the tx-level
//! `computeUnitsConsumed` is read on success, and a forged proof reverts
//! (correctness asserted on-chain, not just off-chain).
//!
//! Leaf scheme mirrors the spike: leaf = sha256(value32 ‖ nextValue32 ‖
//! nextIndex32), all 32-byte big-endian; node = sha256(left ‖ right). Values are
//! compared as big-endian byte strings == numeric order.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;
use crate::error::BlockbenchError;
use crate::instructions::cpu_heavy::CpuHeavy;

fn node(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    hashv(&[a, b]).to_bytes()
}

// Climb the proof from `leaf` at `index` to the root.
fn ladder(leaf: [u8; 32], mut index: u32, proof: &[[u8; 32]]) -> [u8; 32] {
    let mut h = leaf;
    for sib in proof {
        h = if index & 1 == 0 { node(&h, sib) } else { node(sib, &h) };
        index >>= 1;
    }
    h
}

fn u32_be32(x: u32) -> [u8; 32] {
    let mut b = [0u8; 32];
    b[28..].copy_from_slice(&x.to_be_bytes());
    b
}

/// Inclusion: prove `leaf` sits at `index` under `root`.
pub fn merkle_verify_inclusion(
    _ctx: Context<CpuHeavy>,
    leaf: [u8; 32],
    index: u32,
    proof: Vec<[u8; 32]>,
    root: [u8; 32],
) -> Result<()> {
    require!(ladder(leaf, index, &proof) == root, BlockbenchError::InvalidMerkleProof);
    Ok(())
}

/// Exclusion (fraud proof): prove `query` is absent from the committed set by
/// presenting its bounding low leaf {value,next,next_index} + that leaf's
/// inclusion proof, then checking value < query < next (or next == 0 for the max).
pub fn merkle_verify_exclusion(
    _ctx: Context<CpuHeavy>,
    low_value: [u8; 32],
    low_next: [u8; 32],
    low_next_index: u32,
    query: [u8; 32],
    index: u32,
    proof: Vec<[u8; 32]>,
    root: [u8; 32],
) -> Result<()> {
    let leaf = hashv(&[&low_value, &low_next, &u32_be32(low_next_index)]).to_bytes();
    require!(ladder(leaf, index, &proof) == root, BlockbenchError::InvalidMerkleProof);

    let next_is_zero = low_next.iter().all(|&b| b == 0);
    let range_ok = low_value.as_slice() < query.as_slice()
        && (query.as_slice() < low_next.as_slice() || next_is_zero);
    require!(range_ok, BlockbenchError::ExclusionRangeInvalid);
    Ok(())
}
