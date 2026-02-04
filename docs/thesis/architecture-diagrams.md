# GridTokenX System Architecture

This document provides architecture diagrams for the GridTokenX decentralized energy trading platform, suitable for thesis documentation.

## 1. High-Level System Architecture

```mermaid
flowchart TB
    subgraph Frontend["Frontend Layer"]
        TradingUI["Trading Dashboard"]
        SimulatorUI["Meter Simulator UI"]
    end

    subgraph APILayer["API Gateway Layer"]
        Gateway["API Gateway (Rust)"]
        Auth["JWT Authentication"]
        WS["WebSocket Server"]
    end

    subgraph Blockchain["Solana Blockchain"]
        subgraph Programs["Smart Contract Programs"]
            Trading["Trading Program"]
            Registry["Registry Program"]
            Oracle["Oracle Program"]
            EnergyToken["Energy Token Program"]
            Governance["Governance Program"]
        end
        
        subgraph Accounts["On-Chain State"]
            Market["Market Account"]
            Orders["Order Accounts"]
            Users["User PDAs"]
            Meters["Meter PDAs"]
        end
    end

    subgraph DataLayer["Data Integration Layer"]
        Kafka["Apache Kafka"]
        InfluxDB["InfluxDB (Metrics)"]
        Indexer["Solana Indexer"]
    end

    subgraph IoT["IoT / Simulation Layer"]
        Simulator["Smart Meter Simulator"]
        Meters2["Physical Smart Meters"]
    end

    TradingUI --> Gateway
    SimulatorUI --> Gateway
    Gateway --> Auth
    Gateway --> WS
    Gateway --> Trading
    Gateway --> Registry
    
    Simulator --> Kafka
    Meters2 --> Kafka
    Kafka --> Gateway
    
    Gateway --> Oracle
    Oracle --> Meters
    
    Trading --> Market
    Trading --> Orders
    Registry --> Users
    Registry --> Meters
    
    Indexer --> Blockchain
    Indexer --> InfluxDB
```

## 2. Trading Flow Architecture

```mermaid
sequenceDiagram
    participant Prosumer
    participant API as API Gateway
    participant Registry as Registry Program
    participant Oracle as Oracle Program
    participant Trading as Trading Program
    participant Token as Energy Token Program
    
    Note over Prosumer,Token: Energy Production → Token Minting
    Prosumer->>API: Submit Meter Reading
    API->>Oracle: verify_meter_reading()
    Oracle->>Oracle: ZK Proof Verification
    Oracle-->>Registry: Validated Reading
    Registry->>Token: mint_tokens()
    Token-->>Prosumer: ERC Tokens Minted
    
    Note over Prosumer,Token: Order Creation → Settlement
    Prosumer->>API: Create Sell Order
    API->>Trading: create_sell_order()
    Trading->>Trading: Store in Order Book
    
    Consumer->>API: Create Buy Order
    API->>Trading: match_orders()
    Trading->>Trading: Double Auction Match
    Trading->>Token: transfer_tokens()
    Trading-->>Consumer: Order Settled
```

## 3. Confidential Trading Architecture

```mermaid
flowchart LR
    subgraph PublicLayer["Public Token Layer"]
        PubBalance["Public Token Balance"]
        PubTransfer["SPL Transfer"]
    end

    subgraph ConfLayer["Confidential Layer"]
        EncBalance["Encrypted Balance\n(ElGamal)"]
        ZKProofs["ZK Proofs"]
        PrivTransfer["Private Transfer"]
    end

    subgraph Operations["Operations"]
        Shield["Shield Energy\n(Public → Private)"]
        Unshield["Unshield Energy\n(Private → Public)"]
        Trade["Private Transfer"]
    end

    PubBalance -->|"burn"| Shield
    Shield -->|"encrypt"| EncBalance
    
    EncBalance -->|"ZK Range Proof"| Trade
    Trade -->|"Homomorphic Add/Sub"| EncBalance
    
    EncBalance -->|"ZK Proof"| Unshield
    Unshield -->|"mint"| PubBalance
    
    ZKProofs <-.->|"verify"| Shield
    ZKProofs <-.->|"verify"| Trade
    ZKProofs <-.->|"verify"| Unshield
```

## 4. Carbon Marketplace Architecture

```mermaid
flowchart TB
    subgraph Production["Energy Production"]
        Meter["Smart Meter"]
        Reading["Verified Reading"]
    end

    subgraph Certification["REC Certification"]
        MintREC["Mint REC Certificate"]
        RecNFT["REC NFT"]
        CarbonOffset["Carbon Offset Credits"]
    end

    subgraph Marketplace["Carbon Marketplace"]
        List["List REC"]
        Transfer["Transfer REC"]
        Retire["Retire REC"]
    end

    subgraph Verification["Verification"]
        RetireRecord["Retirement Record"]
        ComplianceProof["Compliance Proof"]
    end

    Meter --> Reading
    Reading --> MintREC
    MintREC --> RecNFT
    MintREC --> CarbonOffset
    
    RecNFT --> List
    RecNFT --> Transfer
    RecNFT --> Retire
    
    Retire --> RetireRecord
    RetireRecord --> ComplianceProof
```

## 5. Program Dependencies

```mermaid
graph TD
    Trading["Trading Program"]
    Registry["Registry Program"]
    Oracle["Oracle Program"]
    EnergyToken["Energy Token Program"]
    Governance["Governance Program"]
    TPC["TPC Benchmark Program"]
    Blockbench["Blockbench Program"]
    
    Trading --> Registry
    Trading --> Oracle
    Trading --> EnergyToken
    
    Registry --> EnergyToken
    Registry --> Oracle
    
    Oracle --> Registry
    
    Governance --> Registry
    Governance --> Trading
    
    TPC -.->|"benchmark"| Trading
    Blockbench -.->|"benchmark"| Trading
    
    classDef core fill:#3B82F6,stroke:#1D4ED8,color:#fff
    classDef support fill:#10B981,stroke:#059669,color:#fff
    classDef benchmark fill:#F59E0B,stroke:#D97706,color:#fff
    
    class Trading,Registry,Oracle,EnergyToken core
    class Governance support
    class TPC,Blockbench benchmark
```

## 6. Data Flow Architecture

```mermaid
flowchart LR
    subgraph Sources["Data Sources"]
        SM["Smart Meters"]
        UI["User Interface"]
        API["External APIs"]
    end

    subgraph Ingestion["Data Ingestion"]
        Kafka["Kafka Broker"]
        REST["REST API"]
    end

    subgraph Processing["Processing Layer"]
        Gateway["API Gateway"]
        Validator["Data Validator"]
        Indexer["Transaction Indexer"]
    end

    subgraph Storage["Storage Layer"]
        Solana["Solana Blockchain"]
        InfluxDB["InfluxDB\n(Time Series)"]
        Postgres["PostgreSQL\n(Metadata)"]
    end

    subgraph Analytics["Analytics"]
        Grafana["Grafana\nDashboards"]
        Reports["Report\nGeneration"]
    end

    SM --> Kafka
    UI --> REST
    API --> REST

    Kafka --> Gateway
    REST --> Gateway

    Gateway --> Validator
    Validator --> Solana
    
    Solana --> Indexer
    Indexer --> InfluxDB
    Indexer --> Postgres

    InfluxDB --> Grafana
    Postgres --> Reports
```

## Key Design Decisions

### 1. **PDA-Based State Management**
All user accounts, meters, and orders are stored as Program Derived Addresses (PDAs), enabling:
- Deterministic address derivation
- Cross-program invocation safety
- Rent exemption with known sizes

### 2. **Double Auction Matching**
The trading program implements a continuous double auction mechanism:
- Orders are matched when `bid_price >= ask_price`
- Settlement is atomic with token transfer
- MVCC conflict rate maintained below 2%

### 3. **ZK Proof Integration**
Confidential trading uses a layered approach:
- ElGamal encryption for balance privacy
- Range proofs for non-negative enforcement
- Transfer proofs for balance conservation

### 4. **Event-Driven Architecture**
All state changes emit Anchor events for:
- Real-time UI updates via WebSocket
- Transaction indexing for analytics
- Audit trail for compliance

---

*Generated for GridTokenX Thesis Documentation*
