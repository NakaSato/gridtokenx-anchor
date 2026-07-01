# GridTokenX — Renewable Energy Certificates (REC / ERC) Design

> **✅ STATUS: IMPLEMENTED.** Design/architecture narrative for the REC feature, spanning the `governance` program (certificate lifecycle, `handlers/erc.rs`) and the `energy-token` program (REC-validator mint gating). Authoritative path:line references: `docs/programs/governance.md`, `docs/programs/energy-token.md`. Verified against code (Anchor 1.0).

A Renewable Energy Certificate (REC, called ERC in the source) is an on-chain, per-certificate proof that a specific quantity of renewable energy was generated and admitted. It is the provenance layer beneath the energy token: tokens are not minted from thin air — minting can require a REC validator's co-signature, and tradable energy is gated by a valid, trading-validated certificate. Seven sections.

---

## 1. What a REC Is (and Is Not)

A REC has **two on-chain representations**, issued together:

1. **A fungible Token-2022 REC token** — the tradable balance. **1 token = 1 MWh**, 6 decimals, so the base unit is 1 Wh and **1 kWh = 1_000 base units**. Mint = PDA `[b"rec_mint"]` (governance program), mint authority = the governance `[b"poa_config"]` PDA. Created once via `init_rec_mint`. Standard SPL: held in ATAs, transferable, and **retired** (burned) via `retire_rec` when a holder claims the green attribute.
2. **An individual `ErcCertificate`** — the provenance record. Keyed by a string `certificate_id` (≤64 bytes), it is a serial-numbered atomic proof of one admitted generation event with an immutable `energy_amount` (kWh). The certificate is *not* fungible (no per-account balance, ownership moves whole via `transfer`); it anchors the certificate-level lifecycle and anti-double-claim.

`issue_erc` does both at once: it writes the `ErcCertificate` **and** mints `energy_amount × 1_000` REC base units to the producer's REC ATA (1 token per MWh certified). The energy *commodity* token (GRID, 9-dec) is separate again — GRID is the kWh of energy, the REC token is its renewable attribute.

---

## 2. Certificate Lifecycle

`governance/handlers/erc.rs` exposes four handlers:

| Handler | Purpose |
|---|---|
| `issue(certificate_id, energy_amount, renewable_source, validation_data)` | Mint a certificate. Validates against `GovernanceConfig` limits; CPIs `registry::mark_erc_claimed` to mark the generation claimed (anti-double-claim); creates `ErcCertificate` with `status = Valid`, `owner = meter_owner`. |
| `validate_for_trading()` | Gate the certificate for trading: requires `status == Valid`, not already validated, not expired; sets `validated_for_trading = true`. |
| `transfer()` | Move ownership: requires `Valid` + `validated_for_trading`, not expired, not self-transfer; bumps `transfer_count`. |
| `revoke(reason)` | Authority-only burn: requires a reason (≤128 bytes); sets `status = Revoked`, clears the trading flag. |

State machine: `issue` → **Valid** → `validate_for_trading` → **(tradable)** → `transfer`*; or **Valid** → `revoke` → **Revoked** (terminal). Expiry (`expires_at`, from `GovernanceConfig.erc_validity_period`, max 2 years) blocks validation/transfer.

---

## 3. The Certificate Account

`ErcCertificate` is a regular (Borsh) `#[account]`, PDA seeds `[b"erc_certificate", certificate_id.as_bytes()]` (`governance/src/state/erc_certificate.rs`, `LEN = 627`). Key fields:

- Identity: `certificate_id[64]`+`id_len`, `authority` (issuer), `owner` (current holder)
- Energy: `energy_amount` (immutable kWh), `renewable_source[64]`+`source_len`, `validation_data[256]`+`data_len`
- Lifecycle: `issued_at`, `expires_at: Option<i64>`, `status` (Valid/Expired/Revoked/Pending), `validated_for_trading: bool`, `trading_validated_at`
- Revocation: `revocation_reason[128]`+`reason_len`, `revoked_at`
- Transfer: `transfer_count`, `last_transferred_at`

Note the **no-`String`-on-chain** convention: strings are fixed `[u8; N]` + a `*_len`, rehydrated with `from_utf8_lossy`.

`GovernanceConfig` (singleton, `[b"poa_config"]`) holds the issuance policy: `erc_validation_enabled`, `min_energy_amount`/`max_erc_amount`, `erc_validity_period`, `require_oracle_validation`+`oracle_authority`, `allow_certificate_transfers`, and running stats (`total_ercs_issued/validated/revoked`, `total_energy_certified`).

---

## 4. REC-Validator Mint Gating (energy-token)

The energy-token program ties minting to REC attestation. `TokenInfo` (zero-copy) holds `rec_validators: [Pubkey; 5]` + `rec_validators_count` (`energy-token/src/state.rs:15-16`). Validators are managed by `add_rec_validator` (≤5, `MaxValidatorsReached`/`ValidatorAlreadyExists`) and `remove_rec_validator` (swap-remove, `RemoveValidatorNotFound`) (`lib.rs:291`,`324`).

When `rec_validators_count > 0`, three mint paths require a registered validator co-signer (`RecValidatorNotFound` otherwise):

- `mint_to_wallet` — admin mint; co-signer optional in account list but enforced when validators exist (`lib.rs:106-164`).
- `mint_generation` — per-`(meter, window)` idempotent generation mint; same check (`lib.rs:181-264`).
- `mint_tokens_direct` — registry-authorized mint; co-signer **required** (`Signer`, not `Option`) (`lib.rs:392-447`).

The rationale (source comment `lib.rs:115`): without the co-sign, the admin mint path would bypass the REC proof. This binds every issuance of the energy token to attested provenance.

> **Caveat — automated bridge mint collapses the co-signer.** On the surplus-mint
> path (Aggregator Bridge → NATS `chain.tx.mint` → Chain Bridge), the bridge builds
> the `mint_generation` instruction with a **single** Vault `platform_admin` key
> filling **both** the `authority` and `rec_validator` signer slots — that key is the
> energy-token `authority` *and* is registered on-chain as a REC validator, so one
> signature satisfies both gates and clears `Custom(6008)`
> (`gridtokenx-blockchain-core/src/rpc/instructions.rs:1093-1100`). The on-chain
> check still passes (the key *is* a registered validator), but the REC co-signature
> stops being an **independent** attestation on this path: provenance is asserted by
> the same actor that mints, not a separate validator. This is intentional for the
> unattended bridge flow; trust shifts to the bridge's mTLS envelope-auth + RBAC
> (`chain-bridge-api/.../nats_consumer/consumer.rs:694-743`). Human/admin mints
> (`mint_to_wallet`, `mint_tokens_direct`) retain a genuinely distinct co-signer.

---

## 5. REC ↔ Token Relationship

- **REC token** = the fungible Token-2022 green-attribute balance, **1 token = 1 MWh** (6 decimals; 1 kWh = 1_000 base units). Minted to the producer by `issue_erc`, retired (burned) by `retire_rec` (handlers `init_rec_mint` / `retire_rec`, `governance/handlers/erc.rs`).
- **ErcCertificate** = the per-issuance provenance record proving X kWh of renewable energy exists (governance ERC certificate).
- **GRID** = the fungible 9-decimal energy *commodity* token minted by the energy-token program (1 kWh = 1 GRID). (The same single mint is also labeled GRX as the platform utility/collateral role — see the energy-token reference doc's naming note; it is one mint, not two.) GRID is the energy itself; the REC token is its renewable attribute — two distinct mints.
- **Binding** = REC-validator co-signature on the GRID mint path, plus `registry::mark_erc_claimed` preventing the same generation from being certified (and REC-minted) twice.

So a sell order's energy is doubly provenanced: the token was minted under a REC validator's signature, and the order itself must reference a `Valid`, trading-validated certificate (trading program ERC checks, `lib.rs:230-240`).

**Fungible-REC balance gate on `create_sell_order` (opt-in).** Beyond the certificate check, the seller may append their REC token account as `remaining_accounts[0]`; when present the trading program requires it to be the real governance `rec_mint` PDA, owned by the seller, holding **≥ `energy_amount × 1_000` base units** (REC mint is 6-dec; 1 kWh = 1_000 units, matching the kWh-denominated `energy_amount`). Errors: `InvalidRecMint`, `RecAccountOwnerMismatch`, `InsufficientRecBalance`. Omitting the account leaves placement unchanged (backwards compatible) — the gate is *opt-in via remaining_accounts*, not a forced context account, so existing callers are unaffected.

**REC settle-transfer (opt-in, both settle handlers).** On settlement the matched REC moves seller→buyer escrow, mirroring the energy leg. Both on-chain settle handlers carry it, gated on the same opt-in `remaining_accounts` group `[rec_mint, seller_rec_escrow, buyer_rec_escrow, rec_token_program]`:

- `settle_offchain_match` (the `ln` path) — REC group at `rec_base` = 3 cross-zone (after the mandatory `ZoneCapacity` slot) / 2 intra-zone; escrows seed-bound to `[b"escrow", user, rec_mint]`; signed by the `market_authority` PDA.
- `execute_atomic_settlement` (the **production** path) — REC group at `remaining_accounts[0..4]`; signed by `escrow_authority` (this handler's custodial model; its currency/energy legs sign the same way).

Both pin `rec_mint` to the governance `[b"rec_mint"]` PDA and the token program to the mint's owner, move `match_amount × 1_000 / 1e9` base units via `transfer_checked`, and skip the leg when the group is absent (back-compat). Errors: `InvalidRecMint` (mint/program mismatch), `Overflow`. Covered by `settle_offchain_guards_litesvm.ts` (move / omit / wrong-program) and `atomic_settlement_rec_litesvm.ts`.

**Production-wiring status (as of 2026-07-01).** The on-chain capability is complete and `gridtokenx-blockchain-core` exposes the helpers to build the group (`get_rec_mint_pubkey`, `rec_escrow_pubkey`, `rec_settlement_account_metas`). **Not yet wired:** the trading-service settlement call does not append the REC group, and there is **no REC-escrow funding step** — REC minted by `issue_erc` lands in the producer's ATA, and nothing deposits it into `[b"escrow", user, rec_mint]` before settle. Turning REC on in production needs two decisions: (1) **mandatory vs opt-in** REC at settlement, and (2) the **REC-escrow funding trigger** (on order placement? on deposit? custodial auto-fund?). Until then the REC leg is reachable only in tests.

**Blocker — the two settle models are incompatible for REC transfer.** The REC settle-transfer moves REC *seller → buyer* and therefore assumes **per-party** REC holdings. `settle_offchain_match` has them (`[b"escrow", user, rec_mint]` PDAs, authority = `market_authority`). But the **production** path, `execute_atomic_settlement`, uses a **platform-pooled custodial** escrow model: `buyer_currency_escrow = ATA(platform, currency)`, `seller_energy_escrow = ATA(platform, energy)`, all owned by the platform (`escrow_authority == market_authority == platform`, one bridge signature; parties are custodial and hold nothing) — see `gridtokenx-trading-service/crates/trading-infra/src/blockchain/settlement.rs`. In that model **`seller_rec_escrow` and `buyer_rec_escrow` both derive to `ATA(platform, rec_mint)` — the same account** — so the on-chain REC transfer is a platform→platform no-op. Enabling REC in production is thus **not** a wiring/config task; it needs a deeper decision: **(a)** migrate production settlement to the per-party `settle_offchain_match` model, or **(b)** replace the transfer-based REC leg with a custodial-friendly provenance mechanism (e.g. mint-to-buyer / burn-from-seller, or an off-chain REC ledger reconciled on chain). The `execute_atomic_settlement` REC leg (ef182e6) is correct and tested, but only *usable* under a per-party escrow model.

---

## 6. Key Errors

- Governance: `ErcValidationDisabled`, `InvalidErcStatus`, `AlreadyValidated`, `BelowMinimumEnergy`, `ExceedsMaximumEnergy`, `ErcExpired`, `InsufficientUnclaimedGeneration`, `AlreadyRevoked`, `CannotTransferToSelf`, `NotValidatedForTrading`, `MathOverflow` (REC base-unit conversion), `InvalidAmount` (`retire_rec` zero).
- Energy-token: `RecValidatorNotFound`, `ValidatorAlreadyExists`, `MaxValidatorsReached`, `RemoveValidatorNotFound`, `MisalignedWindow`.
- Trading (fungible-REC gate): `InvalidRecMint`, `RecAccountOwnerMismatch`, `InsufficientRecBalance`.

---

## 7. Invariants

1. **Single-claim**: `issue` CPIs `registry::mark_erc_claimed` *before* creating the certificate — the same generation can be certified once.
2. **Validator array density**: indices `0..count` of `rec_validators` are non-default; swap-remove preserves this.
3. **Transfer requires validation**: `can_transfer()` enforces `Valid` AND `validated_for_trading`.
4. **Immutable energy**: `energy_amount` is set at issue and never changed.
5. **Status terminality**: `Revoked` is irreversible.

---

*Design narrative for the implemented REC/ERC feature. Authoritative path:line references: `docs/programs/governance.md`, `docs/programs/energy-token.md`. Verified against code (Anchor 1.0).*
