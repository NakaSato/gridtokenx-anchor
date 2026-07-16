# GridTokenX — Trading: Shielded Balances & Private Transfer

> **🔒 STATUS: IMPLEMENTED, FEATURE-GATED (`privacy`), NOT ENABLED.** Validated
> end-to-end on a local validator (Agave 3.1.10, which ships the ZK ElGamal
> Proof Program); the `privacy` cargo feature is **off by default** and must stay
> off on mainnet until an independent audit. Verified against
> `programs/trading/src/` (Anchor 1.0). The authoritative path:line reference is
> `docs/programs/trading.md`; this doc explains the *model and why*.

This document specifies the confidential-balance subsystem: how tokens enter and
leave a shielded pool, how a hidden-amount transfer conserves value without
revealing it, and where each guarantee is enforced. The amounts in `shield` and
`unshield` are **public** (tokens visibly cross the shield boundary); only
`private_transfer` hides the amount.

---

## 1. Three Layers

The feature spans three codebases that must agree byte-for-byte on the crypto:

1. **Prover (client)** — `gridtokenx-trading/wasm-zk` (Rust→WASM). Produces the
   Pedersen commitments, the Okamoto balance proof, and the bulletproof range
   proofs (`create_transfer_proof`, `create_unshield_proof`).
2. **On-chain verifier** — this program: `zk_verify.rs` (crypto) +
   `instructions/private_shield.rs` and `instructions/private_transfer.rs`
   (instructions), gated behind the `privacy` feature.
3. **Proof-program glue (client)** — `gridtokenx-trading/lib/zk-proof-program.ts`
   builds the native **ZK ElGamal Proof Program** instructions that verify the
   range proofs into context-state accounts.

Bulletproof range-proof verification does **not** fit an Anchor program's compute
budget, which is why range proofs are verified by the native proof program and
this program only reads the resulting context account.

---

## 2. The Commitment Model

A shielded balance is a **Pedersen commitment** `C = value·G + b·H` stored per
`(owner, mint)` in a `PrivateBalance` PDA (`state/private_balance.rs:14`), seeds
`[b"priv_bal", owner, mint]`. `G` is the ristretto basepoint; `H` is
`solana-zk-token-sdk`'s Pedersen generator, hardcoded on-chain as `G_COMPRESSED`
(`zk_verify.rs:43`) and `H_COMPRESSED` (`zk_verify.rs:53`). `H` is a deterministic
hash of constants, so it is identical across `solana-zk-token-sdk` and
`solana-zk-sdk` versions — the prover may build commitments with either and the
bytes match.

A freshly-initialized `PrivateBalance` has `commitment = [0; 32]`, which is the
canonical ristretto encoding of the identity point (a commitment to 0 with
blinding 0). Homomorphic credit therefore works correctly on first use.

---

## 3. Shield & Unshield — the public boundary

`shield` (`lib.rs:213` → `instructions/private_shield.rs:65`) transfers `amount`
public tokens into a per-mint pool vault (PDA token account, seeds
`[b"priv_vault", mint]`, authority `[b"priv_vault_auth"]`) and adds `amount·G` to
the caller's commitment (`value_times_g`, `private_shield.rs:84`). No proof is
needed: the amount is public and adding a positive value cannot underflow. The
blinding contribution is 0; blinding accrues through private transfers.

`unshield` (`lib.rs:221` → `private_shield.rs:138`) is the inverse: it recomputes
`C_new = C_old − amount·G` and pays `amount` tokens out of the vault. Because the
amount is public and the balance only decreases, soundness requires a **range
proof that the remaining balance is still in `[0, 2^64)`** — otherwise
`amount > balance` would wrap `C_new` modulo the group order and mint value. That
proof is a single-commitment `BatchedRangeProofU64` over `C_new`, verified via
`verify_single_range_context` (`private_shield.rs:160`, `zk_verify.rs:193`).

---

## 4. Private Transfer — hidden amount

`private_transfer` (`lib.rs:229` → `instructions/private_transfer.rs:76`) moves a
hidden `amount` from sender to recipient. The sender's balance `C_old` splits
into an amount commitment `C_amt` and the sender's new commitment `C_new`, with
blindings chosen so `C_old = C_amt + C_new`. The handler enforces three things:

1. **Conservation** — `verify_conservation` (`private_transfer.rs:87`,
   `zk_verify.rs:90`) checks `C_old == C_amt + C_new` as ristretto points (via the
   `sol_curve25519` syscalls). Because Pedersen commitments are additively
   homomorphic and binding, this single identity forces
   `value(C_old) = value(C_amt) + value(C_new)` (mod l): no value is created.
   `C_old` is read from the *current* stored commitment, so a replayed proof fails
   after the first transfer updates it.
2. **Balance proof** — `verify_balance_proof` (`private_transfer.rs:92`,
   `zk_verify.rs:102`) checks a Fiat–Shamir **Okamoto proof of knowledge** of the
   opening of `C_amt` (challenge domain `GridTokenX_BalanceProof_v1`,
   `okamoto_challenge`, `zk_verify.rs:60`). This is the field that previously
   shipped as all-zeros; a zeroed proof now fails.
3. **Range proofs** — `verify_range_context` (`private_transfer.rs:111`,
   `zk_verify.rs:171`) validates a `BatchedRangeProofU128` context (both `C_amt`
   and `C_new` proven to 64-bit range), closing the underflow hole.

The recipient is credited homomorphically (`recipient.commitment += C_amt`). A
`recipient != sender` constraint (`private_transfer.rs:56`) prevents a
self-transfer double-write (Anchor also rejects it via
`ConstraintDuplicateMutableAccount`; this is defense-in-depth).

---

## 5. Range Proofs via the ZK ElGamal Proof Program

The prover verifies a batched range proof through the native ZK ElGamal Proof
Program (`ZkE1Gama1Proof11111111111111111111111111111`, `zk_verify.rs:37`), which
writes a `ProofContextState<BatchedRangeProofContext>` account (297 bytes:
authority 32, proof_type 1, commitments 8×32, bit_lengths 8). This program reads
that account by fixed offset and requires:

- account **owner == the proof program** (checked in the instruction — a matching
  layout under any other owner proves nothing);
- `proof_type == BatchedRangeProofU128` (7) for transfer / `U64` (6) for unshield;
- the committed values equal exactly `C_amt`/`C_new`;
- the bit-lengths are 64.

Client transaction structure (`lib/zk-proof-program.ts`): the ~1000-byte U128
proof plus `createAccount` exceeds the 1232-byte transaction limit, so the
context is created and verified in **two separate transactions** *before* the
trading instruction, and closed (rent reclaimed) as a post-instruction. The
proof-program instruction data is version-specific: proofs must be generated with
`solana-zk-sdk 4.x` to be accepted by current (Agave 3.x) validators.

---

## 6. Soundness & What Is Not Done

Enforced: value conservation, no over-spend/underflow (range proofs), no replay
(commitment state-update vs current `C_old`), no context forgery (owner +
proof_type + commitment binding), sender authorization (the `Signer`).

Not in scope / open: the `PrivacyNullifier` (`state/private_balance.rs:29`) and
the Okamoto balance proof are partly redundant given conservation + range proofs
+ the signature, but are kept as defense-in-depth. `unshield`'s over-unshield is
blocked cryptographically (no valid range proof exists for a wrapped remaining),
not by an explicit `amount <= balance` check (the balance is hidden).

**Before mainnet:** an independent professional audit of the sigma-proof and
Okamoto construction is required. The `privacy` feature stays OFF until then.

---

*Design narrative for the feature-gated shielded-transfer subsystem. Verified
against `programs/trading/src/` (Anchor 1.0) and validated end-to-end on a local
validator on 2026-07-17.*
