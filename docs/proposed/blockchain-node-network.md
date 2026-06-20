# GridTokenX — Blockchain Node Network Design

> **⚠️ STATUS: MIXED — network/account layout + settlement audit commitment implemented; trustless adjudication PROPOSED (updated 2026-06-21).** The permissioned-Solana model, the treasury program, the PDA/vault layout (§5), and the non-custodial settlement call are real. The **Merkle/VAT audit commitment** part of the Tier-2 layer is now in code: `treasury::record_settlement_batch` (`programs/treasury/src/lib.rs:210`) writes a **per-`(zone, batch)` `SettlementRecord` PDA holding `merkle_root`, `vat_amount`/`vat_rate_bps`, `total_value`, zone & batch ids** and bumps the global `total_settled_thbg`; the trading batch path records it via CPI (on-chain verified, `tests/batch_settle_thbg.ts`). The legacy single-match `treasury::record_settlement(ctx, value)` (value-only) still backs `settle_offchain_match`. **Still PROPOSED:** the **trustless settlement-validity layer** (§3.2, §6, §7) — on-chain Merkle-root *verification*, challenge-response, and fraud proofs. The commitment above is **commit-only** (off-chain verifiers consume the root); the §3 feasibility spike found the on-chain exclusion-proof verify cheap (~3.6k CU) but it is gated on a settlement-finality / challenge-window redesign, since current settlement is immediate and non-reversible. **Collateral conflict resolved:** decision D1 keeps the **GRX** validator bond (`registry::stake_grx` / `MIN_VALIDATOR_STAKE`); the THBG-denominated bond in the slashing doc is deferred — §2's GRX collateral is the decided design, not a conflict.

This document specifies the design of the blockchain node network underlying GridTokenX, a peer-to-peer renewable energy trading platform for the Thai electricity market. It consolidates the network model, the node taxonomy, the two-tier consensus design, and the mapping of nodes onto Thailand's wholesale and retail market structure. The document is organized into eight sections: (1) network model overview, (2) node taxonomy, (3) the two-tier consensus design, (4) market-layer mapping, (5) the on-chain program and account layout, (6) the settlement data flow, (7) trust and verification, and (8) design rationale and limitations.

> **Note:** The system runs on a *private, permissioned Solana network* rather than the public Solana mainnet. All application-layer code (the Anchor treasury program, the dual-token design, the program-derived address layout, and the enforced invariants) is identical to what would run on public Solana; only the network and consensus membership differ. Regulatory and tariff facts referenced here were verified as of June 2026.

---

## 0. Architecture at a Glance

```
                         OFF-CHAIN
  +----------------+  +------------------+  +--------------+
  |  aggregator    |  |   custodian      |  |  price       |
  |  (clearing)    |  |  (THB reserve)   |  |  oracle      |
  +-------+--------+  +--------+---------+  +------+-------+
          |                    |                   |
          | record_settlement  | attest reserve    | rate
          | (CPI)              | (signed)          |
          v                    v                   v
  ========================= ON-CHAIN =========================
  +---------------------------------------------------------+
  | LAYER 1: Permissioned Solana (SVM)                      |
  |   EGAT / MEA / PEA run consensus nodes (closed set)     |
  |   ordering consensus inherited from Solana (PoH + PoS)  |
  +----------------------------+----------------------------+
                               |
  +----------------------------v----------------------------+
  | LAYER 2: Treasury Program (Anchor)                      |
  |   swap/redeem | stake/slash | record_settlement | admin |
  |   checked arithmetic - constraints - invoke_signed      |
  +----------------------------+----------------------------+
                               |
  +----------------------------v----------------------------+
  | LAYER 3: State Accounts (PDA)                           |
  |   config | settlement_record[zone] | stake_record[aggr] |
  +----------------------------+----------------------------+
                               |
  +----------------------------v----------------------------+
  | LAYER 4: Vault Accounts (PDA authority)                 |
  |   swap vault | stake vault | reward vault | THBG mint    |
  +----------------------------+----------------------------+
                               |
  +----------------------------v----------------------------+
  | LAYER 5: Dual-Token (SPL)                               |
  |   THBG (6 dec, peg, settlement)                         |
  |   GRX  (9 dec, collateral + incentive)                  |
  +---------------------------------------------------------+

  Enforced invariants (cross-layer, from Chapter 3):
    peg ceiling - vault separation - slash conservation
    - commitment binding
```

---

## 1. Network Model Overview

GridTokenX operates on a permissioned deployment of the Solana Virtual Machine (SVM). The decision to use a private network rather than the public mainnet follows from the system's regulatory context: the Thai electricity sector is operated by state enterprises under the Enhanced Single Buyer model, and transaction data includes consumer electricity usage and tax information that should not be exposed publicly.

The permissioned model has three defining properties. First, the consensus node set is closed: only the Electricity Generating Authority of Thailand (EGAT), the Metropolitan Electricity Authority (MEA), and the Provincial Electricity Authority (PEA) operate consensus nodes. Second, there is no volatile public gas market; transaction fees are controlled internally, which is important because the system's economic viability depends on low settlement overhead. Third, transaction data is not publicly visible, which suits the privacy requirements of electricity-usage and tax data while still requiring a designed audit-access mechanism so that regulators can inspect the ledger.

A crucial point for understanding the design is the separation between what changes and what does not when moving from public to private Solana. The entire application layer is unchanged: the treasury program, the THBG and GRX tokens, the vault and program-derived-address structure, and all enforced invariants run without modification because the private network uses the same SVM and Anchor framework. What changes is confined to the network and consensus layer: the validator set is closed and controlled by the utilities, fees are internally governed, and data is private. One consequence that must be emphasized is that state-contention limits are a property of the SVM runtime, not of the public network, so they persist under the private deployment; the per-zone account-isolation design described in Section 5 remains necessary.

---

## 2. Node Taxonomy

The network contains several distinct node roles. It is essential to distinguish two senses of the word "validator," because they refer to entirely different things and conflating them is a common source of confusion.

```
  "validator" has TWO meanings — keep them separate:

  +--------------------------+   +----------------------------+
  | CONSENSUS NODE           |   | AGGREGATOR NODE            |
  | (Solana validator)       |   | (application "validator")  |
  +--------------------------+   +----------------------------+
  | orders txns, agrees on   |   | clears one zone's market   |
  | ledger state (PoH+PoS)   |   | off-chain, staked+slashable|
  | run by EGAT/MEA/PEA only |   | run by licensed private    |
  | NOT designed by team     |   | sector, 1 per zone         |
  +--------------------------+   +----------------------------+

  +--------------------------+   +----------------------------+
  | GOVERNANCE AUTHORITY     |   | CLIENT PARTICIPANT         |
  | holds authority account  |   | prosumer / consumer        |
  | admit/revoke/slash/params|   | submits bids+offers, swaps |
  | EGAT/MEA/PEA             |   | cannot stake (collateral   |
  | not in main data path    |   | model); runs no node       |
  +--------------------------+   +----------------------------+
```

A **consensus node** is a Solana validator in the classical blockchain sense: it participates in ordering transactions and agreeing on ledger state through Solana's Proof of History and Proof of Stake machinery. In GridTokenX, consensus nodes are operated only by EGAT, MEA, and PEA. The system does not design this layer; it is inherited from Solana.

An **aggregator node** (also called an aggregator validator in the application sense) is a permissioned, staked, off-chain worker that performs market clearing for one microgrid zone. It is *not* a Solana consensus validator. The aggregator collects signed telemetry, runs the uniform-price auction, computes value-added tax, builds a Merkle commitment, and submits the settlement on-chain. Each zone has exactly one aggregator, and private-sector entities may apply to operate one by obtaining a license and posting GRX collateral with PEA or MEA.

A **governance authority** is the holder of the on-chain authority account. EGAT, MEA, and PEA act in this role to admit aggregators, revoke them, slash their collateral, and set system parameters. The governance authority is not in the main data path; it governs through a separate admit/slash channel.

Finally, ordinary **client participants** — prosumers and consumers — interact with the network by submitting bids and offers to their zone's aggregator and by swapping or redeeming tokens. They do not run nodes and, under the institutional-collateral model, cannot stake; their only token path is swapping GRX to THBG for settlement.

---

## 3. Two-Tier Consensus Design

GridTokenX deliberately separates consensus into two tiers that operate by different mechanisms. Failing to distinguish them obscures the system's actual contribution.

```
  TIER 1 — ORDERING (inherited from Solana)
  +---------------------------------------------------+
  |  "What transactions happened, in what order?"     |
  |  Mechanism: Proof of History + Proof of Stake     |
  |  Designed by: Solana (NOT the GridTokenX team)    |
  |  Guarantees: durable, consistently-observed writes|
  +---------------------------------------------------+

  TIER 2 — SETTLEMENT VALIDITY (designed by the team)
  +---------------------------------------------------+
  |  "Is this zone's matching + clearing price valid?"|
  |  Mechanism: optimistic commitment + challenge     |
  |  NOT horizontal Byzantine voting                  |
  |                                                   |
  |   commit root --> challenge window --> adjudicate |
  |        |                |                  |      |
  |   (bind matches)  (fraud proof via     (verify    |
  |                    signed telemetry)    sig+proof)|
  |                                          |        |
  |                              +-----------+------+ |
  |                              v                  v |
  |                          SLASH            FINALIZE |
  |                       (fraud proven)   (window     |
  |                                         expired)   |
  +---------------------------------------------------+

  Trust model: "trust, but verify — with stake at risk"
  Byzantine  : trust through agreement among many parties
  GridTokenX : trust through stake at risk + provable fraud
```

### 3.1 Tier One: Ordering Consensus (Solana)

The first tier is ordering consensus in the classical sense — agreement on which transactions occurred and in what sequence, and what the resulting account state is. This is provided by the underlying permissioned Solana network through Proof of History and Proof of Stake. The system does not design this tier; it is obtained by running on the SVM. When the treasury program writes a settlement record, this tier guarantees the write is durably recorded and consistently observed.

### 3.2 Tier Two: Settlement-Validity Consensus (Challenge-Response)

The second tier answers a different question: who decides that a zone's matching and clearing price are correct? This is the tier the system actually designs. GridTokenX does *not* use horizontal Byzantine consensus in which multiple aggregators vote to reach agreement. Instead, each zone has a single trusted aggregator whose output is accepted immediately, with correctness enforced vertically through three mechanisms.

The first mechanism is commitment: the aggregator commits a Merkle root on-chain, binding it to a specific set of matches that cannot be changed afterward. The second is challenge-response: any party — the governance authority or a prosumer — may submit a fraud proof consisting of signed telemetry that contradicts the committed root, within a challenge window. The third is slashing: if fraud is proven, the aggregator's staked collateral is forfeited.

The distinction is summarized as follows. Byzantine consensus achieves trust through agreement among many parties. The GridTokenX model achieves trust through stake at risk and provable fraud — the design philosophy is "trust, but verify, with stake at risk." Because the network is permissioned, the governance authority knows each aggregator in advance, which allows the challenge window to be reduced from the multi-day periods used in public optimistic systems to the order of minutes.

### 3.3 The Permissioned Consensus Network

This section details how the tier-one ordering consensus operates among the utility-operated nodes, which the layered view above references but does not fully specify.

The consensus network is a closed set of Solana validators run by EGAT, MEA, and PEA. It uses the same Tower BFT mechanism as public Solana — a derivative of Practical Byzantine Fault Tolerance that integrates Proof of History as a pre-consensus clock — but with a known, authorized membership rather than open participation. The Byzantine fault-tolerance properties of Tower BFT carry over directly. A supermajority of roughly two-thirds of stake-weighted votes is required to confirm a block. There are two critical thresholds: if one-third or more of the nodes are dishonest or offline, the network may halt — ceasing to produce transactions rather than producing incorrect ones — and strictly less than two-thirds dishonest participation is required to prevent the validation of false transactions. In other words, the network prefers safety over liveness: under severe partition it stops rather than finalizing an incorrect ledger.

```
  PERMISSIONED CONSENSUS NETWORK (Tower BFT, closed membership)

         +-----------+     +-----------+     +-----------+
         |  EGAT     |     |   MEA     |     |   PEA     |
         | consensus |<===>| consensus |<===>| consensus |
         |  node(s)  |     |  node(s)  |     |  node(s)  |
         +-----+-----+     +-----+-----+     +-----+-----+
               |                 |                 |
               +--------+--------+--------+--------+
                        |                 |
                        v                 v
                stake-weighted vote   Proof of History
                (~2/3 supermajority)  (pre-consensus clock)
                        |
                        v
              +-------------------------+
              |  block confirmed when   |
              |  >= ~2/3 stake votes    |
              +-------------------------+

   Fault thresholds (inherited from Tower BFT):
     >= 1/3 offline/dishonest  -> network HALTS (safety preserved)
     >= 2/3 dishonest          -> needed to forge state (prevented)
   Preference: SAFETY over liveness (halt, never finalize false state)
```

A design question specific to the permissioned setting is how membership and voting weight are configured. GridTokenX adopts a hybrid model that separates two concerns that public Solana fuses together. Voting for ordering consensus is conducted on an authority basis — a k-of-n threshold among the n authorized utility nodes — while stake functions as slashable collateral for settlement validity rather than as vote weight. This separation maps onto Thailand's licensed-intermediary-with-collateral structure: the utilities hold consensus authority by virtue of their statutory role, while economic accountability is carried by the staked, slashable bonds of the aggregators in tier two.

Three parameters of this consensus network are deliberately left as design parameters to be fixed during deployment and calibration, because the appropriate values depend on the number of participating utility entities and the operational risk tolerance. The first is the initial node count n and the threshold k for authority-based finality. The second is the rule governing membership changes — how a node is added or removed from the authorized set, and under what governance approval. The third is the relationship between the consensus node count and the per-zone aggregator population, which determines how ordering authority and settlement accountability are distributed. These parameters are noted here rather than assigned specific values, because assigning them without empirical calibration would overstate the precision of the design.

---

## 4. Market-Layer Mapping

The node network maps onto Thailand's two-tier electricity market structure, which is essential for situating the technical architecture within the real market.

```
  WHOLESALE LAYER (Enhanced Single Buyer)
  +-------------------------------------------------------+
  |  EGAT — transmission monopoly + single buyer          |
  |  transmission wheeling | wholesale validator (future) |
  +-----------------------------+-------------------------+
                                | high-voltage transmission
              +-----------------+-----------------+
              |                                   |
  RETAIL LAYER (distribution)   |                 |
  +---------------------------+ | +---------------------------+
  | MEA  (Bangkok metro)      | | | PEA  (rest of country)    |
  |  +---------------------+  | | |  +---------------------+  |
  |  | aggregator zone M1  |  | | |  | aggregator zone P1  |  |
  |  | aggregator zone M2  |  | | |  | aggregator zone P2  |  |
  |  +---------------------+  | | |  +---------------------+  |
  |  distribution wheeling    | | |  distribution wheeling    |
  |  admit / slash in-region  | | |  admit / slash in-region  |
  +-------------+-------------+ | +-------------+-------------+
                |               |               |
                |   record_settlement (CPI)     |
                +-------------> TREASURY <-------+
                              (shared on-chain)

  wheeling charge = transmission (EGAT) + distribution (MEA/PEA)
  applies even when a trade stays within one distribution zone
```

### 4.1 Wholesale Layer (EGAT)

Under the Enhanced Single Buyer model, EGAT holds a monopoly over high-voltage transmission and the wholesale market and acts as the single buyer. In the node network, a wholesale-tier validator is a future-phase concern: it becomes necessary only when transactions cross distribution-zone boundaries and must traverse EGAT's transmission grid.

### 4.2 Retail Layer (MEA and PEA)

The retail layer is where most aggregator nodes operate, because peer-to-peer trading occurs within distribution zones where prosumers and consumers are electrically close. The two distribution utilities have geographically exclusive territories: MEA has distribution rights in Bangkok and its metropolitan vicinity, while PEA covers the remainder of the country. Each distribution zone hosts one private-sector aggregator that performs clearing under the supervision of MEA or PEA according to territory.

### 4.3 Wheeling as a Two-Layer Charge

A point that materially affects the economic analysis is that the wheeling charge is a two-layer charge. It covers both transmission wheeling (paid to EGAT) and distribution wheeling (paid to MEA and PEA), and it applies even when a third-party-access transaction occurs entirely within a single distribution network. This explains why the wheeling charge used in the economic analysis (approximately 1.10 baht per unit) is not a single-layer cost; it is the combined transmission-plus-distribution charge.

### 4.4 Differentiated Governance

The market-layer mapping clarifies that EGAT, MEA, and PEA do not govern identically; they govern by layer and territory. MEA admits and slashes aggregators in the metropolitan zones, PEA admits and slashes aggregators in provincial zones, and EGAT governs the wholesale layer and cross-zone transactions. This differentiation matches the real authority structure under the Enhanced Single Buyer model.

---

## 5. On-Chain Program and Account Layout

### 5.1 The Treasury Program

The on-chain logic is concentrated in a single Anchor program, the treasury program. It exposes instruction handlers in four groups: swap and redeem (which mint and burn THBG), stake and slash (which manage aggregator collateral), record-settlement (which receives the settlement value and Merkle root), and administrative instructions (which set parameters). Every handler enforces account constraints and uses checked arithmetic to prevent overflow conditions that could violate an invariant.

### 5.2 Program-Derived Addresses

State is held in program-derived addresses (PDAs). The configuration PDA stores the governance authority, system parameters, and the exchange rate. A settlement-record PDA is maintained per zone, storing the committed Merkle root, total settled value, VAT amount, and zone identifier. A stake-record PDA is maintained per aggregator, storing the collateral amount and the reward-accounting baseline (reward debt).

The decision to isolate settlement and stake records per zone and per aggregator is the most important performance lever in the design. The binding constraint on the SVM is write-lock contention — concurrent writes to a single account are serialized — rather than aggregate transaction throughput. Isolating state into per-zone PDAs allows writes from different zones to proceed in parallel without contending for a single account's write lock. This lever remains necessary under the private network because contention is a runtime property of the SVM, not a property of the public network.

### 5.3 Vault Accounts

The program controls four separated token accounts, each with a PDA as its authority so that only the program, via signed cross-program invocation, can move tokens. The swap vault backs THBG redemption. The stake vault holds aggregator collateral. The reward vault holds redistributed value from slashing. The THBG mint authority is also a PDA, ensuring that minting occurs only under the peg-ceiling check. The separation of these accounts mechanically enforces the vault-separation invariant: staked GRX never backs the THBG peg because it resides in a distinct account.

---

## 6. Settlement Data Flow

The settlement flow proceeds through the node network as follows. First, prosumer and consumer meters in a zone produce telemetry signed with Ed25519 keys and transmit it to the zone's aggregator. Second, the aggregator verifies the signatures, discards any unsigned or invalid readings, and runs the uniform-price auction to produce a set of matches and a marginal clearing price. Third, the aggregator separates the energy value (subject to VAT) from the token transfer (VAT-exempt under conditions) and computes the tax. Fourth, the aggregator builds a Merkle tree over the matches and retains the leaves for later proof. Fifth, the aggregator calls the record-settlement instruction through cross-program invocation, submitting the total value and Merkle root, signed by its market-authority PDA.

```
  meters            aggregator (off-chain)         treasury (on-chain)
  ------            ----------------------         -------------------
  [signed     ==>   1. verify Ed25519 sigs
   telemetry]          discard invalid
                   2. uniform-price auction
                      -> matches + P* (marginal)
                   3. split energy value | token xfer
                      -> compute VAT 7%
                   4. build Merkle tree
                      -> retain leaves (proof)
                   5. record_settlement (CPI)  ==>  write settlement_record
                      value + root                   [root, total, vat, zone]
                      signed by market_authority PDA  total_settled += value

  Non-custodial: aggregator submits value + root only; never holds funds.
  Payment occurs via user-initiated GRX -> THBG swap.
```

Importantly, the settlement is non-custodial: the aggregator submits only the value and the Merkle root and never holds user funds. Actual payment occurs through users swapping GRX for THBG, which they perform themselves. This structure reduces custodial risk and positions the aggregator as a data processor rather than a custodian.

---

## 7. Trust and Verification

The trust model is "trust, but verify, with stake at risk," rather than full horizontal Byzantine fault tolerance. Each zone's aggregator is trusted to a degree, but correctness is verified through the Merkle commitment and the challenge-response protocol, with staked collateral providing vertical accountability.

The principal threats the system addresses include an aggregator reporting false matches, fabricating energy quantities, dropping valid matches, committing a root that does not correspond to the true data, colluding with select users, and denial of service. Each is detectable through signed telemetry and Merkle proofs. The six-step challenge-response protocol proceeds from off-chain clearing, to on-chain commitment, to a challenge window, to fraud-proof submission, to on-chain adjudication, and finally to either slashing (if fraud is proven) or finalization (if the window expires without challenge).

Because the network is permissioned, the governance authority knows each aggregator in advance, which permits a much shorter challenge window than public optimistic systems require. This is a direct benefit of the permissioned design.

---

## 8. Design Rationale and Limitations

### 8.1 Why a Blockchain in a Permissioned Setting

The most pointed question a reviewer will raise is why a blockchain is needed at all when the network is closed and the utilities are trusted — why not a conventional database. The answer is that the blockchain provides three properties a conventional database does not. It provides tamper-evidence, so that retroactive alteration is detectable. It provides an audit trail that multiple parties can jointly verify without trusting a single database administrator. And it provides smart-contract enforcement of invariants at the code level — the peg ceiling, vault separation, slash conservation, and commitment binding are enforced mechanically rather than by an application layer that is easier to alter.

### 8.2 The Decentralization Trade-Off

The permissioned design accepts reduced decentralization in exchange for regulatory compliance and data privacy. In a state-regulated infrastructure context this is not a weakness when framed correctly: full decentralization is not the objective. The objective is a clear and accountable trust structure — the utilities serve as the guarantors — that remains auditable.

### 8.3 Positioning

This design situates the work alongside consortium and permissioned energy-blockchain systems rather than public decentralized-finance systems. The relevant comparison is to permissioned blockchain deployments in the energy sector, and the literature positioning should reflect this.

### 8.4 Limitations

Several limitations should be acknowledged. The single-trusted-aggregator-per-zone model does not provide horizontal Byzantine fault tolerance within a zone; correctness depends on the challenge-response mechanism and the economic deterrent of slashing. Cross-zone settlement that traverses EGAT's transmission grid is a future phase and would require coordination between aggregators that the current intra-zone design does not address. And the reduced decentralization concentrates consensus trust in the utilities, which is appropriate for this regulatory context but limits the system's applicability to settings where such a trusted authority structure exists.

---

## 9. Summary

The GridTokenX node network runs on a permissioned Solana deployment in which EGAT, MEA, and PEA operate consensus nodes, while private-sector aggregators perform market clearing for individual distribution zones under utility supervision. Consensus is two-tiered: transaction ordering is inherited from Solana, while settlement validity is enforced through optimistic commitment and challenge-response with staked collateral, not through horizontal voting. The node network maps onto Thailand's wholesale and retail market structure, with aggregators operating at the retail distribution layer where peer-to-peer trading occurs, and wheeling charges reflecting the two-layer transmission-plus-distribution cost. The on-chain treasury program enforces the system's invariants mechanically through separated vaults and per-zone account isolation, the latter remaining necessary under the private network because state contention is a runtime property of the SVM. The permissioned design trades decentralization for compliance and privacy, which is appropriate for a state-regulated electricity market, and positions the work within the consortium energy-blockchain literature rather than public decentralized finance.

---

*Note: The system runs on private permissioned Solana; application-layer code is identical to a public-Solana deployment. Regulatory and tariff facts were verified as of June 2026. This document describes system architecture and is not legal or financial advice.*
