# GridTokenX Protocol Application Diagram

**Version:** 2.0.0  
**Last Updated:** February 2026

---

## 1. Complete Protocol Architecture Overview

```mermaid
graph TB
    subgraph External["External Layer"]
        Prosumer[Prosumer Wallet]
        Consumer[Consumer Wallet]
        Authority[Authority Wallet]
        Regulator[Regulator Portal]
        ExtChains[External Chains<br/>Wormhole]
    end

    subgraph AppLayer["Application Layer"]
        WebApp[Web Application<br/>Next.js]
        API[API Gateway<br/>REST/WebSocket/GraphQL]
        RPC[RPC Proxy<br/>Load Balancer]
    end

    subgraph Services["Off-chain Services"]
        OracleSvc[Oracle Service<br/>Node.js]
        IndexerSvc[Indexer Service<br/>PostgreSQL + Redis]
        AMI[AMI Gateway<br/>Meter Data]
    end

    subgraph Blockchain["Solana Blockchain Layer"]
        subgraph Programs["Anchor Programs"]
            Registry[Registry Program<br/>EmiSgo85...]
            Oracle[Oracle Program<br/>BRctXUy...]
            EnergyToken[Energy Token Program<br/>GzEcWzkb...]
            Trading[Trading Program<br/>3LXbBJ7s...]
            Governance[Governance Program<br/>8bNpJqZo...]
            Blockbench[Blockbench Program<br/>B5aD...]
            TPC[TPC-Benchmark Program<br/>BcXc...]
        end
        
        subgraph SolanaRuntime["Solana Runtime"]
            TokenProg[SPL Token Program]
            Token2022[Token-2022 Program]
            SystemProg[System Program]
            Metaplex[Metaplex]
        end
    end

    Prosumer --> WebApp
    Consumer --> WebApp
    Authority --> WebApp
    Regulator --> WebApp
    ExtChains --> OracleSvc
    
    WebApp --> API
    API --> RPC
    RPC --> Blockchain
    
    OracleSvc --> Oracle
    OracleSvc --> Registry
    AMI --> OracleSvc
    
    IndexerSvc --> Blockchain
    
    Registry --> EnergyToken
    Oracle --> Registry
    Trading --> EnergyToken
    Trading --> Governance
    Trading --> Registry
    Governance --> Registry
    
    EnergyToken --> TokenProg
    EnergyToken --> Token2022
    EnergyToken --> Metaplex
```

---

## 2. Program Interaction Flow (CPI Diagram)

```mermaid
flowchart LR
    subgraph Input["External Inputs"]
        UserWallet[User Wallet]
        OracleAPI[Oracle API Gateway]
        PoAAuth[PoA Authority]
    end

    subgraph Programs["Smart Contract Programs"]
        Registry[<b>REGISTRY</b><br/>EmiSgo85FVUYWXPtScCMQZBpq9ecZ4jhveg7E7T7F75z<br/><br/>• UserAccount PDA<br/>• MeterAccount PDA<br/>• Registry Singleton]
        
        Oracle[<b>ORACLE</b><br/>BRctXUydec2wrP4k2NpqZZT2sVnMfGqpv9bmWn5mTWh9<br/><br/>• OracleData PDA<br/>• Validation Logic<br/>• Anomaly Detection]
        
        Governance[<b>GOVERNANCE</b><br/>8bNpJqZoqqUWKu55...<br/><br/>• PoAConfig PDA<br/>• ErcCertificate PDA<br/>• Emergency Controls]
        
        EnergyToken[<b>ENERGY TOKEN</b><br/>GzEcWzkb73zcgvgoNRxEiuuT7CEAbzbHcAgjNV25pbLV<br/><br/>• TokenInfo PDA<br/>• GRX Mint<br/>• Token-2022 Support]
        
        Trading[<b>TRADING</b><br/>3LXbBJ7sWYYrveHvLoLtwuVYbYd27HPcbpF1DQ8rK1Bo<br/><br/>• Market PDA<br/>• Order PDA<br/>• Escrow PDA]
    end

    UserWallet -->|register_user| Registry
    UserWallet -->|register_meter| Registry
    OracleAPI -->|submit_meter_reading| Oracle
    PoAAuth -->|issue_erc| Governance

    Oracle -->|CPI: update_meter_reading| Registry
    Registry -->|CPI: mint_tokens_direct| EnergyToken
    Trading -->|CPI: token_transfer| EnergyToken
    Trading -->|READ: ErcCertificate| Governance
    Trading -->|READ: UserAccount| Registry
```

---

## 3. GRX Token Lifecycle Sequence

```mermaid
sequenceDiagram
    participant Meter as Smart Meter
    participant AMI as AMI Gateway
    participant OracleSvc as Oracle Service
    participant Oracle as Oracle Program
    participant Registry as Registry Program
    participant EnergyToken as Energy Token Program
    participant Prosumer as Prosumer Wallet
    participant Trading as Trading Program
    participant Consumer as Consumer Wallet

    Note over Meter,Consumer: Phase 1: Energy Generation & Recording
    Meter->>AMI: 1. Generate electricity (kWh)
    AMI->>AMI: 2. Record reading with signature
    AMI->>OracleSvc: 3. Submit signed reading
    
    Note over Meter,Consumer: Phase 2: Blockchain Validation
    OracleSvc->>Oracle: 4. submit_meter_reading()
    Oracle->>Oracle: 5. Validate reading
    Oracle->>Registry: 6. CPI: update_meter_reading()
    Registry->>Registry: 7. Update MeterAccount
    
    Note over Meter,Consumer: Phase 3: Token Minting
    Prosumer->>Registry: 8. settle_and_mint_tokens()
    Registry->>Registry: 9. Calculate net generation
    Registry->>EnergyToken: 10. CPI: mint_tokens_direct()
    EnergyToken->>EnergyToken: 11. Mint GRX tokens
    EnergyToken->>Prosumer: 12. Credit to token account
    
    Note over Meter,Consumer: Phase 4: Trading
    Prosumer->>Trading: 13. create_sell_order()
    Trading->>Trading: 14. Create order + escrow
    Consumer->>Trading: 15. create_buy_order()
    Trading->>Trading: 16. Match orders
    Trading->>EnergyToken: 17. CPI: transfer tokens
    EnergyToken->>Consumer: 18. Credit GRX to buyer
```

---

## 4. Trading Protocol State Machine

```mermaid
stateDiagram-v2
    [*] --> MarketInitialized: initialize_market()
    
    state Market {
        MarketInitialized --> OrderCreated: create_sell_order()<br/>create_buy_order()
        OrderCreated --> OrderActive: Validate ERC<br/>Check Balance
        OrderActive --> OrderMatched: match_orders()<br/>AMM Swap<br/>Auction Clear
        OrderMatched --> SettlementPending: execute_settlement()
        SettlementPending --> Settled: Transfer Complete
        SettlementPending --> Cancelled: Settlement Failed
        OrderActive --> Cancelled: cancel_order()<br/>Expiration
        Settled --> [*]
        Cancelled --> [*]
    }
    
    state OrderTypes {
        direction TB
        [*] --> Bilateral
        [*] --> AMM
        [*] --> Auction
        [*] --> BatchClearing
    }
    
    state OrderStatus {
        direction TB
        Active --> PartiallyFilled
        PartiallyFilled --> FullyFilled
        Active --> Cancelled
        FullyFilled --> Settled
    }
```

---

## 5. Account Hierarchy & PDA Structure

```mermaid
graph TB
    subgraph RegistryProgram["Registry Program (EmiSgo85...)"]
        RegPDA[Registry PDA<br/><b>Seeds:</b> ['registry']<br/>authority, user_count, meter_count]
        
        subgraph UserPDAs["User Accounts"]
            User1[UserAccount PDA<br/><b>Seeds:</b> ['user', wallet_pubkey]<br/>user_type, status, registered_at]
            User2[UserAccount PDA<br/><b>Seeds:</b> ['user', wallet_pubkey]<br/>...]
        end
        
        subgraph MeterPDAs["Meter Accounts"]
            Meter1[MeterAccount PDA<br/><b>Seeds:</b> ['meter', meter_id]<br/>total_generation, total_consumption<br/>settled_net_generation, claimed_erc_generation]
            Meter2[MeterAccount PDA<br/><b>Seeds:</b> ['meter', meter_id]<br/>...]
        end
    end
    
    subgraph EnergyTokenProgram["Energy Token Program (GzEcWzkb...)"]
        TokenInfoPDA[TokenInfo PDA<br/><b>Seeds:</b> ['token_info_2022']<br/>authority, mint, total_supply<br/>rec_validators[]]
        GRXMint[GRX Token Mint<br/>SPL Token-2022<br/>9 Decimals<br/>Metaplex Metadata]
    end
    
    subgraph OracleProgram["Oracle Program (BRctXUy...)"]
        OraclePDA[OracleData PDA<br/><b>Seeds:</b> ['oracle_data']<br/>api_gateway, total_readings<br/>quality_metrics]
    end
    
    subgraph TradingProgram["Trading Program (3LXbBJ7s...)"]
        MarketPDA[Market PDA<br/><b>Seeds:</b> ['market']<br/>authority, active_orders<br/>price_history, VWAP]
        
        subgraph OrderPDAs["Order Accounts"]
            Order1[Order PDA<br/><b>Seeds:</b> ['order', user, counter]<br/>amount, price_per_kwh, status<br/>erc_certificate_id]
            Order2[Order PDA<br/>...]
        end
        
        subgraph EscrowPDAs["Escrow Accounts"]
            Escrow1[Escrow PDA<br/><b>Seeds:</b> ['escrow', order_id]<br/>locked GRX tokens]
        end
    end
    
    subgraph GovernanceProgram["Governance Program (8bNpJqZo...)"]
        PoAConfigPDA[PoAConfig PDA<br/><b>Seeds:</b> ['poa_config']<br/>authority, required_signers]
        
        subgraph ERCPDAs["ERC Certificates"]
            ERC1[ErcCertificate PDA<br/><b>Seeds:</b> ['erc_certificate', cert_id]<br/>energy_amount, source, status<br/>validated_for_trading]
        end
    end
    
    RegPDA --> User1
    RegPDA --> Meter1
    User1 --> Meter1
    TokenInfoPDA --> GRXMint
    MarketPDA --> Order1
    Order1 --> Escrow1
    Order1 -.->|Optional ERC| ERC1
```

---

## 6. Cross-Program Invocation (CPI) Matrix

```mermaid
graph LR
    subgraph CPIMatrix["CPI Dependency Matrix"]
        direction TB
        
        Reg[Registry]
        Ora[Oracle]
        Gov[Governance]
        EToken[Energy Token]
        Trad[Trading]
        
        Reg -->|CPI: mint_tokens_direct| EToken
        Ora -->|CPI: update_meter_reading| Reg
        Trad -->|CPI: transfer| EToken
        Trad -.->|READ| Gov
        Trad -.->|READ| Reg
        Gov -.->|READ| Reg
    end
    
    style Reg fill:#e1f5fe
    style Ora fill:#fff3e0
    style Gov fill:#f3e5f5
    style EToken fill:#e8f5e9
    style Trad fill:#fce4ec
```

| From ↓ / To → | Registry | Oracle | Governance | Energy Token | Trading |
|---------------|----------|--------|------------|--------------|---------|
| **Registry** | - | - | - | **CPI ✓** | - |
| **Oracle** | **CPI ✓** | - | - | - | **CPI ✓** |
| **Governance** | READ ✓ | - | - | - | - |
| **Energy Token** | - | - | - | - | - |
| **Trading** | READ ✓ | READ ✓ | READ ✓ | **CPI ✓** | - |

- **CPI ✓** = Cross-Program Invocation (write operation)
- **READ ✓** = Account data read (no CPI needed)

---

## 7. Data Flow Architecture

```mermaid
flowchart TB
    subgraph Physical["Physical Layer"]
        Solar[Solar Panels]
        Wind[Wind Turbines]
        Grid[Grid Connection]
    end
    
    subgraph Meters["Metering Layer"]
        SmartMeter[Smart Meter<br/>Ed25519 Signing]
    end
    
    subgraph Offchain["Off-chain Services"]
        AMIGW[AMI Gateway<br/>Data Aggregation]
        OracleSvc[Oracle Service<br/>HSM Signing]
        Indexer[Event Indexer<br/>PostgreSQL]
        Cache[Redis Cache<br/>Real-time Data]
    end
    
    subgraph Blockchain["Blockchain Layer"]
        subgraph Programs["Programs"]
            RegProg[Registry]
            OraProg[Oracle]
            ETokenProg[Energy Token]
            TradeProg[Trading]
            GovProg[Governance]
        end
        
        subgraph Events["Program Events"]
            UserReg[UserRegistered]
            MeterReg[MeterRegistered]
            Reading[MeterReadingUpdated]
            TokensMinted[TokensMinted]
            OrderCreated[OrderCreated]
            TradeExec[TradeExecuted]
        end
    end
    
    subgraph Application["Application Layer"]
        Dashboard[User Dashboard]
        TradingUI[Trading Terminal]
        Analytics[Analytics]
    end
    
    Solar --> SmartMeter
    Wind --> SmartMeter
    Grid --> SmartMeter
    
    SmartMeter -->|Signed Reading| AMIGW
    AMIGW -->|HTTPS| OracleSvc
    OracleSvc -->|Transaction| OraProg
    
    OraProg -->|CPI| RegProg
    RegProg -->|CPI| ETokenProg
    
    RegProg --> Events
    ETokenProg --> Events
    TradeProg --> Events
    
    Events --> Indexer
    Indexer --> Cache
    
    Cache --> Dashboard
    Cache --> TradingUI
    Cache --> Analytics
    
    TradeProg -->|Read| GovProg
    TradeProg -->|Read| RegProg
```

---

## 8. Settlement Protocol Flow

```mermaid
sequenceDiagram
    participant Seller as Seller (Prosumer)
    participant Trading as Trading Program
    participant Escrow as Escrow Account
    participant Token as Energy Token Program
    participant Governance as Governance Program
    participant Buyer as Buyer (Consumer)
    
    Note over Seller,Buyer: Order Creation Phase
    Seller->>Trading: create_sell_order(amount, price)
    Trading->>Governance: READ: Validate ERC Certificate
    Governance-->>Trading: ERC Status: Valid
    Trading->>Escrow: Lock GRX tokens
    Trading-->>Seller: Order Created (Active)
    
    Buyer->>Trading: create_buy_order(amount, price)
    Trading->>Trading: Validate buyer balance
    Trading-->>Buyer: Order Created (Active)
    
    Note over Seller,Buyer: Matching Phase
    Trading->>Trading: match_orders()
    Note right of Trading: Match by price, amount<br/>Type: Bilateral/AMM/Auction
    
    Note over Seller,Buyer: Settlement Phase
    Trading->>Trading: execute_atomic_settlement()
    
    par Parallel Operations
        Trading->>Escrow: Unlock seller tokens
        Trading->>Token: CPI: transfer(seller → buyer)
        Trading->>Token: CPI: transfer(buyer → seller) THB
    end
    
    Trading-->>Seller: Settlement Complete + THB
    Trading-->>Buyer: Settlement Complete + GRX
```

---

## 9. Oracle Validation Protocol

```mermaid
flowchart TD
    subgraph Input["Meter Reading Input"]
        Reading[Meter Reading<br/>{meter_id, produced, consumed, timestamp}]
    end
    
    subgraph Validation["Validation Pipeline"]
        Auth{API Gateway<br/>Authorized?}
        Active{Oracle<br/>Active?}
        Timestamp{Timestamp<br/>Valid?}
        Range{Energy Value<br/>In Range?}
        Anomaly{Anomaly<br/>Detection}
        Ratio{Production/Consumption<br/>Ratio Check}
    end
    
    subgraph Success["Success Path"]
        UpdateGlobal[Update Global Counters]
        EmitEvent[Emit MeterReadingSubmitted]
        CPIRegistry[CPI: update_meter_reading<br/>→ Registry]
    end
    
    subgraph Failure["Failure Path"]
        RejectCounter[Increment Rejected Count]
        EmitReject[Emit MeterReadingRejected]
        Error[Return Error]
    end
    
    Reading --> Auth
    Auth -->|No| Error
    Auth -->|Yes| Active
    Active -->|No| Error
    Active -->|Yes| Timestamp
    Timestamp -->|Future Reading| Error
    Timestamp -->|Valid| Range
    Range -->|Out of Range| Error
    Range -->|Valid| Anomaly
    Anomaly -->|Anomaly Detected| Ratio
    Anomaly -->|OK| UpdateGlobal
    Ratio -->|Exceeds Max| EmitReject
    Ratio -->|OK| UpdateGlobal
    
    UpdateGlobal --> EmitEvent
    EmitEvent --> CPIRegistry
    
    EmitReject --> RejectCounter
    RejectCounter --> Error
```

---

## 10. Governance & ERC Certificate Flow

```mermaid
sequenceDiagram
    participant Authority as PoA Authority
    participant Governance as Governance Program
    participant Registry as Registry Program
    participant Trading as Trading Program
    participant Owner as Certificate Owner
    
    Note over Authority,Owner: ERC Certificate Issuance
    Authority->>Governance: issue_erc(owner, energy_amount, source)
    Governance->>Governance: Create ErcCertificate PDA
    Governance->>Governance: Set status = Pending
    Governance-->>Owner: ERC Issued (Pending)
    
    Note over Authority,Owner: ERC Validation
    Authority->>Governance: validate_erc(certificate_id)
    Governance->>Registry: READ: Verify meter data
    Registry-->>Governance: Meter data confirmed
    Governance->>Governance: Set status = Valid<br/>validated_for_trading = true
    Governance-->>Owner: ERC Validated
    
    Note over Authority,Owner: Trading with ERC
    Owner->>Trading: create_sell_order(amount, price, erc_id)
    Trading->>Governance: READ: Validate ERC
    Governance-->>Trading: ERC Valid & Not Expired
    Trading->>Trading: Create order with ERC linkage
    
    Note over Authority,Owner: ERC Retirement
    Owner->>Governance: retire_erc(certificate_id)
    Governance->>Governance: Set status = Retired
    Governance-->>Owner: ERC Retired
```

---

## 11. Module Architecture (Trading Program)

```mermaid
graph TB
    subgraph TradingProgram["Trading Program (3LXbBJ7s...)"]
        Entry[lib.rs<br/>Entry Point]
        
        subgraph Core["Core Modules"]
            State[state.rs<br/>Market, Order, Escrow]
            Error[error.rs<br/>TradingError]
            Events[events.rs<br/>OrderCreated, TradeExecuted]
        end
        
        subgraph Features["Feature Modules"]
            AMM[amm.rs<br/>AMM Pools<br/>Bonding Curves<br/>Swap Logic]
            Auction[auction.rs<br/>Periodic Auction<br/>Batch Orders<br/>Clearing]
            Pricing[pricing.rs<br/>TOU Rates<br/>Dynamic Pricing<br/>Urgency Multiplier]
            Payments[payments.rs<br/>Escrow<br/>Fee Collection<br/>Refunds]
            Stablecoin[stablecoin.rs<br/>THB Peg<br/>USDC/USDT Support<br/>FX Rates]
            Carbon[carbon.rs<br/>Carbon Credits<br/>Offset Tracking]
            Privacy[privacy.rs<br/>ZK Proofs<br/>Range Proofs<br/>Anonymous Trading]
            Confidential[confidential.rs<br/>Token-2022<br/>Confidential Transfers]
            MeterVerify[meter_verification.rs<br/>Verify Readings<br/>Cross-check Oracle]
        end
        
        subgraph Invariants["Security"]
            Inv[invariants.rs<br/>Protocol Invariants<br/>Validation Rules]
        end
    end
    
    Entry --> State
    Entry --> Error
    Entry --> Events
    Entry --> AMM
    Entry --> Auction
    Entry --> Pricing
    Entry --> Payments
    Entry --> Stablecoin
    Entry --> Carbon
    Entry --> Privacy
    Entry --> Confidential
    Entry --> MeterVerify
    
    AMM --> State
    Auction --> State
    Pricing --> State
    Payments --> State
    Stablecoin --> State
    Carbon --> State
    Privacy --> Confidential
    Confidential --> State
    MeterVerify --> State
    
    All Features --> Inv
```

---

## 12. Network Topology

```mermaid
graph TB
    subgraph Internet["Internet"]
        Users[End Users<br/>Prosumers & Consumers]
    end
    
    subgraph AWS["AWS Cloud Infrastructure"]
        subgraph LoadBalancer["Load Balancing"]
            ALB[Application Load Balancer]
        end
        
        subgraph Compute["Compute Layer"]
            API1[API Server 1<br/>Express.js]
            API2[API Server 2<br/>Express.js]
            WS1[WebSocket Server 1]
            WS2[WebSocket Server 2]
        end
        
        subgraph Services["Service Layer"]
            OracleNode[Oracle Service<br/>HSM Signer]
            IndexerWorker[Indexer Worker<br/>Event Processor]
        end
        
        subgraph Data["Data Layer"]
            PostgreSQL[(PostgreSQL<br/>Event Store)]
            Redis[(Redis<br/>Cache)]
        end
        
        subgraph Monitoring["Monitoring"]
            Prometheus[Prometheus]
            AlertManager[AlertManager]
        end
    end
    
    subgraph Solana["Solana Network"]
        RPC1[RPC Node 1]
        RPC2[RPC Node 2]
        Validator1[Validator 1]
        Validator2[Validator 2]
        Validator3[Validator 3]
    end
    
    subgraph External["External Systems"]
        Meters[Smart Meters<br/>AMI Network]
        ThaiBaht[Thai Baht Chain]
        Wormhole[Wormhole Bridge]
    end
    
    Users --> ALB
    ALB --> API1
    ALB --> API2
    ALB --> WS1
    ALB --> WS2
    
    API1 --> PostgreSQL
    API2 --> PostgreSQL
    API1 --> Redis
    API2 --> Redis
    
    OracleNode --> RPC1
    OracleNode --> RPC2
    IndexerWorker --> RPC1
    IndexerWorker --> PostgreSQL
    
    Meters --> OracleNode
    ThaiBaht --> OracleNode
    Wormhole --> OracleNode
    
    RPC1 --> Validator1
    RPC1 --> Validator2
    RPC2 --> Validator2
    RPC2 --> Validator3
    
    Prometheus --> API1
    Prometheus --> API2
    Prometheus --> PostgreSQL
    Prometheus --> Redis
    AlertManager --> Prometheus
```

---

## 13. Key Protocol Constants

| Constant | Value | Description |
|----------|-------|-------------|
| **GRX Decimals** | 9 | 1 GRX = 1,000,000,000 atomic units |
| **GRX to kWh** | 1:1 | 1 GRX minted per 1 kWh verified |
| **Airdrop Amount** | 20 GRX | New user registration bonus |
| **Order Expiry** | 86,400 sec | 24 hours default order lifetime |
| **Market Fee** | 25 bps | 0.25% trading fee |
| **Max Batch Size** | 100 orders | Maximum orders per batch |
| **Batch Timeout** | 300 sec | 5 minutes batch window |
| **Min Reading Interval** | 60 sec | Minimum time between readings |
| **Max Reading Deviation** | 50% | Anomaly detection threshold |
| **Max Prod/Cons Ratio** | 1000x | For solar farm validation |
| **Consensus Threshold** | 2 | Backup oracles needed |

---

## Related Documentation

- [Architecture Diagrams](./architecture.md) - Detailed system architecture
- [Sequence Diagrams](./sequences.md) - Transaction flow sequences
- [Entity Relationship](./entity-relationship.md) - Account data models
- [Network Topology](./network-topology.md) - Infrastructure layout
- [State Machines](./state-machines.md) - Account state transitions
