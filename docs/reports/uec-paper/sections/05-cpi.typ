= 5. Cross-Program Invocation (CPI)

Programs call each other synchronously inside one transaction; the callee
inherits the transaction's account locks and compute budget. Two production CPI edges exist (§5.1, §5.2).

At the binary level, `invoke` is a syscall that re-marshals data the runtime
already holds. The caller passes an `Instruction` (program id, `AccountMeta`
list — 34 bytes each: 32-byte key + `is_signer` + `is_writable` flags — and a
raw data vector) plus the subset of its own `AccountInfo`s the callee will
touch; the runtime translates each named account back to the *same underlying
buffers* the caller sees, so a CPI is not a copy of state but a re-borrow. This is precisely why the callee inherits the caller's locks, and why a reentrant write is structurally impossible: the account is already borrowed.
Two hard limits bound the mechanism: a maximum invocation depth of four, and flag narrowing — the flags on each `AccountMeta` may only be *narrowed*; a callee cannot
promote an account to writable or signer that the caller did not already hold
as such. The repository's deepest production chain — registry invoking
energy-token's mint, which itself invokes the Token-2022 program — uses three
of the four levels. PDA "signing" is an instance of exactly this narrowing rule:
`invoke_signed` carries the seed byte-tuples alongside the call, the runtime
re-runs the §4.7 derivation (`sha256(seeds ‖ bump ‖ program_id ‖ …)`), and if
the result equals one of the passed account keys *and* the derivation used
the calling program's id, that account's `is_signer` flag is set for the
callee — a signature proven by hash preimage rather than by curve math, valid
only downward through the call chain, never across transactions.

== 5.1 registry → energy-token (registration grant)

When a new user registers, the registry program mints the 10 GRX grant by CPI
into energy-token. The registry signs the CPI *as its own PDA* using
`CpiContext::new_with_signer` with the `[b"registry", bump]` seeds
(`programs/registry/src/lib.rs:298`), then calls
`energy_token::cpi::mint_tokens_direct` (`programs/registry/src/lib.rs:305`).
This is the canonical PDA-signing pattern: no private key exists for the registry
PDA; the runtime grants it signer status because the calling program proved the
seeds derive to that address.

== 5.2 trading → governance (PoA config + ERC certificates)

Trading depends on governance with `features = ["cpi"]` and re-exports its types
directly: `pub use governance::{ErcCertificate, ErcStatus, GovernanceConfig}`
(`programs/trading/src/lib.rs:18`). Settlement validates governance-owned
accounts (deserialise + owner check) rather than invoking governance
instructions — a read-side coupling, cheaper than a full CPI call.

Both edges are path dependencies in `Cargo.toml`, so Anchor builds callee CPI
client code (typed `cpi::` modules) at compile time — no runtime IDL lookup.
