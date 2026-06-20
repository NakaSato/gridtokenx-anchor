# GridTokenX — Full Cost and Fee Structure (Wheeling, VAT, Transaction Fees)

> **⚠️ STATUS: RESEARCH FRAMEWORK — economic figures external; some on-chain hooks PROPOSED.** Tariff, wheeling, Ft, and VAT figures are external regulatory facts (illustrative, not yet final). On the code side: the swap fee (`grx_per_thbg_rate`, fee in bps) is implemented, but **on-chain VAT recording** (§4.3) and **single-Merkle-root batched settlement** (§5) are not — `record_settlement` stores a value only, with no VAT or Merkle field. Treat those two as target design.

This document specifies the complete economic cost structure of a GridTokenX transaction: every charge, fee, and tax that flows through a peer-to-peer energy trade, and how they compose into the final settlement. It covers the wheeling charge, value-added tax (VAT), the fuel adjustment charge (Ft), blockchain transaction fees, the swap fee, the aggregator margin, and the TPA administrative fees. It is organized into eleven sections.

> **Note:** Prices and rates were verified as of June 2026 and are base figures before Ft and VAT unless stated otherwise. The wheeling charge and TPA Code are not yet final. This document is a structural and economic framework for research and is not investment, tax, or legal advice; the author is not a tax or legal advisor.

---

## 1. The Cost Stack Overview

A peer-to-peer energy trade in GridTokenX carries several distinct cost components that sit between the producer's revenue floor and the consumer's retail alternative. Understanding tokenomics requires seeing how these compose. The components fall into three groups: energy-price components (retail tariff, buyback floor, Ft), grid-and-regulatory components (wheeling charge, TPA fees, VAT), and platform components (blockchain transaction fee, swap fee, aggregator margin).

```
  COST STACK OF A P2P TRADE (per unit, illustrative)

  consumer's retail alternative  ~ 4.10 THB (On-Peak, Type 3-4)
        |
        |  P2P trade routes value differently:
        v
  +----------------------------------------------+
  | clearing price P* (market-derived)           |  e.g. 2.59
  +----------------------------------------------+
  | + wheeling charge (transmission+distribution)|  ~ 1.10
  +----------------------------------------------+
  | + VAT 7% (on energy value)                   |  on energy
  +----------------------------------------------+
  | + blockchain tx fee (per settlement, tiny)   |  ~ 0 per unit
  +----------------------------------------------+
  | + swap fee (bps, on GRX->THBG)               |  design param
  +----------------------------------------------+
  | + aggregator margin (small, from spread)     |  ~ 0.05
  +----------------------------------------------+
  buyback floor (producer's alternative)         ~ 2.20
```

The arithmetic that makes the system viable is that the consumer's all-in P2P cost must stay below their retail alternative, while the producer's net receipt must stay above their buyback floor, with all the components in between fitting inside that spread.

---

## 2. Energy-Price Components

### 2.1 Retail Tariff

The retail tariff is the price a consumer pays the utility and is the consumer's baseline alternative to a P2P trade. For May–August 2026 the ERC set the average tariff at 3.95 baht per unit, combining a base tariff of 3.78 baht with the Ft of 0.1623 baht, before 7% VAT. Under time-of-use, Type 3–4 customers (69 kV and above) pay 4.1025 baht On-Peak and 2.5849 baht Off-Peak before Ft and VAT; Type 1–2 customers pay substantially more On-Peak.

### 2.2 Buyback Floor

The buyback floor is the price a producer receives for exporting surplus to the grid and is the producer's baseline alternative. The current floor under the Solar Rooftop for the Public net-billing program is 2.20 baht per unit, fixed for ten years for systems up to 5 kW. A higher incentive rate of 2.70 baht has also been approved. The earlier 1.68-baht figure is an outdated second-tier net-billing rate and should not be used.

### 2.3 The Fuel Adjustment Charge (Ft)

The Ft is a variable surcharge the ERC resets every four months to reflect fuel and power-purchase costs. For May–August 2026 it is 0.1623 baht per unit, applied to all customer types under both MEA and PEA before VAT. In the cost stack, the Ft is part of the retail tariff a consumer would otherwise pay, so it affects the consumer's baseline rather than the P2P clearing price directly.

---

## 3. The Wheeling Charge

The wheeling charge is the fee for using the grid to transport P2P-traded energy, and it is the largest single deduction in the cost stack. It has two structural features that are essential to tokenomics.

First, it is a two-layer charge. The ERC has set the wheeling charge basis on the existing tariff structure, which already includes both transmission and distribution service-charge components. The charge therefore covers transmission (paid in respect of EGAT's grid) and distribution (paid in respect of MEA's or PEA's grid), and it applies even when a trade occurs entirely within a single distribution zone. This is why the wheeling charge is on the order of 1.10 baht per unit rather than a single-layer cost: the figures under consideration range from approximately 1.07 baht (draft Direct PPA pilot) to 1.151 baht (ERC Sandbox), and the final rate is not yet settled.

Second, it is not yet final. The wheeling charge depends on the finalization of the Third-Party Access (TPA) Code, which the ERC is still coordinating with the utilities. Because the charge consumes roughly half of the usable price spread, its final value is the single most important external variable for the system's economics, and the system has no control over it. The sensitivity of the win-win-win outcome to this charge is analyzed in the pricing documents.

---

## 4. Value-Added Tax (VAT)

### 4.1 Rate and Scope

The standard VAT rate is 10 percent but is currently reduced to 7 percent (inclusive of local tax) through 30 September 2026 under Royal Decree No. 799, unless extended. The reduced rate has a near-term expiry, so the system must treat the VAT rate as an adjustable parameter rather than a hard-coded constant.

### 4.2 The Taxable-Component Split

The defining principle of the VAT design is that a single P2P transaction has two components with different tax status. The energy value — the electricity the consumer pays for — is subject to 7 percent VAT. The token transfer — the movement of THBG or GRX — is VAT-exempt under Royal Decree No. 788 when conducted through a licensed digital-asset operator. The VAT is therefore computed on the energy value only. Let $V_{\text{energy}}$ be the energy value and $r_{\text{vat}}$ the VAT rate.

$$\text{VAT} = V_{\text{energy}} \cdot r_{\text{vat}} \tag{1}$$

$$V_{\text{total}} = V_{\text{energy}} \cdot (1 + r_{\text{vat}}) \tag{2}$$

### 4.3 Computation Point and Caveat

VAT is computed at the aggregator layer during clearing, where the energy value, VAT amount, and rate used are recorded separately in the settlement record so that e-Tax invoices can be issued and audited. An important caveat applies: the VAT-exemption of token transfers depends on the legal classification of the tokens. If THBG is classified as e-money rather than a digital token — which the Bank of Thailand may determine — the exemption pathway changes. This classification must be resolved with the relevant authorities.

---

## 5. Blockchain Transaction Fees

On the permissioned Solana deployment, blockchain transaction fees are internally governed rather than set by a volatile public gas market. This is a deliberate advantage: on the public mainnet, fees fluctuate with network congestion, which would inject unpredictable cost into settlement. On the private network, the operator controls fees, and they can be kept negligible per settlement.

The per-unit impact of transaction fees is essentially zero because of batching. The non-custodial settlement design submits one transaction per zone per settlement period carrying many matched trades under a single Merkle root, rather than one transaction per trade. The fixed cost of that single transaction is amortized across all the energy in the batch, so the per-kWh transaction-fee cost is negligible. This is a central tokenomic point: batching is what keeps the blockchain cost from eroding the narrow price spread.

---

## 6. The Swap Fee

The swap fee is charged when GRX is converted to THBG. Let $\phi$ denote the fee in basis points and $T_{\text{gross}}$ the gross THBG amount. The fee deducted is

$$\text{fee} = \frac{T_{\text{gross}} \cdot \phi}{10{,}000} \tag{3}$$

The swap fee is a design parameter that funds system operations or a reserve. It must be set carefully because it sits inside the narrow usable spread: too high a swap fee erodes the producer's net receipt below the level that makes P2P worthwhile. The swap fee and the aggregator margin together constitute the platform's revenue, and both must fit within the spread that remains after the wheeling charge.

---

## 7. The Aggregator Margin

The aggregator's operating margin is taken as a small per-unit charge from within the price spread, compensating it for performing clearing, VAT computation, commitment, and settlement. Because the usable spread after the wheeling charge can be as small as a few tenths of a baht per unit, the aggregator margin must be small — on the order of a few satang per unit. This is the economic core of the platform's design constraint: the margin available to the intermediary is structurally narrow, which is precisely why the architecture must be low-overhead. An aggregator with high operating costs could not fit its margin inside the spread, so efficiency is a necessary condition for the platform to function, not merely a desirable property.

---

## 8. TPA Administrative Fees

Beyond the per-unit wheeling charge, the Direct PPA framework defines fixed administrative fees that an aggregator or participant pays to obtain and maintain grid access. The ERC has approved, for the Direct PPA pilot, a connection charge of 10,000 baht, an Available Transfer Capacity allocation fee of 125,000 baht, a contract-rights transfer fee of 10,000 baht, and an annual fee of 120,000 baht. These are not per-unit costs; they are fixed costs of operating as a grid-access holder, and they factor into the aggregator's business case rather than into the per-trade cost stack. An aggregator must recover these fixed costs across the volume it clears, which reinforces the case for aggregators operating at sufficient zone scale.

---

## 9. The Full Composition

Putting the components together, the consumer's all-in cost per unit in a P2P trade is the clearing price plus the wheeling charge plus VAT on the energy value, while the producer's net receipt is the clearing price minus the swap fee and the aggregator margin. Let $P^*$ be the clearing price, $w$ the wheeling charge, $r_{\text{vat}}$ the VAT rate, $\phi$ the swap fee fraction, and $m$ the aggregator margin per unit. The consumer's all-in cost is approximately

$$C_{\text{consumer}} = (P^* + w)\,(1 + r_{\text{vat}}) \tag{4}$$

and the producer's net receipt is approximately

$$R_{\text{producer}} = P^* - \phi \cdot P^* - m \tag{5}$$

The win-win-win condition requires that the consumer's all-in cost stay below the retail alternative and the producer's net receipt stay above the buyback floor:

$$C_{\text{consumer}} < R_{\text{retail}} \quad\text{and}\quad R_{\text{producer}} > P_{\text{buyback}} \tag{6}$$

Both conditions must hold simultaneously, which is only possible when the sum of wheeling, VAT, swap fee, and aggregator margin fits inside the spread between retail and buyback. This is the arithmetic that the narrow Thai spread makes tight, and that the low-overhead architecture is designed to satisfy.

---

## 10. Worked Composition Example

Using illustrative numbers for Type 3–4 On-Peak: retail $R_{\text{retail}} = 4.1025$, buyback $P_{\text{buyback}} = 2.20$, wheeling $w = 1.10$, clearing $P^* = 2.59$, VAT $r_{\text{vat}} = 0.07$, swap fee $\phi = 0.005$ (50 bps), and aggregator margin $m = 0.05$. The consumer's all-in energy cost before VAT is $2.59 + 1.10 = 3.69$, and the producer's net receipt is $2.59 - 0.013 - 0.05 = 2.527$. The consumer pays roughly 3.69 against a retail alternative of 4.1025 (a saving), and the producer receives roughly 2.53 against a buyback floor of 2.20 (a gain). VAT applies to the energy value on top, mirroring the VAT the consumer would also pay on retail. Every party is better off, with the platform's swap fee and margin fitting inside the spread.

---

## 11. Summary

The full cost structure of a GridTokenX trade comprises energy-price components (retail tariff, buyback floor, Ft), grid-and-regulatory components (the two-layer wheeling charge, TPA administrative fees, and VAT on energy value only), and platform components (negligible batched blockchain fees, the swap fee, and the aggregator margin). The wheeling charge is the largest deduction and the most important external uncertainty, consuming roughly half the usable spread and not yet finalized. VAT applies only to the energy value, with the token-transfer exemption contingent on token classification. Blockchain fees are negligible per unit because of batching, which is what protects the narrow spread. The swap fee and aggregator margin are the platform's revenue and must fit inside the spread that remains, which is structurally narrow in the Thai market — and that narrowness is the economic reason the system's low-overhead architecture is a necessary condition rather than a convenience.

---

*Note: Rates verified as of June 2026; base figures before Ft and VAT unless stated. Wheeling charge and TPA Code are not final. Worked numbers are illustrative. Equation numbers use `\tag{n}`; variables are italic mathematical symbols. This document is not investment, tax, or legal advice.*
