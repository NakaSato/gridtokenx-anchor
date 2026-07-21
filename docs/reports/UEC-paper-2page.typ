// gridtokenx-anchor — 2-page condensed paper (UEC ASEAN workshop format).
// Compile: typst compile UEC-paper-2page.typ UEC-paper-2page.pdf
// Academic register; no source-line citations.

#set page(paper: "a4", margin: (x: 1.4cm, y: 1.15cm), numbering: "1")
#set text(size: 8.5pt)
#set par(justify: true, leading: 0.56em, spacing: 0.8em)
#set heading(numbering: none)
#show heading: it => block(above: 0.6em, below: 0.35em, text(size: 9pt, it))
#set math.equation(numbering: "(1)", supplement: [Eq.])
#show math.equation: set text(size: 8pt)
#show math.equation.where(block: true): set block(above: 0.6em, below: 0.6em)

#place(top + center, scope: "parent", float: true)[
  #text(size: 13.5pt, weight: "bold")[An On-Chain Settlement Layer for Peer-to-Peer Energy
  Trading under Thailand's Enhanced Single Buyer Model]
  #v(0.2em)
  #text(size: 9pt)[GridTokenX: Solana/Anchor Programs and Runtime Architecture — Extended Abstract]
  #v(0.5em)
  #block(inset: (left: 1.2em, right: 1.2em))[
    #set par(justify: true)
    #text(size: 8.5pt)[
      *Abstract* — Thailand's three state utilities EGAT, MEA, and PEA have
      advanced a National Energy Trading Platform (NETP) since 2017 to
      facilitate Peer-to-Peer (P2P) trading among rooftop-solar prosumers,
      envisaging a blockchain-based settlement layer with a dedicated
      digital currency. However, the platform remains in development, and
      Thailand's regulated buy-back scheme still provides no direct
      mechanism for prosumers to exchange surplus generation within the
      local electrical grid. This paper presents a smart-contract-based
      on-chain settlement layer for P2P energy trading, realized as six
      modular Anchor programs deployed on a permissioned Solana runtime
      that utilize the Sealevel parallel-execution engine. By routing every
      high-frequency write to a per-entity program-derived account (PDA),
      the system permits transactions with disjoint write sets to execute
      in parallel, with transaction ordering provided by Solana's
      Proof-of-History (PoH). The evaluated market-clearing framework
      couples a continuous double auction (CDA) for real-time trades with a
      uniform-price auction that clears aggregated prosumer bids into a
      single settlement price over fifteen-minute epochs. We simulate
      energy consumption, generation, and power flow for a network of $M$
      meters over $D$ days at fifteen-minute intervals within a low-voltage
      grid topology, of which 15% of meters are prosumers. The full token
      life-cycle — minting, settlement, and burning — is evaluated on a
      single-node validator (Apple M2, Agave 3.1.10). We report the
      resulting throughput, energy-conservation, and net-revenue outcomes,
      each independently re-derived and audited from on-chain state.
    ]
  ]
  #v(0.4em)
]

= Introduction

Thailand's state utilities have advanced a National Energy Trading Platform
(NETP) since 2017 @egat_netp to facilitate P2P trading among rooftop-solar
prosumers, using a Tendermint-based consortium blockchain @netp2019report.
This article presents a Solana-based architecture as an alternative
execution layer, motivated by NETP's own finding that Tendermint
outperformed Ethereum and Hyperledger Fabric in throughput testing —
suggesting further gains may be available from Solana's parallel execution
model @yakovenko2018solana.

The smart contracts are built as six programs on the Anchor framework,
written in the Rust programming language,
compiled to SBF bytecode, and executed on the Solana Virtual Machine (SVM).
By routing high-frequency writes to per-entity program-derived accounts
(PDAs), transactions with disjoint write sets never contend for the same
account lock and therefore execute in parallel under Solana's Sealevel
runtime.

= Methodology

The implementation and evaluation setup comprise:

- The smart-contract layer is built on the Solana Anchor framework
  @anchor2024 (`anchor-lang` and `anchor-spl`, version 1.0.0) and comprises
  six programs — *energy-token, governance, oracle, registry, trading,
  treasury* — all written in Rust and compiled to SBF bytecode. Anchor
  supports a modular program architecture in which one program invokes
  instructions of another through cross-program invocation (CPI); authority
  for such calls is delegated to program-derived addresses (PDAs), which
  sign CPIs without any private key existing. The deployment targets a
  permissioned environment realised as a private network of
  `solana-test-validator`. All experiments reported here were executed on a
  single-node validator on local hardware (Apple M2, Agave 3.1.10).

- Fleet datasets use the CINELDI 80-bus rural LV reference grid (SINTEF)
  @cineldi2024 for network topology only — the 80-node single-phase feeder
  with its V/A/W parameters. The grid is imported from MATPOWER, translated
  to a GridLAB-D (v5.3.0) model @chassin2008, and its AC power flow
  resolved with pandapower @thurner2018. As CINELDI carries only hourly
  load and no generation, all time-series are simulator-produced: per-meter
  consumption and twelve prosumer nodes' (15%) rooftop PV are generated at
  fifteen-minute cadence, with solar modelled deterministically via pvlib
  @holmgren2018pvlib under a fixed seed.

- The replay drives the full per-prosumer token lifecycle against the live
  validator — registry-synchronised GRID mint (CPI), escrow deposit,
  Ed25519-verified off-chain-signed settlement, buyer withdraw and burn,
  month-end REC certification — and an audit harness then re-derives every
  headline figure from live chain state by RPC reads only (per-meter
  counters, PDA censuses, registry conservation sums, token supplies and
  balances): 15 assertions, all required to pass.

= Key Results and Discussion

All measurements use a single-node validator (Apple M2, Agave 3.1.10);
throughput is client-observed confirmed goodput (confirmed transactions per
wall-clock second, burst start to last confirmation), characterising
execution-layer runtime and account locking rather than consensus
throughput. Every non-confirmed transaction is attributed to one failure
class (rejected at submission, failed an on-chain guard, or expired
unconfirmed), separating delivery loss from validation working as intended.
The community-month evaluation is grounded in the simulator setup of
@tab-data: 80 meters (seeded solar/load physics), 12 prosumer sellers under
a 10 kWh/day cap, 68 consumers, 30 days × 96 ticks = 230,400 readings;
month energy 15,868.5 kWh generated, 144,879.8 kWh consumed, 10,386.7 kWh
interval surplus.

== Equations and Data

#figure(
  caption: [#text(size: 8pt)[The simulated community-month dataset
  (seed-deterministic; no field data).]],
  text(size: 7.5pt)[
    #table(
      columns: (auto, auto),
      align: (left + horizon, left + horizon),
      stroke: 0.4pt,
      inset: 3pt,
      table.header([*Quantity*], [*Value*]),
      [fleet], [80 meters (seeded solar/load physics): 12 prosumer sellers, 68 consumers],
      [market policy], [sell cap $C = 10$ kWh/day per prosumer; 0.1 kWh dust floor],
      [horizon / readings], [30 days × 96 ticks ($Delta t$ = 15 min) = 230,400 readings, integer Wh],
      [month energy], [15,868.5 kWh generated; 144,879.8 kWh consumed; 10,386.7 kWh interval surplus],
      [oracle-accepted surplus], [8,253.502 kWh (@eq-accepted); 919 readings gate-rejected],
    )
  ],
) <tab-data>

Energy carries nine decimals ($1 "kWh" = 10^9$ atomic units), the
THB-denominated settlement currency six; all value arithmetic is checked
integer arithmetic ($floor(dot)$ = integer floor). The oracle admits a
reading pair $(g_(i,t), c_(i,t))$ (generated, consumed, integer Wh) only if
generation is physically plausible against consumption,
$100 g_(i,t) <= kappa c_(i,t)$ with $kappa = 1000$; prosumer $i$'s
*oracle-accepted* surplus on day $d$ sums the accepted ticks:

$ S_a (i, d) = sum_(t in "day" d, "accepted") max(0, thin g_(i,t) - c_(i,t)) $ <eq-accepted>

With $C = 10$ kWh the daily sell cap, the lifecycle mints
$M(i, d) = min(S_a (i, d), C)$ as GRID for each prosumer-day above the
0.1 kWh dust floor and certifies the remainder as RECs at month end,
$R(i) = sum_d S_a (i, d) - sum_d M(i, d)$, with the registry enforcing
GRID + REC ≤ net metered generation *on-chain* per meter at claim time.
Each settled match $m$ of quantity $q_m$ at clearing price $p^*$ (bounded
by both counterparties' signed limits, $p_s <= p^* <= p_b$) debits the
buyer escrow by $T_m = floor(q_m p^* slash 10^9)$; per-order nullifiers
record cumulative fill so a signed order may fill partially but never
over-fill or replay. A complete run must therefore satisfy three closure
identities, each checkable from chain state:

$ sum_(i,d) M(i,d) = E_"settle" = E_"burn", quad
  sum_i R(i) = "REC supply" / 10^3, quad
  sum_m T_m = P_"sell" + W $ <eq-closure>

where $E_"settle"$, $E_"burn"$ are the energy moved by settlement and
retired by burns, the REC mint carries $10^3$ base units per kWh, and
$P_"sell"$, $W$ are total seller proceeds and wheeling charges.

*Outcomes.* The month replays in 1,394.7 s (1,858× real time) with zero
delivery loss; all 919 rejected readings are deterministic anomaly-gate
rejections. Telemetry sustains ≈213 readings·s#super[−1], order bursts
≈53 TPS, and each Ed25519-verified settlement costs 107 k CU. The closure
identities of @eq-closure hold exactly on chain (15/15 audit assertions),
and they hold under all three price rules; net revenue orders uniform
2.290 > buyback 2.200 > CDA 2.065 ฿/kWh, so wheeling policy sets the P2P
participation threshold.

= Conclusion

The measurements support the central design claim: with hot-path state
partitioned into per-entity PDAs, the residual scaling limit is consensus
and lock serialization rather than computation. A simulated community month
closes the token lifecycle with exact, independently audited on-chain
conservation — minted equals settled equals burned energy, minted plus
certified RECs equals oracle-accepted surplus to the watt-hour, currency
conserved to the atom — and the net-revenue comparison shows wheeling
policy, not the market mechanism alone, decides whether P2P trading beats
the regulated buy-back rate. Future work: a multi-validator deployment for
true consensus throughput and cross-border P2P pilots with UEC–ASEAN
partners.

#heading(numbering: none)[Acknowledgment]
The authors thank the University of the Thai Chamber of Commerce (UTCC) for
institutional support, and the organizers, the UEC ASEAN Research Center
(UARC) and Multimedia University (MMU), for hosting this workshop.

#text(size: 6.5pt)[
  #columns(2, gutter: 0.8cm)[
    #bibliography("UEC-2page-refs.bib", title: [References], style: "ieee")
  ]
]
