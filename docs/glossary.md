# GridTokenX Glossary & Concepts

**Version:** 0.1.1  
**Last Updated:** February 2, 2026

---

## Table of Contents

1. [Energy Trading Concepts](#1-energy-trading-concepts)
2. [Blockchain & Solana Fundamentals](#2-blockchain--solana-fundamentals)
3. [GridTokenX Platform Terms](#3-gridtokenx-platform-terms)
4. [Trading Mechanisms](#4-trading-mechanisms)
5. [Regulatory & Compliance Terms](#5-regulatory--compliance-terms)
6. [Technical Implementation Terms](#6-technical-implementation-terms)
7. [Acronyms & Abbreviations](#7-acronyms--abbreviations)

---

## 1. Energy Trading Concepts

### 1.1 Energy Generation & Consumption

| Term | Definition |
|------|------------|
| **Renewable Energy** | Energy generated from natural sources that replenish over time (solar, wind, hydro, biomass). GridTokenX specifically tracks solar and other renewable sources. |
| **Prosumer** | A participant who both produces (generates) and consumes energy. Common in distributed solar installations where households generate excess power. |
| **Net Metering** | A billing mechanism where excess energy generated is credited against energy consumed. GridTokenX extends this concept to tokenized trading. |
| **Grid-Tied System** | A renewable energy system connected to the main power grid, allowing bidirectional energy flow. |
| **kWh (Kilowatt-hour)** | Standard unit of energy measurement. 1 kWh = 1,000 watts used for 1 hour. In GridTokenX, 1 GRX = 1 kWh. |
| **MWh (Megawatt-hour)** | 1,000 kWh. Used for larger-scale energy trading. |
| **Peak Demand** | Period when electricity consumption is highest (typically afternoon/evening). Energy prices are usually higher during peak times. |
| **Off-Peak** | Periods of lower energy demand, typically overnight. Often associated with lower energy prices. |
| **Baseload** | The minimum amount of electricity demand over a period. Typically supplied by consistent generation sources. |
| **Load Profile** | The pattern of electricity usage over time for a consumer or region. |

### 1.2 Energy Markets

| Term | Definition |
|------|------------|
| **Day-Ahead Market** | Energy market where electricity is traded for delivery the next day. Prices are set in advance. |
| **Real-Time Market** | Energy market for immediate or near-immediate delivery. Prices fluctuate based on current supply/demand. |
| **Spot Price** | Current market price for immediate energy delivery. |
| **Forward Contract** | Agreement to buy/sell energy at a predetermined price for future delivery. |
| **Merit Order** | Ranking of power plants by marginal cost, determining dispatch order. Renewables typically have near-zero marginal cost. |
| **Clearing Price** | The price at which supply equals demand in an auction market. All matched trades execute at this price. In P2P trading, the current implementation uses Pay-as-Seller pricing (the seller's ask price is used as the clearing price). |
| **Market Maker** | Entity providing liquidity by offering to buy and sell at quoted prices. In GridTokenX, AMM pools serve this role. |
| **Spread** | Difference between buy (bid) and sell (ask) prices. Lower spreads indicate higher liquidity. |

### 1.3 Distributed Energy Resources (DER)

| Term | Definition |
|------|------------|
| **DER** | Small-scale energy generation or storage units located near the point of consumption (rooftop solar, batteries, small wind). |
| **Virtual Power Plant (VPP)** | Aggregation of DERs coordinated to function as a single power plant. |
| **Peer-to-Peer (P2P) Trading** | Direct energy trading between prosumers without intermediary utilities. Core functionality of GridTokenX. |
| **Microgrid** | Localized power grid that can operate independently or connected to the main grid. |
| **Behind-the-Meter** | Energy systems installed on the customer side of the utility meter. |

---

## 2. Blockchain & Solana Fundamentals

### 2.1 Core Blockchain Concepts

| Term | Definition |
|------|------------|
| **Blockchain** | Distributed ledger technology where transactions are recorded in linked blocks, providing immutability and transparency. |
| **Smart Contract** | Self-executing code stored on blockchain that automatically enforces agreement terms. On Solana, these are called "programs." |
| **Decentralization** | Distribution of control across network participants rather than central authority. |
| **Consensus** | Agreement mechanism among network nodes on the valid state of the blockchain. |
| **Finality** | Point at which a transaction is irreversible. Solana achieves finality in ~400ms. |
| **Gas/Transaction Fee** | Cost paid to execute transactions. On Solana, fees are measured in lamports (1 SOL = 1 billion lamports). |
| **Wallet** | Software/hardware that stores private keys and enables blockchain interactions. |
| **Private Key** | Secret cryptographic key used to sign transactions. Must be kept secure. |
| **Public Key** | Cryptographic key derived from private key, used as account identifier/address. |
| **Signature** | Cryptographic proof that a transaction was authorized by the private key holder. |

### 2.2 Solana-Specific Terms

| Term | Definition |
|------|------------|
| **Solana** | High-performance blockchain using Proof of History (PoH) and Proof of Stake (PoS), capable of 65,000+ TPS. |
| **Program** | Solana's term for smart contract. Stateless executable code deployed on-chain. |
| **Account** | Data storage unit on Solana. Programs store state in accounts, not within the program itself. |
| **PDA (Program Derived Address)** | Deterministic account address derived from seeds and program ID. Has no private key—only the program can sign for it. |
| **Anchor** | Framework for building Solana programs in Rust. Provides macros, IDL generation, and client libraries. |
| **IDL (Interface Definition Language)** | JSON specification describing a program's instructions, accounts, and types. Enables client generation. |
| **CPI (Cross-Program Invocation)** | One program calling another program's instruction. Core mechanism for program composability. |
| **Rent** | SOL required to keep an account alive on Solana. Accounts must maintain minimum balance (rent-exempt). |
| **Lamport** | Smallest unit of SOL. 1 SOL = 1,000,000,000 lamports. |
| **Slot** | Time period (~400ms) during which a validator can produce a block. |
| **Epoch** | ~2-3 days period used for staking rewards and validator rotation. |
| **Compute Unit (CU)** | Measure of computational resources consumed by a transaction. Max 1.4M CU per transaction. |
| **Transaction** | Atomic unit of work on Solana containing one or more instructions. |
| **Instruction** | Single operation within a transaction (e.g., transfer tokens, create account). |

### 2.3 Token Standards

| Term | Definition |
|------|------------|
| **SPL Token** | Solana Program Library token standard. Equivalent to ERC-20 on Ethereum. |
| **SPL Token-2022** | Extended token standard with additional features (transfer fees, confidential transfers, metadata). GridTokenX uses Token-2022. |
| **Mint** | Token creation authority and metadata storage. Defines decimals, supply, and authorities. |
| **Token Account** | Account holding tokens for a specific mint. Associated Token Accounts (ATA) are deterministically derived. |
| **ATA (Associated Token Account)** | Standard token account address derived from owner and mint. One per owner per token type. |
| **Mint Authority** | Key authorized to create new tokens. Can be revoked to make supply fixed. |
| **Freeze Authority** | Key authorized to freeze/unfreeze token accounts. Used for compliance. |

---

## 3. GridTokenX Platform Terms

### 3.1 Core Platform Components

| Term | Definition |
|------|------------|
| **GridTokenX** | Decentralized energy trading platform on Solana enabling peer-to-peer renewable energy trading with tokenized certificates. |
| **GRX Token** | Platform's energy token. 1 GRX = 1 kWh of renewable energy. SPL Token-2022 with 9 decimals. |
| **THB Stablecoin** | Thai Baht stablecoin used for settlement. Pegged 1:1 to Thai Baht fiat currency. |
| **Registry** | Program managing user and meter registration. Central identity and metering infrastructure. |
| **Oracle** | Program receiving off-chain meter readings and triggering market operations. Bridge between physical and digital. |
| **Trading** | Core program implementing all trading mechanisms (P2P, auctions, AMM, privacy). |
| **Governance** | Program managing PoA validators, ERC issuance, and emergency controls. |
| **Energy Token** | Program for GRX token minting and burning based on verified energy generation/consumption. |

### 3.2 User Types & Roles

| Term | Definition |
|------|------------|
| **Producer** | User who generates renewable energy (has solar panels, wind turbines). Sells excess energy. |
| **Consumer** | User who purchases energy from the grid or other participants. |
| **Prosumer** | User who both produces and consumes energy. Most common participant type. |
| **Authority** | Administrative role with elevated permissions (pause system, issue ERCs). |
| **PoA Validator** | Proof-of-Authority validator authorized to validate meter readings and issue certificates. |
| **API Gateway** | Service authorized to submit meter readings to the Oracle program. |
| **Fee Collector** | Account receiving trading fees. Typically controlled by platform governance. |

### 3.3 Metering & Settlement

| Term | Definition |
|------|------------|
| **Smart Meter** | Digital meter capable of bidirectional measurement and communication. Provides data to Oracle. |
| **Meter Reading** | Energy measurement at a point in time (generation and consumption values). |
| **Settlement Period** | Time window for aggregating meter readings and settling trades (e.g., 15 minutes, 1 hour). |
| **Net Generation** | Total generation minus total consumption. Positive = excess energy to sell. |
| **Settled Generation** | Energy that has been converted to GRX tokens through settlement. |
| **Unsettled Generation** | Verified energy not yet converted to tokens. Pending settlement. |

### 3.4 Certificates & Compliance

| Term | Definition |
|------|------------|
| **ERC (Energy Renewable Certificate)** | On-chain certificate proving renewable energy generation. Required for selling GRX tokens. |
| **Certificate ID** | Unique identifier for an ERC, format: `CERT-{year}-{sequence}`. |
| **Certificate Vintage** | Year/period when the energy was generated. Important for compliance. |
| **Green Attribute** | Environmental benefit of renewable energy (carbon offset, REC value). |
| **Additionality** | Principle that renewable energy certificates should represent new generation, not existing. |
| **Double Counting** | Fraud where the same energy is claimed multiple times. ERCs prevent this. |

---

## 4. Trading Mechanisms

### 4.1 Order Types

| Term | Definition |
|------|------------|
| **Limit Order** | Order to buy/sell at a specific price or better. Remains in order book until filled, cancelled, or expired. |
| **Market Order** | Order to buy/sell immediately at best available price. Executes against existing limit orders. |
| **Sell Order** | Order offering GRX tokens for sale at specified price. |
| **Buy Order** | Order to purchase GRX tokens at specified price. |
| **Auction Order** | Order submitted to periodic auction, executed at clearing price. |

### 4.2 Order States

| Term | Definition |
|------|------------|
| **Active** | Order is live in the order book, available for matching. |
| **Partially Filled** | Part of the order has been matched; remainder still active. |
| **Completed** | Order fully matched and settled. |
| **Cancelled** | Order removed by user before full execution. |
| **Expired** | Order removed due to time expiration (expires_at reached). |

### 4.3 Trading Mechanisms

| Term | Definition |
|------|------------|
| **P2P Trading** | Direct peer-to-peer trading via limit orders in an order book. |
| **Periodic Auction** | Batch auction collecting orders, then clearing at uniform price. Default duration is 5 minutes (configurable by authority). |
| **AMM (Automated Market Maker)** | Algorithmic liquidity provision using constant product formula (x * y = k). |
| **Order Book** | Collection of active buy and sell orders organized by price. |
| **Matching Engine** | Logic that pairs buy and sell orders based on price-time priority. |
| **Price-Time Priority** | Order matching rule: best price first, then earliest submission time. |

### 4.4 AMM-Specific Terms

| Term | Definition |
|------|------------|
| **Liquidity Pool** | Smart contract holding token reserves that enable trading. |
| **LP (Liquidity Provider)** | User who deposits tokens into a pool, earning fees from trades. |
| **LP Token** | Token representing share of liquidity pool. Burned when withdrawing liquidity. |
| **Constant Product** | AMM formula: `reserve_grx × reserve_thb = k`. Trade changes reserves but maintains k. |
| **Slippage** | Difference between expected and actual execution price due to price impact. |
| **Price Impact** | Change in price caused by a trade. Larger trades have greater impact. |
| **Impermanent Loss** | Temporary loss LPs experience when pool token prices diverge from deposit ratio. |
| **TWAP (Time-Weighted Average Price)** | Average price over time, resistant to manipulation. Used for oracle pricing. |

### 4.5 Auction-Specific Terms

| Term | Definition |
|------|------------|
| **Collection Window** | Period when auction orders can be submitted (5 minutes). |
| **Clearing** | Process of determining clearing price and matched orders. |
| **Supply Curve** | Aggregated sell orders sorted by price (ascending). |
| **Demand Curve** | Aggregated buy orders sorted by price (descending). |
| **Market Equilibrium** | Point where supply and demand curves intersect (clearing price/quantity). |
| **Uniform Price** | All matched orders execute at the same clearing price, regardless of their limit price. |

### 4.6 Privacy Trading Terms

| Term | Definition |
|------|------------|
| **Confidential Transfer** | Token transfer where amount is encrypted, visible only to sender/receiver. Uses SPL Token-2022 extension. |
| **Zero-Knowledge Proof (ZKP)** | Cryptographic proof that a statement is true without revealing underlying data. |
| **ElGamal Encryption** | Encryption scheme used in SPL Token-2022 confidential transfers. |
| **Pending Balance** | Encrypted balance awaiting decryption/application. Must be explicitly applied. |
| **Auditor Key** | Optional key that can decrypt confidential transfers for compliance. |

---

## 5. Regulatory & Compliance Terms

### 5.1 Energy Regulations

| Term | Definition |
|------|------------|
| **VSPP (Very Small Power Producer)** | Thai regulatory category for small-scale generators (<10 MW). Simplified licensing. |
| **SPP (Small Power Producer)** | Thai regulatory category for generators 10-90 MW. |
| **PPA (Power Purchase Agreement)** | Contract between energy generator and buyer specifying terms, prices, and duration. |
| **Feed-in Tariff (FiT)** | Government-guaranteed price paid for renewable energy fed into the grid. |
| **Net Billing** | System where exported energy is credited at wholesale rate, not retail rate. |
| **Wheeling Charge** | Fee for transmitting energy through utility infrastructure to distant buyers. |

### 5.2 Certificate Standards

| Term | Definition |
|------|------------|
| **REC (Renewable Energy Certificate)** | Tradable certificate representing 1 MWh of renewable energy generation. |
| **I-REC** | International REC standard used in many countries including Thailand. |
| **GO (Guarantee of Origin)** | European certificate system for renewable energy tracking. |
| **Carbon Credit** | Tradable certificate representing 1 tonne CO₂ equivalent avoided/removed. |
| **Scope 2 Emissions** | Indirect emissions from purchased electricity. RECs help reduce Scope 2. |
| **Greenwashing** | Misleading claims about environmental benefits. Blockchain traceability prevents this. |

### 5.3 Compliance Mechanisms

| Term | Definition |
|------|------------|
| **KYC (Know Your Customer)** | Identity verification process for users. Required for regulatory compliance. |
| **AML (Anti-Money Laundering)** | Regulations preventing illegal fund movement. Trading limits may apply. |
| **Audit Trail** | Complete record of all transactions and state changes. Blockchain provides immutable audit trail. |
| **Data Retention** | Requirement to store records for specified period (typically 5-7 years). |

---

## 6. Technical Implementation Terms

### 6.1 Program Architecture

| Term | Definition |
|------|------------|
| **Program ID** | Unique address identifying a deployed Solana program. |
| **Instruction** | Single operation a program can perform. Defined in program code. |
| **Account Constraint** | Anchor macro specifying account requirements (signer, mut, seeds, etc.). |
| **Account Validation** | Checking account ownership, initialization state, and data validity. |
| **Discriminator** | 8-byte prefix identifying account/instruction type. Prevents type confusion attacks. |
| **Bump Seed** | Single byte ensuring PDA falls off ed25519 curve. Stored for efficiency. |

### 6.2 Security Terms

| Term | Definition |
|------|------------|
| **Signer** | Account that must cryptographically sign the transaction. |
| **Authority** | Account with permission to perform privileged operations. |
| **Escrow** | Temporary holding of assets by program until conditions are met. |
| **Reentrancy** | Attack where external call re-enters the calling function. Less common on Solana but still possible via CPI. |
| **Integer Overflow** | Math error when result exceeds maximum value. Prevented by checked math. |
| **Access Control** | Ensuring only authorized accounts can execute privileged operations. |
| **Emergency Pause** | Mechanism to halt program operations during security incidents. |

### 6.3 Performance Terms

| Term | Definition |
|------|------------|
| **Compute Units (CU)** | Measure of computation. Transaction limit is 1.4M CU (1M default, 400K bonus). |
| **Account Compression** | Techniques to reduce account size and rent costs. |
| **Batching** | Combining multiple operations in single transaction for efficiency. |
| **Crank** | Off-chain service triggering on-chain operations (auction clearing, order expiration). |
| **Priority Fee** | Additional fee to prioritize transaction inclusion during congestion. |
| **Preflight Check** | Simulation before submission to detect errors early. |

### 6.4 Testing & Deployment

| Term | Definition |
|------|------------|
| **Localnet** | Local Solana validator for development testing. |
| **Devnet** | Public test network with free SOL for development. |
| **Testnet** | Public test network closer to mainnet configuration. |
| **Mainnet-Beta** | Production Solana network with real value. |
| **Program Upgrade** | Deploying new program code to existing program address. Requires upgrade authority. |
| **IDL Upload** | Storing program interface definition on-chain for client generation. |

---

## 7. Acronyms & Abbreviations

### Platform & Protocol

| Acronym | Full Form |
|---------|-----------|
| **GRX** | GridTokenX (energy token) |
| **THB** | Thai Baht (stablecoin) |
| **ERC** | Energy Renewable Certificate |
| **PoA** | Proof of Authority |
| **AMM** | Automated Market Maker |
| **P2P** | Peer-to-Peer |
| **LP** | Liquidity Provider |
| **TWAP** | Time-Weighted Average Price |

### Blockchain & Solana

| Acronym | Full Form |
|---------|-----------|
| **PDA** | Program Derived Address |
| **CPI** | Cross-Program Invocation |
| **IDL** | Interface Definition Language |
| **SPL** | Solana Program Library |
| **CU** | Compute Unit |
| **ATA** | Associated Token Account |
| **TPS** | Transactions Per Second |
| **PoH** | Proof of History |
| **PoS** | Proof of Stake |

### Energy Industry

| Acronym | Full Form |
|---------|-----------|
| **kWh** | Kilowatt-hour |
| **MWh** | Megawatt-hour |
| **DER** | Distributed Energy Resource |
| **VPP** | Virtual Power Plant |
| **PPA** | Power Purchase Agreement |
| **FiT** | Feed-in Tariff |
| **VSPP** | Very Small Power Producer |
| **SPP** | Small Power Producer |
| **REC** | Renewable Energy Certificate |
| **I-REC** | International REC |

### Security & Compliance

| Acronym | Full Form |
|---------|-----------|
| **KYC** | Know Your Customer |
| **AML** | Anti-Money Laundering |
| **ZKP** | Zero-Knowledge Proof |
| **RBAC** | Role-Based Access Control |
| **MFA** | Multi-Factor Authentication |

### Infrastructure

| Acronym | Full Form |
|---------|-----------|
| **AWS** | Amazon Web Services |
| **ECS** | Elastic Container Service |
| **RDS** | Relational Database Service |
| **VPC** | Virtual Private Cloud |
| **ALB** | Application Load Balancer |
| **RPC** | Remote Procedure Call |
| **API** | Application Programming Interface |
| **SDK** | Software Development Kit |
| **CLI** | Command Line Interface |

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     GRIDTOKENX QUICK REFERENCE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  TOKEN BASICS                           TRADING MECHANISMS                  │
│  ────────────                           ──────────────────                  │
│  1 GRX = 1 kWh                          P2P: Limit orders, order book       │
│  GRX decimals: 9                        Auction: 5-min periodic, uniform    │
│  THB decimals: 9                        AMM: x * y = k, instant swaps       │
│  Token standard: SPL Token-2022                                             │
│                                                                             │
│  USER TYPES                             CERTIFICATE FLOW                    │
│  ──────────                             ────────────────                    │
│  Producer: Generates energy             1. Meter reading (Oracle)           │
│  Consumer: Buys energy                  2. Settlement (tokens minted)       │
│  Prosumer: Both generates & consumes    3. ERC issuance (Governance)        │
│                                         4. Trading (with valid ERC)         │
│                                                                             │
│  ACCOUNT TYPES                          KEY LIMITS                          │
│  ─────────────                          ──────────                          │
│  Registry: UserAccount, MeterAccount    Max CU: 1,400,000                   │
│  Trading: Market, Order, TradeRecord    Order expiry: 24 hours default      │
│  Governance: PoAConfig, ErcAccount      Auction window: 5 minutes           │
│                                         Min ERC energy: 100 kWh             │
│                                                                             │
│  PROGRAM IDS (Mainnet)                                                      │
│  ─────────────────────                                                      │
│  Trading:      8S2e2p4ghqMJuzTz5AkAKSka7jqsjgBH7eWDcCHzXPND                │
│  Registry:     CXXRVpEwyd2ch7eo425mtaBfr2Yi1825Nm6yik2NEWqR                │
│  Oracle:       EkcPD2YEXhpo1J73UX9EJNnjV2uuFS8KXMVLx9ybqnhU                │
│  Governance:   8bNpJqZoqqUWKu55VWhR8LWS66BX7NPpwgYBAKhBzu2L                │
│  Energy Token: 5DJCWKo5cXt3PXRsrpH1xixra4wXWbNzxZ1p4FHqSxvi                │
│  Blockbench:   9sz5rrCnWTLqPeQVuyJgyQ1hqLGXrT94GLfVVoWUKpxz                │
│  TPC-Benchmark:Gn99qZgnpwNXsQaBB7zvyycnRJmMGaQ4UaG5PpvBsmEu                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Related Documentation

- [Trading Program](./programs/trading.md) - Trading mechanisms deep-dive
- [Registry Program](./programs/registry.md) - User and meter management
- [Oracle Program](./programs/oracle.md) - Meter data integration
- [Governance Program](./programs/governance.md) - PoA and certificate issuance
- [Energy Token Program](./programs/energy-token.md) - Token minting and burning
- [Architecture Diagrams](./programs/diagrams/architecture.md) - Visual system overview
- [State Machines](./programs/diagrams/state-machines.md) - Account state transitions
