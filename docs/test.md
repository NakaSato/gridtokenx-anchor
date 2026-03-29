Batch Processing Flow Diagram

      1 ┌─────────────────────────────────────────────────────────────────┐
      2 │                    BATCH PROCESSING LIFECYCLE                    │
      3 └─────────────────────────────────────────────────────────────────┘
      4
      5 Phase 1: ACCUMULATION (Continuous)
      6 ═══════════════════════════════════════════════════════════════════
      7   User A ──┐
      8   User B ──┼──> submit_limit_order ──> Order Account Created
      9   User C ──┤
     10            │
     11            ▼
     12   ┌─────────────────────────────────────────────────────────┐
     13   │  add_order_to_batch (O(1) per order)                    │
     14   │  ├─ Check batch_config.enabled                          │
     15   │  ├─ If no batch: create new BatchInfo                   │
     16   │  ├─ Validate: batch not expired                         │
     17   │  ├─ Validate: order_count < max_batch_size (100)        │
     18   │  └─ Add order_id to current_batch.order_ids[]           │
     19   └─────────────────────────────────────────────────────────┘
     20            │
     21            ▼
     22   Batch State:
     23   ┌──────────────────────────────────────────────┐
     24   │ batch_id: 42                                 │
     25   │ order_count: 15                              │
     26   │ total_volume: 4,500 kWh                      │
     27   │ created_at: 1710584400                       │
     28   │ expires_at: 1710584700  (5 min window)       │
     29   │ order_ids: [0x123, 0x456, ...]               │
     30   └──────────────────────────────────────────────┘
     31
     32 Phase 2: TRIGGER (Off-chain Agent)
     33 ═══════════════════════════════════════════════════════════════════
     34   Conditions:
     35   ├─ order_count >= min_batch_size (5) ✓
     36   ├─ time_remaining < 30 seconds ✓
     37   └─ OR manual trigger
     38
     39   ▼
     40   Off-chain Matching Agent:
     41   ├─ Fetch all orders in batch
     42   ├─ Run matching algorithm (supply-demand intersection)
     43   ├─ Calculate match_pairs: Vec<MatchPair>
     44   └─ Submit execute_batch instruction
     45
     46 Phase 3: EXECUTION (On-chain)
     47 ═══════════════════════════════════════════════════════════════════
     48   ┌─────────────────────────────────────────────────────────┐
     49   │  execute_batch(match_pairs: Vec<MatchPair>)             │
     50   │  ├─ Validate: batch exists & not empty                  │
     51   │  ├─ Validate: match_pairs.len() == order_count          │
     52   │  ├─ Accumulate total_volume (saturating_add)            │
     53   │  ├─ Update market.total_volume                          │
     54   │  ├─ Update market.total_trades += 1                     │
     55   │  ├─ Set clearing_price = match_pairs[0].price           │
     56   │  └─ Clear batch (has_current_batch = 0)                 │
     57   └─────────────────────────────────────────────────────────┘
     58            │
     59            ▼
     60   emit!(BatchExecuted {
     61     batch_id: 42,
     62     order_count: 15,
     63     total_volume: 4500,
     64     timestamp: 1710584685
     65   })
     66
     67 Phase 4: SETTLEMENT (Atomic)
     68 ═══════════════════════════════════════════════════════════════════
     69   For each MatchPair in match_pairs:
     70   ├─ Transfer energy: Seller ERC → Buyer ERC
     71   ├─ Transfer currency: Buyer GRX → Seller GRX
     72   ├─ Deduct fee: market_fee_bps (0.25% = 25 bps)
     73   ├─ Update order status: Active → Completed/PartiallyFilled
     74   └─ Emit OrderMatched event

    ---

    Algorithm Comparison Table


    ┌──────────────────────┬─────────────────┬──────────────────┬────────────────────────┬───────────────────────────────┐
    │ Algorithm            │ Time Complexity │ Space Complexity │ Gas Cost               │ Use Case                      │
    ├──────────────────────┼─────────────────┼──────────────────┼────────────────────────┼───────────────────────────────┤
    │ `add_order_to_batch`     │ O(1)            │ O(1)             │ ~5,000 CU              │ Accumulating orders for batch │
    │ `execute_batch`        │ O(n)            │ O(n)             │ ~15,000 CU + transfers │ Executing matched batch       │
    │ `clear_auction` (spec) │ O(m × k)        │ O(m + k)         │ ~50,000+ CU            │ Periodic auction clearing     │
    │ `update_depth`         │ O(n)            │ O(1)             │ ~8,000 CU              │ Order book depth tracking     │
    │ `match_orders` (CDA)   │ O(1)            │ O(1)             │ ~10,000 CU             │ Continuous matching           │
    └──────────────────────┴─────────────────┴──────────────────┴────────────────────────┴───────────────────────────────┘


    Note: CU = Compute Units (Solana gas metric)

    ---

    Key Design Decisions

    1. Batch Processing vs Continuous Matching

     1 // Batch Config (from initialize_market)
     2 BatchConfig {
     3     enabled: 0,                    // Disabled by default
     4     max_batch_size: 100,           // Max orders per batch
     5     batch_timeout_seconds: 300,    // 5 minute accumulation window
     6     min_batch_size: 5,             // Minimum to trigger execution
     7 }

    Trade-offs:

    ┌──────────────────┬────────────────────────────────────────────┬──────────────────────────────┐
    │ Approach         │ Pros                                       │ Cons                         │
    ├──────────────────┼────────────────────────────────────────────┼──────────────────────────────┤
    │ Batch            │ MEV resistance, uniform pricing, lower gas │ Latency (5 min delay)        │
    │ Continuous (CDA) │ Instant execution, simple                  │ Higher gas, price volatility │
    └──────────────────┴────────────────────────────────────────────┴──────────────────────────────┘


    2. Clearing Price Mechanisms

    ┌─────────────────┬───────────────────────────────────────┬────────────────────────┐
    │ Mechanism       │ Formula                               │ Production Status      │
    ├─────────────────┼───────────────────────────────────────┼────────────────────────┤
    │ Pay-as-Seller   │ clearing_price = sell_order.price_per_kwh │ ✅ ACTIVE (P2P trades) │
    │ Uniform Auction │ P* : S(P) = D(P)                      │ 📋 Specified (future)  │
    │ VWAP            │ Σ(Pᵢ × Vᵢ) / ΣVᵢ                      │ 📊 Reference only      │
    └─────────────────┴───────────────────────────────────────┴────────────────────────┘


    3. Sharding for Contention Reduction

     1 // Instead of updating global Market, update shard
     2 zone_shard.volume_accumulated += actual_match_amount;
     3 zone_shard.trade_count += 1;
     4 zone_shard.last_clearing_price = clearing_price;

    Benefit: Parallel writes without MVCC conflicts


     Summary Table: All Trading Algorithms


    ┌────┬───────────────────────────┬────────┬────────┬─────────────────────┐
    │ #  │ Algorithm                 │ Time   │ Space  │ Production Status   │
    ├────┼───────────────────────────┼────────┼────────┼─────────────────────┤
    │ 1  │ match_orders (CDA)        │ O(1)   │ O(1)   │ ✅ Active           │
    │ 2  │ update_price_history (VWAP) │ O(n)   │ O(1)   │ ✅ Active           │
    │ 3  │ sharded_match_orders        │ O(1)   │ O(1)   │ ✅ Active           │
    │ 4  │ settle_offchain_match       │ O(1)   │ O(1)   │ ✅ Active           │
    │ 5  │ submit_limit_order_sharded  │ O(1)   │ O(1)   │ ✅ Active           │
    │ 6  │ get_shard_id                │ O(1)   │ O(1)   │ ✅ Active           │
    │ 7  │ add_order_to_batch          │ O(1)   │ O(1)   │ ⚠️  Config-disabled  │
    │ 8  │ execute_batch             │ O(n)   │ O(n)   │ ⚠️  Config-disabled  │
    │ 9  │ clear_auction (spec)      │ O(m×k) │ O(m+k) │ 📋 Documented       │
    │ 10 │ update_depth              │ O(n)   │ O(1)   │ ✅ Active           │
    │ 11 │ calculate_fees            │ O(1)   │ O(1)   │ ✅ Active           │
    │ 12 │ deposit_to_escrow           │ O(1)   │ O(1)   │ ✅ Active (inline)  │
    │ 13 │ release_escrow            │ O(1)   │ O(1)   │ ✅ Active (inline)  │
    │ 14 │ refund_escrow             │ O(1)   │ O(1)   │ ✅ Active (inline)  │
    │ 15 │ volume_discount_fee         │ O(1)   │ O(1)   │ 🔮 Future (Q3 2026) │
    └────┴───────────────────────────┴────────┴────────┴─────────────────────┘
