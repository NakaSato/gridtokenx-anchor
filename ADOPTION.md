# Adopting the GridTokenX Anchor Programs

This guide is for teams evaluating, deploying, or integrating the GridTokenX on-chain
programs — a P2P energy-trading platform on a permissioned PoA Solana cluster. It covers
what "adoption" means at the current maturity, the concrete paths in, and the caveats you
must plan around **before** committing.

> Read [`README.md`](README.md) for the program list and build steps, and
> [`ARCHITECTURE.md`](ARCHITECTURE.md) / [`SKILL.md`](SKILL.md) for the invariants these
> programs assume. This document sits on top of both.

---

## 1. Maturity: what you are adopting

- **Pre-mainnet, localnet-only.** `Anchor.toml [provider] cluster = "localnet"`. Program
  IDs in `[programs.localnet]` are dev keypairs — you regenerate your own on deploy
  (`anchor keys sync`). Nothing here is a mainnet deployment you connect to; you stand up
  your own cluster.
- **Permissioned Proof-of-Authority.** The `governance` program is the root of trust:
  a PoA authority admits validators/aggregators and gates operational instructions. This is
  a consortium/utility model, **not** a permissionless public chain. Adoption implies you
  (or a named operator set) run the authority.
- **Not audited for production value.** Treat every economic path (treasury peg, staking,
  settlement) as reference-grade until you commission your own audit. The seed-stability
  and migration notes in [`SKILL.md`](SKILL.md) exist precisely because the on-chain layout
  is still allowed to change in this window.

If you need a live, permissionless, audited protocol today — this is not that yet. If you
are a utility, microgrid operator, or research group who will **run the cluster and the
authority**, read on.

---

## 2. Adoption paths

Three distinct ways to adopt, in increasing depth:

| Path | You get | You own |
| ---- | ------- | ------- |
| **A. Deploy & operate** | A running GridTokenX cluster (all 6 core programs) | Program keypairs, the PoA authority, init state, validator set |
| **B. Integrate off-chain** | Your services talk to a running cluster | A Chain Bridge deployment + your service wiring |
| **C. Extend on-chain** | New instructions / a new program in the CPI graph | The new program + its invariant compliance |

Most adopters do **A + B**. Path C is for teams changing the protocol itself.

---

## 3. Path A — Deploy & operate a cluster

### Prerequisites

- `anchor-lang` / `anchor-spl` **1.0.0** toolchain; Anchor CLI matched to the 1.0.0
  on-chain crate (CLI version is intentionally unpinned — `Anchor.toml [toolchain]` empty).
- `pnpm@9.15.4`; Node with `tsx` for the init scripts.
- A Solana cluster: local `solana-test-validator`, or Surfpool for mainnet simulation
  (`npm run simnet`) with no local validator.
- **macOS Apple Silicon:** `ulimit -n 65536` before launching the validator, or it panics
  under load ("Too many open files"). The superproject `scripts/app.sh` does this for you.

### Deploy sequence

```bash
anchor keys sync          # generate YOUR program IDs, then update declare_id! in each lib.rs
anchor build              # → per-program target/deploy/<p>.so (+ target/types)
anchor deploy             # deploy all programs to the configured cluster
```

> **Gotcha:** Anchor 1.0 emits `programs/<p>/target/deploy/<p>.so`. The in-process litesvm
> suites load `target/deploy/<p>.so` at the **root** — a stale root copy silently runs the
> wrong binary. After editing a program, rebuild and copy the fresh `.so` to root
> `target/deploy/` (see [`SKILL.md`](SKILL.md) gotcha #1).

### Initialize state — order matters

The init scripts wire the programs together and set the authority. Run in this order
(`npx tsx scripts/<name>.ts`):

```
bootstrap.ts → init-registry.ts → init-oracle.ts → init-market.ts
             → init-governance.ts → init-rec-mint.ts → init-treasury.ts
             → init-zone-config.ts        (also: anchor run init-zone-config)
```

`init-treasury.ts` in particular sets **cross-program policy** you must not skip:

- Points `registry::set_slash_destination` at the treasury `rebate_vault` (slashed
  validator bonds are a penalty, not staker yield — they must not route to `reward_vault`).
- Sets `trading::set_settlement_thbg_mint` so THBG-currency matches **require** the treasury
  `record_settlement` CPI (a match that omits treasury accounts is rejected with
  `TreasurySettlementRequired` — no silent skip).

Getting this wrong doesn't fail loudly at deploy — it fails at first settlement. Verify the
policy is set before you open trading.

### Own the authority

After `init-governance.ts`, **you** hold the PoA authority key. Adoption checklist:

- Rotate the authority to your operator key (2-step transfer — governance supports it).
- Decide your validator/aggregator admission policy (registry staking is a security bond
  gated by `MIN_VALIDATOR_STAKE`; slashing is real).
- Custody the mint authorities: energy-token mint (REC-validator gated) and treasury THBG
  mint (mint authority = treasury PDA `[b"treasury"]`).

---

## 4. Path B — Integrate off-chain services

**Rule: no service calls Solana RPC directly. All access goes through Chain Bridge.**

- **Writes** → publish to NATS JetStream (`chain.tx.submit`, `chain.tx.cancel`,
  `chain.tx.mint`). Chain Bridge signs (Vault Transit in prod, keypair path in dev) and
  submits.
- **Reads** → gRPC to Chain Bridge (balance, account data, slot). Dev reads need
  `CHAIN_BRIDGE_INSECURE=true`; the real trust boundary is mTLS + role/RBAC, not the bind
  address.
- **Shared types** → the `gridtokenx-blockchain-core` crate (in the superproject).

Adopting the on-chain programs without Chain Bridge means re-implementing this boundary
yourself — possible, but you inherit signing, retry, and RBAC concerns the platform already
solves. Prefer running Chain Bridge.

For settlement specifically: matches are computed **off-chain** and settled via
off-chain-signed proofs (`programs/trading/src/instructions/settle_offchain.rs`), Ed25519
one signature per match.
Batch settlement is capped at **1 match per transaction** (the per-match Ed25519 data can't
be ALT-compressed). Size your throughput plan around that, not around naive batching.

---

## 5. Path C — Extend on-chain

If you add instructions or a program, you inherit the load-bearing invariants. The ones
that break silently if ignored:

1. **Zero-copy everywhere.** Every state struct is `#[account(zero_copy)] #[repr(C)]` + Pod
   with manual `_paddingN` alignment. Recount padding by hand when adding fields. No
   `String` — use `[u8; N]` + `*_len: u8`.
2. **Sealevel parallelism.** Hot-path writes go to per-entity PDAs, never global config
   accounts (read-only on hot paths). Global totals are stale on purpose; reconcile via
   admin instructions. Writing a global account on a hot path serializes your whole market.
3. **`overflow-checks = true`** in every program's `[profile.release]` — `cargo build-sbf`
   defaults it **off**, so a new program without this block wraps silently. Still prefer
   `checked_*` / `saturating_*` explicitly.
4. **`compute-debug`** — wrap handler bodies in `compute_fn!` (no-op in release) to keep CU
   profiling working against the 200k default / 1.4M max budget.
5. **Program IDs & seeds.** Changing a program ID needs `anchor keys sync` **and** a
   `declare_id!` edit. Renaming an account *type* never renames its PDA seed bytes — the
   seed literal is the on-chain address; changing it orphans every existing account. Only
   change seed bytes for a genuinely new account or an explicitly planned migration.

The CPI graph you must respect when wiring a new program:

```
registry → energy-token
trading  → governance,  trading → treasury (optional record_settlement)
oracle   → governance   (validation only, no CPI invoke)
```

---

## 6. Pre-adoption checklist

- [ ] Confirm the PoA/permissioned model fits your regulatory and operator structure.
- [ ] Budget for your own security audit of the economic paths before handling real value.
- [ ] Stand up your own cluster; generate your own program IDs (`anchor keys sync`).
- [ ] Run the full init sequence — **including** the `init-treasury.ts` cross-program policy.
- [ ] Rotate the governance authority to your operator key; define admission + slashing policy.
- [ ] Deploy Chain Bridge and route all service ↔ chain traffic through it (no direct RPC).
- [ ] Custody mint authorities (energy-token, treasury THBG) deliberately.
- [ ] Plan throughput around 1-match-per-tx settlement, not naive batching.
- [ ] Pin your Anchor CLI to match the 1.0.0 on-chain crate; validate builds reproduce.

---

## 7. Support & references

- Program invariants — [`SKILL.md`](SKILL.md)
- Component map — [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Runtime / SVM measurement — [`RUNTIME-ARCHITECTURE.md`](RUNTIME-ARCHITECTURE.md)
- Benchmark baselines — [`BENCHMARKS.md`](BENCHMARKS.md)
- Solana-internals learning path — `docs/diagrams/README.md`
- Platform-wide services (Chain Bridge, IAM, Trading, Aggregator Bridge) — the
  `gridtokenx-coresystem` superproject.

## License

[MIT](LICENSE) © 2026 WIT @GridTokenX
