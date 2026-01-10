---
marp: true
theme: default
paginate: true
backgroundColor: #fff
style: |
  section { font-family: 'Arial', sans-serif; }
  h1 { color: #2E86C1; }
  h2 { color: #2874A6; }
  strong { color: #E74C3C; }
---

# GridTokenX
## Decentralized P2P Energy Trading Platform

**Chanthawat Kiriyadee**
January 2026

---

# The Problem: Archaic Energy Markets

The global energy landscape is shifting to renewables, but the market infrastructure is stuck in the past.

- **Centralized Intermediaries**: Utilities take 40-60% markup.
- **Lack of Transparency**: Consumers don't know where their energy comes from.
- **Slow Settlement**: Producers wait months for payment.
- **Data Silos**: Smart meter data is locked away.

> **Result:** Slower adoption of Distributed Energy Resources (DERs).

---

# The Solution: GridTokenX

A blockchain-based Peer-to-Peer (P2P) energy trading ecosystem built on **Solana**.

- **Direct P2P Trading**: Prosumers sell surplus solar directly to neighbors.
- **1 GRID = 1 kWh**: Tokenized verified renewable energy.
- **Real-Time Settlement**: Transactions settle in seconds via blockchain.
- **Transparent Provenance**: Immutable cryptographic proof of green energy.

---

# System Architecture

Built on **Solana** for high throughput and low cost, utilizing the **Anchor Framework**.

1. **Registry Program**: User identity and smart meter verification.
2. **Energy Token Program**: Mints GRID tokens based on oracle data.
3. **Oracle Program**: Bridges physical smart meter data to the blockchain.
4. **Trading Program**: On-chain order book for matching asks/bids.
5. **Governance Program**: DAO for protocol upgrades and fee management.

---

# Dual-Tracker Model

Bridging the Physical and Financial worlds.

- **Physical Layer**: Electrons flow from Prosumer -> Grid -> Consumer.
- **Financial Layer**: GRID Tokens flow from Prosumer -> Wallet -> Consumer.

> **Safety Mechanism**: "Dual-Tracker Logic" ensures tokens are only minted for verified surplus energy, preventing double-spending.

---

# Token Economics (GRID)

- **Standard**: SPL Token (Solana)
- **Supply**: Elastic (Algorithms mint on production, burn on consumption).
- **Utility**:
  - **Medium of Exchange**: Used for settling energy trades.
  - **Governance**: Voting on protocol parameters.
  - **Incentives**: Lower fees for staking.

**Price Discovery**: Supply/Demand equilibrium updates in real-time.

---

# Performance & Security

Validated using **Blockbench** and **TPC-Benchmark** adaptations.

- **Throughput**: ~530 TPS (Sustained), Peak > 65k TPS theoretically.
- **Latency**: ~2-4 ms confirmation time.
- **Cost**: ~$0.00025 per transaction.
- **Security**: Defense-in-depth with multi-sig oracles and audited contracts.

---

# Development Roadmap

**Phase 1: Foundation (Current - Q1 2026)**
- Testnet Deployment & Audits.
- Blockbench Performance Validation.

**Phase 2: Market Expansion (Q3 2026)**
- Mainnet Launch in Thailand.
- Pilot Program in Bangkok Metro.

**Phase 3: Global Scale (2027+)**
- Expansion to Vietnam & Indonesia.
- Advanced DeFi Features (Energy Futures).

---

# Conclusion

GridTokenX is democratizing the future of energy.

- **For Prosumers**: Earn more for your energy.
- **For Consumers**: Pay less for green power.
- **For the Planet**: Accelerating the transition to Net Zero.

### Questions?
gridtokenx.io
