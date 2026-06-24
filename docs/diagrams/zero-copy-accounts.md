# Zero-Copy Accounts — Why This Repo's State Looks Weird

> Deep-dive. `#[account(zero_copy)] #[repr(C)]` + Pod + manual `_paddingN`, `AccountLoader`
> load/load_mut/load_init. SKILL invariant #1. Why every `state.rs` here uses it.
> (Concept-level; verify exact fields in each `programs/*/src/state.rs`.)

---

## 0. TL;DR

Normal Anchor accounts (`#[account]`) **deserialize** the whole struct into the stack/heap every
instruction (Borsh). Big accounts → big copy → blows the 4KB BPF stack + burns CU. **Zero-copy**
accounts skip deserialization: the struct is `#[repr(C)]` Pod laid out byte-identical to the
account data, and you get a **reference directly into the account buffer** via `AccountLoader`.
No copy. Cost: you must hand-manage C layout — alignment, `_paddingN`, no `String`/`Vec`.

---

## 1. The problem: Borsh deserialization is expensive

A regular `#[account]` struct round-trips through Borsh:

```text
account bytes ──Borsh deserialize──► owned struct (copied onto stack/heap)
                  ...mutate...
owned struct ──Borsh serialize──► account bytes
```

For a `MeterState` or `Order` written every reading/trade, that copy:
- **eats CU** (serialize/deserialize every field),
- **eats the 4KB BPF stack** (the owned struct sits on stack),
- scales badly as the struct grows.

Hot-path accounts can't afford it.

---

## 2. The fix: memory-map the account, no copy

Zero-copy makes the Rust struct **byte-for-byte identical** to the on-chain layout, so the
program reads/writes the account buffer **in place**:

```rust
#[account(zero_copy)]      // Anchor: this is Pod, mapped not deserialized
#[repr(C)]                 // C layout — stable field order + alignment (NOT Rust's repr)
pub struct MeterState {
    pub authority: Pubkey,     // 32
    pub total_energy: u64,     // 8
    pub reading_count: u32,    // 4
    pub bump: u8,              // 1
    pub _padding0: [u8; 3],    // 3  ← manual: realign to 8 before next field
    pub last_ts: i64,          // 8
    // ...
}
```

`load()` returns `Ref<MeterState>` pointing **into** the account data — zero copy. Mutating
through `load_mut()` writes the buffer directly.

---

## 3. The three rules you pay for it

### Rule 1 — `#[repr(C)]` + Pod, no Rust layout
`#[repr(C)]` fixes field order and C alignment. The type must be **Pod** (plain old data: all
bytes valid, no enums-with-niches, no pointers). Anchor's `zero_copy` derives the `Pod`/`Zeroable`
bounds; a non-Pod field won't compile.

### Rule 2 — manual `_paddingN`, recount by hand
C alignment requires each field start at a multiple of its alignment (u64 @8, u32 @4, ...).
Gaps the compiler *would* insert must be **explicit** `_paddingN: [u8; N]` so the layout is
deterministic and matches across builds. **Adding a field = recount padding by hand.** Get it
wrong → misaligned reads / corrupted neighbor fields.

### Rule 3 — no `String`, no `Vec`
Heap/pointer types aren't Pod. Use fixed `[u8; N]` + a `*_len: u8`:

```rust
pub meter_id: [u8; 32],
pub meter_id_len: u8,
```
Convert via `registry::string_to_bytes32` / `bytes32_to_string`; rehydrate events with
`String::from_utf8_lossy(&b[..len]).into_owned()`. (SKILL invariant #2.)

---

## 4. AccountLoader: load / load_mut / load_init

Zero-copy accounts use `AccountLoader<'info, T>`, not `Account<'info, T>`:

| Method | When | Returns |
|--------|------|---------|
| `load()` | account already initialized, read-only | `Ref<T>` (immutable into buffer) |
| `load_mut()` | already initialized, writing | `RefMut<T>` (mutable into buffer) |
| `load_init()` | **first time**, right after `init` | `RefMut<T>` (zeroed buffer to fill) |

```rust
let mut meter = ctx.accounts.meter.load_mut()?;   // RefMut into account data
meter.total_energy = meter.total_energy.checked_add(kwh).ok_or(Err::Overflow)?;
// dropped at scope end → changes already in the buffer (no serialize step)
```

`load_init()` only at creation (it asserts the discriminator was freshly written). Using `load()`
on an uninit account, or `load_init()` twice, errors.

---

## 5. Space calculation

- **Zero-copy:** `space = 8 + size_of::<T>()` — 8-byte discriminator + the exact Pod size
  (padding included, since it's part of the struct). Simple because layout is fixed.
- **Regular `#[account]`:** manual `T::LEN` summing each field's serialized size (no padding,
  Borsh is compact). More error-prone for variable types.

```rust
#[account(init, payer = authority, space = 8 + std::mem::size_of::<MeterState>(),
          seeds = [b"meter", authority.key().as_ref()], bump)]
pub meter: AccountLoader<'info, MeterState>,
```

---

## 6. Why this repo mandates it (SKILL #1)

Every `state.rs` struct here is `#[account(zero_copy)] #[repr(C)]` Pod with manual padding —
**not a style choice, a throughput requirement.** Hot accounts (`MeterState`, `Order`,
`OrderNullifier`, `*Shard`) are written constantly; Borsh copies would blow CU + stack. Zero-copy
keeps each write to an in-place buffer mutation.

Ties to other docs:
- **Sealevel** (`sealevel-scheduling.md`): cheap per-account writes only help if accounts are
  sharded; zero-copy + per-entity PDAs together give the throughput.
- **BPF stack** (`bpf-stack-limits.md`): zero-copy keeps big structs **off** the stack (they
  stay in the account buffer), critical near the 4KB ceiling.
- **CU** (`compute-units-budget.md`): no serialize/deserialize = fewer CU per instruction.

---

## 7. Pitfalls

- **Miscounted padding** → silent field corruption (writes land in the wrong offset). Recount on
  every field add; a test that reads back known values catches it.
- **`load()` vs `load_init()` mixup** → init path must use `load_init()`; reuse path must not.
- **Adding a non-Pod field** (`String`, `Vec`, `Option<NonZero>`, enum) → won't compile / breaks
  Pod. Use fixed arrays + len.
- **Changing struct = changing layout** → existing accounts on a persisted ledger now mismatch
  (memory: ledger persists across `solana-up` restarts). Migrate or reset.
- **Assuming `size_of` excludes padding** → it includes it; that's why `8 + size_of` is correct.

---

## 8. One-paragraph recall

Zero-copy accounts (`#[account(zero_copy)] #[repr(C)]` Pod) map the account buffer directly into
a Rust struct instead of Borsh-deserializing it, so hot-path writes avoid copy cost on both CU
and the 4KB BPF stack — the reason every `state.rs` here uses them (SKILL #1). The price: fixed C
layout with hand-counted `_paddingN`, no `String`/`Vec` (use `[u8;N]`+`*_len`), and
`AccountLoader` with `load`/`load_mut`/`load_init`. Space = `8 + size_of::<T>()`. Recount padding
on every field add or you corrupt neighbors.
