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

---

## 6. Key Errors

- Governance: `ErcValidationDisabled`, `InvalidErcStatus`, `AlreadyValidated`, `BelowMinimumEnergy`, `ExceedsMaximumEnergy`, `ErcExpired`, `InsufficientUnclaimedGeneration`, `AlreadyRevoked`, `CannotTransferToSelf`, `NotValidatedForTrading`, `MathOverflow` (REC base-unit conversion), `InvalidAmount` (`retire_rec` zero).
- Energy-token: `RecValidatorNotFound`, `ValidatorAlreadyExists`, `MaxValidatorsReached`, `RemoveValidatorNotFound`, `MisalignedWindow`.

---

## 7. Invariants

1. **Single-claim**: `issue` CPIs `registry::mark_erc_claimed` *before* creating the certificate — the same generation can be certified once.
2. **Validator array density**: indices `0..count` of `rec_validators` are non-default; swap-remove preserves this.
3. **Transfer requires validation**: `can_transfer()` enforces `Valid` AND `validated_for_trading`.
4. **Immutable energy**: `energy_amount` is set at issue and never changed.
5. **Status terminality**: `Revoked` is irreversible.

---

*Design narrative for the implemented REC/ERC feature. Authoritative path:line references: `docs/programs/governance.md`, `docs/programs/energy-token.md`. Verified against code (Anchor 1.0).*
