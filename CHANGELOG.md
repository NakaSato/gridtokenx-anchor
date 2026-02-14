# Changelog

All notable changes to GridTokenX will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Comprehensive documentation restructure
- SDK documentation with all 5 modules
- Instruction reference for all programs
- Integration examples guide
- Security best practices guide
- Troubleshooting guide

---

## [0.1.1] - 2026-02-02

### Fixed
- Corrected program IDs in all documentation files
- Fixed version numbers across all program documentation (2.0.0 → 0.1.1)

### Changed
- Updated Governance program description to reflect PoA-based model
- Updated Oracle program description to reflect smart meter validation
- Updated instruction names to match source code (create_order → create_sell_order/create_buy_order, match_order → match_orders, mint_tokens → mint_to_wallet/mint_tokens_direct)
- Added Blockbench and TPC-Benchmark to program ID listings

---

## [0.1.0] - 2025-11-29

### Added
- **Registry Program** - User and meter registration
  - `register_user` instruction
  - `register_meter` instruction
  - `update_meter_reading` instruction
  - Dual-tracker system for double-claim prevention

- **Oracle Program** - Smart meter reading validation
  - `submit_meter_reading` instruction
  - Internal validation helpers (anomaly detection, rate limiting)
  - `trigger_market_clearing` instruction
  - Multi-oracle support

- **Energy Token Program** - GRID token management
  - SPL Token-2022 integration
  - `mint_to_wallet` instruction (admin-controlled minting)
  - `mint_tokens_direct` instruction (1:1 kWh ratio)
  - `burn_tokens` instruction
  - `transfer_tokens` instruction

- **Trading Program** - P2P marketplace
  - `create_sell_order` / `create_buy_order` instructions
  - `match_orders` instruction
  - `cancel_order` instruction
  - Escrow-based settlement
  - ERC certificate support

- **Governance Program** - PoA-based governance with ERC certificate management
  - `initialize_poa` instruction
  - `emergency_pause` / `emergency_unpause` instructions
  - `issue_erc` instruction
  - `validate_erc_for_trading` instruction
  - `revoke_erc` instruction
  - `transfer_erc` instruction

- **TypeScript SDK**
  - Full client library
  - All program modules
  - Event subscriptions
  - Error handling

- **Documentation**
  - Academic thesis documentation (10 chapters)
  - Technical architecture docs
  - API reference
  - Developer guides

### Security
- PDA-based access control
- CPI validation
- Checked arithmetic operations
- Timelock for governance

---

## Program IDs

| Program | ID |
|---------|-----|
| Registry | `CXXRVpEwyd2ch7eo425mtaBfr2Yi1825Nm6yik2NEWqR` |
| Oracle | `EkcPD2YEXhpo1J73UX9EJNnjV2uuFS8KXMVLx9ybqnhU` |
| Energy Token | `5DJCWKo5cXt3PXRsrpH1xixra4wXWbNzxZ1p4FHqSxvi` |
| Trading | `8S2e2p4ghqMJuzTz5AkAKSka7jqsjgBH7eWDcCHzXPND` |
| Governance | `8bNpJqZoqqUWKu55VWhR8LWS66BX7NPpwgYBAKhBzu2L` |
| Blockbench | `9sz5rrCnWTLqPeQVuyJgyQ1hqLGXrT94GLfVVoWUKpxz` |
| TPC-Benchmark | `Gn99qZgnpwNXsQaBB7zvyycnRJmMGaQ4UaG5PpvBsmEu` |

---

[Unreleased]: https://github.com/NakaSato/gridtokenx-anchor/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/NakaSato/gridtokenx-anchor/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/NakaSato/gridtokenx-anchor/releases/tag/v0.1.0
