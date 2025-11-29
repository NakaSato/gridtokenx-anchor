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

## [0.1.0] - 2025-11-29

### Added
- **Registry Program** - User and meter registration
  - `register_user` instruction
  - `register_meter` instruction
  - `update_meter_reading` instruction
  - Dual-tracker system for double-claim prevention

- **Oracle Program** - Price feeds and validation
  - `update_price_feed` instruction
  - `validate_meter_reading` instruction
  - Anomaly detection algorithm
  - Multi-oracle support

- **Energy Token Program** - GRID token management
  - SPL Token integration
  - `mint_tokens` instruction (1:1 kWh ratio)
  - `burn_tokens` instruction
  - `transfer` instruction

- **Trading Program** - P2P marketplace
  - `create_order` instruction
  - `match_order` instruction
  - `cancel_order` instruction
  - Escrow-based settlement
  - ERC certificate support

- **Governance Program** - Decentralized governance
  - `create_proposal` instruction
  - `vote` instruction
  - `execute_proposal` instruction
  - Vote delegation support

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
| Registry | `2XPQmRp1wz9ZdVxGLdgBEJjKL7gaV7g7ScvhzSGBV2ek` |
| Oracle | `DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE` |
| Energy Token | `94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur` |
| Trading | `GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk` |
| Governance | `4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe` |

---

[Unreleased]: https://github.com/NakaSato/gridtokenx-anchor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/NakaSato/gridtokenx-anchor/releases/tag/v0.1.0
