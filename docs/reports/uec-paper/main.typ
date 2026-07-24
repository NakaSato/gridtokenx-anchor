// gridtokenx-anchor — Runtime Architecture (Typst)
// Entry point. Compile: typst compile uec-paper/main.typ docs/reports/UEC-paper.pdf
//
// Structure:
//   template.typ      — page/text/show rules + title/abstract layout
//   uec-paper/sections/*.typ    — one file per top-level section, in reading order

#import "template.typ": uec-paper

#show: uec-paper.with(
  title: [An On-Chain Settlement Layer for Peer-to-Peer
    Energy Trading under Thailand's Enhanced Single Buyer Model],
  subtitle: [GridTokenX: Solana/Anchor Programs and Runtime Architecture],
  abstract: [
    The growing adoption of renewable energy has produced a growing class of participants
    with surplus generation capacity who currently cannot engage in peer-to-peer
    (P2P) trading under Thailand's Enhanced Single Buyer model. This article
    presents an on-chain settlement layer for P2P energy trading in which
    transaction settlement executes on a Solana cluster. The system features a
    consortium governance structure mapped to Thailand's grid operators (EGAT, MEA,
    PEA), an application layer implemented as a set of Anchor smart-contract programs, and
    consensus and finality driven by Solana's PoH/Tower-BFT engine. The market
    design incorporates a hybrid continuous double auction (CDA) that matches orders on the on-chain order book in real time for immediate trades, such as battery energy storage system (BESS) reserve dispatch, alongside a uniform-price auction that establishes a single clearing
    price over 15-minute intervals. We evaluate the smart-contract programs using a
    transaction-level benchmark on a single-node validator (Apple M2, Agave
    3.1.10). Across a TPC-C concurrency sweep (500 transactions, 50% NewOrder / 50%
    Payment), all transactions were confirmed with zero failures. Throughput scaled
    super-linearly with in-flight concurrency, reaching ≈74 tx·s#super[−1] at a
    concurrency of 40 with no saturation knee across the swept range. Compute cost
    remained flat at ≈23 k CU·tx#super[−1] across all levels, indicating that the
    performance ceiling is dictated by single-node block production and write-lock
    serialisation rather than on-chain execution. That serialisation dominates any
    path funnelled through a single write-locked account: single-signer mint
    issuance holds at only ≈5.33 mint·s#super[−1] regardless of device count, and
    single-fee-payer settlement at ≈0.6 tx·s#super[−1]. We identify multi-signer
    fee-payer pooling, together with sharded collector accounts, as the primary
    lever for issuance- and settlement-side throughput.
  ],
  keywords: [peer-to-peer energy trading; blockchain settlement; Solana;
    continuous double auction; uniform-price auction; Thailand Enhanced Single
    Buyer.],
)

#include "sections/01-introduction.typ"
#include "sections/02-methodology.typ"
#include "sections/03-execution-stack.typ"
#include "sections/04-svm-execution-model.typ"
#include "sections/05-cpi.typ"
#include "sections/06-security-model.typ"
#include "sections/07-protocol-flow.typ"
#include "sections/08-consensus-topology.typ"
#include "sections/09-results.typ"
#include "sections/10-reading-map.typ"
#include "sections/11-formal-model.typ"
#include "sections/12-appendix-binary.typ"
