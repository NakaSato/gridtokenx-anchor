# TPC-C Benchmark Program

## Abstract

The `tpc-benchmark` program is an on-chain implementation of the TPC-C benchmark — the Transaction Processing Performance Council's Benchmark C, the canonical Online Transaction Processing (OLTP) workload modelling a wholesale order-entry environment — adapted to the Solana account model using the Anchor framework. It maps the TPC-C relational schema onto Program-Derived Addresses (PDAs) and implements the five standard TPC-C business transactions (New-Order, Payment, Order-Status, Delivery, Stock-Level) together with load-phase initialization and benchmark-control instructions. Its purpose is to stress-test OLTP throughput and concurrency behaviour on a permissioned Solana cluster, exposing the Sealevel runtime's parallelism and contention characteristics under a write-heavy mix. The program is a research and measurement harness; the source header explicitly designates it for "enterprise blockchain research" on a permissioned environment (`programs/tpc-benchmark/src/lib.rs:33-37`) and it is not a production component of the GridTokenX platform.

## 1. Program Identity

| Property | Value |
|----------|-------|
| Program ID | `ELv3cWARDqNLgv7A7dochy2CC4Ke9wdgAHvkU3wCwQha` |
| Crate name | `tpc-benchmark` (library name `tpc_benchmark`) |
| Crate version | `0.1.1` |
| Framework | `anchor-lang` 1.0.0 |

The program ID is declared via `declare_id!("ELv3cWARDqNLgv7A7dochy2CC4Ke9wdgAHvkU3wCwQha")` at `programs/tpc-benchmark/src/lib.rs:50`, and is registered under `[programs.localnet]` as `tpc_benchmark` at `Anchor.toml:13`. The crate name, version, library name, and `anchor-lang` dependency are defined at `programs/tpc-benchmark/Cargo.toml:2`, `:3`, `:12`, and `:27` respectively. The crate enables checked arithmetic for release builds via `[profile.release] overflow-checks = true` (`Cargo.toml:33-34`), conforming to the repository invariant that prevents silent wrapping under `cargo build-sbf`.

## 2. System Role

The program implements the TPC-C transaction mix on Solana in order to measure OLTP throughput, latency, and concurrency contention under a write-dominated workload. TPC-C is centred on an order-entry environment in which a population of terminal operators execute transactions against a database (`lib.rs:8-10`); this implementation reproduces that environment as on-chain accounts and instructions so that the Sealevel parallel runtime can be exercised and profiled.

The five standard TPC-C transactions and their specified frequencies, declared as constants in `tpc_constants` (`lib.rs:65-94`), are:

| Transaction | Frequency | Profile | Constant (`lib.rs`) |
|-------------|-----------|---------|---------------------|
| New-Order | 45% | Write-heavy; high contention on `District.next_o_id` | `NEW_ORDER_FREQ` (`:68`) |
| Payment | 43% | Write-heavy; updates year-to-date (YTD) balances | `PAYMENT_FREQ` (`:70`) |
| Order-Status | 4% | Read-only | `ORDER_STATUS_FREQ` (`:72`) |
| Delivery | 4% | Batch processing across 10 districts per warehouse | `DELIVERY_FREQ` (`:74`) |
| Stock-Level | 4% | Read-only aggregation query | `STOCK_LEVEL_FREQ` (`:76`) |

The program documents itself as targeting a Solana Permissioned Environment (SPE) emulating Proof-of-Authority (PoA) consensus with a fixed validator set (`lib.rs:33-37`), consistent with the GridTokenX localnet's permissioned PoA cluster.

## 3. State Model

The state module maps the TPC-C relational schema to Solana's key-value account model under four stated design principles (`state.rs:5-18`): state fragmentation (each logical row becomes a separate account to permit parallel access under Sealevel), deterministic PDA addressing from primary keys (O(1) lookup without on-chain indexes), embedded one-to-many relationships (order lines embedded as a fixed array rather than separate accounts), and fixed-size allocation (maximum-size allocation to avoid reallocation).

Most hot-path tables use Anchor's zero-copy representation: `#[account(zero_copy)] #[repr(C)]` with manual `_padding` fields for 8-byte alignment, accessed through `AccountLoader` and `load()`/`load_mut()`/`load_init()`. Fixed-width `[u8; N]` byte arrays replace `String`, converted via `string_to_bytes` / `bytes_to_string` (`state.rs:28-40`). Space for zero-copy accounts is computed as `8 + std::mem::size_of::<T>()` (the 8-byte Anchor discriminator plus the Pod struct size). Two accounts that carry a variable-length `Vec` — `CustomerLastNameIndex` and `NewOrderEntry` — use the regular `#[account]` representation with manually computed `SPACE`.

### 3.1 TPC-C table to account mapping

The canonical mapping is documented in `lib.rs:14-23`:

| TPC-C table | Account struct | PDA seeds | Representation |
|-------------|----------------|-----------|----------------|
| WAREHOUSE | `Warehouse` | `["warehouse", w_id]` | zero-copy |
| DISTRICT | `District` | `["district", w_id, d_id]` | zero-copy |
| CUSTOMER | `Customer` | `["customer", w_id, d_id, c_id]` | zero-copy |
| ITEM | `Item` | `["item", i_id]` | zero-copy |
| STOCK | `Stock` | `["stock", w_id, i_id]` | zero-copy |
| ORDER | `Order` (with embedded `OrderLine[15]`) | `["order", w_id, d_id, o_id]` | zero-copy |
| NEW_ORDER | `NewOrderEntry` | `["new_order", w_id, d_id, o_id]` | regular |
| HISTORY | `History` | `["history", w_id, d_id, h_id]` | zero-copy |
| (secondary index) | `CustomerLastNameIndex` | `["idx_c_last", w_id, d_id, hash(c_last)]` | regular |

All PDA seed components derived from integer keys use little-endian encoding (`*.to_le_bytes()`), e.g. the warehouse seed at `new_order.rs:48`.

### 3.2 Account structures

**`Warehouse`** (`state.rs:127-165`). Fields: `w_id` (W_ID), fixed-width `name`/`street_1`/`street_2`/`city`/`state`/`zip`, `tax` (W_TAX), `ytd` (W_YTD, year-to-date sales), and `bump`. Contention profile is documented as MODERATE because every Payment to a warehouse updates `ytd` (`state.rs:124-126`). `SPACE = 8 + size_of::<Warehouse>()` (`state.rs:164`).

**`District`** (`state.rs:178-221`). Fields mirror `Warehouse` plus `d_id` (D_ID) and `next_o_id` (D_NEXT_O_ID, the next available order ID). It is documented as the HIGH-contention critical synchronization point: every New-Order increments `next_o_id`, serializing all New-Order transactions for a district; parallelism is achieved across districts, not within one (`state.rs:174-177`).

**`Customer`** (`state.rs:243-316`). Identity (`w_id`, `d_id`, `c_id`) plus name fields, address, `phone`, `since` (C_SINCE), `credit` (C_CREDIT, `u8`: 0 = GoodCredit, 1 = BadCredit), `credit_lim`, `discount`, signed `balance` (C_BALANCE), `ytd_payment`, `payment_cnt`, `delivery_cnt`, and a 512-byte `data` field (C_DATA, "max 500, using 512 for Pod", `state.rs:306-307`). Contention profile LOW (`state.rs:240-242`).

**`Item`** (`state.rs:367-392`). Read-only catalogue product: `i_id`, `im_id` (I_IM_ID, image ID), `name`, `price`, `data`. Documented as READ-ONLY after initialization, safe for parallel access (`state.rs:364-366`).

**`Stock`** (`state.rs:405-447`). Per-(warehouse, item) inventory: `w_id`, `i_id`, `quantity` (S_QUANTITY), ten 32-byte district-data strings `dist_01`..`dist_10`, `ytd` (S_YTD), `order_cnt`, `remote_cnt`, and `data`. Contention profile HIGH — updated by every New-Order including the item, with popular items becoming hot spots under TPC-C's skewed (zipfian) item selection (`state.rs:401-404`).

**`Order`** and **`OrderLine`** (`state.rs:462-533`). `Order` carries identity (`w_id`, `d_id`, `o_id`, `c_id`), `entry_d`, `carrier_id` (0 when undelivered), `ol_cnt` (5–15), `all_local`, `bump`, and an embedded fixed array `lines: [OrderLine; 15]`. Embedding the order lines avoids separate ORDER_LINE accounts, reducing per-transaction account count and loading overhead (`state.rs:460-461`, `:489-492`). `OrderLine` (`state.rs:497-526`) holds `number`, `i_id`, `supply_w_id`, `delivery_d`, `amount`, 32-byte `dist_info`, and `quantity`, with explicit padding to maintain `u64` alignment. `MAX_ORDER_LINES = 15` (`state.rs:530`). Contention profile LOW — created once, then `carrier_id` set once during Delivery (`state.rs:456-459`).

**`NewOrderEntry`** (`state.rs:547-568`). A regular `#[account]` queue entry tracking an order awaiting delivery: `w_id`, `d_id`, `o_id`, `created_at`, `bump`. It functions as a queue: Delivery processes the oldest entry and closes the account (`state.rs:544-546`). Contention profile HIGH — created by New-Order, deleted by Delivery (`state.rs:542-543`).

**`History`** (`state.rs:580-614`). Zero-copy payment audit record: customer identity (`c_w_id`, `c_d_id`, `c_id`), transaction location (`w_id`, `d_id`), `h_id`, `date`, `amount`, and a 32-byte `data` string. Contention profile LOW (write-once) (`state.rs:577`).

**`CustomerLastNameIndex`** (`state.rs:329-355`). A secondary index supplementing the absence of native secondary indexes on Solana, required because TPC-C specifies that 60% of Payment and Order-Status transactions look up the customer by last name (`state.rs:322-328`). It stores `w_id`, `d_id`, a 32-byte `last_name_hash`, and a `Vec<u64> customer_ids` (to handle non-unique last names; the spec selects the middle customer in sorted order). `MAX_CUSTOMERS_PER_NAME = 20` bounds the vector and the `SPACE` calculation (`state.rs:347-354`).

**`BenchmarkState`** (`state.rs:46-66`), a regular `#[account]` singleton at seeds `["benchmark"]`, holds `authority`, an embedded `BenchmarkConfig` (`state.rs:69-85`: `warehouses` scale factor, `districts_per_warehouse`, `customers_per_district`, `total_items`, `duration_seconds`, `warmup_percent`, `use_real_transactions`), running `BenchmarkStats` (`state.rs:88-115`: per-transaction counts, success/failure totals, conflict count, latency aggregates, and computed `tpm_c`), run-control fields (`is_running`, `start_time`, `end_time`), and `bump`. Auxiliary serialized types include the `TransactionType` enum (`state.rs:621-628`), `TransactionMetrics` with a 10-bucket latency histogram (`state.rs:631-651`), and `OrderLineInput` (the New-Order line argument: `i_id`, `supply_w_id`, `quantity`; `state.rs:654-662`).

## 4. Instruction Set

The program module declares all entry points at `programs/tpc-benchmark/src/lib.rs:96-314`. Each handler body is wrapped in `compute_fn!` for compute-unit profiling, which is a no-op unless the `localnet` feature is enabled (`lib.rs:52-63`). Initialization (load-phase) instructions populate the schema; the five transaction instructions implement the workload; the benchmark-control instructions manage measurement state.

### 4.1 Load-phase initialization

These instructions are not part of the measured transaction mix; they populate the schema during the load phase (`initialize.rs:3-4`).

- **`initialize_benchmark`** (`initialize.rs:31-47`) — creates the `["benchmark"]` singleton, stores authority and config, zeroes statistics.
- **`initialize_warehouse`** (`initialize.rs:71-100`) — creates a `Warehouse`; validates `w_id > 0` and `tax <= 2000` basis points; seeds W_YTD to `300_000_00` (`:95`).
- **`initialize_district`** (`initialize.rs:131-162`) — creates a `District` after verifying the parent warehouse PDA; validates `d_id` in 1..=10 and tax bound; seeds D_YTD to `30_000_00` and `next_o_id = 3001` (`:157-158`), matching the TPC-C convention that the first 3000 orders per district are preloaded.
- **`initialize_customer`** (`initialize.rs:198-249`) — creates a `Customer` after verifying the parent district; validates `c_id` in 1..=3000 and `discount <= 5000`; seeds initial balance `-10_00`, `ytd_payment = 10_00`, `payment_cnt = 1` (`:241-243`).
- **`initialize_item`** (`initialize.rs:273-294`) — creates an `Item`; validates `i_id` in 1..=100000.
- **`initialize_stock`** (`initialize.rs:333-373`) — creates a `Stock` after verifying both parent warehouse and item; stores quantity and the ten district-data strings.
- **`initialize_customer_index`** (`initialize.rs:402-418`) — creates an empty `CustomerLastNameIndex` for last-name lookups.

### 4.2 New-Order (`new_order`)

Handler at `new_order.rs:136-325`; context `NewOrder<'info>` at `new_order.rs:39-123`. Per the TPC-C specification this is the most critical transaction: it drives the primary metric (tpmC) and tests write-contention handling (`new_order.rs:2-6`).

- **Accounts.** Reads `warehouse` (tax) and `customer` (discount); takes a write lock on `district` to increment `next_o_id` (`new_order.rs:53-60`); `init`s the `order` (space `Order::SPACE`, allocated for the full 15 lines) and `new_order` queue entry. Variable Item/Stock accounts are passed via `remaining_accounts` in the layout `[item_1, stock_1, …, item_n, stock_n]` (`new_order.rs:111-123`).
- **Effects.** Validates 5–15 order lines and that `remaining_accounts.len() == ol_cnt * 2` (`new_order.rs:148-159`); validates each quantity in 1..=10 (`:162-164`). Increments `district.next_o_id` with `checked_add`, the documented serialization point (`new_order.rs:188-191`). Populates the `Order` and, per line, manually deserializes the Item (via `bytemuck::from_bytes`) and Stock (via `bytemuck::from_bytes_mut`) from `remaining_accounts`, verifying IDs, then adjusts stock quantity using the TPC-C restock rule (`stock.quantity >= quantity + 10 ? subtract : add 91 − quantity`, `new_order.rs:247-251`), and updates `ytd`, `order_cnt`, and `remote_cnt`/`all_local` for cross-warehouse supply (`:253-259`). Computes the order total with warehouse/district tax and customer discount applied in basis points using saturating arithmetic (`new_order.rs:300-306`).
- **What it stresses.** Serialized writes to `District.next_o_id` per district (parallelism across districts, bounded at 10 × W; `new_order.rs:10-16`) and contended writes to popular `Stock` accounts.

### 4.3 Payment (`payment`)

Handler at `payment.rs:99-187`; context `Payment<'info>` at `payment.rs:28-86`. Updates customer balance and records the payment in warehouse and district YTD totals.

- **Accounts.** Write locks on `warehouse`, `district`, and `customer` (the customer may reside in a different warehouse/district in ~15% of cases, `payment.rs:48`); `init`s a `History` record at `["history", w_id, d_id, h_id]`; an optional `customer_index` `UncheckedAccount` for last-name lookup (`payment.rs:77-80`).
- **Effects.** Requires `h_amount > 0` (`payment.rs:110`); adds the amount to `warehouse.ytd` and `district.ytd` and subtracts it (signed) from `customer.balance`, all with `checked_*` arithmetic; increments `ytd_payment` and `payment_cnt` (`payment.rs:122-150`); writes the History record with H_DATA composed of the warehouse and district names (`payment.rs:165-179`). The bad-credit C_DATA append specified by TPC-C is deliberately omitted to preserve the fixed-size zero-copy `Customer` layout (`payment.rs:152-159`).
- **What it stresses.** Serialized writes to `Warehouse.ytd` and `District.ytd` — all payments to a district contend on its YTD field (`payment.rs:8-15`).

### 4.4 Order-Status (`order_status`)

Handler at `order_status.rs:82-148`; context `OrderStatus<'info>` at `order_status.rs:20-44`. A read-only transaction retrieving a customer's most recent order status; it creates no write contention and runs fully in parallel (`order_status.rs:6-9`).

- **Accounts.** Reads `customer`; optional `order` and `customer_index` `UncheckedAccount`s (`order_status.rs:36-43`).
- **Effects.** Builds an `OrderStatusResult` from the customer and, if an order account is supplied, manually deserializes it (`bytemuck::from_bytes::<Order>`) and copies the order header and per-line fields, then logs the result via `msg!` (the result is logged rather than emitted as an event, `order_status.rs:104-145`).
- **What it stresses.** Read-path account loading and zero-copy deserialization under concurrent execution.

### 4.5 Delivery (`delivery`, `delivery_district`)

Two variants are provided because processing all 10 districts in one transaction may exceed Solana's default 200K compute-unit (CU) limit and approach the 1.4M CU maximum (`delivery.rs:6-16`).

- **`delivery`** (handler `delivery.rs:59-101`, context `:36-53`) — the full batch. It reads `warehouse` and consumes `remaining_accounts` in groups of three (`[new_order, order, customer]` per district), delegating to the helper `process_district_delivery` (`delivery.rs:233-288`), which manually deserializes the Order and Customer, sets `carrier_id` and per-line `delivery_d`, increments the customer balance and `delivery_cnt`, and manually closes the NewOrder account by zeroing its lamports and crediting the payer (`delivery.rs:275-281`).
- **`delivery_district`** (handler `delivery.rs:167-226`, context `:109-164`) — the Solana-native per-district variant, allowing parallel execution across districts. It uses Anchor's `close = payer` on the `new_order` account (`delivery.rs:121-132`) and derives the `order` and `customer` PDAs from `new_order.o_id` and `order.c_id` respectively (`:135-158`). It verifies the order is not already delivered (`carrier_id == 0`, `:184-187`), sets `carrier_id` and each line's `delivery_d`, sums line amounts into the customer balance with `checked_add`, and increments `delivery_cnt`.
- **What it stresses.** Batch account mutation and rent reclamation; the per-district form measures the trade-off between TPC-C's prescribed warehouse-batch semantics and Solana's per-account compute and locking model.

### 4.6 Stock-Level (`stock_level`)

Handler at `stock_level.rs:60-107`; context `StockLevel<'info>` at `stock_level.rs:22-34`. A read-only aggregation counting items below a stock threshold (`stock_level.rs:3-9`).

- **Accounts.** Reads `district` (for `next_o_id`, representing recent orders) and the Stock accounts to examine via `remaining_accounts` (`stock_level.rs:25-33`).
- **Effects.** Requires `threshold > 0` (`stock_level.rs:66`), then iterates `remaining_accounts`, manually deserializing each `Stock` and counting those with `quantity < threshold`; the count is logged via `msg!` rather than returned or emitted (`stock_level.rs:75-104`).
- **What it stresses.** Read-only aggregation over many accounts in a single transaction.

### 4.7 Benchmark control

- **`record_metric`** (handler `benchmark.rs:27-70`, context `:10-24`) — authority-gated update of `BenchmarkStats`: increments the per-`TransactionType` counter, the success/failure totals, the conflict count (driven by `retry_count`), and the latency aggregates (sum, min, max). Authorization is enforced by `constraint = authority.key() == benchmark.authority` (`benchmark.rs:20-22`).
- **`reset_benchmark`** (handler `benchmark.rs:90-100`, context `:73-87`) — authority-gated reset of statistics and run-control fields to defaults.

## 5. Methodology and TPC-C Mapping

The implementation reproduces the TPC-C transaction profile faithfully where the relational semantics permit, and adapts the data and execution model where Solana's account-based, single-writer-lock runtime requires it.

### 5.1 Faithful to the specification

- **Transaction set and weights.** All five transactions exist and the canonical 45/43/4/4/4 mix is encoded as named constants (`lib.rs:65-94`). Scale parameters are likewise specified: 10 districts per warehouse, 3000 customers per district, 100000 items, 1% remote orders, 60% last-name lookups (`lib.rs:83-93`).
- **Schema and keys.** Every TPC-C table has a corresponding account keyed by its primary key through deterministic PDA seeds (`lib.rs:14-23`), and parent-existence is enforced during load (e.g. district verifies warehouse, `initialize.rs:118-123`; stock verifies both warehouse and item, `:312-324`).
- **Business rules.** New-Order enforces the 5–15 line-count and 1–10 quantity bounds and applies the warehouse/district tax and customer discount (`new_order.rs:148-164`, `:300-306`); the spec's stock restock rule is implemented (`new_order.rs:247-251`); District `next_o_id` is preloaded to 3001 (`initialize.rs:158`). Payment maintains the warehouse, district, and customer YTD/balance invariants and writes a History record (`payment.rs:122-179`). Delivery processes the oldest undelivered order and removes its NewOrder queue entry (`delivery.rs:18-24`).

### 5.2 Adapted for the Solana account model

- **Row-per-account fragmentation.** Each TPC-C row becomes an independent PDA so the Sealevel runtime can schedule non-conflicting transactions in parallel (`state.rs:5-9`). Consequently parallelism is structural: New-Order parallelism is bounded by the number of districts (10 × W), because the per-district `next_o_id` write serializes within a district (`new_order.rs:10-16`).
- **Embedded order lines.** ORDER_LINE is not a separate table; the up-to-15 lines are embedded in the `Order` account as a fixed array, trading worst-case space for fewer accounts per transaction (`state.rs:460-461`, `:489-492`).
- **Built secondary index.** Because Solana provides no native secondary indexes, last-name lookup is served by an explicit `CustomerLastNameIndex` PDA keyed on a last-name hash (`state.rs:322-355`). The current handlers accept the index as an optional account but resolve the customer directly by ID in the provided contexts.
- **Variable account sets via `remaining_accounts`.** New-Order, full Delivery, and Stock-Level pass their variable-cardinality Item/Stock/Order/Customer accounts through `remaining_accounts` with documented ordering, and manually deserialize them with `bytemuck` rather than through typed Anchor accounts (`new_order.rs:215-237`, `delivery.rs:72-98`, `stock_level.rs:75-86`).
- **Compute-budget split for Delivery.** The two Delivery variants exist specifically to accommodate the 200K-default / 1.4M-maximum CU budget; the per-district form is the Solana-native, parallelizable path (`delivery.rs:6-16`).
- **Client-provided identifiers.** Order IDs (`o_id`) and history IDs (`h_id`) are supplied by the client to serve as PDA seeds; `District.next_o_id` is still incremented for legacy state tracking, but uniqueness is guaranteed by the client-supplied `o_id` rather than by the counter (`new_order.rs:184-191`).
- **Simplifications.** The bad-credit C_DATA append is omitted to keep `Customer` fixed-size and zero-copy (`payment.rs:152-159`); Order-Status and Stock-Level log their results via `msg!` rather than emitting structured events or return data (`order_status.rs:130`, `stock_level.rs:103-104`). As noted in `BENCHMARKS.md:45-48`, measured latency is dominated by single-node block time and the sequential client submit loop, not program execution; the compute-unit columns are the machine-independent measure of on-chain cost.

## 6. Error Codes

Defined in the `TpcError` enum at `programs/tpc-benchmark/src/error.rs:7-152`.

| Variant | Message | error.rs |
|---------|---------|----------|
| `BenchmarkAlreadyInitialized` | Benchmark already initialized | `:14` |
| `InvalidWarehouseId` | Invalid warehouse ID | `:17` |
| `InvalidDistrictId` | Invalid district ID - must be 1-10 | `:20` |
| `InvalidCustomerId` | Invalid customer ID - must be 1-3000 | `:23` |
| `InvalidItemId` | Invalid item ID - must be 1-100000 | `:26` |
| `StringTooLong` | String exceeds maximum length | `:29` |
| `InvalidTaxRate` | Tax rate must be 0-2000 basis points | `:32` |
| `InvalidDiscount` | Discount must be 0-5000 basis points | `:35` |
| `InvalidOrderLineCount` | Order must have 5-15 items per TPC-C specification | `:42` |
| `ItemNotFound` | Invalid item ID - item does not exist | `:45` |
| `InsufficientStock` | Insufficient stock for order | `:48` |
| `CustomerNotFound` | Customer not found | `:51` |
| `DistrictNotFound` | District not found | `:54` |
| `WarehouseNotFound` | Warehouse not found | `:57` |
| `InvalidQuantity` | Invalid quantity - must be 1-10 | `:60` |
| `OrderIdOverflow` | Order ID overflow - district counter exhausted | `:63` |
| `InvalidPaymentAmount` | Invalid payment amount - must be positive | `:70` |
| `BalanceOverflow` | Customer balance would overflow | `:73` |
| `HistoryCreationFailed` | History record creation failed | `:76` |
| `CustomerNotFoundByLastName` | Customer not found by last name | `:79` |
| `OrderNotFound` | Order not found for customer | `:86` |
| `NoUndeliveredOrders` | No undelivered orders found for district | `:93` |
| `NewOrderNotFound` | New-order record not found | `:96` |
| `OrderAlreadyDelivered` | Order already delivered | `:99` |
| `InvalidCarrierId` | Invalid carrier ID - must be 1-10 | `:102` |
| `ComputeBudgetExceeded` | Delivery transaction would exceed compute budget | `:105` |
| `InvalidStockThreshold` | Invalid stock threshold | `:112` |
| `CustomerIndexNotFound` | Customer index not found | `:119` |
| `CustomerIndexFull` | Customer index full - too many customers with same last name | `:122` |
| `BenchmarkNotInitialized` | Benchmark not initialized | `:129` |
| `BenchmarkAlreadyRunning` | Benchmark already running | `:132` |
| `BenchmarkNotRunning` | Benchmark not running | `:135` |
| `Unauthorized` | Unauthorized - only authority can perform this action | `:138` |
| `LockConflict` | Account lock conflict - transaction serialized | `:145` |
| `StaleBlockhash` | Stale blockhash - transaction expired | `:148` |
| `AccountInUse` | Account already in use by concurrent transaction | `:151` |

## 7. Testing and Running

The integration suite is `tests/tpc_stress_test.ts`, invoked through `npm run test:tpc-stress`, which maps to `anchor test tests/tpc_stress_test.ts` (`package.json:21`). The suite is also included in the aggregate `test:all` target (`package.json:23`).

The test (`describe("TPC-C Performance Stress Test")`, `tests/tpc_stress_test.ts:16`) loads the program from the Anchor workspace as `TpcBenchmark`, initializes a single warehouse, district, customers, and items, then runs `it("Runs TPC-C Workload Mix (NewOrder and Payment)")` (`:168`). The workload mix is a 50/50 New-Order/Payment split selected at random per transaction (`:185`); New-Order constructs five order lines with their Item and Stock `remaining_accounts` (`:198-207`), and order IDs are derived from a timestamp to guarantee unique PDA seeds (`:194`). The harness is environment-tunable: `TPC_TX_COUNT` (default 200) and `TPC_CONCURRENCY` (default 10) control transaction volume and batch concurrency (`tests/tpc_stress_test.ts:170-171`). The documented paper-grade reproduction command is `TPC_TX_COUNT=500 TPC_CONCURRENCY=20 npm run test:tpc-stress` (`BENCHMARKS.md:42`).

Running the suite requires the program's compiled BPF object: `scripts/run-tests.sh` notes that the `tpc-stress` suite "requires `tpc_benchmark` .so" (`scripts/run-tests.sh:17`). Because each `programs/*` directory is its own crate rather than a member of a root workspace, Anchor 1.0 emits the object under the sub-workspace's own `target/deploy/`; `scripts/run-tests.sh` synchronizes the freshly built `.so` into the root `target/deploy/` before deploying (`scripts/run-tests.sh:148-159`, `:213-217`), which is the path required for the test validator to load and deploy the program. The benchmark caveat applies: per `BENCHMARKS.md:45-48`, end-to-end latency reflects block time and client submission overhead, so the load-independent compute-unit figures are the appropriate measure of on-chain efficiency.
