= 1. Introduction

Peer-to-peer (P2P) energy trading enables prosumers — households and firms that both
produce and consume electricity — to settle surplus generation directly with one
another rather than solely through a utility. In Thailand this exchange is
currently foreclosed: under the Enhanced Single Buyer (ESB) model all wholesale
electricity is procured through a single national off-taker, leaving prosumers
with surplus generation no direct route to such an exchange. Realising such
an exchange on a public ledger raises three requirements that a general-purpose
blockchain does not satisfy by default: (i) *throughput*, because metering
telemetry and order flow arrive continuously from many independent devices; (ii)
*settlement integrity*, because a trade must be provably authorised by both
counterparties yet must not be replayable; and (iii) *physical backing*,
because a token that claims to represent a kilowatt-hour must be tied to an
attested, real-world measurement rather than minted at will.

This paper describes GridTokenX, an on-chain energy-trading platform built as a
set of Anchor programs on a permissioned Proof-of-Authority (PoA) Solana cluster.
The design exploits the Solana Virtual Machine (SVM) execution model directly: it
partitions all hot-path state into per-entity program-derived accounts (PDAs) so
that unrelated meters, orders, and registrations never contend for the same write
lock and therefore execute in parallel under Sealevel. The market runs a hybrid
double auction: a continuous double auction (CDA) maintains an on-chain order book
and matches compatible orders in real time (`sharded_match_orders`) for immediate
trades, such as battery-energy-storage reserve dispatch, while a uniform-price
auction clears accumulated bids at a single price over 15-minute epochs
coordinated by the oracle's market-clearing trigger. Matches produced by the
off-chain engine settle on-chain through native Ed25519 signature verification and
per-order replay nullifiers, so the chain never hosts the matching engine yet still enforces authorisation and single-use settlement. Token minting
is gated behind a registered set of Renewable Energy Certificate (REC) validators,
binding issuance to attested generation. An accompanying treasury program provides
a Thai-baht-pegged stablecoin (THBC) with reserve-attested peg invariants and a
MasterChef-style staking accumulator, giving the market a baht-denominated
settlement unit.

Governance follows a permissioned consortium model. The platform authority named
in the governance program is intended to be held jointly by Thailand's grid
operators — the Electricity Generating Authority (EGAT), the Metropolitan
Electricity Authority (MEA), and the Provincial Electricity Authority (PEA) —
under a two-step authority-transfer discipline (§6.2), so that protocol
administration rests with the same institutions that operate the physical grid.
Block production, separately, runs on a permissioned Proof-of-Authority
validator set (§8).

The contributions of this work are:

+ A Sealevel-parallel account architecture in which every high-frequency write —
  meter telemetry, order placement, settlement — targets a per-entity PDA, with
  global aggregates kept deliberately stale and reconciled by periodic admin
  instructions (§4.2).
+ An off-chain-matched, on-chain-settled trade protocol that verifies buyer and
  seller Ed25519 signatures through instruction-sysvar introspection and prevents
  replay in depth, with per-order fill nullifiers bounding cumulative settlement
  and per-match nullifiers blocking duplicate settlement of the same match
  (§6.3).
+ A REC-validator gating scheme that ties token minting to attested physical
  energy (§6.4), together with a two-step authority-transfer mechanism for
  application-layer PoA governance (§6.2).
+ A treasury design with formally stated peg and collateral invariants and a
  precise, integer-only economic model for price formation, settlement, fees,
  wheeling charges, and staking rewards (§11).
+ A transaction-level measurement study on a single-node validator: a
  per-instruction compute profile, a TPC-C concurrency sweep that scales
  super-linearly to the swept ceiling, a fleet-scale telemetry benchmark
  showing flat throughput and $O(1)$ per-write cost from 10,000 to 200,000
  meters — with zero delivery loss across 1,020,000 first-attempt submissions
  and every failure attributed to an explicit class — and a month-long
  community replay that closes the token lifecycle (§9). The study isolates
  write-lock serialisation on shared accounts as the binding throughput
  ceiling and identifies fee-payer pooling with sharded collectors as the
  primary remedy. A companion market-mechanism comparison drives all three
  price rules on-chain over four physically modelled fleets and isolates the
  wheeling tariff and demand-side participation as the two levers that decide
  whether P2P trading beats the regulated feed-in rate (§9.6).
+ A binary-level characterisation of the three per-transaction budgets —
  compute units, the 1,232-byte IP-derived packet, and the 4 KiB SBF stack
  frame — showing, with measured incidents from this codebase, how each
  budget independently shapes protocol packaging, account-interface design,
  and client encoding (§4.3–§4.8, §12).

The remainder of the paper is organised as follows. Section 2 states the
methodology — the design principles, the implementation stack, and the evaluation
approach. Section 3 presents the execution stack from off-chain services down to
the deployed programs. Section 4 develops the SVM execution model — the
account/lock discipline, the compute budget, and zero-copy state. Section 5
describes cross-program invocation between the programs. Section 6 sets out the
security and trust model. Section 7 traces an end-to-end market cycle, and
Section 8 covers the consensus and validator topology. Section 9 reports the key
empirical results and discusses their implications. Section 10 is a reading map to
the wider documentation, and Section 11 gives the formal price-formation, settlement, and
economic equations, each cited to its implementing source line. Section 12 is a
binary-level reference appendix covering the encodings, storage formats, and
runtime limits the design sections build on.
