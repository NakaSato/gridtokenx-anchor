# Data Flow Diagrams

## GridTokenX Complete Data Flow Documentation

> *December 2025 Edition*

---

## 1. Level 0: Context Diagram

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                            CONTEXT DIAGRAM (DFD Level 0)                           │
└────────────────────────────────────────────────────────────────────────────────────┘


    ┌─────────────────┐                                    ┌─────────────────┐
    │                 │                                    │                 │
    │    Prosumer     │                                    │    Consumer     │
    │    (Seller)     │                                    │    (Buyer)      │
    │                 │                                    │                 │
    └────────┬────────┘                                    └────────┬────────┘
             │                                                      │
             │ • Registration                                       │ • Registration
             │ • Energy Data                                        │ • Browse Orders
             │ • Create Orders                                      │ • Execute Trades
             │ • Receive Payment                                    │ • Make Payments
             │                                                      │
             │                                                      │
             └───────────────────┬──────────────────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────────┐
                    │                            │
                    │       GRIDTOKENX           │
                    │         SYSTEM             │
                    │                            │
                    │   P2P Energy Trading       │
                    │      Platform              │
                    │                            │
                    └─────────────┬──────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│                 │      │                 │      │                 │
│  Smart Meter    │      │   Thai Baht     │      │     Grid        │
│   System        │      │     Chain       │      │   Operator      │
│                 │      │                 │      │                 │
│ • Energy Data   │      │ • Fiat Payment  │      │ • Reporting     │
│ • Verification  │      │ • Settlement    │      │ • Compliance    │
│                 │      │                 │      │                 │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

---

## 2. Level 1: Main Process Decomposition

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                         MAIN PROCESS DECOMPOSITION (DFD Level 1)                   │
└────────────────────────────────────────────────────────────────────────────────────┘


    Prosumer                                                            Consumer
       │                                                                    │
       │                                                                    │
       ▼                                                                    │
┌──────────────┐         ┌──────────────┐         ┌──────────────┐         │
│              │         │              │         │              │         │
│   1.0        │         │   2.0        │         │   3.0        │         │
│   USER       │────────►│   ENERGY     │────────►│   TOKEN      │         │
│   MANAGEMENT │         │   RECORDING  │         │   MINTING    │         │
│              │         │              │         │              │         │
└──────┬───────┘         └──────┬───────┘         └──────┬───────┘         │
       │                        │                        │                  │
       │                        │                        │                  │
       │                        ▼                        ▼                  │
       │                  (Meter Data)            (Token Balance)           │
       │                        │                        │                  │
       │                        │                        │                  │
       │                        │         ┌──────────────┴──────────────┐   │
       │                        │         │                             │   │
       │                        │         ▼                             ▼   │
       │                  ┌──────────────┐          ┌──────────────┐        │
       │                  │              │          │              │        │
       │                  │   4.0        │          │   5.0        │◄───────┘
       │                  │   ORDER      │◄────────►│   TRADE      │
       │                  │   MANAGEMENT │          │   SETTLEMENT │
       │                  │              │          │              │
       │                  └──────┬───────┘          └──────┬───────┘
       │                         │                         │
       │                         │                         │
       │                         ▼                         ▼
       │                   (Order Book)             (Trade Record)
       │                         │                         │
       │                         │                         │
       │                  ┌──────┴───────┐          ┌──────┴───────┐
       │                  │              │          │              │
       │                  │   6.0        │          │   7.0        │
       └─────────────────►│   ERC        │◄────────►│   PAYMENT    │
                          │   MANAGEMENT │          │   PROCESSING │
                          │              │          │              │
                          └──────────────┘          └──────────────┘
                                 │                         │
                                 ▼                         ▼
                          (Certificates)            (Payments)


Data Stores:
════════════════════════════════════════════════════════════════════
D1: User Database       - User profiles, wallets, PDAs
D2: Meter Readings      - Time-series energy data
D3: Token Ledger        - GRID token balances (on-chain)
D4: Order Book          - Active and historical orders
D5: Trade History       - Completed trades
D6: ERC Registry        - Certificate records
D7: Payment Records     - Payment transactions
```

---

## 3. Level 2: Detailed Process Flows

### 3.1 Process 1.0: User Management

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                      PROCESS 1.0: USER MANAGEMENT (DFD Level 2)                    │
└────────────────────────────────────────────────────────────────────────────────────┘


                                    User
                                     │
                                     │ Registration Request
                                     │ (wallet, type, profile)
                                     ▼
                           ┌─────────────────────┐
                           │                     │
                           │   1.1 VALIDATE      │
                           │   REGISTRATION      │
                           │                     │
                           └──────────┬──────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
           ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
           │              │  │              │  │              │
           │ 1.2 CHECK    │  │ 1.3 VERIFY   │  │ 1.4 CHECK    │
           │ WALLET       │  │ SIGNATURE    │  │ DUPLICATE    │
           │ FORMAT       │  │              │  │              │
           │              │  │              │  │              │
           └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                  │                 │                 │
                  │                 │                 │
                  └─────────────────┼─────────────────┘
                                    │
                                    │ Validation Result
                                    ▼
                           ┌─────────────────────┐
                           │                     │
                           │   1.5 CREATE        │
                           │   USER PDA          │
                           │   (Solana)          │
                           │                     │
                           └──────────┬──────────┘
                                      │
                                      │ PDA Address
                                      ▼
                           ┌─────────────────────┐
                           │                     │
                           │   1.6 STORE         │────────► D1: User Database
                           │   USER PROFILE      │
                           │   (PostgreSQL)      │
                           │                     │
                           └──────────┬──────────┘
                                      │
                                      │ Confirmation
                                      ▼
                                    User
```

### 3.2 Process 2.0: Energy Recording

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                     PROCESS 2.0: ENERGY RECORDING (DFD Level 2)                    │
└────────────────────────────────────────────────────────────────────────────────────┘


          Smart Meter
               │
               │ Signed Reading
               │ {meter_id, production, consumption, timestamp, signature}
               ▼
      ┌─────────────────────┐
      │                     │
      │   2.1 VERIFY        │
      │   METER SIGNATURE   │
      │   (Ed25519)         │
      │                     │
      └──────────┬──────────┘
                 │
                 │ Valid Signature
                 ▼
      ┌─────────────────────┐
      │                     │
      │   2.2 CHECK         │◄───────── D1: User Database
      │   METER REGISTRATION│           (Meter Registry)
      │                     │
      └──────────┬──────────┘
                 │
                 │ Registered Meter
                 ▼
      ┌─────────────────────┐
      │                     │
      │   2.3 VALIDATE      │
      │   READING DATA      │
      │   • Timestamp age   │
      │   • Amount limits   │
      │   • Duplicates      │
      │                     │
      └──────────┬──────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
┌──────────────┐  ┌──────────────┐
│              │  │              │
│ 2.4 STORE    │  │ 2.5 UPDATE   │
│ READING      │  │ METER PDA    │
│ (PostgreSQL) │  │ (Solana)     │
│              │  │              │
└──────┬───────┘  └──────┬───────┘
       │                 │
       │                 │
       ▼                 │
D2: Meter Readings       │
                         │
       │                 │
       │                 │
       ▼                 ▼
      ┌─────────────────────┐
      │                     │
      │   2.6 CALCULATE     │
      │   SURPLUS           │
      │   (prod - cons)     │
      │                     │
      └──────────┬──────────┘
                 │
                 │ Surplus Amount
                 ▼
           To Process 3.0
           (Token Minting)
```

### 3.3 Process 3.0: Token Minting

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                      PROCESS 3.0: TOKEN MINTING (DFD Level 2)                      │
└────────────────────────────────────────────────────────────────────────────────────┘


     From Process 2.0
     (Surplus Amount)
           │
           │
           ▼
  ┌─────────────────────┐
  │                     │
  │   3.1 CHECK         │◄───────── D2: Meter Readings
  │   UNMINTED          │           (minted = false)
  │   READINGS          │
  │                     │
  └──────────┬──────────┘
             │
             │ Unminted Readings
             ▼
  ┌─────────────────────┐
  │                     │
  │   3.2 CALCULATE     │
  │   UNSETTLED         │
  │   BALANCE           │
  │                     │
  │   current_net =     │
  │   production -      │
  │   consumption       │
  │                     │
  │   unsettled =       │
  │   current_net -     │
  │   settled_net_gen   │
  │                     │
  └──────────┬──────────┘
             │
             │ Unsettled Amount
             ▼
  ┌─────────────────────┐
  │                     │
  │   3.3 SETTLE        │
  │   METER BALANCE     │
  │   (Registry CPI)    │
  │                     │
  └──────────┬──────────┘
             │
             │ Settlement Proof
             ▼
  ┌─────────────────────┐
  │                     │
  │   3.4 MINT TOKENS   │
  │   (Energy Token     │
  │    Program CPI)     │
  │                     │
  │   1 kWh = 1 GRID    │
  │   (9 decimals)      │
  │                     │
  └──────────┬──────────┘
             │
     ┌───────┴───────┐
     │               │
     ▼               ▼
┌──────────┐   ┌──────────┐
│          │   │          │
│ 3.5 UPD  │   │ 3.6 UPD  │
│ TOKEN    │   │ METER    │
│ BALANCE  │   │ READING  │
│ (SPL)    │   │ (minted  │
│          │   │  = true) │
└────┬─────┘   └────┬─────┘
     │              │
     │              │
     ▼              ▼
D3: Token       D2: Meter
    Ledger          Readings
```

### 3.4 Process 4.0: Order Management

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                     PROCESS 4.0: ORDER MANAGEMENT (DFD Level 2)                    │
└────────────────────────────────────────────────────────────────────────────────────┘


        Prosumer                                               Consumer
           │                                                       │
           │ Create Order                                          │ View Orders
           │ (amount, price)                                       │
           ▼                                                       │
  ┌─────────────────────┐                                         │
  │                     │                                         │
  │   4.1 VALIDATE      │                                         │
  │   ORDER REQUEST     │                                         │
  │   • Amount > 0      │                                         │
  │   • Price > 0       │                                         │
  │   • Has balance     │◄───────── D3: Token Ledger              │
  │                     │                                         │
  └──────────┬──────────┘                                         │
             │                                                     │
             │ Valid Order                                         │
             ▼                                                     │
  ┌─────────────────────┐                                         │
  │                     │                                         │
  │   4.2 TRANSFER TO   │                                         │
  │   ESCROW            │                                         │
  │   (Lock Tokens)     │                                         │
  │                     │                                         │
  └──────────┬──────────┘                                         │
             │                                                     │
             │ Tokens Locked                                       │
             ▼                                                     │
  ┌─────────────────────┐                                         │
  │                     │                                         │
  │   4.3 CREATE        │                                         │
  │   ORDER PDA         │                                         │
  │   (Solana)          │                                         │
  │                     │                                         │
  └──────────┬──────────┘                                         │
             │                                                     │
             │ Order Created                                       │
             ▼                                                     │
  ┌─────────────────────┐         ┌─────────────────────┐         │
  │                     │         │                     │         │
  │   4.4 STORE         │────────►│   4.5 QUERY         │◄────────┘
  │   ORDER             │         │   ORDER BOOK        │
  │   (PostgreSQL)      │         │                     │
  │                     │         │                     │
  └──────────┬──────────┘         └──────────┬──────────┘
             │                                │
             │                                │
             ▼                                ▼
      D4: Order Book                   Order List
                                      (To Consumer)

                    ┌─────────────────────┐
                    │                     │
                    │   4.6 CANCEL        │
                    │   ORDER             │
                    │   (If requested)    │
                    │   • Return tokens   │
                    │   • Update status   │
                    │                     │
                    └─────────────────────┘
```

### 3.5 Process 5.0: Trade Settlement

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                     PROCESS 5.0: TRADE SETTLEMENT (DFD Level 2)                    │
└────────────────────────────────────────────────────────────────────────────────────┘


        Consumer
           │
           │ Match Order Request
           │ (order_id)
           ▼
  ┌─────────────────────┐
  │                     │
  │   5.1 VALIDATE      │
  │   MATCH REQUEST     │
  │   • Order active    │◄───────── D4: Order Book
  │   • Not self-trade  │
  │   • Buyer balance   │◄───────── D3: Token Ledger (GRX)
  │                     │
  └──────────┬──────────┘
             │
             │ Valid Match
             ▼
  ┌─────────────────────┐
  │                     │
  │   5.2 ATOMIC        │
  │   SETTLEMENT        │
  │   (All-or-Nothing)  │
  │                     │
  └──────────┬──────────┘
             │
     ┌───────┴───────────────────┐
     │                           │
     ▼                           ▼
┌──────────────┐          ┌──────────────┐
│              │          │              │
│ 5.3 TRANSFER │          │ 5.4 TRANSFER │
│ TOKENS       │          │ PAYMENT      │
│              │          │              │
│ Escrow →     │          │ Buyer →      │
│ Buyer        │          │ Seller       │
│              │          │              │
└──────┬───────┘          └──────┬───────┘
       │                         │
       │                         │
       └────────────┬────────────┘
                    │
                    │ Both Complete
                    ▼
           ┌─────────────────────┐
           │                     │
           │   5.5 UPDATE        │
           │   ORDER STATUS      │
           │   (FILLED)          │
           │                     │
           └──────────┬──────────┘
                      │
                      │
           ┌──────────┴──────────┐
           │                     │
           ▼                     ▼
  ┌─────────────────┐   ┌─────────────────┐
  │                 │   │                 │
  │ 5.6 EMIT        │   │ 5.7 RECORD      │
  │ TRADE EVENT     │   │ TRADE           │
  │ (On-chain)      │   │ (PostgreSQL)    │
  │                 │   │                 │
  └────────┬────────┘   └────────┬────────┘
           │                     │
           │                     │
           ▼                     ▼
     Event Listener        D5: Trade History
```

---

## 4. Cross-Process Data Flows

### 4.1 End-to-End Energy Trading Flow

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                    END-TO-END ENERGY TRADING DATA FLOW                             │
└────────────────────────────────────────────────────────────────────────────────────┘


PHASE 1: ENERGY GENERATION
═══════════════════════════════════════════════════════════════════════════════════

 Smart Meter              API Gateway              Backend               Blockchain
     │                        │                      │                       │
     │    Signed Reading      │                      │                       │
     │ ──────────────────────►│                      │                       │
     │                        │   Validated Data     │                       │
     │                        │ ──────────────────►  │                       │
     │                        │                      │   Update Meter PDA    │
     │                        │                      │ ────────────────────► │
     │                        │                      │                       │
     │                        │                      │   Store in DB         │
     │                        │                      │ ────────┐             │
     │                        │                      │ ◄───────┘             │
     │                        │                      │                       │


PHASE 2: TOKEN MINTING
═══════════════════════════════════════════════════════════════════════════════════

 Polling Service          Registry Program       Energy Token          SPL Token
     │                        │                      │                       │
     │   Query Unminted       │                      │                       │
     │ ──────┐                │                      │                       │
     │ ◄─────┘                │                      │                       │
     │                        │                      │                       │
     │   Settle Balance       │                      │                       │
     │ ──────────────────────►│                      │                       │
     │                        │   CPI: Mint Request  │                       │
     │                        │ ────────────────────►│                       │
     │                        │                      │   SPL Mint            │
     │                        │                      │ ────────────────────► │
     │                        │                      │                       │
     │   Update DB (minted)   │                      │                       │
     │ ──────┐                │                      │                       │
     │ ◄─────┘                │                      │                       │


PHASE 3: ORDER CREATION
═══════════════════════════════════════════════════════════════════════════════════

 Prosumer                 API Gateway          Trading Program            Escrow
     │                        │                      │                       │
     │   Create Order Request │                      │                       │
     │ ──────────────────────►│                      │                       │
     │                        │   Create Order TX    │                       │
     │                        │ ────────────────────►│                       │
     │                        │                      │   Lock Tokens         │
     │                        │                      │ ────────────────────► │
     │                        │                      │                       │
     │   Order Confirmation   │   Order Created      │                       │
     │ ◄──────────────────────│ ◄────────────────────│                       │


PHASE 4: TRADE EXECUTION
═══════════════════════════════════════════════════════════════════════════════════

 Consumer                API Gateway          Trading Program        Seller Wallet
     │                        │                      │                       │
     │   Match Order Request  │                      │                       │
     │ ──────────────────────►│                      │                       │
     │                        │   Match Order TX     │                       │
     │                        │ ────────────────────►│                       │
     │                        │                      │                       │
     │                        │                      │   Transfer Tokens     │
     │                        │   ◄──────────────────│   (Escrow → Buyer)    │
     │                        │                      │                       │
     │                        │                      │   Transfer Payment    │
     │                        │                      │ ────────────────────► │
     │                        │                      │   (Buyer → Seller)    │
     │                        │                      │                       │
     │   Trade Confirmation   │   TradeExecuted      │                       │
     │ ◄──────────────────────│ ◄────────────────────│                       │


PHASE 5: EVENT SYNCHRONIZATION
═══════════════════════════════════════════════════════════════════════════════════

 Event Listener              Blockchain              PostgreSQL           WebSocket
     │                           │                       │                    │
     │   Subscribe to Events     │                       │                    │
     │ ─────────────────────────►│                       │                    │
     │                           │                       │                    │
     │   TradeExecuted Event     │                       │                    │
     │ ◄─────────────────────────│                       │                    │
     │                           │                       │                    │
     │   Parse Event Data        │                       │                    │
     │ ──────┐                   │                       │                    │
     │ ◄─────┘                   │                       │                    │
     │                           │                       │                    │
     │   Insert Trade Record     │                       │                    │
     │ ──────────────────────────────────────────────────►                    │
     │                           │                       │                    │
     │   Broadcast to Clients    │                       │                    │
     │ ──────────────────────────────────────────────────────────────────────►│
     │                           │                       │                    │
```

### 4.2 Data Entity Flow

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                          DATA ENTITY LIFECYCLE FLOW                                │
└────────────────────────────────────────────────────────────────────────────────────┘


USER ENTITY
───────────────────────────────────────────────────────────────────────────────────

  Created                 Stored                  Active                 Trading
     │                       │                       │                       │
     ▼                       ▼                       ▼                       ▼
┌─────────┐           ┌─────────┐           ┌─────────┐           ┌─────────┐
│ wallet  │──────────►│ PDA     │──────────►│ profile │──────────►│ orders  │
│ address │           │ on-chain│           │ in DB   │           │ trades  │
│ type    │           │         │           │         │           │         │
└─────────┘           └─────────┘           └─────────┘           └─────────┘


METER READING ENTITY
───────────────────────────────────────────────────────────────────────────────────

  Submitted              Validated               Stored                 Minted
     │                       │                       │                       │
     ▼                       ▼                       ▼                       ▼
┌─────────┐           ┌─────────┐           ┌─────────┐           ┌─────────┐
│ raw     │──────────►│ verified│──────────►│ persisted──────────►│ tokens  │
│ reading │           │ signature           │ minted  │           │ created │
│         │           │         │           │ = false │           │ = true  │
└─────────┘           └─────────┘           └─────────┘           └─────────┘


ORDER ENTITY
───────────────────────────────────────────────────────────────────────────────────

  Created                Escrowed               Active                  Final
     │                       │                       │                       │
     ▼                       ▼                       ▼                       ▼
┌─────────┐           ┌─────────┐           ┌─────────┐           ┌─────────┐
│ amount  │──────────►│ tokens  │──────────►│ visible │──────────►│ FILLED  │
│ price   │           │ locked  │           │ in book │           │ or      │
│         │           │         │           │         │           │CANCELLED│
└─────────┘           └─────────┘           └─────────┘           └─────────┘


TRADE ENTITY
───────────────────────────────────────────────────────────────────────────────────

  Initiated              Validated              Executed               Recorded
     │                       │                       │                       │
     ▼                       ▼                       ▼                       ▼
┌─────────┐           ┌─────────┐           ┌─────────┐           ┌─────────┐
│ match   │──────────►│ checks  │──────────►│ atomic  │──────────►│ history │
│ request │           │ passed  │           │ swap    │           │ stored  │
│         │           │         │           │         │           │ event   │
└─────────┘           └─────────┘           └─────────┘           └─────────┘


TOKEN ENTITY
───────────────────────────────────────────────────────────────────────────────────

  Minted                  Held                   Traded                 Consumed
     │                       │                       │                       │
     ▼                       ▼                       ▼                       ▼
┌─────────┐           ┌─────────┐           ┌─────────┐           ┌─────────┐
│ from    │──────────►│ in      │──────────►│ transfer│──────────►│ burned  │
│ energy  │           │ wallet  │           │ to buyer│           │ or      │
│         │           │ or      │           │         │           │ retired │
│         │           │ escrow  │           │         │           │         │
└─────────┘           └─────────┘           └─────────┘           └─────────┘
```

---

## 5. State Transition Diagrams

### 5.1 Order State Machine

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                           ORDER STATE MACHINE                                      │
└────────────────────────────────────────────────────────────────────────────────────┘


                           ┌─────────────────┐
                           │                 │
                           │    CREATED      │
                           │                 │
                           └────────┬────────┘
                                    │
                                    │ Tokens Locked
                                    ▼
                           ┌─────────────────┐
                  ┌───────►│                 │◄───────┐
                  │        │     ACTIVE      │        │
                  │        │                 │        │
                  │        └───────┬─────────┘        │
                  │                │                  │
                  │     ┌──────────┼──────────┐       │
                  │     │          │          │       │
            Partial     │    Full Match       │   Cancel
            Match       │          │          │   Request
                  │     │          │          │       │
                  │     ▼          ▼          ▼       │
           ┌──────┴──────┐  ┌───────────┐  ┌─────────┴───┐
           │             │  │           │  │             │
           │  PARTIALLY  │  │  FILLED   │  │ CANCELLED   │
           │   FILLED    │  │           │  │             │
           │             │  │ (Terminal)│  │ (Terminal)  │
           └─────────────┘  └───────────┘  └─────────────┘
                                    │
                                    │ If Time Exceeded
                                    ▼
                           ┌─────────────────┐
                           │                 │
                           │    EXPIRED      │
                           │   (Terminal)    │
                           │                 │
                           └─────────────────┘


State Descriptions:
═══════════════════════════════════════════════════════════════════════════════════

CREATED     → Initial state, tokens being locked
ACTIVE      → Order visible in order book, can be matched
PARTIALLY_  → Some amount filled, remaining still active
  FILLED
FILLED      → Completely executed, trade completed
CANCELLED   → User cancelled, tokens returned
EXPIRED     → Time limit exceeded, tokens returned
```

### 5.2 Meter Reading State Machine

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                       METER READING STATE MACHINE                                  │
└────────────────────────────────────────────────────────────────────────────────────┘


                           ┌─────────────────┐
                           │                 │
                           │   SUBMITTED     │
                           │                 │
                           └────────┬────────┘
                                    │
                                    │ Signature Verified
                                    ▼
                           ┌─────────────────┐
                           │                 │
                           │   VALIDATED     │
                           │                 │
                           └────────┬────────┘
                                    │
                                    │ Stored in DB
                                    ▼
                           ┌─────────────────┐
                           │                 │
                           │    STORED       │
                           │  (minted=false) │
                           │                 │
                           └────────┬────────┘
                                    │
                                    │ Polling Service Processes
                                    ▼
                           ┌─────────────────┐
                           │                 │
                           │   PROCESSING    │
                           │                 │
                           └────────┬────────┘
                                    │
                          ┌─────────┴─────────┐
                          │                   │
                    Success               Failure
                          │                   │
                          ▼                   ▼
                 ┌─────────────────┐  ┌─────────────────┐
                 │                 │  │                 │
                 │    MINTED       │  │    FAILED       │
                 │  (minted=true)  │  │  (retry queue)  │
                 │                 │  │                 │
                 └─────────────────┘  └─────────────────┘
```

### 5.3 ERC Certificate State Machine

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                    ERC CERTIFICATE STATE MACHINE                                   │
└────────────────────────────────────────────────────────────────────────────────────┘


                           ┌─────────────────┐
                           │                 │
                           │    PENDING      │
                           │  (Just Created) │
                           │                 │
                           └────────┬────────┘
                                    │
                                    │ Governance Validates
                                    │ Against Meter Data
                                    ▼
                           ┌─────────────────┐
                           │                 │
                           │     VALID       │
                           │ (Can Trade with)│
                           │                 │
                           └────────┬────────┘
                                    │
                          ┌─────────┼─────────┐
                          │         │         │
                     Trade         │     Revoked
                     Complete      │     (Fraud)
                          │        │         │
                          ▼        │         ▼
                 ┌─────────────────┐│┌─────────────────┐
                 │                 │││                 │
                 │    RETIRED      │││    REVOKED      │
                 │  (Used for      │││  (Invalid)      │
                 │   trading)      │││                 │
                 └─────────────────┘│└─────────────────┘
                                    │
                                    │ Time Expired
                                    ▼
                           ┌─────────────────┐
                           │                 │
                           │    EXPIRED      │
                           │                 │
                           └─────────────────┘
```

---

## 6. Data Store Specifications

### 6.1 Primary Data Stores

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                          DATA STORE SPECIFICATIONS                                 │
└────────────────────────────────────────────────────────────────────────────────────┘


D1: USER DATABASE (PostgreSQL)
═══════════════════════════════════════════════════════════════════════════════════
│ Field              │ Type          │ Description                                │
├────────────────────┼───────────────┼────────────────────────────────────────────┤
│ id                 │ UUID          │ Primary key                                │
│ wallet_address     │ VARCHAR(88)   │ Solana wallet address                      │
│ user_type          │ ENUM          │ prosumer, consumer                         │
│ pda_address        │ VARCHAR(88)   │ On-chain PDA reference                     │
│ name               │ VARCHAR(100)  │ Display name                               │
│ created_at         │ TIMESTAMP     │ Registration time                          │
│ last_active        │ TIMESTAMP     │ Last activity                              │
└────────────────────┴───────────────┴────────────────────────────────────────────┘


D2: METER READINGS (PostgreSQL - Time-series)
═══════════════════════════════════════════════════════════════════════════════════
│ Field              │ Type          │ Description                                │
├────────────────────┼───────────────┼────────────────────────────────────────────┤
│ id                 │ UUID          │ Primary key                                │
│ user_id            │ UUID          │ Foreign key to users                       │
│ meter_id           │ VARCHAR(64)   │ Smart meter identifier                     │
│ production_kwh     │ DECIMAL(10,4) │ Energy produced                            │
│ consumption_kwh    │ DECIMAL(10,4) │ Energy consumed                            │
│ surplus_kwh        │ DECIMAL(10,4) │ Computed (prod - cons)                     │
│ reading_timestamp  │ TIMESTAMP     │ When reading was taken                     │
│ minted             │ BOOLEAN       │ Has been converted to tokens               │
│ mint_tx_signature  │ VARCHAR(88)   │ Blockchain transaction                     │
└────────────────────┴───────────────┴────────────────────────────────────────────┘


D3: TOKEN LEDGER (Solana - On-chain)
═══════════════════════════════════════════════════════════════════════════════════
│ Account Type       │ Content       │ Description                                │
├────────────────────┼───────────────┼────────────────────────────────────────────┤
│ Mint               │ GRID Token    │ Token mint authority                       │
│ Token Account      │ Balance       │ User token holdings                        │
│ Escrow Account     │ Locked        │ Order-locked tokens                        │
└────────────────────┴───────────────┴────────────────────────────────────────────┘


D4: ORDER BOOK (PostgreSQL + Redis Cache)
═══════════════════════════════════════════════════════════════════════════════════
│ Field              │ Type          │ Description                                │
├────────────────────┼───────────────┼────────────────────────────────────────────┤
│ id                 │ UUID          │ Primary key                                │
│ pda_address        │ VARCHAR(88)   │ On-chain order PDA                         │
│ seller_id          │ UUID          │ Foreign key to users                       │
│ amount_kwh         │ DECIMAL(10,4) │ Energy amount                              │
│ price_per_kwh      │ DECIMAL(10,4) │ Price in GRX                               │
│ status             │ ENUM          │ active, filled, cancelled                  │
│ created_at         │ TIMESTAMP     │ Order creation time                        │
│ expires_at         │ TIMESTAMP     │ Order expiration                           │
└────────────────────┴───────────────┴────────────────────────────────────────────┘


D5: TRADE HISTORY (PostgreSQL)
═══════════════════════════════════════════════════════════════════════════════════
│ Field              │ Type          │ Description                                │
├────────────────────┼───────────────┼────────────────────────────────────────────┤
│ id                 │ UUID          │ Primary key                                │
│ order_id           │ UUID          │ Foreign key to orders                      │
│ seller_id          │ UUID          │ Foreign key to users                       │
│ buyer_id           │ UUID          │ Foreign key to users                       │
│ amount_kwh         │ DECIMAL(10,4) │ Energy traded                              │
│ total_price        │ DECIMAL(10,4) │ Total payment                              │
│ executed_at        │ TIMESTAMP     │ Trade execution time                       │
│ tx_signature       │ VARCHAR(88)   │ Blockchain transaction                     │
└────────────────────┴───────────────┴────────────────────────────────────────────┘
```

---

## 7. Document Navigation

| Previous | Current | Next |
|----------|---------|------|
| [03-SYSTEM-ARCHITECTURE.md](./03-SYSTEM-ARCHITECTURE.md) | **04-DATA-FLOW-DIAGRAMS.md** | [05-TOKEN-ECONOMICS.md](./05-TOKEN-ECONOMICS.md) |

---

**Document Version**: 1.0  
**Last Updated**: November 2024  
**Status**: Complete
