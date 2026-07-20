= 2. Methodology

This work follows a *design-and-measure* method: the platform is constructed as a
set of on-chain programs whose structure is dictated by the execution semantics of
the target runtime, and every architectural claim is grounded in the implementing
source and, where behavioural, in a reproducible measurement. This section states
the design principles that constrain the implementation (§2.1), the implementation
stack itself (§2.2), and the evaluation harnesses used to verify functional
correctness and quantify runtime cost (§2.3).

== 2.1 Design principles

The design is governed by four principles, each a direct consequence of the SVM
account model rather than a stylistic preference.

+ *Execution-model-first partitioning.* Because the runtime serialises any two
  transactions that write the same account, all high-frequency state is placed in
  per-entity PDAs, and shared configuration is treated as read-only on hot paths.
  Parallelism is therefore a property of the data layout, not of an added
  concurrency mechanism (developed in §4.2).
+ *State in accounts, logic in stateless programs.* Programs hold no mutable
  state; all protocol state lives in program-owned accounts, which keeps
  authorisation reducible to the runtime ownership rule.
+ *Defensive integer arithmetic.* All value-bearing computations use checked or
  saturating integer operations over `u128` intermediates, and every program
  enables `overflow-checks = true` in its release profile, so an arithmetic
  overflow aborts the transaction rather than wrapping silently.
+ *Cite, do not assert.* Each architectural statement in this paper is anchored to
  a specific source location (`path:line`); a claim without such an anchor is
  treated as a hypothesis rather than a result.

== 2.2 Implementation

The platform is implemented in Rust and compiled to SBF bytecode with the Anchor
framework (`anchor-lang` and `anchor-spl` version 1.0.0). It comprises five core
programs — `energy-token`, `governance`, `oracle`, `registry`, and `trading` — a
`treasury` program providing the pegged settlement unit, and two benchmark crates
(`blockbench` and `tpc-benchmark`); shared functionality is factored into `core`
and `compute-debug` crates. Each program is an independent crate rather than a
member of a single workspace, and the canonical program identifiers are declared
in `Anchor.toml [programs.localnet]`. Fungible energy and Renewable Energy
Certificate balances are held in Token-2022 mints. State structs are declared
zero-copy (`#[account(zero_copy)] #[repr(C)]`) and accessed in place through
`AccountLoader`, avoiding full deserialisation of large accounts. Compute-unit
consumption is profiled non-invasively by wrapping each handler body in the
`compute_fn!` macro (`shared/compute-debug/src/lib.rs:78`), which reports remaining
budget on localnet and compiles to a no-op in release builds.

== 2.3 Evaluation approach

Functional correctness and runtime cost are assessed with a layered set of
harnesses, chosen so that most properties can be verified without a validator
and so that every reported number leaves a reproducible artifact.

*Correctness tiers.* In-process suites built on LiteSVM exercise program
guards against the deployed binaries (`addProgramFromFile` loads the real
`.so`), with the profiling suites asserting that each instruction remains
below the 200,000-CU default budget. The same harness fabricates
hard-to-reach protocol states directly — encoding whole accounts and
injecting them at the storage layer, or byte-patching a live zero-copy
account at known offsets (§12.10) — so guard paths can be tested without
replaying the transactions that would normally produce them. Integration
suites run under a live validator (`anchor test` or the standalone runner) to
confirm cross-program invocation and settlement end to end, and a
Surfpool-based simulation reproduces a mainnet-like environment without a
local validator. Complementing the example-based tests, ten invariant-fuzzing
harnesses under `fuzz/` (one per program plus dedicated trading
escrow/match/settle/batch targets) drive randomised instruction sequences
against accounting invariants such as peg collateralisation and
vault-balance conservation.

*Load and scale.* Throughput and cost under load are characterised at four
scopes: (i) generic OLTP proxies ported to the account model — BlockBench,
SmallBank, and a TPC-C concurrency sweep (§9.2); (ii) the real settlement
path, measured both per-instruction and as an open-loop submission sweep, and
the three price rules driven as complete on-chain market mechanisms over
physically modelled fleet datasets with independent chain-state verification
(§9.6);
(iii) fleet-scale telemetry ingest, driving `submit_meter_reading` for
10,000–200,000 distinct meters via a raw-send harness
(`scripts/bench-meter-throughput.ts`, swept across scales by
`scripts/run-meter-scale-sweep.sh`, §9.3); and (iv) a one-month community
replay that exercises the full token lifecycle over physically modelled data
(`scripts/bench-community-month.ts`, §9.4).

*Measurement conventions.* Throughput is client-observed confirmed goodput
(confirmed transactions per wall-clock second, burst start to last observed
confirmation at `confirmed` commitment); latency is send-to-confirmed per
transaction, quantised by the status-poll period where bulk polling is used;
compute units are read from `computeUnitsConsumed` of confirmed transactions
and are machine-independent (§12.5). Every non-confirmed transaction is
attributed to an explicit failure class (§9.3) rather than folded into a
single loss rate. Canonical results, environments, and commit hashes are
recorded in #link("BENCHMARKS.md")[`BENCHMARKS.md`]; per-run JSON and
Markdown artifacts are written under `test-results/`.

A methodological caveat applies to all on-chain measurements: the development
topology is a single-node localnet, so reported figures characterise SVM and
runtime behaviour (account locking, compute metering, instruction cost) and
not consensus throughput, which would require a multi-validator deployment
(§8.3).
