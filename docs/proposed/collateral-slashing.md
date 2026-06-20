# GridTokenX — Aggregator Collateral and Slashing Model (Full)

> **⚠️ STATUS: PARTIALLY IMPLEMENTED (updated 2026-06-21).** The **slash distribution mechanics** of this model are now in code and on-chain verified: `registry::slash_validator` (`programs/registry/src/lib.rs:839`) applies a **severity fraction** σ (`slash_bps`, governance-attested per slash), pays **capped victim compensation** = `min(slash_amount, proven_loss)`, routes the remainder to a **transparent fund** (`slash_destination`, typically the treasury `reward_vault`, redistributed via `fund_rewards`), demotes a partially-slashed validator to **`Suspended`** when the remaining bond drops below `MIN_VALIDATOR_STAKE` (full forfeiture → terminal `Slashed`), and enforces the value invariant `slash_amount == compensation + fund`. Verified in `tests/staking.ts` (11/11: partial→Suspended, capped comp both directions, invariant, CU ≈ 27.8k). **Still forward design (not in code):** the bond is **GRX**, not THBG (decision D1 keeps the existing `registry::stake_grx` / `MIN_VALIDATOR_STAKE` bond — THBG-denominated collateral + migration deferred); **multi-victim pro-rata** payout (current compensation pays a single victim account); a **distinct transparent-fund PDA with published accounting** (current routes to the existing `slash_destination`); and the **Merkle / challenge-response trustless adjudication** (§§ below) — deferred behind the §3 feasibility spike, which found the on-chain exclusion-proof verify cheap (~3.6k CU) but gated on a settlement-finality/challenge-window redesign. The registry bond is already **no-reward** (the treasury `acc_reward_per_share`/`reward_pool` yield-staking is a separate product). Treat THBG-bond / multi-victim / trustless-challenge statements as target design; the slash-distribution sections describe shipped behavior.

This document is the complete specification of the aggregator collateral and slashing model for GridTokenX. It expands the revised model — THBG-denominated collateral, no reward, and capped victim compensation — into full operational detail: the bond lifecycle, the challenge-to-slash sequence, partial versus full slashing, the fund mechanics, worked numerical examples, and the invariants. It is organized into twelve sections.

> **Note:** This model runs on the same permissioned Solana deployment and treasury-program structure as the rest of the system. Bond sizes, slash fractions, and fund earmarking are design parameters to be set during deployment and calibration. This document describes the economic structure of the system and is not investment, tax, or legal advice.

---

## 1. Model Summary

An aggregator operating a zone must post a performance bond denominated in THBG, the baht-pegged stablecoin. The bond earns no reward; it is a pure cost of obtaining the right to operate. If the aggregator is proven to have misbehaved, its bond is slashed, and the slashed amount is distributed by compensating harmed parties up to their on-chain-provable loss, with any remainder going to a transparent governance fund. GRX plays no role in collateral or slashing; it retains only its swap role as the energy-linked settlement-input token.

The model rests on a single security condition. With no reward, an aggregator behaves honestly only because dishonesty is expected to lose more than it gains. Let $G_{\text{cheat}}$ be the gain from cheating, $p$ the probability of being detected and proven, and $L_{\text{slash}}$ the bond value at risk. Honest behavior is rational when

$$p \cdot L_{\text{slash}} > G_{\text{cheat}} \tag{1}$$

Every parameter in this document is ultimately in service of keeping this inequality true.

---

## 2. The Bond Lifecycle

The bond passes through four stages: posting, active service, exit, and the off-ramp.

At **posting**, an entity applying to operate a zone deposits a THBG bond of at least the minimum required amount into the collateral vault, locked under the governance authority for its territory. Because THBG is pegged one-to-one to the baht, the bond's baht value equals its THBG amount and does not fluctuate during service.

During **active service**, the bond is locked and at risk. The aggregator performs clearing, computes VAT, commits Merkle roots, and submits settlements. Each settlement enters a challenge window during which the bond can be slashed if fraud is proven.

At **honest exit**, when an aggregator ceases service without any open or upheld challenge, the bond is returned in full after a final settlement period elapses, ensuring no late challenges remain.

The **off-ramp** acknowledges that the returned bond is THBG. The aggregator may redeem THBG to GRX, or hold it, according to the standard token mechanics. The bond's value is preserved through service because it never depended on a volatile asset.

```
  BOND LIFECYCLE

  POST                ACTIVE SERVICE              EXIT
  deposit THBG  -->   bond locked & at risk  -->  return bond
  >= B_min            (each settlement has        (after final
  to collateral       a challenge window)          window, if
  vault                                             no upheld
                                                    challenge)
                            |
                            | fraud proven
                            v
                          SLASH
                  (compensate victims, capped;
                   remainder to fund)
```

---

## 3. Minimum Bond Sizing

The minimum bond $B_{\min}$ is the parameter that most directly controls the deterrent. It must satisfy the security condition for the maximum plausible single-settlement gain from cheating in the zone. If $G_{\max}$ is the largest amount an aggregator could extract by a single fraudulent settlement and $p$ is the detection probability, then from the security condition the bond must satisfy

$$B_{\min} > \frac{G_{\max}}{p} \tag{2}$$

This makes the sizing logic explicit. A zone handling larger transaction value has a larger $G_{\max}$ and therefore needs a larger bond. A lower detection probability requires a larger bond to compensate. Because $G_{\max}$ scales with the zone's traded volume, $B_{\min}$ should be set per zone in proportion to that volume, not as a single system-wide constant. Since the bond is in stable THBG, this calculation is performed directly in baht.

---

## 4. The Challenge-to-Slash Sequence

Slashing is never unilateral; it follows from a proven challenge. The sequence has six steps, integrating the challenge-response protocol with the THBG bond.

First, the aggregator commits a settlement (value and Merkle root) on-chain. Second, the challenge window opens. Third, a challenger — a harmed user or the governance authority — submits a fraud proof consisting of signed telemetry that contradicts the committed root, or a Merkle proof that a valid match was dropped. Fourth, the program adjudicates by verifying the meter signatures and the Merkle proof. Fifth, if the fraud is proven, the program computes the harm and executes the slash from the bond. Sixth, if the window expires with no upheld challenge, the settlement finalizes and the bond remains intact for that settlement.

The critical property is that adjudication is mechanical: it rests on cryptographic verification of signed telemetry and Merkle proofs, not on discretion. This is what allows slashing to be both automatic and fair — the bond is touched only when the math proves fraud.

---

## 5. Partial versus Full Slashing

Not every proven fault warrants forfeiting the entire bond. The model supports a slash fraction that scales the penalty to the severity of the fault. Let $\sigma \in (0, 1]$ be the slash fraction for a given fault class and $B$ the posted bond. The slashed amount is

$$\Delta_{\text{slash}} = \sigma \cdot B \tag{3}$$

A minor, recoverable fault (for example, a single mis-rounded settlement that harmed one party slightly) may carry a small $\sigma$, while egregious fraud (systematic fabrication of matches) carries $\sigma = 1$, full forfeiture. The slash fraction per fault class is a design parameter. Partial slashing has a subtlety worth noting: after a partial slash, the remaining bond may fall below $B_{\min}$, in which case the aggregator must top up the bond to continue operating, or be revoked. This top-up requirement prevents an aggregator from absorbing repeated small slashes while staying below the deterrent threshold.

---

## 6. The Slash Distribution Rule

When a slash of amount $\Delta_{\text{slash}}$ is executed, it is distributed by capped victim compensation. Let $L_{\text{proven}}$ be the total on-chain-provable loss of the harmed parties in the fraudulent settlement. Compensation and the fund remainder are

$$\text{compensation} = \min(\Delta_{\text{slash}},\, L_{\text{proven}}) \tag{4}$$

$$F = \Delta_{\text{slash}} - \min(\Delta_{\text{slash}},\, L_{\text{proven}}) \tag{5}$$

Harmed parties are compensated in proportion to their individual proven losses. If the slashed amount is insufficient to cover all proven losses (because the bond was too small or only partially slashed), compensation is pro-rated across harmed parties by their proven loss, and the fund remainder $F$ is zero.

The compensation is capped at proven loss for a specific reason: it removes the bounty-gaming incentive. If a successful challenge could pay more than the actual loss, parties would have motive to manufacture fraud, collude to stage violations, or file frivolous challenges. Capping compensation at proven loss means a challenger cannot profit beyond what they actually lost, so manufacturing fraud yields no surplus, while genuine victims still have a real reason to bring proofs.

---

## 7. The Transparent Fund

The remainder after compensation flows to a governance-controlled fund. To address the conflict of interest that arises when the entity that executes the slash also receives the residual, the fund must be ring-fenced and transparent. Concretely, the fund should be a designated on-chain account with published accounting, earmarked for a purpose that benefits the system's participants rather than the slashing authority's general budget — for example, grid maintenance, system development, or a consumer-protection reserve. In a utility-regulated context this mirrors how infrastructure penalties commonly flow to a regulated fund, and the on-chain transparency is what makes it defensible to a regulator and to the aggregators who post bonds.

---

## 8. Worked Examples

The following examples use illustrative numbers to show the mechanics. They are not calibrated values.

**Example 1 — Full slash, victim fully compensated.** An aggregator posts a bond of $B = 500{,}000$ THBG. It fabricates a settlement that harms two buyers by a proven total of $L_{\text{proven}} = 120{,}000$ THBG. The fault is egregious, so $\sigma = 1$ and $\Delta_{\text{slash}} = 500{,}000$. Compensation is $\min(500{,}000,\, 120{,}000) = 120{,}000$ THBG, distributed to the two buyers by their proven losses. The fund receives $F = 500{,}000 - 120{,}000 = 380{,}000$ THBG. The aggregator is revoked.

**Example 2 — Partial slash, top-up required.** The same aggregator commits a minor mis-rounding harming one party by a proven $L_{\text{proven}} = 8{,}000$ THBG. The fault class carries $\sigma = 0.1$, so $\Delta_{\text{slash}} = 50{,}000$ THBG. Compensation is $\min(50{,}000,\, 8{,}000) = 8{,}000$ THBG to the harmed party. The fund receives $F = 42{,}000$ THBG. The remaining bond is $500{,}000 - 50{,}000 = 450{,}000$ THBG; if $B_{\min}$ for the zone is $450{,}000$ or below, the aggregator may continue, otherwise it must top up.

**Example 3 — Bond too small to cover harm.** An under-bonded aggregator with $B = 100{,}000$ THBG fabricates a settlement harming parties by a proven $L_{\text{proven}} = 150{,}000$ THBG, with $\sigma = 1$. The slash yields only $100{,}000$ THBG, which is fully distributed to harmed parties pro-rata (each receives two-thirds of their proven loss), and the fund receives nothing. This example illustrates why $B_{\min}$ must be sized per equation (2) to cover plausible maximum harm.

---

## 9. Incentive Analysis

Because the bond earns no reward, the aggregator's expected payoff from honesty is simply the preservation of its bond, while the expected payoff from cheating is the gain minus the probability-weighted loss. Honesty dominates when equation (1) holds. The model concentrates the entire security argument on two parameters.

The bond $L_{\text{slash}} = B$ must be large enough, per equation (2), that even a high-value fraud is not worth attempting at the prevailing detection probability. Because the bond is in stable THBG, this is a direct baht calculation with no asset-price uncertainty.

The detection probability $p$ must be high enough that $p \cdot B$ exceeds the cheating gain. Detection depends on someone being motivated to challenge, which is exactly what the capped-compensation rule protects: genuine victims have a reason to bring proofs, raising $p$, without the over-incentivization that uncapped compensation would create. The governance authority also acts as a standing challenger, providing a baseline $p$ independent of user vigilance.

---

## 10. Comparison with the Earlier GRX-Staking Model

| Dimension | Earlier model | This model |
|---|---|---|
| Collateral asset | GRX | THBG |
| Bond value | Fluctuates with GRX price | Stable in baht |
| Reward for posting | Yes (accumulator) | None |
| Slashed funds go to | Redistributed to honest stakers | Capped victim compensation + fund |
| Partial slashing | Not specified | Supported, with top-up |
| Honesty driver | Yield + deterrent | Deterrent only |
| Liquidity-drain risk | Required analysis | Not applicable |

---

## 11. Invariants

The model changes one invariant and leaves the others intact. The former slash-conservation invariant (redistribution to honest stakers) is replaced by a value-accounting invariant: the slashed amount equals the sum of compensation paid and the amount sent to the fund, with no value created or destroyed.

$$\Delta_{\text{slash}} = \text{compensation} + F \tag{6}$$

The collateral vault holding THBG bonds is separate from the swap vault that backs the peg, so the vault-separation principle still holds: collateral does not back the peg, enforced by account separation. The peg-ceiling and commitment-binding invariants are unaffected.

---

## 12. Summary

The aggregator collateral model posts a THBG bond as a non-yielding performance bond, sized per zone so that the deterrent condition $p \cdot L_{\text{slash}} > G_{\text{cheat}}$ holds. Slashing follows only from a mechanically adjudicated fraud proof, supports partial penalties scaled to fault severity with a top-up requirement, and distributes slashed funds by capped victim compensation with the remainder to a transparent fund. The capped-compensation rule protects the detection probability without opening a bounty-gaming attack surface, and the transparent fund addresses the conflict-of-interest concern. Because the bond is stable THBG, the entire security argument reduces to two clear baht-denominated parameters — the bond size and the detection probability — making the model simpler and more analyzable than the earlier GRX-staking design.

---

*Note: $B_{\min}$, the slash fractions $\sigma$, and the fund earmarking are design parameters. Worked examples use illustrative, uncalibrated numbers. Equation numbers use `\tag{n}` continuously within this document; variables are set as italic mathematical symbols. This document is not investment, tax, or legal advice.*
