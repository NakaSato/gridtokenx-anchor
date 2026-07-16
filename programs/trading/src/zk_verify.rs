//! On-chain verification for shielded transfers (Phase 1, `privacy` feature).
//!
//! Verifies two things about a shielded transfer of `amount` out of a sender's
//! committed balance:
//!
//!  1. **Conservation** — `C_old == C_amt + C_new` as ristretto points. Because
//!     Pedersen commitments are additively homomorphic and binding, this single
//!     identity forces `value(C_old) = value(C_amt) + value(C_new)` (mod l): no
//!     value is created.
//!  2. **Balance PoK** — a Fiat–Shamir Okamoto proof that the sender knows the
//!     opening `(amount, r_amt)` of `C_amt`. This is the field the frontend used
//!     to fill with zeros; it is now real and checked here.
//!
//! The prover side lives in `gridtokenx-trading/wasm-zk/src/lib.rs`. The
//! challenge hash below MUST stay byte-identical to `okamoto_challenge` there.
//!
//! ## NOT MAINNET-SOUND ON ITS OWN
//!
//! Conservation holds modulo the group order. Without verifying the range proofs
//! (that `amount` and `remaining` are in `[0, 2^64)`), a sender can pick
//! `amount > balance` so `remaining` wraps to a near-`l` value and mint tokens.
//! Bulletproof range-proof verification does not fit an Anchor program's compute
//! budget — Phase 2 wires the ZK ElGamal Proof Program for it. Until then the
//! `privacy` feature stays OFF and this must not gate real funds.

use anchor_lang::prelude::Pubkey;
use curve25519_dalek::scalar::Scalar;
use sha2::{Digest, Sha512};
use solana_curve25519::{
    ristretto::{add_ristretto, multiply_ristretto, subtract_ristretto, PodRistrettoPoint},
    scalar::PodScalar,
};

/// ZK ElGamal Proof Program (`ZkE1Gama1Proof11111111111111111111111111111`) —
/// the required owner of any range-proof context-state account. Bytes verified
/// against the base58 id in tests (`zk_program_id_bytes_correct`).
pub const ZK_ELGAMAL_PROOF_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    8, 99, 117, 172, 226, 174, 234, 40, 26, 107, 55, 77, 104, 27, 167, 106, 83, 204, 246, 56, 192,
    116, 85, 147, 108, 5, 208, 101, 64, 0, 0, 0,
]);

/// `RISTRETTO_BASEPOINT_COMPRESSED` (the Pedersen value generator `G`).
pub const G_COMPRESSED: [u8; 32] = [
    226, 242, 174, 10, 106, 188, 78, 113, 168, 132, 169, 97, 197, 0, 81, 95, 88, 227, 11, 106, 165,
    130, 221, 141, 182, 166, 89, 69, 224, 141, 45, 118,
];

/// solana-zk-token-sdk's Pedersen blinding generator `H`
/// (`hash_from_bytes::<Sha3_512>(RISTRETTO_BASEPOINT_COMPRESSED)`), compressed.
/// Extracted from the sdk so both prover (wasm-zk) and this verifier use the
/// SAME `H`. If the sdk ever changes its `H`, this constant and the prover must
/// change together.
pub const H_COMPRESSED: [u8; 32] = [
    140, 146, 64, 180, 86, 169, 230, 220, 101, 195, 119, 161, 4, 141, 116, 95, 148, 160, 140, 219,
    127, 68, 203, 205, 123, 70, 243, 64, 72, 135, 17, 52,
];

/// Domain-separated Fiat–Shamir challenge, reduced mod l. Byte-identical to the
/// wasm-zk prover's `okamoto_challenge`.
fn okamoto_challenge(c_amt: &[u8; 32], nonce_point: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha512::new();
    h.update(b"GridTokenX_BalanceProof_v1");
    h.update(c_amt);
    h.update(nonce_point);
    let digest = h.finalize();
    let mut wide = [0u8; 64];
    wide.copy_from_slice(&digest);
    Scalar::from_bytes_mod_order_wide(&wide).to_bytes()
}

/// `amount·G` as a compressed ristretto point — the public-value contribution
/// used by shield/unshield (blinding contribution 0). `None` only on the
/// impossible syscall failure.
pub fn value_times_g(amount: u64) -> Option<[u8; 32]> {
    let scalar = PodScalar(Scalar::from(amount).to_bytes());
    multiply_ristretto(&scalar, &PodRistrettoPoint(G_COMPRESSED)).map(|p| p.0)
}

/// Homomorphic add of two commitments (`a + b`).
pub fn add_commitments(a: &[u8; 32], b: &[u8; 32]) -> Option<[u8; 32]> {
    add_ristretto(&PodRistrettoPoint(*a), &PodRistrettoPoint(*b)).map(|p| p.0)
}

/// Homomorphic subtract of two commitments (`a - b`).
pub fn sub_commitments(a: &[u8; 32], b: &[u8; 32]) -> Option<[u8; 32]> {
    subtract_ristretto(&PodRistrettoPoint(*a), &PodRistrettoPoint(*b)).map(|p| p.0)
}

/// `C_old == C_amt + C_new` (value conservation). Args are compressed ristretto.
pub fn verify_conservation(c_old: &[u8; 32], c_amt: &[u8; 32], c_new: &[u8; 32]) -> bool {
    match add_ristretto(&PodRistrettoPoint(*c_amt), &PodRistrettoPoint(*c_new)) {
        Some(sum) => &sum.0 == c_old,
        None => false,
    }
}

/// Verify the Okamoto PoK of the opening of `c_amt`.
///
/// `challenge` = c (canonical scalar), `response` = z_v ‖ z_r (two canonical
/// scalars). Recomputes `A' = z_v·G + z_r·H − c·C_amt` and checks
/// `H(C_amt, A') == c`. Any non-canonical scalar or non-decodable point → false.
pub fn verify_balance_proof(c_amt: &[u8; 32], challenge: &[u8; 32], response: &[u8; 64]) -> bool {
    let mut zv = [0u8; 32];
    let mut zr = [0u8; 32];
    zv.copy_from_slice(&response[..32]);
    zr.copy_from_slice(&response[32..]);

    let g = PodRistrettoPoint(G_COMPRESSED);
    let h = PodRistrettoPoint(H_COMPRESSED);
    let c_amt_point = PodRistrettoPoint(*c_amt);

    // A' = z_v·G + z_r·H − c·C_amt
    let t1 = match multiply_ristretto(&PodScalar(zv), &g) {
        Some(p) => p,
        None => return false,
    };
    let t2 = match multiply_ristretto(&PodScalar(zr), &h) {
        Some(p) => p,
        None => return false,
    };
    let lhs = match add_ristretto(&t1, &t2) {
        Some(p) => p,
        None => return false,
    };
    let c_times_commit = match multiply_ristretto(&PodScalar(*challenge), &c_amt_point) {
        Some(p) => p,
        None => return false,
    };
    let a_prime = match subtract_ristretto(&lhs, &c_times_commit) {
        Some(p) => p,
        None => return false,
    };

    let recomputed = okamoto_challenge(c_amt, &a_prime.0);
    &recomputed == challenge
}

// ============================================================================
// Phase 2: range-proof context-state validation
//
// Bulletproof range-proof verification does not fit an Anchor program's compute
// budget, so it runs in the ZK ElGamal Proof Program. The client verifies a
// `BatchedRangeProofU128` (context = [C_amt(64-bit), C_new(64-bit)]) via that
// program, which writes a context-state account. `private_transfer` then only
// has to confirm that account was produced by the proof program and that its
// committed values are exactly the transfer's C_amt and C_new.
//
// Context-state account layout (`ProofContextState<BatchedRangeProofContext>`,
// all little-endian Pod, no padding):
//   [0..32)   context_state_authority: Pubkey
//   [32]      proof_type: u8            (ProofType::BatchedRangeProofU128 == 7)
//   [33..289) commitments: [ [u8;32]; 8 ]   (only [0] and [1] used here)
//   [289..297) bit_lengths: [u8; 8]         (must be 64, 64 for the first two)
// ============================================================================

/// `ProofType::BatchedRangeProofU64` / `BatchedRangeProofU128` discriminants
/// (verified against the sdk enum in tests).
pub const PROOF_TYPE_BATCHED_RANGE_U64: u8 = 6;
pub const PROOF_TYPE_BATCHED_RANGE_U128: u8 = 7;

const CTX_STATE_LEN: usize = 32 + 1 + 8 * 32 + 8; // 297
const COMMITMENTS_OFFSET: usize = 33;
const BIT_LENGTHS_OFFSET: usize = 33 + 8 * 32; // 289

/// Validate a ZK ElGamal Proof Program range-proof context-state account: it must
/// be a `BatchedRangeProofU128` whose first two committed values are exactly
/// `c_amt` and `c_new`, each proven to be a 64-bit value. The CALLER must
/// separately check the account is OWNED by the proof program (see
/// `private_transfer`) — a matching layout under a different owner proves
/// nothing.
pub fn verify_range_context(data: &[u8], c_amt: &[u8; 32], c_new: &[u8; 32]) -> bool {
    if data.len() != CTX_STATE_LEN {
        return false;
    }
    if data[32] != PROOF_TYPE_BATCHED_RANGE_U128 {
        return false;
    }
    if &data[COMMITMENTS_OFFSET..COMMITMENTS_OFFSET + 32] != c_amt {
        return false;
    }
    if &data[COMMITMENTS_OFFSET + 32..COMMITMENTS_OFFSET + 64] != c_new {
        return false;
    }
    // Both amounts must be proven to 64-bit range.
    data[BIT_LENGTHS_OFFSET] == 64 && data[BIT_LENGTHS_OFFSET + 1] == 64
}

/// Validate a single-commitment `BatchedRangeProofU64` context-state account:
/// its one committed value must be exactly `commitment`, proven to 64-bit range.
/// Used by `unshield` to prove the post-unshield remaining balance is in range
/// (closing the same underflow hole on the private→public boundary). The CALLER
/// must separately check the account is owned by the proof program.
pub fn verify_single_range_context(data: &[u8], commitment: &[u8; 32]) -> bool {
    if data.len() != CTX_STATE_LEN {
        return false;
    }
    if data[32] != PROOF_TYPE_BATCHED_RANGE_U64 {
        return false;
    }
    if &data[COMMITMENTS_OFFSET..COMMITMENTS_OFFSET + 32] != commitment {
        return false;
    }
    data[BIT_LENGTHS_OFFSET] == 64
}

#[cfg(test)]
mod tests {
    use super::*;
    use curve25519_dalek::ristretto::CompressedRistretto;
    use curve25519_dalek::ristretto::RistrettoPoint;

    fn g_point() -> RistrettoPoint {
        CompressedRistretto(G_COMPRESSED).decompress().unwrap()
    }
    fn h_point() -> RistrettoPoint {
        CompressedRistretto(H_COMPRESSED).decompress().unwrap()
    }

    fn commit(value: u64, blinding: &Scalar) -> RistrettoPoint {
        g_point() * Scalar::from(value) + h_point() * blinding
    }

    // Rebuild a transfer proof exactly as wasm-zk's create_transfer_proof does,
    // then verify with the on-chain verifier — proves prover/verifier agree.
    fn make_proof(amount: u64, r_amt: &Scalar) -> ([u8; 32], [u8; 32], [u8; 64]) {
        let c_amt = commit(amount, r_amt).compress().to_bytes();

        let s_v = Scalar::from(123_456u64);
        let s_r = Scalar::from(987_654u64);
        let a = g_point() * s_v + h_point() * s_r;
        let c = Scalar::from_canonical_bytes(okamoto_challenge(&c_amt, &a.compress().to_bytes()))
            .unwrap();
        let z_v = s_v + c * Scalar::from(amount);
        let z_r = s_r + c * r_amt;

        let mut response = [0u8; 64];
        response[..32].copy_from_slice(z_v.as_bytes());
        response[32..].copy_from_slice(z_r.as_bytes());
        (c_amt, c.to_bytes(), response)
    }

    #[test]
    fn conservation_holds_for_consistent_blindings() {
        let balance = 1_000u64;
        let amount = 300u64;
        let r_old = Scalar::from(555u64);
        let r_amt = Scalar::from(222u64);
        let r_new = r_old - r_amt; // consistency the prover enforces

        let c_old = commit(balance, &r_old).compress().to_bytes();
        let c_amt = commit(amount, &r_amt).compress().to_bytes();
        let c_new = commit(balance - amount, &r_new).compress().to_bytes();

        assert!(verify_conservation(&c_old, &c_amt, &c_new));
        // Tamper: wrong remaining commitment must fail.
        let bad = commit(balance - amount + 1, &r_new).compress().to_bytes();
        assert!(!verify_conservation(&c_old, &c_amt, &bad));
    }

    #[test]
    fn balance_proof_verifies() {
        let r_amt = Scalar::from(42u64);
        let (c_amt, challenge, response) = make_proof(500u64, &r_amt);
        assert!(verify_balance_proof(&c_amt, &challenge, &response));
    }

    #[test]
    fn rejects_zero_placeholder_proof() {
        // The old fake all-zeros balance_proof must NOT verify.
        let c_amt = commit(1u64, &Scalar::from(3u64)).compress().to_bytes();
        assert!(!verify_balance_proof(&c_amt, &[0u8; 32], &[0u8; 64]));
    }

    #[test]
    fn rejects_proof_bound_to_other_commitment() {
        let r_amt = Scalar::from(42u64);
        let (_c_amt, challenge, response) = make_proof(500u64, &r_amt);
        let other = commit(501u64, &r_amt).compress().to_bytes();
        assert!(!verify_balance_proof(&other, &challenge, &response));
    }

    // --- Phase 2: context-state validation ---
    use solana_zk_sdk::{
        encryption::pedersen::{Pedersen as ZkPedersen, PedersenOpening as ZkPedersenOpening},
        zk_elgamal_proof_program::proof_data::{
            batched_range_proof::{
                batched_range_proof_u128::BatchedRangeProofU128Data,
                batched_range_proof_u64::BatchedRangeProofU64Data,
            },
            ProofType,
        },
    };

    // Single-commitment U64 context-state account bytes + the commitment.
    fn build_u64_context(remaining: u64) -> (Vec<u8>, [u8; 32]) {
        let r = ZkPedersenOpening::new_rand();
        let c = ZkPedersen::with(remaining, &r);
        let data =
            BatchedRangeProofU64Data::new(vec![&c], vec![remaining], vec![64], vec![&r]).unwrap();
        let mut acct = vec![0u8; 32];
        acct.push(ProofType::BatchedRangeProofU64 as u8);
        acct.extend_from_slice(bytemuck::bytes_of(&data.context));
        (acct, c.to_bytes())
    }

    // Build the exact bytes the proof program writes for a valid batched range
    // proof over [C_amt(64), C_new(64)], plus the two commitment byte arrays.
    fn build_context_account(amount: u64, remaining: u64) -> (Vec<u8>, [u8; 32], [u8; 32]) {
        let r_amt = ZkPedersenOpening::new_rand();
        let r_new = ZkPedersenOpening::new_rand();
        let c_amt = ZkPedersen::with(amount, &r_amt);
        let c_new = ZkPedersen::with(remaining, &r_new);
        let data = BatchedRangeProofU128Data::new(
            vec![&c_amt, &c_new],
            vec![amount, remaining],
            vec![64, 64],
            vec![&r_amt, &r_new],
        )
        .unwrap();

        // ProofContextState layout: authority(32) || proof_type(1) || context.
        let mut acct = vec![0u8; 32];
        acct.push(ProofType::BatchedRangeProofU128 as u8);
        acct.extend_from_slice(bytemuck::bytes_of(&data.context));
        (acct, c_amt.to_bytes(), c_new.to_bytes())
    }

    #[test]
    fn discriminant_matches_sdk() {
        assert_eq!(
            PROOF_TYPE_BATCHED_RANGE_U128,
            ProofType::BatchedRangeProofU128 as u8
        );
    }

    #[test]
    fn accepts_valid_range_context() {
        let (acct, c_amt, c_new) = build_context_account(300, 700);
        assert_eq!(acct.len(), CTX_STATE_LEN);
        assert!(verify_range_context(&acct, &c_amt, &c_new));
    }

    #[test]
    fn rejects_swapped_commitments() {
        let (acct, c_amt, c_new) = build_context_account(300, 700);
        // Commitments in the wrong order must fail (binds C_amt/C_new positionally).
        assert!(!verify_range_context(&acct, &c_new, &c_amt));
    }

    #[test]
    fn rejects_wrong_proof_type() {
        let (mut acct, c_amt, c_new) = build_context_account(300, 700);
        acct[32] = PROOF_TYPE_BATCHED_RANGE_U128 - 1; // BatchedRangeProofU64
        assert!(!verify_range_context(&acct, &c_amt, &c_new));
    }

    #[test]
    fn rejects_wrong_bit_length() {
        let (mut acct, c_amt, c_new) = build_context_account(300, 700);
        acct[BIT_LENGTHS_OFFSET] = 32;
        assert!(!verify_range_context(&acct, &c_amt, &c_new));
    }

    #[test]
    fn u64_discriminant_matches_sdk() {
        assert_eq!(
            PROOF_TYPE_BATCHED_RANGE_U64,
            ProofType::BatchedRangeProofU64 as u8
        );
    }

    #[test]
    fn accepts_valid_single_range_context() {
        let (acct, c) = build_u64_context(500);
        assert!(verify_single_range_context(&acct, &c));
    }

    #[test]
    fn single_range_rejects_wrong_commitment() {
        let (acct, _c) = build_u64_context(500);
        let (_a2, other) = build_u64_context(501);
        assert!(!verify_single_range_context(&acct, &other));
    }

    #[test]
    fn single_range_rejects_u128_context() {
        // A U128 (two-commitment) account must not pass the U64 check.
        let (acct, c_amt, _c_new) = build_context_account(300, 700);
        assert!(!verify_single_range_context(&acct, &c_amt));
    }

    #[test]
    fn zk_program_id_bytes_correct() {
        use anchor_lang::prelude::Pubkey;
        use core::str::FromStr;
        // Must equal the hardcoded const in instructions/private_transfer.rs.
        let bytes: [u8; 32] = [
            8, 99, 117, 172, 226, 174, 234, 40, 26, 107, 55, 77, 104, 27, 167, 106, 83, 204, 246,
            56, 192, 116, 85, 147, 108, 5, 208, 101, 64, 0, 0, 0,
        ];
        assert_eq!(
            Pubkey::new_from_array(bytes),
            Pubkey::from_str("ZkE1Gama1Proof11111111111111111111111111111").unwrap()
        );
    }
}
