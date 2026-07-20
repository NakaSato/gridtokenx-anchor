= 12. Appendix: Binary-Level Reference

This appendix collects byte-level mechanics referenced throughout the paper
but too low-level to inline in the design sections: encodings, storage formats, and runtime
limits that the design sections build on. Each subsection is grounded in a
measurement or artifact from this repository.

== 12.1 Token-2022 account layout

Both value mints — GRID/GRX (9 decimals) and the REC certificate mint
(6 decimals, 1 token = 1 MWh) — are owned by the Token-2022 program, whose
account format is the classic SPL layout plus a type-length-value tail. A
base mint is 82 bytes (`mint_authority` 36 B as a 4-byte tag + key,
`supply` u64, `decimals` u8, `is_initialized` u8, `freeze_authority` 36 B);
a base token account is 165 bytes. When any extension is present, the
account is padded to 165 bytes, byte 165 carries an account-type
discriminant (mint vs. account — necessary because with extensions both can
exceed 165 bytes and size no longer identifies type), and extension records
follow as TLV: `extension_type: u16`, `length: u16`, then `length` bytes of
payload. The platform's mints are currently created with empty extension
tails, but the layout is load-bearing anyway: client code must derive
associated token accounts against `TOKEN_2022_PROGRAM_ID` (an ATA address different from classic SPL's — the program id is an ATA seed), and any future
extension (transfer hooks for compliance, confidential amounts) changes
account sizes without changing the base offsets, which is exactly what TLV
buys.

== 12.2 Borsh and bytemuck: one datum, two encodings

The repository uses two serialisation regimes with opposite priorities, and
several structures cross between them. *Borsh* (instruction arguments,
events, non-zero-copy accounts) is packed little-endian with no padding:
`u64` is 8 bytes at any offset, `String` is a u32 length prefix plus UTF-8
bytes, `Option<T>` is a 1-byte tag plus payload, `Vec<T>` a u32 count plus
elements. The encoding is compact but variable-offset: reading one field requires walking
every prior field. *Bytemuck* zero-copy (`#[account(zero_copy)]
#[repr(C)]`, §4.4) is the opposite trade-off: fixed offsets, natural alignment,
explicit padding, no heap types — a cast, not a parse. The 77-byte signed
settlement payload of §6.3 is effectively hand-rolled Borsh (fields
serialised in declaration order, `get_message`,
`settle_offchain.rs:400`); the `MeterState` it settles against is a
bytemuck cast. The practical rule visible throughout is that data that is *parsed
once per transaction* (arguments, signed messages, events) is Borsh; data
that is *read in place every transaction* (hot accounts) is zero-copy; and
the boundary crossings — `[u8; 32]` + length byte in state rehydrating to
`String` in an event — are always explicit conversions, never casts.

== 12.3 Ed25519 key and signature encoding

A Solana address is a 32-byte compressed Edwards point: 255 bits of the
y-coordinate plus one sign bit for x. Two facts used earlier follow
directly. First, the registry's shard selector (§3.1) is uniform because
the first byte of a compressed point over a ~2²⁵² group is
indistinguishable from uniform for honestly generated keys — and only
grindable, not choosable, for adversarial ones (expected 16 keygen
attempts to hit a chosen shard). Second, "off-curve" — the PDA acceptance
condition of §4.7 — is a decompression failure: the candidate 32 bytes
decode to a y with no valid x on the curve equation, so no scalar (private
key) can ever produce a signature verifying against that "key". A signature
is 64 bytes, `R ‖ s`: a 32-byte curve point commitment and a 32-byte
scalar; the native Ed25519 program checks
`[s]B = R + [H(R ‖ A ‖ M)]A` — batch-friendly curve math priced at one
native instruction rather than program compute, which is the entire reason
§6.3's introspection pattern exists.

== 12.4 Rent arithmetic

Every account must hold a lamport balance proportional to its size to be
rent-exempt: `(data_len + 128) × 3,480 lamports/byte-year × 2 years`, where
128 bytes is the per-account storage overhead (key, owner, lamports,
metadata) and 3,480 the protocol's per-byte-year rate. This turns state
size directly into capital cost, and the §9.3 sweep is a worked example: a
`MeterState` account is 102 bytes, so
`(102 + 128) × 3,480 × 2 = 1,600,800` lamports ≈ 0.0016 SOL per meter; the
510,000 PDAs of the extension sweep therefore locked ≈ 816 SOL of rent
against ≈ 5.1 SOL of transaction fees (1.02 M signatures at 5,000
lamports). Rent is reclaimable — closing an account returns the lamports —
which is why the 9-byte `TradeNullifier` (§6.3) is cheap insurance
(≈ 0.00095 SOL each) but *deliberately never closed*: reclaiming its rent
would re-open the replay window it exists to shut.

== 12.5 The SBF instruction set and verifier

Programs execute as SBF, an eBPF-derived 64-bit ISA: eleven registers
(`r0` return, `r1–r5` arguments, `r6–r9` callee-saved, `r10` the read-only
frame pointer behind §4.8's fixed 4 KiB frames), fixed 8-byte instruction
encoding (16 for `lddw`), and calls to the runtime only through
hash-identified syscalls (`sol_sha256`, `sol_log_data`,
`sol_invoke_signed_c`, …). Before deployment the loader's verifier
statically rejects indirect jumps, out-of-range branches, and writes
outside the stack/heap windows, and at runtime the interpreter or JIT
meters every instruction against the compute budget — which is what makes
§9.1's CU numbers deterministic: identical bytecode over identical inputs
executes an identical number of instructions, so compute cost is a property of
the binary, machine-independent in a way wall-clock TPS never is. The
64-frame call-depth limit and the absence of dynamic stack allocation are
also why deep generic expansions (Anchor's `try_accounts`) hit §4.8's wall
at compile time rather than as a runtime surprise.

== 12.6 Blockhash lifetime and the expiry failure class

A transaction binds to a recent blockhash (32 bytes in the message, §4.5)
and is valid only while that hash is within the last 150 blocks —
roughly 60–90 s at the localnet's 400–600 ms block times. This is the
replay-prevention *and* garbage-collection mechanism: the same signed bytes
can never land twice outside the window, and a dropped transaction expires
rather than lingering forever. The §9.3 harness works inside this budget
deliberately: it caches one blockhash and refreshes every 10 s
(`BLOCKHASH_MS`), pre-signing thousands of transactions against the cached value. Its third failure class — *expired*, zero occurrences in the
extension sweep — is precisely "the blockhash aged out before
confirmation". For signers that cannot tolerate the window (offline
signing, multi-party approval), the protocol's durable-nonce mechanism
substitutes a per-payer nonce account whose stored value replaces the
recent blockhash and advances on use; the platform does not need it,
because Chain Bridge signs and submits within seconds.

== 12.7 Address lookup table layout

A `v0` transaction (§4.5) may reference accounts through on-chain lookup
tables: an ALT account is a ~56-byte header (type discriminant,
deactivation slot, last-extended slot and start index, optional authority)
followed by a packed array of 32-byte addresses, at most 256 — the
addressing unit in the transaction is a single byte index. Compression is
therefore 32 : 1 per table-resident account, but three properties bound its
use, all encountered by the §9.2 TPS harness (which builds one ALT per
batch): a table only becomes usable one slot *after* extension (warm-up),
deactivation is delayed (cool-down) so in-flight transactions cannot be
invalidated, and — the §4.5 point — only *addresses* compress; signatures
and instruction data pass through untouched, which is why the ALT could
not rescue the two-match settlement batch.

== 12.8 Validator account storage (why 510,000 PDAs were free)

The §9.3 finding that write cost is independent of accumulated account
count has a storage-layer mechanism. The validator's AccountsDB stores
account payloads in append-only files ("append-vecs"): each entry is
stored metadata (write version, data length, pubkey), the account fields
(lamports, owner, executable, rent epoch), a hash, then the data bytes,
8-byte aligned. Updates never rewrite in place — an update appends a fresh entry in the current slot's storage and the old one becomes
garbage for background cleaning. Lookup goes through an in-memory index
from pubkey to (slot, offset) — effectively O(1) regardless of population
— so the 200,000-meter epoch's random-access pattern over 510,000+
accounts costs the same per write as the 10,000-meter epoch's: one index
probe, one append. The costs that *do* scale with account count land
elsewhere: index memory, snapshot size, and startup time — real
multi-node operational concerns (§8.3), invisible to per-transaction
latency, which is exactly what the flat latency row of the extension
sweep shows.

== 12.9 Base58 address display

The 32-byte keys and 64-byte signatures quoted throughout render in
Base58 — Bitcoin's alphabet, which drops `0`, `O`, `I`, `l` to keep
transcription unambiguous. A 32-byte key encodes to 43–44 characters; the
mint transaction signature quoted in §9.3's mint-proof experiment is a
64-byte signature at 87–88 characters. Unlike EVM's hex-with-checksum
(EIP-55), Base58 here carries no check digits — integrity comes from the
fact that a mistyped address is overwhelmingly unlikely to be a valid
funded account, and PDAs are derived rather than typed at all.

== 12.10 Litesvm account injection: the testing mirror

The in-process test harness closes the loop on everything above: because
accounts are just (lamports, owner, data, executable) tuples, a test can
*fabricate* protocol states that would take many transactions to reach.
The LiteSVM suites do this three ways, all visible in the §9.6 price-rule
tests (`tests/price_models_litesvm.ts:146`): Borsh-encode a full
`GovernanceConfig` or `ErcCertificate` with Anchor's coder and
`setAccount` it into existence with exactly
`minimumBalanceForRentExemption(len)` lamports; byte-patch a live
zero-copy account at known §4.4 offsets (the market price band at
88/96); and load the real program binaries (`addProgramFromFile`) so the
code under test is the deployed artifact, not a reimplementation. The
technique is sound for the same reason the attacks it resembles are not:
inside the SVM, `setAccount` is the storage layer's own write path, while
on-chain the ownership rule (§4.1) means only a program can produce bytes
in accounts it owns — the test harness is standing in for the runtime,
not bypassing it.
