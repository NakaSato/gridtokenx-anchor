= 4. SVM Execution Model

== 4.1 Programs are stateless; state lives in accounts

Each program in `programs/*` compiles to SBF bytecode (`anchor build` →
`target/deploy/*.so`) and is deployed at a fixed address (`declare_id!`). A
program owns accounts; only the owning program may mutate an account's data. All
protocol state — token supply, meter readings, orders, governance config — lives
in accounts, not in the programs.

== 4.2 Transactions declare their account set in advance

A Solana transaction lists every account it will touch and whether each is
read-only or writable. The runtime uses this to take *per-account read/write
locks* before execution. Two transactions that touch disjoint writable account
sets execute *in parallel* on different cores (Sealevel). Two transactions that
both write the same account serialise.

This is the most fundamental constraint on the repository's design. Every
hot-path write goes to a *per-entity PDA* so that unrelated users/meters/orders
never contend:

#table(
  columns: 4,
  align: (left, left, left, left),
  table.header([*Hot path*], [*Per-entity account*], [*Seeds*], [*Where*]),
  [Meter telemetry], [`MeterState`], [`[b"meter", meter_id]`], [`programs/oracle/src/lib.rs:473`],
  [Order placement], [`Order`], [`[b"order", authority, order_id]`], [`programs/trading/src/lib.rs:1435`],
  [Settlement replay guard], [`OrderNullifier`], [`[b"nullifier", user, order_id]`], [`.../settle_offchain.rs:112`],
  [User registration counters], [`RegistryShard` ×16], [`[b"registry_shard", shard_id]`], [`programs/registry/src/lib.rs:770`],
  [Settlement escrow], [escrow PDA], [`[b"escrow", user, currency_mint]`], [`.../settle_offchain.rs:140`],
)

Shard selection is deterministic from the signer: `key.to_bytes()[0] % 16`
(`programs/registry/src/lib.rs:46`), so a given user always lands on the same
shard but the 16 shards absorb concurrent registrations without a global write
lock.

The corollary: *global accounts (config, totals) are read-only on hot paths and
deliberately stale*. Periodic admin instructions (`aggregate_readings` in oracle,
`aggregate_shards` in registry) fold per-entity state back into global totals.

== 4.3 Compute budget

Every instruction executes under a compute-unit meter (200k CU default per
instruction, 1.4M per transaction ceiling). Exceeding it aborts the transaction.
This repository profiles CU cost with the `compute_fn!` macro
(`shared/compute-debug/src/lib.rs:78`), which logs remaining CU around each
handler body on localnet and compiles to a no-op in release. Checkpoints inside
long handlers use `compute_checkpoint!` (`shared/compute-debug/src/lib.rs:143`)
— e.g. around the registry→energy-token CPI.

== 4.4 Zero-copy account access

State structs are `#[account(zero_copy)] #[repr(C)]` and accessed through
`AccountLoader` (`load()` / `load_mut()` / `load_init()`). Instead of
deserialising the whole account into heap objects (Borsh), the program casts the
account's byte buffer in place — large accounts (sharded order books, meter
state) incur low compute-unit cost. The cost is manual layout discipline:
explicit padding
fields, no `String` (fixed `[u8; N]` + length byte instead). See invariants 1–2
in #link("ARCHITECTURE.md")[`ARCHITECTURE.md`].

What "manual layout discipline" means concretely is best shown by one real
account. The registry's `UserAccount` documents its own byte map in source
(`registry/src/state.rs:56`); after the 8-byte discriminator, the data bytes
are:

```
offset  size  field                    offset  size  field
0       32    authority                59      1     airdrop_claimed
32      1     user_type                60      4     _padding3
33      3     _padding1                64      8     registered_at
36      4     lat_e7                   72      4     meter_count
40      4     long_e7                  76      4     _padding4
44      4     _padding2                80      8     staked_grx
48      8     h3_index                 88      8     last_stake_at
56      1     status                   96      8     resign_at   → 104 total
57      1     validator_status
58      1     shard_id
```

Every padding run exists to keep the next field naturally aligned for the
in-place cast (`bytemuck` requires it), and every run is *named* — because
those bytes are also the account's only schema-evolution budget: `resign_at`
and `airdrop_claimed` were both carved out of former padding without
changing the 104-byte size, which is what made them deployable without a
state migration. The same byte-stability is load-bearing for testing: the LiteSVM suites configure a deployed market's price band by *byte-patching
the account data directly at offsets 88/96* rather than replaying admin
instructions (`tests/price_models_litesvm.ts:17`) — safe precisely because
`#[repr(C)]` freezes the offsets, and a silent field reorder would break the
test rather than the invariant.

== 4.5 The network limit on transaction size: an IP-packet ceiling

One SVM constraint is not a runtime rule at all but a *network-layer* constant
that surfaces as an application ABI: a serialised Solana transaction must fit
in *1,232 bytes*. The number is the IPv6 minimum MTU of 1,280 bytes minus 40
bytes of IPv6 header and 8 bytes of fragmentation header — chosen so that one
transaction always travels as a single unfragmented datagram on the original
UDP ingest path, and retained unchanged after the validator transport moved to
QUIC, because every deployed client, RPC node, and program interface assumes
it. Everything a transaction carries competes for that budget: 64 bytes per
signature, 32 bytes per statically listed account address, 32 bytes of recent
blockhash, compact-array headers, and the raw instruction data. Versioned
(`v0`) transactions with address lookup tables relieve exactly one of these
terms — a table-resident account address shrinks from 32 bytes to a 1-byte
index — but signatures and instruction *data* are cryptographic content that
no table can compress.

The budget's fine structure merits one further level of detail, because two of
its encoding rules carry semantics. A serialised message is: a 1-byte version
prefix (high bit set, `0x80`, for `v0`; absent for legacy), then a *3-byte
header* — `num_required_signatures`, `num_readonly_signed_accounts`,
`num_readonly_unsigned_accounts` — then the account-key array, recent
blockhash, and instructions, with every variable-length array prefixed by a
*compact-u16*: a 1–3-byte little-endian varint carrying 7 bits per byte
(lengths under 128 cost one byte, which is why the §9.3 telemetry
transaction's arrays all take single-byte prefixes). The semantic rule hiding
in the header: account keys are *sorted* — writable signers, then read-only
signers, then writable non-signers, then read-only non-signers — and an
account's writability is determined purely by its *position* relative to the
three header counts. The runtime takes its lock set from this message
encoding, not from the program's own declarations. This repository measured
the consequence directly: a stale client IDL that still marked `zone_market`
writable made every settlement transaction acquire a write lock the program
no longer needed — serialising to 1 settlement per slot where the read-only
encoding sustained 3 — with zero on-chain code difference. The client's
byte-level message encoding, not the deployed program, is what Sealevel
schedules against.

The ceiling shapes this repository in two measured places:

+ *Settlement batching is packet-bound, not compute-bound.*
  `batch_settle_offchain_match` accepts $N$ matches on-chain, but every match
  requires two inline Ed25519 verify instructions whose ≈189-byte
  signature+pubkey+message payloads live in instruction data
  (`settle_offchain.rs:598`). Two matches — four Ed25519 instructions
  (≈760 B) plus two serialised match descriptors (≈370 B) plus the settle
  instruction's account-index list and headers — overrun 1,232 bytes and fail
  client-side at `MessageV0.serialize`, even with every account address
  behind a lookup table. The effective batch size is therefore *one match per
  transaction* (#link("BENCHMARKS.md")[`BENCHMARKS.md`] §2b): the measured
  ≈101 k CU cost of that packet-capped batch is nowhere near the 1.4 M CU
  maximum transaction compute budget, so the
  binding constraint on settlement packaging is the packet, not compute.
  Raising it requires a protocol change in packaging — pre-verified signature
  accounts written in earlier transactions, or an aggregated signature scheme
  — not more compute.
+ *On-chain data structures are sized to the packet.* The zone order book
  publishes a depth snapshot of at most `MAX_DEPTH_LEVELS = 10` price levels
  per side (`trading/src/state/zone_market.rs:7`), tuned so `update_depth`'s
  serialised level vector stays within a single transaction; deepening the
  book is a packet-budget recalculation, not a one-line constant change.

The telemetry path, by contrast, never approaches the ceiling: a
`submit_meter_reading` transaction carries one instruction, four accounts, and
a ≈60-byte payload — all 1,020,000 transactions of the §9.3 extension sweep
travelled as single packets with room to spare. The general lesson mirrors
§4.2: as account locking makes parallelism a property of data layout, the
packet ceiling makes protocol throughput a property of *wire format* — what
must be proven inside one transaction (signatures, match descriptors) is as
much a scaling budget as compute units are.

== 4.6 Binary interface: the 8-byte discriminator

Anchor's dispatch and type-safety mechanism reduces to prefix byte
comparison. Every account a program owns begins with an 8-byte
*discriminator*: the first eight bytes of `sha256("account:<StructName>")`.
Every instruction's data begins with the first eight bytes of
`sha256("global:<snake_case_instruction_name>")`. When a transaction arrives,
the program entrypoint matches the leading 8 bytes of instruction data
against its known instruction discriminators to select a handler; when an
account is deserialised as a given type, the first check is that its leading
8 bytes equal that type's discriminator. This is why the space formula
throughout the repository is `8 + size_of::<T>()` for zero-copy accounts
(e.g. `MeterState::SPACE`, `programs/oracle/src/state.rs:27`) — the eight
bytes are not padding but the type tag — and why the sysvar and shard
parsers slice from byte 8 before casting
(`registry/src/instructions/aggregate_shards.rs:35`). Two consequences
matter for safety. First, the discriminator is what makes *type confusion*
across accounts fail closed: a `MeterState` account passed where an `Order`
is expected fails the 8-byte compare before any field is read. Second, the
hash preimage binds the *name*: renaming a struct silently changes its
discriminator and orphans every existing account of that type — the same
migration economics as PDA seed renames (§6), enforced by hash rather than
by seed bytes. Collision risk is negligible (64 bits across the handful of
types one program owns) but the mechanism is prefix equality, not
cryptographic authentication — ownership (§4.1) is what stops an attacker
minting a fake account with a correct prefix.

== 4.7 Binary interface: PDA derivation, bump search, and its compute price

A program-derived address is defined by one hash:
`sha256(seed₁ ‖ … ‖ seedₙ ‖ bump ‖ program_id ‖ "ProgramDerivedAddress")`,
accepted only if the resulting 32 bytes are *not* a valid Ed25519 curve
point (off-curve ⇒ no private key can ever exist for it — the runtime can
then safely let the owning program "sign" as this address in CPI).
`find_program_address` searches the bump byte downward from 255, calling
`create_program_address` per candidate and returning the first off-curve
result; since each candidate is off-curve with probability ≈½, the search
usually ends within a few iterations, but the cost is a hash *plus a curve
decompression check* per attempt, and it is not constant-time across
addresses. The repository treats this cost as a first-class budget item with
a measured answer: derive once, store the winning bump in the account, and
thereafter validate with a single `create_program_address` call against the
stored bump — ≈1,651 CU instead of the ≈12,136 CU a fresh
`find_program_address` costs in the aggregation path
(`registry/src/instructions/aggregate_shards.rs:37`). The same idea appears
as seeds-carrying state everywhere (`RegistryShard.bump`,
`state.rs:25`; `OrderNullifier.bump`; `ZoneCapacity.bump`). Two
binary-level facts follow. First, the seed tuple is length-prefixed nowhere
— concatenation is raw — so seed *boundaries* are a program-level
convention; the repository's fixed-width seeds (`[u8; 32]` meter ids, single
shard-index bytes) mean no two distinct seed tuples can concatenate to the
same byte string, avoiding ambiguity by construction. Second, the 32-byte
meter-id seed ceiling of §9.3's harness is a protocol constant: a PDA seed
may be at most 32 bytes, which is why the oracle's `MeterIdTooLong` guard is
provably dead code — the runtime's seed-length check fires first.

== 4.8 The third budget: 4 KiB of stack

Alongside compute (§4.3) and the packet (§4.5), SBF imposes a third, less
advertised budget: each function frame gets a *fixed 4,096-byte stack
window* (frame pointer register `r10`), with no dynamic growth. Rust code
that would be unremarkable on a conventional target — a context struct with
a dozen typed accounts, each expanding to validation state inside Anchor's
generated `try_accounts` — can overflow a frame at compile time or corrupt
it at run time. The settlement path lives at this ceiling and shows the
three practical escape hatches in use. (1) *Move validation out of the
frame*: the settle context reads the governance maintenance flag by raw byte
offset from the config account (byte 235 = 8-byte discriminator + 32
authority + 64 name + 1 length + 128 contact + 1 length + 1 version) inside
the handler, because one more typed `Account<GovernanceConfig>` constraint
in `try_accounts` overflows the frame (`settle_offchain.rs:69`). (2) *Move
accounts out of the struct*: optional treasury-recording accounts arrive via
`remaining_accounts` — a runtime-indexed slice costs no frame bytes, at the
price of hand-written owner/PDA checks replacing derive-time constraints.
(3) *Box the rest*: heap-allocating large account wrappers trades stack for
the 32 KiB heap. The general statement mirrors §4.5: the packet bounds what
a transaction can *carry*, the stack bounds what one instruction can
*name statically* — and both push the design toward fewer, thinner, more
manually-audited account interfaces on exactly the hottest paths.

== 4.9 Fixed-point value paths and overflow semantics

No floating point exists anywhere in the value paths; every quantity is an
integer with a declared scale. Energy is a `u64` count of 10⁻⁹ kWh atoms
(one Token-2022 GRID token = 1 kWh at 9 decimals), currency a `u64` count of
10⁻⁶ THBC atoms, and rates and fees are integers with explicit divisors.
The treasury swap shows the canonical shape of such arithmetic
(`compute_swap_grx_for_thbc`, `treasury/src/lib.rs:67`): widen to `u128`
*before* multiplying (`grx_in × rate` can exceed 2⁶⁴ for legal inputs),
divide by the scale constant (`GRX_ATOMS_PER_WHOLE = 10⁹`,
`treasury/src/lib.rs:41`), take the fee as basis points over 10,000, check
the peg invariant in the widened domain (`new_supply ≤ attested_reserve`),
and only then narrow back with a *checked* `u64::try_from` — every step
either `checked_*` with a typed `MathOverflow` error or a deliberate
`saturating_sub` where clamping at zero is the intended semantics. The same
pattern gates fill accounting in settlement and reading accumulation in the
oracle (`saturating_add` on lifetime totals, where a pinned counter is
preferable to a halted meter).

The backstop beneath the discipline is a compiler flag with binary
consequences: `cargo build-sbf` release profiles default to
`overflow-checks = off`, under which `a + b` compiles to a plain wrapping
`add` — a silent mint of 2⁶⁴ atoms on overflow. Every program in this
repository sets `overflow-checks = true` in its release profile
(e.g. `programs/registry/Cargo.toml:35`, with the same commented block in
all eight crates), which makes every unannotated arithmetic op compile to
add-plus-branch-to-abort. The measured cost is negligible relative to the §9.1
profiles; the payoff is that the *default* failure mode of forgotten
arithmetic is a reverted transaction, not silently wrapped value — the
`checked_*` calls then exist to attach precise error codes, not to be the
only line of defence.

== 4.10 Event wire format

Events are the platform's audit stream (the explorer, the §9.6 verifier, and
the settlement reconciliation all consume them), so their encoding merits
the same precision as accounts. `emit!` serialises the event struct with
Borsh, prefixes it with an 8-byte event discriminator — the first eight
bytes of `sha256("event:<StructName>")`, the same naming trick as §4.6 —
and writes the result base64-encoded into the transaction log via the
`sol_log_data` syscall. Three practical consequences follow. First, events
are *log data, not state*: they cost compute at emission and bytes in the
ledger's transaction metadata, but no rent — the natural home for
per-reading telemetry like `MeterReadingSubmitted`
(`oracle/src/events.rs:5`), which would be ruinous as accounts (§9.3 emitted
a million of them). Second, because the payload is Borsh over the *event*
struct, events may use heap types the zero-copy accounts cannot: the same
meter identifier that lives in state as `[u8; 32]` + length byte travels in
the event as a real `String`, rehydrated at the emission site — the
account-to-event boundary is where the fixed-width discipline of §4.4
relaxes. Third, syscalls inside macro arguments are invisible in source but
real in the profile: the repository's convention of hoisting
`Clock::get()?` into a local before the `emit!` block exists because a
clock read expanded *inside* the macro executes per expansion — the
CU profile of §9.1 is only reproducible because timestamp acquisition is a
single hoisted syscall per handler, not a hidden per-event one.
