// gridtokenx-anchor — 2-page condensed paper (UEC ASEAN workshop format).
// Compile: typst compile UEC-paper-2page.typ UEC-paper-2page.pdf
// Condensed from uec-paper/main.typ. Academic register; no source-line citations.

#set page(paper: "a4", margin: (x: 1.6cm, y: 1.55cm), numbering: "1", columns: 2)
#set columns(gutter: 0.9cm)
#set text(size: 9pt)
#set par(justify: true)
#set heading(numbering: none)
#show heading: it => block(above: 0.7em, below: 0.4em, text(size: 9.5pt, it))
#set math.equation(numbering: "(1)", supplement: [Eq.])
#show math.equation: set text(size: 8.5pt)

#place(top + center, scope: "parent", float: true)[
  #text(size: 13.5pt, weight: "bold")[An On-Chain Settlement Layer for Peer-to-Peer Energy
  Trading under Thailand's Enhanced Single Buyer Model]
  #v(0.2em)
  #text(size: 9pt)[GridTokenX: Solana/Anchor Programs and Runtime Architecture — Extended Abstract]
  #v(0.5em)
  #block(inset: (left: 2.5em, right: 2.5em))[
    #set par(justify: true)
    #text(size: 8.5pt)[
      *Abstract* — Thailand's forthcoming Power Development Plan (PDP
      2026–2050) @moe_factsheet_2026 mandates a transition to 70% clean energy
      generation to fulfil the nation's carbon-neutrality commitments while
      supporting surging future electrical demand. Achieving this target will
      necessitate a rapid proliferation of distributed rooftop-solar prosumers.
      Crucially, the draft PDP signals a structural shift away from the
      traditional Enhanced Single Buyer model by initiating frameworks for
      Direct Power Purchase Agreements (Direct PPA) to open the green
      electricity market. However, executing these direct agreements
      efficiently at a decentralised, peer-to-peer (P2P) scale requires a
      robust settlement architecture; without it, surplus distributed capacity
      remains underutilised. To address this limitation, this article proposes
      a smart-contract-based on-chain settlement layer for P2P energy trading,
      implemented as six modular Anchor programs within a permissioned Solana
      runtime environment. By directing every high-frequency write to a
      per-entity program-derived account (PDA), the system enables
      transactions with disjoint write sets to execute in parallel under
      Solana's Proof-of-History (PoH) consensus mechanism, and the market
      framework couples a continuous double auction with a uniform-price
      epoch market that clears prosumers' bids at a single settlement price
      over fifteen-minute intervals. On a single-node validator, a simulated
      month of an 80-meter community — 12 rooftop-solar prosumers under a
      10 kWh/day sell cap — replays end-to-end at 1,858× real time with zero
      lifecycle failures: the recurring meter write costs approximately
      13.4 thousand compute units (CU), trustless dual-signature settlement
      approximately 107 thousand CU per match, and the token accounting
      closes exactly, with minted, settled, and burned energy equal and the
      cap-withheld remainder certified as renewable-energy certificates.
    ]
  ]
  #v(0.4em)
]

= 1. Introduction

*Background.* Thailand's electricity market is organised around the Enhanced
Single Buyer model, and the draft PDP 2026–2050 @moe_factsheet_2026 now
initiates Direct-PPA frameworks that will, for the first time, let distributed
rooftop-solar prosumers contract with one another. *Problem.* Executing such
agreements at P2P scale imposes three requirements a general-purpose
blockchain does not meet by default: throughput (telemetry and order flow
arrive continuously from many devices), settlement integrity (trades provably
authorised by both counterparties, never replayable), and physical backing (a
kilowatt-hour token traceable to an attested measurement rather than minted
at will — a shortcoming of early microgrid pilots @ref3). *Objective.* This
work designs, formalises, and empirically evaluates a settlement layer that
meets all three on a permissioned Solana runtime: GridTokenX, six cooperating
Anchor programs @ref1 in which hot-path state lives in per-entity PDAs
(disjoint writes execute in parallel), off-chain matches settle through
native Ed25519 verification without ceding custody to the matching engine,
and administration maps to the Thai grid operators (EGAT, MEA, PEA) under a
two-step authority transfer.

This paper contributes: (i) the complete token lifecycle — attested minting,
capped-charge settlement, collateral-guarded burning — as integer-exact
equations implemented verbatim by the deployed programs; (ii) an empirical
cost profile of that lifecycle, from the per-meter write to full trustless
settlement and an end-to-end simulated community month; and (iii) evidence
that throughput is set by each instruction's write-lock footprint rather than
its compute cost, with the architectural remedies that follow.

= 2. Methodology

The evaluation applies three instruments to the deployed programs:

- *Workload data.* A physically modelled smart-meter fleet (seeded
  solar-irradiance and load profiles) generating one month of telemetry for
  an 80-meter community — 12 rooftop-solar prosumers, 68 consumers,
  fifteen-minute cadence, 230,400 readings — replayed against a live
  validator.
- *Implementation.* Six on-chain programs in Rust/Anchor (zero-copy accounts,
  checked integer arithmetic); TypeScript harnesses signing locally against
  cached blockhashes with bulk status-poll confirmation; per-instruction
  compute profiled in-process on a deterministic SVM.
- *Evaluation.* Client-observed confirmed goodput, send-to-confirmation
  latency, per-transaction compute units, and three-class attribution of
  every non-confirmed transaction; headline figures independently re-derived
  from live chain state by a 15-assertion audit.

= 3. Token-Lifecycle Equations

All value-bearing arithmetic uses checked integer operations over 128-bit
intermediates with compiler-enforced overflow checks: overflow aborts the
transaction rather than wrapping silently. Throughout, $floor(dot)$ denotes integer floor division. Energy
quantities carry nine decimal places ($1 "kWh" = 10^9$ atomic units), while
prices and the baht-pegged settlement currency (THBC) carry six.

*Minting (surplus tokenisation).* A validated surplus of $E$ kWh, aggregated
over one fifteen-minute metering window, mints $A$ atomic units. The
conversion is a single function shared by the producing gateway and the
verifying bridge, so both sides of the trust boundary agree on the exact bound
and scaling:

$ A = floor(10^9 E), quad E in (0, E_max], quad A >= 1 $ <eq-mint>

where $E_max = 10^6$ kWh caps any single mint, bounding
$A lt.approx 10^15 << 2^64$ ahead of the float-to-integer conversion;
non-finite, non-positive, over-cap, and rounds-to-zero values are rejected on
both sides. On-chain, the mint for
meter $m$ and window $w$ executes if and only if three predicates hold
simultaneously:

$ underbrace(w equiv 0 space (mod 900 dot 10^3), "epoch alignment")
  space and space
  underbrace(M(m,w) = 0, "no prior mint")
  space and space
  underbrace(k_"rec" in cal(V), "REC co-signature") $ <eq-mint-guards>

The window start $w$ must lie on the oracle's 900-second epoch grid;
$M(m,w)$ is a per-(meter, window) idempotency record, so no window can ever
be minted twice; and $k_"rec"$ must belong to the registered set $cal(V)$ of
Renewable Energy Certificate (REC) validators, with no opt-out. Supply then
advances by exactly the attested amount, $S arrow.l S + A$.

*Settlement.* Order admission bounds the price domain before any matching
occurs: every limit price must satisfy $p_min <= p <= p_max$. On the on-chain
auction path, two orders match only when they cross, $p_b >= p_s$, and
execution occurs at the seller's limit, $p^* = p_s$, so the full bid–ask
spread accrues to the buyer. A match produced off-chain may
execute at any price the engine chooses, but settlement enforces the bounds
signed by both counterparties, $p_s <= p^* <= p_b$, so no participant can be
settled at a price worse than the limit it authorised. A settled match of
quantity $q$ at price $p^*$ then yields the gross value $V$, the market fee
$F_m$ (at $phi_m$ basis points), the flat-rate wheeling charge $C_w$ (at $w_r$
per kilowatt-hour), and the line-loss charge $C_ell$ (at $ell$ basis points):

$ V &= floor(frac(q p^*, 10^9)), &quad F_m &= floor(frac(V phi_m, 10^4)), \
  C_w &= floor(frac(q w_r, 10^9)), &quad C_ell &= floor(frac(V ell, 10^4)) $ <eq-settle>

The combined network charge $C_"net"$ is capped at $Theta = 2000$ basis
points (20% of gross value), the total deductions must be feasible, and the
seller receives the residual:

$ C_"net" = C_w + C_ell <= floor(frac(V Theta, 10^4)), quad F_m + C_"net" <= V, \
  N_"seller" = V - F_m - C_"net" $ <eq-net>

Replay safety follows from a per-order nullifier recording cumulative fill:
each settlement consumes only the unfilled remainder, so a signed order may
fill partially but never over-fill or replay.

*Burning.* Three burn paths close the lifecycle. First, a holder burns its
own balance, $S arrow.l S - a$, with supply reconciled off the hot path. Second,
stablecoin redemption burns $a_"in"$ THBC and returns GRX at the prevailing
peg rate $r$, subject to collateral guards which ensure that redemption can
neither exceed the outstanding supply nor drain more collateral than the vault
holds, and that dust inputs cannot be burned for nothing:

$ g_"out" = floor(frac(10^9 a_"in", r)) quad "s.t." quad
  a_"in" <= S_"thbc", quad 1 <= g_"out" <= V_"swap" $ <eq-redeem>

Third, certificate retirement burns $a > 0$ REC base units ($10^3$ per
kilowatt-hour), permanently extinguishing the claim and preventing
double-counting of the renewable attribute.

= 4. Key Results and Discussion

All measurements use a single-node validator (Apple M2, Agave 3.1.10);
throughput is client-observed confirmed goodput (confirmed transactions per
wall-clock second, burst start to last confirmation), characterising
execution-layer runtime and account locking rather than consensus throughput.
Every non-confirmed transaction is attributed to one failure class (rejected
at submission, failed an on-chain guard, or expired unconfirmed), separating
delivery loss from validation working as intended. The community-month
evaluation is grounded in the simulator setup: 80 meters (seeded solar/load
physics), 12 prosumer sellers under a 10 kWh/day cap, 68 consumers, 30 days
× 96 ticks = 230,400 readings; month energy 15,868.5 kWh generated,
144,879.8 kWh consumed, 10,386.7 kWh interval surplus.

#figure(
  caption: [#text(size: 8pt)[The 80-meter community month, per pipeline stage;
  CU = compute units, default budget 200 k per instruction. Latency is
  send→confirmed, poll-quantised (±1.5 s).]],
  table(
    columns: (auto, auto, auto),
    align: (left, right, right),
    stroke: 0.4pt,
    inset: 3.5pt,
    table.header([#text(size: 8pt)[*Stage*]], [#text(size: 8pt)[*ok / attempted*]], [#text(size: 8pt)[*CU median*]]),
    text(size: 8pt)[Telemetry replay (batched, ≤10 readings/tx)], text(size: 8pt)[229,481 / 230,400], text(size: 8pt)[13,386 per reading],
    text(size: 8pt)[Daily order sessions (CDA order entry)], text(size: 8pt)[2,396 / 2,396], text(size: 8pt)[11,384],
    text(size: 8pt)[Registry sync + GRID mint (CPI)], text(size: 8pt)[433 / 433], text(size: 8pt)[29,410],
    text(size: 8pt)[Escrow deposit], text(size: 8pt)[433 / 433], text(size: 8pt)[14,905],
    text(size: 8pt)[Settlement (Ed25519 ×2, v0 + lookup table)], text(size: 8pt)[353 / 353], text(size: 8pt)[107,141],
    text(size: 8pt)[Withdraw + burn], text(size: 8pt)[353 / 353], text(size: 8pt)[21,963],
    text(size: 8pt)[REC issuance (month-end)], text(size: 8pt)[12 / 12], text(size: 8pt)[71,369],
    text(size: 8pt)[Whole month, wall time], text(size: 8pt)[1,394.7 s], text(size: 8pt)[1,858× real time],
  ),
)

Three findings emerge. First, delivery is lossless and validation is
deterministic: the 919 non-confirmed readings are exactly the oracle's
anomaly-gate rejections — fee-paid, recorded on-ledger, and bit-identical
across seven replays — while batched per-meter submission carries ≈213
readings·s#super[−1] at only ≈21 tx·s#super[−1], with every lifecycle stage
completing without a single failure. Second, the token accounting closes to
the watt-hour: 3,290.7 kWh of GRID minted from oracle-accepted surplus, all
of it trade-settled and burned; 4,962.8 kWh of cap-withheld surplus certified
as RECs; the two sums equal the accepted surplus exactly, and a 15-assertion
audit re-derives every figure from live chain state (account counts,
conservation sums, token supplies, and exact currency conservation — buyer
outflow 13,137 minor units = seller proceeds 12,832 + wheeling 305). Third,
trustless authorisation is the dominant but affordable cost: settlement's
107 thousand CU (≈54% of the default budget) is driven by on-chain Ed25519
verification of both counterparties' signatures, while every other stage
stays below 30 thousand CU — the pipeline is never execution-bound, and the
10 kWh/day cap withholds 68% of raw surplus while demand exceeds capped
supply thirty-nine-fold.

= 5. Conclusion

GridTokenX demonstrates that a production-shaped peer-to-peer energy market —
attested issuance (@eq-mint, @eq-mint-guards), integer-exact settlement with
capped network charges (@eq-settle, @eq-net), and collateral-guarded
burning and redemption (@eq-redeem) — operates comfortably within Solana's
execution budget. Principal outcomes: an end-to-end community month replayed at 1,858× real
time with zero stage failures; exact, independently audited
token-conservation closure; and a 107 k-CU trustless dual-signature
settlement cost, with every other lifecycle stage below 30 k CU.

Future work: a multi-validator deployment for true consensus throughput;
proof aggregation to amortise the per-match signature cost; and a
regulatory-sandbox pilot with the Thai grid operators. Beyond Thailand, the APAEC roadmap's multilateral power-trade and
renewable-energy programmes @ref2 call for precisely this attested, auditable
cross-border settlement — we see UEC–ASEAN collaboration opportunities in
cross-border P2P settlement pilots, harmonised certificate attestation, and
joint benchmarking of permissioned validator topologies.

#text(size: 6.8pt)[
  #bibliography("UEC-2page-refs.bib", title: [References], style: "ieee")
]
