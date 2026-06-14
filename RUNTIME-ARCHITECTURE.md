# gridtokenx-anchor — Runtime Architecture

> How the GridTokenX on-chain programs actually execute: the Solana validator stack, the SVM
> execution model, cross-program invocation, the security/trust model, the energy-trading
> protocol flow, and the consensus/validator topology this protocol assumes.
>
> Companion to [`ARCHITECTURE.md`](ARCHITECTURE.md) (what the programs are). This doc explains
> **how they run**. Program IDs are authoritative in `Anchor.toml [programs.localnet]`.

---

## 1. The Execution Stack, Top to Bottom

```
┌─────────────────────────────────────────────────────────────┐
│  Off-chain platform (superproject)                          │
│  IAM / Trading / Oracle services → Chain Bridge (only RPC   │
│  client) → JSON-RPC / gRPC                                  │
├─────────────────────────────────────────────────────────────┤
│  Validator node (solana-test-validator on localnet)         │
│  TPU ingest → SigVerify → Banking stage → PoH → ledger      │
├─────────────────────────────────────────────────────────────┤
│  SVM runtime (Sealevel)                                     │
│  Account locks → parallel scheduling → SBF (eBPF-derived)   │
│  bytecode execution → compute-unit metering                 │
├─────────────────────────────────────────────────────────────┤
│  GridTokenX programs (this repo)                            │
│  energy-token │ governance │ oracle │ registry │ trading    │
│  + CPI between them, + SPL Token / Token-2022 programs      │
└─────────────────────────────────────────────────────────────┘
```

Key boundary rule (platform-wide, see superproject docs): **no service holds a Solana RPC
connection except Chain Bridge**. Everything below the top layer is what this document covers.

## 2. SVM Execution Model

### 2.1 Programs are stateless; state lives in accounts

Each program in `programs/*` compiles to SBF bytecode (`anchor build` →
`target/deploy/*.so`) and is deployed at a fixed address (`declare_id!`). A program owns
accounts; only the owning program may mutate an account's data. All protocol state — token
supply, meter readings, orders, governance config — lives in accounts, not in the programs.

### 2.2 Transactions declare their account set up front

A Solana transaction lists every account it will touch and whether each is read-only or
writable. The runtime uses this to take **per-account read/write locks** before execution.
Two transactions that touch disjoint writable account sets execute **in parallel** on
different cores (Sealevel). Two transactions that both write the same account serialize.

This is the single most load-bearing fact for this repo's design. Every hot-path write goes
to a **per-entity PDA** so that unrelated users/meters/orders never contend:

| Hot path | Per-entity account | Seeds | Where |
| :--- | :--- | :--- | :--- |
| Meter telemetry | `MeterState` | `[b"meter", meter_id]` | `programs/oracle/src/lib.rs:473` |
| Order placement | `Order` | `[b"order", authority, order_id]` | `programs/trading/src/lib.rs:1435` |
| Settlement replay guard | `OrderNullifier` | `[b"nullifier", user, order_id]` | `programs/trading/src/instructions/settle_offchain.rs:112` |
| User registration counters | `RegistryShard` ×16 | `[b"registry_shard", shard_id]` | `programs/registry/src/lib.rs:770` |
| Settlement escrow | escrow PDA | `[b"escrow", user, currency_mint]` | `programs/trading/src/instructions/settle_offchain.rs:140` |

Shard selection is deterministic from the signer: `key.to_bytes()[0] % 16`
(`programs/registry/src/lib.rs:46`), so a given user always lands on the same shard but the
16 shards absorb concurrent registrations without a global write lock.

The corollary: **global accounts (config, totals) are read-only on hot paths and stale on
purpose**. Periodic admin instructions (`aggregate_readings` in oracle, `aggregate_shards`
in registry) fold per-entity state back into global totals.

### 2.3 Compute budget

Every instruction executes under a compute-unit meter (200k CU default per instruction,
1.4M per transaction ceiling). Exceeding it aborts the transaction. This repo profiles CU
cost with the `compute_fn!` macro (`shared/compute-debug/src/lib.rs:78`), which logs
remaining CU around each handler body on localnet and compiles to a no-op in release.
Checkpoints inside long handlers use `compute_checkpoint!`
(`shared/compute-debug/src/lib.rs:143`) — e.g. around the registry→energy-token CPI.

### 2.4 Zero-copy account access

State structs are `#[account(zero_copy)] #[repr(C)]` and accessed through `AccountLoader`
(`load()` / `load_mut()` / `load_init()`). Instead of deserializing the whole account into
heap objects (Borsh), the program casts the account's byte buffer in place — large accounts
(sharded order books, meter state) stay cheap in CU. The cost is manual layout discipline:
explicit padding fields, no `String` (fixed `[u8; N]` + length byte instead). See invariants
1–2 in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## 3. Cross-Program Invocation (CPI)

Programs call each other synchronously inside one transaction; the callee inherits the
transaction's account locks and compute budget. Two production CPI edges exist:

### 3.1 registry → energy-token (registration airdrop)

When a new user registers, the registry program mints the 20 GRX airdrop by CPI into
energy-token. The registry signs the CPI **as its own PDA** using
`CpiContext::new_with_signer` with the `[b"registry", bump]` seeds
(`programs/registry/src/lib.rs:298`), then calls
`energy_token::cpi::mint_tokens_direct` (`programs/registry/src/lib.rs:305`). This is the
canonical PDA-signing pattern: no private key exists for the registry PDA; the runtime
grants it signer status because the calling program proved the seeds derive to that address.

### 3.2 trading → governance (PoA config + ERC certificates)

Trading depends on governance with `features = ["cpi"]` and re-exports its types directly:
`pub use governance::{ErcCertificate, ErcStatus, PoAConfig}`
(`programs/trading/src/lib.rs:18`). Settlement validates governance-owned accounts
(deserialize + owner check) rather than invoking governance instructions — a read-side
coupling, cheaper than a full CPI call.

Both edges are path dependencies in `Cargo.toml`, so Anchor builds callee CPI client code
(typed `cpi::` modules) at compile time — no runtime IDL lookup.

## 4. Security Model

Solana's runtime gives three primitives: **ownership** (only the owning program mutates an
account), **signatures** (the runtime verifies tx signers before execution), and **PDAs**
(addresses no private key can sign for, derivable only via the owning program). Everything
else is program-level policy. This repo layers four mechanisms on top:

### 4.1 Anchor constraint checks (account validation)

Account structs declare constraints that Anchor verifies before the handler runs:
`Signer<'info>` for required signers, `has_one = authority` for stored-authority matching,
`seeds = [...]` + `bump` for PDA address verification. Governance gates every privileged
instruction this way — e.g. `has_one = authority @ GovernanceError::UnauthorizedAuthority`
on `IssueErc` (`programs/governance/src/contexts.rs:31`), `ValidateErc`
(`programs/governance/src/contexts.rs:90`), `RevokeErc`
(`programs/governance/src/contexts.rs:108`), and `UpdateGovernanceConfig`
(`programs/governance/src/contexts.rs:149`).

### 4.2 Application-layer PoA with 2-step authority transfer

The governance program holds a `PoAConfig` account naming the platform authority. Authority
rotation is two-phase to survive fat-finger key mistakes:

1. `propose_authority_change` (`programs/governance/src/handlers/authority.rs:13`) — current
   authority writes `pending_authority` (`authority.rs:34`), guarded against an
   already-pending proposal (`authority.rs:22`).
2. `approve_authority_change` (`programs/governance/src/handlers/authority.rs:53`) — the
   **new** key must sign to accept, and only then does `poa_config.authority` flip
   (`authority.rs:78`).

A typo'd new authority therefore cannot brick the protocol — the wrong key simply never
signs the approval.

### 4.3 Off-chain-signed settlement: Ed25519 instruction introspection

The CDA matching engine runs off-chain (Trading Service). Matches settle on-chain via
`settle_offchain.rs` without the buyer/seller being transaction signers. Instead:

- The off-chain engine collects **Ed25519 signatures from buyer and seller over the order
  payload** and places them in the transaction as instructions to Solana's native Ed25519
  verification program (which the validator executes — and rejects the tx if invalid —
  before the trading instruction runs).
- The trading handler then **introspects the transaction** via the instructions sysvar:
  `verify_ed25519_signature` (`programs/trading/src/instructions/settle_offchain.rs:651`)
  calls `load_instruction_at_checked` (`settle_offchain.rs:657`), asserts the instruction
  targets the Ed25519 program (`settle_offchain.rs:660`), and asserts the pubkey embedded in
  the verified instruction matches the expected order owner (`settle_offchain.rs:669`).
  Buyer and seller are checked at instruction indexes 0 and 1
  (`settle_offchain.rs:310`, `settle_offchain.rs:314`).

This is the standard Solana pattern for "verify an arbitrary off-chain signature on-chain"
— the expensive curve math runs in the native program; the application program only proves
the verification happened in the same transaction, against the right key and message.

**Replay protection** comes from `OrderNullifier` PDAs seeded per `(user, order_id)`
(`settle_offchain.rs:112`). Each nullifier tracks `filled_amount`; a settlement may only
consume the unfilled remainder (`settle_offchain.rs:344`) and increments the fill
saturatingly (`settle_offchain.rs:428`), with the nullifier's stored authority re-checked
against the payload (`settle_offchain.rs:539`). The same signed order can therefore be
partially filled across transactions but never over-filled or replayed.

### 4.4 REC-validator gating on mint

GRID tokens represent physical energy (1 kWh = 1 GRID), so minting is gated behind
registered REC validators in energy-token. Validators are added/removed by the admin
(`programs/energy-token/src/lib.rs:280`, `lib.rs:313`); when any validator is registered
(`rec_validators_count > 0`, `lib.rs:119`), mint paths require the signing key to appear in
the validator set (`lib.rs:127`–`128`), with the same gate on the generation-mint path (`lib.rs:203`).

### 4.5 Trust boundary summary

| Boundary | Enforced by |
| :--- | :--- |
| Who may mutate an account | Runtime ownership rule (program-owned accounts) |
| Who may invoke privileged instructions | Anchor `Signer` + `has_one` against `PoAConfig` / stored authorities |
| Whether a trade was authorized | Ed25519 native-program verification + sysvar introspection |
| Whether a trade can be replayed | `OrderNullifier` PDA per (user, order) |
| Whether energy backing is real | REC validator set in energy-token |
| Who may even reach the RPC port | Off-chain: Chain Bridge mTLS + RBAC (superproject concern) |

## 5. Protocol Flow (end-to-end runtime view)

A full market cycle touches all five programs:

```
1. Registration   registry: create user PDA on shard (key[0] % 16)
                  └─CPI→ energy-token: mint 20 GRX airdrop (PDA-signed)
2. Telemetry      oracle: AMI gateway submits readings → per-meter MeterState PDA
                  (parallel across meters; 15-min market-clearing epochs)
3. Order entry    trading: submit_order → per-order PDA on order shard
4. Matching       OFF-CHAIN: Trading Service CDA engine matches buy/sell,
                  collects buyer+seller Ed25519 signatures
5. Settlement     trading: settle_offchain_match — ed25519 ix at index 0/1,
                  introspection check, nullifier fill update, escrow transfer
                  (reads governance PoAConfig / ERC certificates)
6. Token movement energy-token / SPL: GRID + GRX transfers, REC-gated mint/settle
7. Reconciliation admin: aggregate_readings / aggregate_shards fold shard + meter
                  state into global totals (deliberately stale between runs)
```

Steps 2 and 3 are the throughput-critical paths and are exactly the ones designed for
Sealevel parallelism (§2.2). Step 5 is the security-critical path (§4.3).

## 6. Consensus & Validator Topology

### 6.1 What Solana consensus provides

On any Solana cluster, ordering and finality come from **Proof of History** (a verifiable
delay function giving each entry a position in time) feeding **Tower BFT** (a
PoH-timestamped variant of practical BFT voting in which validators commit to forks with
exponentially growing lockouts). Block production rotates across a leader schedule weighted
by stake. The programs in this repo are consensus-agnostic: they see only the SVM account
model and cannot tell which consensus produced the block.

### 6.2 What "permissioned PoA" means here

GridTokenX targets a **permissioned cluster**: the validator set is a closed list of known
operators (utility / market-operator nodes) rather than open stake-weighted entry. Solana
does not have a separate "PoA mode" — permissioning is operational (who is allowed to run a
validator and receive stake delegation), and the *application-layer* PoA lives in the
governance program's `PoAConfig` (§4.2), which gates protocol administration regardless of
who validates blocks. Keep the two layers distinct:

| Layer | Authority | Mechanism |
| :--- | :--- | :--- |
| Block production / finality | Permissioned validator operators | PoH + Tower BFT among allowlisted nodes |
| Protocol administration | `PoAConfig.authority` | Governance program checks (§4.1–4.2) |
| Energy attestation | REC validator set | energy-token gating (§4.4) |

### 6.3 Development topologies

| Mode | Nodes | Consensus reality | How |
| :--- | :--- | :--- | :--- |
| `anchor test` / localnet | 1 × `solana-test-validator` | None — single node self-produces blocks; PoH runs but no voting quorum | `anchor test`, or superproject `just solana-up` |
| Surfpool simnet | 0 local validators | Simulated against mainnet state | `npm run simnet` / `npm run simnet:ci` |
| Target deployment | N permissioned validators | Real Tower BFT among allowlisted operators | Out of scope for this repo |

The single-node localnet means dev/test never exercises fork choice, leader rotation, or
vote lockouts — only the SVM semantics (§2) are faithfully reproduced. Performance numbers
from `BENCHMARKS.md` are therefore SVM/runtime measurements, not consensus-throughput
measurements.

## 7. Reading Map

| Question | Read |
| :--- | :--- |
| What are the programs / IDs / invariants? | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Zero-copy layout, sharding, CU profiling detail | `SKILL.md` (versions/IDs stale — trust `Anchor.toml`) |
| Benchmark methodology + results | [`BENCHMARKS.md`](BENCHMARKS.md) |
| Settlement math / clearing | `programs/trading/src/instructions/settle_offchain.rs` |
| Platform-wide rules (Chain Bridge, gateways) | superproject `../CLAUDE.md`, `../ARCHITECTURE.md` |
