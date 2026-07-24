= 6. Security Model

Solana's runtime provides three primitives: *ownership* (only the owning program
mutates an account), *signatures* (the runtime verifies tx signers before
execution), and *PDAs* (addresses no private key can sign for, derivable only via
the owning program). Everything else is program-level policy. This repository
adds four mechanisms atop these primitives:

== 6.1 Anchor constraint checks (account validation)

Account structs declare constraints that Anchor verifies before the handler runs:
`Signer<'info>` for required signers, `has_one = authority` for stored-authority
matching, `seeds = [...]` + `bump` for PDA address verification. Governance gates
every privileged instruction this way — e.g.
`has_one = authority @ GovernanceError::UnauthorizedAuthority` on `IssueErc`
(`programs/governance/src/contexts.rs:31`), `ValidateErc`
(`programs/governance/src/contexts.rs:90`), `RevokeErc`
(`programs/governance/src/contexts.rs:108`), and `UpdateGovernanceConfig`
(`programs/governance/src/contexts.rs:149`).

== 6.2 Application-layer PoA with 2-step authority transfer

The governance program holds a `GovernanceConfig` account naming the platform
authority. Authority rotation is two-phase to tolerate accidental key-entry
errors:

+ `propose_authority_change` (`programs/governance/src/handlers/authority.rs:13`)
  — current authority writes `pending_authority` (`authority.rs:34`), guarded
  against an already-pending proposal (`authority.rs:22`).
+ `approve_authority_change` (`programs/governance/src/handlers/authority.rs:53`)
  — the *new* key must sign to accept, and only then does `poa_config.authority`
  flip (`authority.rs:78`).

A mistyped new-authority key therefore cannot render the protocol
inoperable — the incorrect key never signs the approval.

== 6.3 Off-chain-signed settlement: Ed25519 instruction introspection

The CDA matching engine runs off-chain (Trading Service). Matches settle on-chain
via `settle_offchain.rs` without the buyer/seller being transaction signers.
Instead:

- The off-chain engine collects *Ed25519 signatures from buyer and seller over
  the order payload* and places them in the transaction as instructions to
  Solana's native Ed25519 verification program (which the validator executes —
  and rejects the transaction if invalid — before the trading instruction runs).
- The trading handler then *introspects the transaction* via the instructions
  sysvar: `verify_ed25519_signature` (`.../settle_offchain.rs:651`) calls
  `load_instruction_at_checked` (`settle_offchain.rs:657`), asserts the
  instruction targets the Ed25519 program (`settle_offchain.rs:660`), and asserts
  the pubkey embedded in the verified instruction matches the expected order owner
  (`settle_offchain.rs:669`). Buyer and seller are checked at instruction indexes
  0 and 1 (`settle_offchain.rs:310`, `settle_offchain.rs:314`).

This is the standard Solana pattern for "verify an arbitrary off-chain signature
on-chain" — the expensive curve math runs in the native program; the application
program only proves the verification happened in the same transaction, against
the right key and message.

*The wire format, byte by byte.* The security of the pattern lives entirely in
byte offsets, so we state them exactly. Each Ed25519 verify
instruction's data is:

```
offset  size  field
0       1     num_signatures        (must be 1 here)
1       1     padding
2       2     signature_offset      ┐
4       2     signature_ix_index    │
6       2     pubkey_offset         │ Ed25519SignatureOffsets
8       2     pubkey_ix_index       │ (7 × u16, little-endian)
10      2     message_offset        │
12      2     message_size          │
14      2     message_ix_index      ┘
16      64    signature
80      32    public key
112     var   message
```

The signed message is the order payload serialised field-by-field in fixed
order — `order_id` 16 B, `user` 32 B, `energy_amount` 8 B, `price_per_kwh`
8 B, `side` 1 B, `zone_id` 4 B, `expires_at` 8 B
(`settle_offchain.rs:400`) — 77 bytes, giving 2 + 14 + 64 + 32 + 77 = *189
bytes of instruction data per signature*, the exact figure behind the §4.5
packet arithmetic. The instructions sysvar the handler parses has its own
framing — `num_instructions: u16`, an offset table, then per instruction
`num_accounts: u16`, 33 bytes per account meta (1 flag + 32 key), a 32-byte
program id, and a length-prefixed data blob (`settle_offchain.rs:15`).

*An offset-redirection attack, and its fix.* An earlier revision of the
verifier trusted the *conventional* offsets — signature at byte 16, pubkey at
80, message at 112 — while the native Ed25519 program verifies the triple at
the offsets *declared in the header*. Those are two different parsers over
one blob, and the gap is exploitable: an attacker crafts data whose header
points the native verifier at their own valid (key, sig, message) placed
elsewhere in the blob, while planting a victim's public key at byte 80 and
the target settlement payload at byte 112. The native program passes (it
verified the attacker's triple); the trading program, reading the
conventional offsets, believes the victim signed the settlement. The current
verifier closes this by re-reading the *declared* offsets and constraining
every `*_ix_index` to refer to the same instruction (the `u16::MAX`
self-sentinel or its own absolute index), so parser and native verifier see
identical bytes (`settle_offchain.rs:1372`). The lesson generalises: when two
programs parse one byte blob, agreement of offsets is a security invariant,
not a formatting detail.

*Replay protection.* `OrderNullifier` PDAs are seeded per `(user, order_id)`
(`settle_offchain.rs:112`). Each nullifier tracks `filled_amount`; a settlement
may only consume the unfilled remainder (`settle_offchain.rs:344`) ; the fill is incremented with saturating arithmetic (`settle_offchain.rs:428`), with the nullifier's stored
authority re-checked against the payload (`settle_offchain.rs:539`). The same
signed order can therefore be partially filled across transactions but never
over-filled or replayed.

== 6.4 REC-validator gating on mint

GRID tokens represent physical energy (1 kWh = 1 GRID), so minting is gated
behind registered REC validators in energy-token. Validators are added/removed by
the admin (`programs/energy-token/src/lib.rs:280`, `lib.rs:313`). The gate is
*two-tier*. The attested-issuance paths — `mint_to_wallet` and the generation
mint `mint_generation` (§11.7) — require a REC co-signer *unconditionally*: the
signing key must appear in the validator set (`lib.rs:127`–`128`, `lib.rs:203`)
and an empty set rejects every such mint, with no opt-out. `mint_generation`
tightens this to a *2-of-2*, additionally requiring the REC co-signer to differ
from the program authority (`lib.rs:146`–`149`), so no single key can both
authorise and attest a generation mint. Only the low-privilege registry-grant
path `mint_tokens_direct` (the 10-GRX registration grant of §5.1) is
*conditionally* gated — it enforces membership only once at least one validator
is registered (`rec_validators_count > 0`, `lib.rs:119`, `lib.rs:240`) — so
bootstrap registrations proceed before the REC set is populated while every
energy-backed issuance stays gated.

== 6.5 Trust boundary summary

#table(
  columns: 2,
  align: (left, left),
  table.header([*Boundary*], [*Enforced by*]),
  [Who may mutate an account], [Runtime ownership rule (program-owned accounts)],
  [Who may invoke privileged instructions], [Anchor `Signer` + `has_one` against `GovernanceConfig` / stored authorities],
  [Whether a trade was authorised], [Ed25519 native-program verification + sysvar introspection],
  [Whether a trade can be replayed], [`OrderNullifier` PDA per (user, order)],
  [Whether energy backing is real], [REC validator set in energy-token],
  [Who may reach the RPC port at all], [Off-chain: Chain Bridge mTLS + RBAC (superproject concern)],
)
