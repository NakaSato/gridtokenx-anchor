# GridTokenX State Machine Diagrams

**Version:** 2.0.0  
**Last Updated:** February 2, 2026

---

## 1. User Account State Machine

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              USER ACCOUNT STATE MACHINE                                     │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│                                    ┌───────────────┐                                       │
│                                    │   (START)     │                                       │
│                                    └───────┬───────┘                                       │
│                                            │                                                │
│                                            │ register_user()                               │
│                                            │                                                │
│                                            ▼                                                │
│                          ┌─────────────────────────────────────┐                           │
│                          │                                     │                           │
│                          │              ACTIVE                 │                           │
│                          │                                     │                           │
│                          │  • Can register meters              │                           │
│                          │  • Can participate in trading       │                           │
│                          │  • Can receive settlements          │                           │
│                          │  • Can claim ERCs                   │                           │
│                          │                                     │                           │
│                          └───────────────┬─────────────────────┘                           │
│                                          │                                                  │
│                    ┌─────────────────────┼─────────────────────┐                           │
│                    │                     │                     │                           │
│                    │ suspend_user()      │ deactivate_user()   │                           │
│                    │ (admin)             │ (user/admin)        │                           │
│                    │                     │                     │                           │
│                    ▼                     │                     ▼                           │
│   ┌─────────────────────────────┐       │       ┌─────────────────────────────┐           │
│   │                             │       │       │                             │           │
│   │          SUSPENDED          │       │       │          INACTIVE           │           │
│   │                             │       │       │                             │           │
│   │  • Cannot create orders     │       │       │  • Account exists           │           │
│   │  • Cannot register meters   │       │       │  • No operations allowed    │           │
│   │  • Existing meters frozen   │       │       │  • Historical data retained │           │
│   │  • Can view balances        │       │       │                             │           │
│   │                             │       │       │                             │           │
│   └──────────────┬──────────────┘       │       └─────────────────────────────┘           │
│                  │                      │                                                  │
│                  │ reactivate_user()    │                                                  │
│                  │ (admin)              │                                                  │
│                  │                      │                                                  │
│                  └──────────────────────┘                                                  │
│                                                                                             │
│                                                                                             │
│   TRANSITION TABLE:                                                                         │
│   ═══════════════════════════════════════════════════════════════════════════════════════  │
│   │ From State │ Event              │ To State  │ Guard Condition      │ Action          │ │
│   ├────────────┼────────────────────┼───────────┼──────────────────────┼─────────────────┤ │
│   │ (none)     │ register_user      │ Active    │ user_type valid      │ Create PDA      │ │
│   │ Active     │ suspend_user       │ Suspended │ caller = admin       │ Freeze meters   │ │
│   │ Active     │ deactivate_user    │ Inactive  │ caller = owner/admin │ Close orders    │ │
│   │ Suspended  │ reactivate_user    │ Active    │ caller = admin       │ Unfreeze meters │ │
│   ═══════════════════════════════════════════════════════════════════════════════════════  │
│                                                                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Meter Account State Machine

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              METER ACCOUNT STATE MACHINE                                    │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│                                    ┌───────────────┐                                       │
│                                    │   (START)     │                                       │
│                                    └───────┬───────┘                                       │
│                                            │                                                │
│                                            │ register_meter()                              │
│                                            │                                                │
│                                            ▼                                                │
│                          ┌─────────────────────────────────────┐                           │
│                          │                                     │                           │
│                          │              ACTIVE                 │                           │
│                          │                                     │                           │
│                          │  • Receives oracle readings         │                           │
│                          │  • Accumulates generation/          │                           │
│                          │    consumption                      │                           │
│                          │  • Can be settled for tokens        │                           │
│                          │  • Eligible for ERC issuance        │                           │
│                          │                                     │                           │
│                          └───────────────┬─────────────────────┘                           │
│                                          │                                                  │
│               ┌──────────────────────────┼──────────────────────────┐                      │
│               │                          │                          │                      │
│               │ set_maintenance()        │ deactivate_meter()       │                      │
│               │ (owner/admin)            │ (owner/admin)            │                      │
│               │                          │                          │                      │
│               ▼                          │                          ▼                      │
│   ┌───────────────────────────┐         │         ┌───────────────────────────┐           │
│   │                           │         │         │                           │           │
│   │       MAINTENANCE         │         │         │         INACTIVE          │           │
│   │                           │         │         │                           │           │
│   │  • No new readings        │         │         │  • Meter decommissioned   │           │
│   │  • No settlement          │         │         │  • Historical data kept   │           │
│   │  • Pending readings held  │         │         │  • Cannot reactivate      │           │
│   │  • Owner can fix issues   │         │         │                           │           │
│   │                           │         │         │                           │           │
│   └────────────┬──────────────┘         │         └───────────────────────────┘           │
│                │                        │                                                  │
│                │ clear_maintenance()    │                                                  │
│                │ (owner/admin)          │                                                  │
│                │                        │                                                  │
│                └────────────────────────┘                                                  │
│                                                                                             │
│                                                                                             │
│   STATE DETAILS:                                                                            │
│   ─────────────                                                                             │
│                                                                                             │
│   ACTIVE:                                                                                   │
│   • last_reading_at: Updated on each oracle submission                                     │
│   • total_generation: Monotonically increasing                                             │
│   • total_consumption: Monotonically increasing                                            │
│   • settled_net_generation: Updated on settlement                                          │
│   • claimed_erc_generation: Updated on ERC issuance                                        │
│                                                                                             │
│   MAINTENANCE:                                                                              │
│   • Oracle readings are rejected with error                                                │
│   • Settlement blocked                                                                      │
│   • Counters frozen                                                                         │
│                                                                                             │
│   INACTIVE:                                                                                 │
│   • Terminal state                                                                          │
│   • Account can be closed (rent returned)                                                  │
│                                                                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Order State Machine

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 ORDER STATE MACHINE                                         │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│                                    ┌───────────────┐                                       │
│                                    │   (START)     │                                       │
│                                    └───────┬───────┘                                       │
│                                            │                                                │
│                                            │ create_sell_order() / create_buy_order()      │
│                                            │ [validate ERC, lock tokens in escrow]         │
│                                            │                                                │
│                                            ▼                                                │
│                          ┌─────────────────────────────────────┐                           │
│                          │                                     │                           │
│                          │              ACTIVE                 │                           │
│                          │                                     │                           │
│                          │  • Listed in order book             │                           │
│                          │  • Visible to other traders         │                           │
│                          │  • Tokens held in escrow            │                           │
│                          │  • Can be matched                   │                           │
│                          │                                     │                           │
│                          │  amount: X                          │                           │
│                          │  filled_amount: 0                   │                           │
│                          │                                     │                           │
│                          └───────────────┬─────────────────────┘                           │
│                                          │                                                  │
│           ┌──────────────────────────────┼──────────────────────────┐                      │
│           │                              │                          │                      │
│           │ partial_match()              │ full_match()             │ cancel_order()       │
│           │ [matched < amount]           │ [matched = amount]       │ [owner request]      │
│           │                              │                          │                      │
│           ▼                              ▼                          │                      │
│   ┌───────────────────────┐    ┌───────────────────────┐           │                      │
│   │                       │    │                       │           │                      │
│   │   PARTIALLY_FILLED    │    │      COMPLETED        │           │                      │
│   │                       │    │                       │           │                      │
│   │  • Still in order     │    │  • Order fulfilled    │           │                      │
│   │    book               │    │  • Escrow released    │           │                      │
│   │  • Remaining amount   │    │  • Trade recorded     │           │                      │
│   │    can be matched     │    │  • PDA can be closed  │           │                      │
│   │                       │    │                       │           │                      │
│   │  filled_amount: Y     │    │  filled_amount: X     │           │                      │
│   │  (0 < Y < X)          │    │  (Y = X)              │           │                      │
│   │                       │    │                       │           │                      │
│   └───────────┬───────────┘    └───────────────────────┘           │                      │
│               │                                                     │                      │
│               │ continue_match() / cancel_remaining()               │                      │
│               │                                                     │                      │
│               ├─────────────────────────────────────────────────────┤                      │
│               │                                                     │                      │
│               │ [matched + existing = amount]                       │ [owner/timeout]      │
│               │                                                     │                      │
│               ▼                                                     ▼                      │
│   ┌───────────────────────┐                            ┌───────────────────────┐          │
│   │                       │                            │                       │          │
│   │      COMPLETED        │                            │      CANCELLED        │          │
│   │                       │                            │                       │          │
│   │  (same as above)      │                            │  • Order removed      │          │
│   │                       │                            │  • Escrow returned    │          │
│   │                       │                            │  • PDA can be closed  │          │
│   │                       │                            │                       │          │
│   └───────────────────────┘                            └───────────────────────┘          │
│                                                                                             │
│                                        ┌───────────────────────┐                           │
│                      ─────────────────▶│                       │                           │
│                      [expires_at <     │       EXPIRED         │                           │
│                       current_time]    │                       │                           │
│                                        │  • Triggered by crank │                           │
│                                        │  • Escrow returned    │                           │
│                                        │  • Same as Cancelled  │                           │
│                                        │                       │                           │
│                                        └───────────────────────┘                           │
│                                                                                             │
│                                                                                             │
│   TRANSITION TABLE:                                                                         │
│   ═══════════════════════════════════════════════════════════════════════════════════════  │
│   │ From State       │ Event           │ To State         │ Side Effects                 │ │
│   ├──────────────────┼─────────────────┼──────────────────┼──────────────────────────────┤ │
│   │ (none)           │ create_*_order  │ Active           │ Lock tokens, emit event      │ │
│   │ Active           │ partial_match   │ PartiallyFilled  │ Update filled, transfer      │ │
│   │ Active           │ full_match      │ Completed        │ Transfer all, emit trade     │ │
│   │ Active           │ cancel_order    │ Cancelled        │ Refund escrow                │ │
│   │ Active           │ time_expire     │ Expired          │ Refund escrow (crank)        │ │
│   │ PartiallyFilled  │ continue_match  │ PartiallyFilled  │ Update filled, transfer      │ │
│   │ PartiallyFilled  │ final_match     │ Completed        │ Transfer remaining           │ │
│   │ PartiallyFilled  │ cancel_remain   │ Cancelled        │ Refund remaining             │ │
│   │ PartiallyFilled  │ time_expire     │ Expired          │ Refund remaining (crank)     │ │
│   ═══════════════════════════════════════════════════════════════════════════════════════  │
│                                                                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. ERC Certificate State Machine

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                            ERC CERTIFICATE STATE MACHINE                                    │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│                                    ┌───────────────┐                                       │
│                                    │   (START)     │                                       │
│                                    └───────┬───────┘                                       │
│                                            │                                                │
│                                            │ issue_erc()                                   │
│                                            │ [authority = PoA, energy >= min]              │
│                                            │                                                │
│                                            ▼                                                │
│                          ┌─────────────────────────────────────┐                           │
│                          │                                     │                           │
│                          │             PENDING                 │◀─────────────┐            │
│                          │                                     │              │            │
│                          │  • Certificate created              │              │            │
│                          │  • Awaiting validation              │              │            │
│                          │  • Cannot be used in trading        │              │            │
│                          │                                     │              │            │
│                          │  validated_for_trading: false       │              │            │
│                          │                                     │              │            │
│                          └───────────────┬─────────────────────┘              │            │
│                                          │                                     │            │
│               ┌──────────────────────────┼─────────────────────┐              │            │
│               │                          │                     │              │            │
│               │ validate_erc_for_        │ reject_erc()        │              │            │
│               │ trading()                │ [authority]         │              │            │
│               │ [authority]              │                     │              │            │
│               │                          │                     │              │            │
│               ▼                          │                     ▼              │            │
│   ┌───────────────────────────┐         │         ┌───────────────────────┐  │            │
│   │                           │         │         │                       │  │            │
│   │          VALID            │         │         │        REVOKED        │  │            │
│   │                           │         │         │                       │  │            │
│   │  • Can be used in sell    │         │         │  • Cannot be used     │  │            │
│   │    orders                 │         │         │  • Fraud/error        │  │            │
│   │  • Verifiable on-chain    │         │         │  • Reason recorded    │  │            │
│   │  • Can be transferred     │         │         │  • Terminal state     │  │            │
│   │                           │         │         │                       │  │            │
│   │  validated_for_trading:   │         │         │  revocation_reason:   │  │            │
│   │  true                     │         │         │  "string"             │  │            │
│   │                           │         │         │                       │  │            │
│   └───────────┬───────────────┘         │         └───────────────────────┘  │            │
│               │                         │                     ▲              │            │
│               │                         │                     │              │            │
│    ┌──────────┼─────────────────────────┼─────────────────────┤              │            │
│    │          │                         │                     │              │            │
│    │          │ transfer_erc()          │                     │ revoke_erc() │            │
│    │          │ [owner + new_owner]     │                     │ [authority]  │            │
│    │          │                         │                     │              │            │
│    │          │ (owner changes,         │                     │              │            │
│    │          │  state stays VALID)     │                     │              │            │
│    │          │                         │                     │              │            │
│    │          └─────────────────────────┼─────────────────────┘              │            │
│    │                                    │                                     │            │
│    │                                    │ [expires_at < current_time]         │            │
│    │                                    │ (automatic via crank)               │            │
│    │                                    │                                     │            │
│    │                                    ▼                                     │            │
│    │                       ┌───────────────────────────┐                     │            │
│    │                       │                           │                     │            │
│    │                       │         EXPIRED           │                     │            │
│    │                       │                           │                     │            │
│    │                       │  • Time-based expiration  │                     │            │
│    │                       │  • Cannot be used         │                     │            │
│    │                       │  • Can be renewed (→ new) │─────────────────────┘            │
│    │                       │  • Terminal state         │                                  │
│    │                       │                           │  renew_erc()                     │
│    │                       │  expires_at: past         │  [creates new certificate]      │
│    │                       │                           │                                  │
│    │                       └───────────────────────────┘                                  │
│    │                                                                                       │
│    │  OWNERSHIP TRANSFER FLOW:                                                            │
│    │  ─────────────────────────                                                           │
│    │                                                                                       │
│    │  Valid(owner=A) ──transfer_erc()──▶ Valid(owner=B)                                   │
│    │  transfer_count: N                  transfer_count: N+1                              │
│    │                                                                                       │
│    └───────────────────────────────────────────────────────────────────────────────────────│
│                                                                                             │
│                                                                                             │
│   VALIDATION REQUIREMENTS:                                                                  │
│   ════════════════════════                                                                  │
│   • Authority signature required                                                           │
│   • Oracle validation (if require_oracle_validation = true)                               │
│   • Meter data cross-check (unclaimed_generation >= energy_amount)                        │
│   • Certificate ID uniqueness check                                                        │
│                                                                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Auction State Machine

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                               AUCTION STATE MACHINE                                         │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│                                    ┌───────────────┐                                       │
│                                    │   (START)     │                                       │
│                                    └───────┬───────┘                                       │
│                                            │                                                │
│                                            │ initialize_auction()                          │
│                                            │ [authority]                                   │
│                                            │                                                │
│                                            ▼                                                │
│   ┌───────────────────────────────────────────────────────────────────────────────────┐   │
│   │                                                                                    │   │
│   │                              ORDER COLLECTION                                      │   │
│   │                                   (OPEN)                                           │   │
│   │                                                                                    │   │
│   │   ┌────────────────────────────────────────────────────────────────────────────┐  │   │
│   │   │                                                                             │  │   │
│   │   │  Window: 5 minutes (configurable)                                          │  │   │
│   │   │                                                                             │  │   │
│   │   │  Actions:                                                                   │  │   │
│   │   │  • submit_auction_sell_order() → Add to sell_orders[]                      │  │   │
│   │   │  • submit_auction_buy_order()  → Add to buy_orders[]                       │  │   │
│   │   │  • cancel_auction_order()      → Remove from orders[], refund              │  │   │
│   │   │                                                                             │  │   │
│   │   │  Data Collected:                                                            │  │   │
│   │   │  • Sell orders: [(price, amount, seller)]                                  │  │   │
│   │   │  • Buy orders:  [(price, amount, buyer)]                                   │  │   │
│   │   │  • All funds locked in escrow                                              │  │   │
│   │   │                                                                             │  │   │
│   │   └────────────────────────────────────────────────────────────────────────────┘  │   │
│   │                                                                                    │   │
│   └────────────────────────────────────────┬───────────────────────────────────────────┘   │
│                                            │                                                │
│                                            │ [current_time >= end_time]                    │
│                                            │ OR execute_auction_clearing() [crank]         │
│                                            │                                                │
│                                            ▼                                                │
│   ┌───────────────────────────────────────────────────────────────────────────────────┐   │
│   │                                                                                    │   │
│   │                                  CLEARING                                          │   │
│   │                                                                                    │   │
│   │   ┌────────────────────────────────────────────────────────────────────────────┐  │   │
│   │   │                                                                             │  │   │
│   │   │  Algorithm:                                                                 │  │   │
│   │   │                                                                             │  │   │
│   │   │  1. Sort sell_orders by price (ASC)  → Supply curve                        │  │   │
│   │   │  2. Sort buy_orders by price (DESC)  → Demand curve                        │  │   │
│   │   │                                                                             │  │   │
│   │   │     Price │                                                                 │  │   │
│   │   │           │         Supply                                                  │  │   │
│   │   │           │        /                                                        │  │   │
│   │   │      P*   │───────X────────  ← Clearing Price                              │  │   │
│   │   │           │      / \                                                        │  │   │
│   │   │           │     /   \                                                       │  │   │
│   │   │           │    /     Demand                                                 │  │   │
│   │   │           │   /       \                                                     │  │   │
│   │   │           └───────────────▶ Quantity                                        │  │   │
│   │   │                  Q*                                                         │  │   │
│   │   │                                                                             │  │   │
│   │   │  3. Find intersection (clearing price P*, clearing quantity Q*)            │  │   │
│   │   │  4. All orders at P* or better are matched                                 │  │   │
│   │   │                                                                             │  │   │
│   │   └────────────────────────────────────────────────────────────────────────────┘  │   │
│   │                                                                                    │   │
│   └────────────────────────────────────────┬───────────────────────────────────────────┘   │
│                                            │                                                │
│                                            │ [all matches processed]                       │
│                                            │                                                │
│                                            ▼                                                │
│   ┌───────────────────────────────────────────────────────────────────────────────────┐   │
│   │                                                                                    │   │
│   │                                 SETTLEMENT                                         │   │
│   │                                                                                    │   │
│   │   ┌────────────────────────────────────────────────────────────────────────────┐  │   │
│   │   │                                                                             │  │   │
│   │   │  For each matched pair (sell_order, buy_order):                            │  │   │
│   │   │                                                                             │  │   │
│   │   │  1. Calculate settlement:                                                   │  │   │
│   │   │     • matched_amount = min(sell_remaining, buy_remaining)                  │  │   │
│   │   │     • settlement_value = matched_amount × clearing_price                   │  │   │
│   │   │     • fee = settlement_value × fee_bps / 10000                             │  │   │
│   │   │                                                                             │  │   │
│   │   │  2. Execute transfers:                                                      │  │   │
│   │   │     • GRX: escrow(seller) → buyer                                          │  │   │
│   │   │     • THB: escrow(buyer) → seller (minus fee)                              │  │   │
│   │   │     • Fee: escrow(buyer) → fee_collector                                   │  │   │
│   │   │                                                                             │  │   │
│   │   │  3. Create TradeRecord                                                      │  │   │
│   │   │                                                                             │  │   │
│   │   │  4. Emit AuctionTrade event                                                │  │   │
│   │   │                                                                             │  │   │
│   │   └────────────────────────────────────────────────────────────────────────────┘  │   │
│   │                                                                                    │   │
│   └────────────────────────────────────────┬───────────────────────────────────────────┘   │
│                                            │                                                │
│                                            │ [settlement complete]                         │
│                                            │                                                │
│                                            ▼                                                │
│   ┌───────────────────────────────────────────────────────────────────────────────────┐   │
│   │                                                                                    │   │
│   │                                   CLOSED                                           │   │
│   │                                                                                    │   │
│   │   ┌────────────────────────────────────────────────────────────────────────────┐  │   │
│   │   │                                                                             │  │   │
│   │   │  Post-Auction:                                                              │  │   │
│   │   │                                                                             │  │   │
│   │   │  • Unmatched sell orders: GRX returned to seller                           │  │   │
│   │   │  • Unmatched buy orders: THB returned to buyer                             │  │   │
│   │   │  • Partially filled orders: Remaining amount returned                      │  │   │
│   │   │                                                                             │  │   │
│   │   │  Statistics Updated:                                                        │  │   │
│   │   │  • Market.last_clearing_price = P*                                         │  │   │
│   │   │  • Market.total_volume += Q*                                               │  │   │
│   │   │  • Market.total_trades += matched_count                                    │  │   │
│   │   │  • Market.price_history[] updated                                          │  │   │
│   │   │                                                                             │  │   │
│   │   │  Emit: AuctionCleared { clearing_price, total_volume, matched_orders }     │  │   │
│   │   │                                                                             │  │   │
│   │   └────────────────────────────────────────────────────────────────────────────┘  │   │
│   │                                                                                    │   │
│   └────────────────────────────────────────┬───────────────────────────────────────────┘   │
│                                            │                                                │
│                                            │ next_auction_cycle()                          │
│                                            │ [scheduled by crank]                          │
│                                            │                                                │
│                                            └────────────────────────▶ (BACK TO OPEN)       │
│                                                                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Oracle Data State Machine

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              ORACLE DATA STATE MACHINE                                      │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│                                    ┌───────────────┐                                       │
│                                    │   (START)     │                                       │
│                                    └───────┬───────┘                                       │
│                                            │                                                │
│                                            │ initialize()                                  │
│                                            │ [authority, api_gateway]                      │
│                                            │                                                │
│                                            ▼                                                │
│   ┌───────────────────────────────────────────────────────────────────────────────────┐   │
│   │                                                                                    │   │
│   │                                   ACTIVE                                           │   │
│   │                              (active = true)                                       │   │
│   │                                                                                    │   │
│   │  ┌──────────────────────────────────────────────────────────────────────────────┐ │   │
│   │  │                                                                               │ │   │
│   │  │  Operational State:                                                           │ │   │
│   │  │  • Accepting meter readings from API Gateway                                 │ │   │
│   │  │  • Validating readings (min/max, anomaly detection)                          │ │   │
│   │  │  • Updating Registry via CPI                                                 │ │   │
│   │  │  • Triggering market clearing                                                │ │   │
│   │  │                                                                               │ │   │
│   │  │  Key Fields:                                                                  │ │   │
│   │  │  • total_readings: Incremented on each submission                            │ │   │
│   │  │  • total_valid_readings: Passed validation                                   │ │   │
│   │  │  • total_rejected_readings: Failed validation                                │ │   │
│   │  │  • last_reading_timestamp: Most recent reading                               │ │   │
│   │  │  • last_clearing: Most recent market clearing                                │ │   │
│   │  │                                                                               │ │   │
│   │  └──────────────────────────────────────────────────────────────────────────────┘ │   │
│   │                                                                                    │   │
│   │                           │                          │                             │   │
│   │     update_oracle_status()│                          │ update_oracle_status()      │   │
│   │     (active=false)        │                          │ (active=true)               │   │
│   │                           ▼                          │                             │   │
│   │   ┌─────────────────────────────────────────────┐   │                             │   │
│   │   │                                             │   │                             │   │
│   │   │                  PAUSED                     │───┘                             │   │
│   │   │              (active = false)              │                                  │   │
│   │   │                                             │                                  │   │
│   │   │  • All reading submissions rejected         │                                  │   │
│   │   │  • Market clearing blocked                  │                                  │   │
│   │   │  • Administrative functions still work     │                                  │   │
│   │   │                                             │                                  │   │
│   │   └─────────────────────────────────────────────┘                                  │   │
│   │                                                                                    │   │
│   └────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                             │
│                                                                                             │
│   READING SUBMISSION STATE FLOW:                                                            │
│   ══════════════════════════════                                                            │
│                                                                                             │
│   ┌───────────────┐     ┌───────────────┐     ┌───────────────┐     ┌───────────────┐     │
│   │   RECEIVED    │────▶│   VALIDATED   │────▶│   COMMITTED   │────▶│   SETTLED     │     │
│   │               │     │               │     │               │     │               │     │
│   │ API Gateway   │     │ min/max check │     │ Registry CPI  │     │ Token mint    │     │
│   │ submits       │     │ anomaly check │     │ updates meter │     │ (later)       │     │
│   └───────────────┘     └───────────────┘     └───────────────┘     └───────────────┘     │
│          │                     │                                                           │
│          │                     │ [validation failed]                                       │
│          │                     ▼                                                           │
│          │              ┌───────────────┐                                                  │
│          │              │   REJECTED    │                                                  │
│          │              │               │                                                  │
│          │              │ Event emitted │                                                  │
│          │              │ with reason   │                                                  │
│          │              └───────────────┘                                                  │
│          │                                                                                  │
│   Validation Rules:                                                                         │
│   • energy_produced >= min_energy_value                                                    │
│   • energy_produced <= max_energy_value                                                    │
│   • reading_timestamp <= current_time + 60s (no future readings)                          │
│   • Anomaly: |reading - last_reading| < max_deviation_percent × last_reading              │
│                                                                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Governance Emergency State Machine

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                         GOVERNANCE EMERGENCY STATE MACHINE                                  │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────────────────────┐  │
│   │                                                                                      │  │
│   │                                   OPERATIONAL                                        │  │
│   │                     (emergency_paused=false, maintenance_mode=false)                │  │
│   │                                                                                      │  │
│   │  • All functions available                                                          │  │
│   │  • ERC issuance enabled (if erc_validation_enabled=true)                           │  │
│   │  • Trading operations normal                                                        │  │
│   │                                                                                      │  │
│   └───────────────────────────────────────────┬─────────────────────────────────────────┘  │
│                                               │                                             │
│                  ┌────────────────────────────┴────────────────────────────┐               │
│                  │                                                         │               │
│                  │ set_maintenance_mode(true)                              │ emergency_    │
│                  │ [authority, planned]                                    │ pause()       │
│                  │                                                         │ [authority,   │
│                  │                                                         │  urgent]      │
│                  ▼                                                         ▼               │
│   ┌─────────────────────────────────────┐      ┌─────────────────────────────────────┐   │
│   │                                     │      │                                     │   │
│   │          MAINTENANCE MODE           │      │         EMERGENCY PAUSED            │   │
│   │     (maintenance_mode=true)         │      │      (emergency_paused=true)        │   │
│   │                                     │      │                                     │   │
│   │  • Soft pause for upgrades          │      │  • Hard stop - security event       │   │
│   │  • ERC issuance blocked             │      │  • ALL operations blocked           │   │
│   │  • Existing orders can complete     │      │  • Emergency timestamp recorded     │   │
│   │  • Read operations allowed          │      │  • Only emergency_unpause works     │   │
│   │                                     │      │                                     │   │
│   │  Use Case:                          │      │  Use Case:                          │   │
│   │  • Program upgrades                 │      │  • Security breach                  │   │
│   │  • Configuration changes            │      │  • Bug discovery                    │   │
│   │  • Scheduled maintenance            │      │  • Attack in progress               │   │
│   │                                     │      │                                     │   │
│   └──────────────┬──────────────────────┘      └──────────────┬──────────────────────┘   │
│                  │                                            │                          │
│                  │ set_maintenance_mode(false)                │ emergency_unpause()      │
│                  │ [authority]                                │ [authority]              │
│                  │                                            │                          │
│                  └────────────────────────────┬───────────────┘                          │
│                                               │                                           │
│                                               ▼                                           │
│                                   ┌───────────────────┐                                  │
│                                   │    OPERATIONAL    │                                  │
│                                   └───────────────────┘                                  │
│                                                                                           │
│                                                                                           │
│   STATE CHECK FUNCTION:                                                                   │
│   ═════════════════════                                                                   │
│                                                                                           │
│   pub fn is_operational(&self) -> bool {                                                 │
│       !self.emergency_paused && !self.maintenance_mode                                   │
│   }                                                                                       │
│                                                                                           │
│   pub fn can_issue_erc(&self) -> bool {                                                  │
│       self.is_operational() && self.erc_validation_enabled                              │
│   }                                                                                       │
│                                                                                           │
│                                                                                           │
│   GUARD IMPLEMENTATION:                                                                   │
│   ═════════════════════                                                                   │
│                                                                                           │
│   #[access_control(require_operational(&ctx.accounts.poa_config))]                       │
│   pub fn issue_erc(...) -> Result<()> {                                                  │
│       // ... issue certificate                                                           │
│   }                                                                                       │
│                                                                                           │
│   fn require_operational(config: &PoAConfig) -> Result<()> {                            │
│       require!(config.is_operational(), GovernanceError::SystemPaused);                 │
│       Ok(())                                                                             │
│   }                                                                                       │
│                                                                                           │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Related Documentation

- [Architecture Diagrams](./architecture.md) - System overview
- [Sequence Diagrams](./sequences.md) - Transaction flow sequences
- [Entity Relationship](./entity-relationship.md) - Account data models
- [Network Topology](./network-topology.md) - Infrastructure layout
