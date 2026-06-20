# GridTokenX — Wallet Management and Authority

> **⚠️ STATUS: MOSTLY IMPLEMENTED — one PROPOSED dependency.** The authority architecture here matches code: PDA-owned vaults (`swap_vault`/`stake_vault`/`reward_vault`), PDA THBG mint authority gated by the peg ceiling, custodian reserve attestation with freshness TTL, and scoped aggregator settlement signing. The **aggregator THBG collateral bond** (§6) is the exception — collateral is currently a **GRX** bond, and the THBG-bond model is PROPOSED (see the collateral-and-slashing doc).

This document specifies the wallet-management and authority structure of GridTokenX. It maps every authority-holding entity in the system, the keys and signing power each holds, the trust boundaries between them, and the principles governing key custody and access control. The document is organized into nine sections.

> **Security note:** This document describes the authority *architecture* — who holds what power and where the trust boundaries lie. It is not a key-management implementation guide. Real custody of private keys, in particular the governance multisig and the custodian's reserve keys, must be designed and audited by qualified security professionals. Nothing here should be treated as a substitute for a security audit. The author is not a security or legal advisor.

---

## 1. Authority Model Overview

GridTokenX distributes authority across five distinct entity types, each with a bounded scope of power. The guiding principle is least privilege: each entity holds exactly the authority required for its role and no more, and the most powerful actions require multiple parties. The five entity types are the governance authority, the program (PDA) authority, the mint authority, the custodian, and user wallets.

A central design property is that the most sensitive on-chain assets — the token vaults and the mint — are not controlled by any human-held key directly. They are controlled by program-derived addresses, which can only act through the treasury program's logic. This means that even a compromised individual key cannot move vault funds or mint tokens arbitrarily; it can only invoke program instructions, which enforce the system's invariants.

```
  AUTHORITY MAP (least privilege, multi-party for sensitive actions)

  +------------------+        +---------------------------+
  | GOVERNANCE       |        | CUSTODIAN                 |
  | EGAT/MEA/PEA     |        | (off-chain THB reserve)   |
  | multisig         |        | signs reserve attestation |
  | admit/slash/     |        +-------------+-------------+
  | set_params       |                      |
  +--------+---------+                      | attest (signed)
           | authority                      v
           | (signer)              +-----------------+
           v                       | config PDA      |
  +---------------------------+    | R_attested, TTL |
  | TREASURY PROGRAM          |<---+-----------------+
  | enforces invariants       |
  | acts via invoke_signed    |
  +-----+----------+----------+
        |          |
        | PDA      | PDA authority
        | authority|
        v          v
  +-----------+  +-----------+   +-------------------------+
  | VAULTS    |  | THBG MINT |   | USER WALLETS            |
  | (PDA-     |  | (PDA-     |   | prosumer / consumer     |
  |  owned)   |  |  owned)   |   | self-custody keys       |
  +-----------+  +-----------+   | sign own swap/redeem    |
                                 +-------------------------+
  Aggregator: holds a market-authority key to sign
              record_settlement for its zone (scoped).
```

---

## 2. Governance Authority

The governance authority is held by the utilities — EGAT, MEA, and PEA. It is the most powerful authority in the system, because it can admit and revoke aggregators, slash collateral, and set system parameters. For this reason it should be held as a multisignature arrangement rather than a single key, so that no single utility or individual can act unilaterally.

The governance authority's powers are bounded to specific instruction handlers. It can call the administrative instructions that set parameters such as the exchange rate, fees, and minimum bond. It can admit a new aggregator by recording its authorization, and revoke one. It can execute a slash following a proven fraud. It cannot, however, move vault funds arbitrarily, mint tokens outside the peg ceiling, or alter settled records — those actions are governed by the program logic and the invariants, not by the governance key.

Because the governance authority maps onto the differentiated market structure, its powers are also territorially scoped in practice: MEA admits and slashes aggregators in the metropolitan zones, PEA in the provincial zones, and EGAT governs the wholesale layer. The multisig structure should reflect this — a threshold of the relevant utility signers for actions within a territory, with system-wide parameter changes requiring a broader threshold.

---

## 3. Program (PDA) Authority

Program-derived addresses are the heart of the security model. A PDA is an address that has no private key; it can only be "signed for" by the program that owns it, through the `invoke_signed` mechanism. GridTokenX uses PDAs as the authority over the most sensitive assets so that no human key can move them directly.

The vault accounts — swap vault, stake/collateral vault, and reward or fund accounts — have a PDA as their authority. This means tokens can leave a vault only when the treasury program runs an instruction that constructs a signed invocation, and that instruction enforces the relevant guards (for example, that a redemption does not exceed the vault balance, or that a swap does not breach the peg ceiling). A compromised user or aggregator key cannot drain a vault, because the vault does not answer to any user key — it answers only to the program.

The THBG mint authority is likewise a PDA. New THBG can be created only when the program runs the swap instruction and the peg-ceiling check passes. There is no human key that can mint THBG at will. This is what makes the peg ceiling a mechanically enforced invariant rather than a policy that a key-holder could violate.

---

## 4. Mint Authority

The mint authority deserves separate emphasis because it is the point where new value enters the system. In GridTokenX the THBG mint authority is a program-derived address, so minting is gated entirely by program logic. The sequence is that a user's swap deposits GRX, the program checks the peg ceiling and attestation freshness, and only if both pass does the program, acting through the PDA, mint THBG to the user. No party — not the governance authority, not the custodian, not an aggregator — can mint THBG by holding a key. This separation is deliberate: it ensures that the peg-ceiling invariant cannot be bypassed by any key compromise, because the only path to minting runs through the program's checks.

The GRX token's issuance authority, if the supply model involves issuance, should be treated with the same discipline: issuance gated by program logic under a defined schedule, not by a freely-held mint key. Where GRX has a fixed supply, the mint authority should be retired (set to none) after initial issuance so that no further GRX can ever be created.

---

## 5. Custodian Authority

The custodian holds the off-chain baht reserve that backs THBG and signs the reserve attestations that the program records. The custodian's authority is narrow but critical: it can update the attested reserve value and its freshness timestamp, which together cap how much THBG can exist. The custodian cannot mint, move vaults, or slash; it can only attest.

The trust placed in the custodian is the system's principal off-chain trust assumption. Two safeguards bound it. First, the attestation is signed, so the program accepts reserve updates only from the authorized custodian key, and that key should itself be a multisig or an institutionally-held key under audit. Second, the attestation-freshness rule means a stale or withheld attestation suspends minting rather than allowing minting against an unverified reserve — so a custodian failure fails safe (minting stops) rather than fails open (minting against nothing). Independent third-party audit of the reserve is the appropriate external control on custodian honesty.

---

## 6. Aggregator Authority

Each aggregator holds a scoped signing authority used to submit settlements for its zone. This is typically realized as a market-authority key (or PDA) that the program recognizes as authorized to call `record_settlement` for that specific zone. The authority is scoped: an aggregator can submit settlements only for the zone it was admitted to, and cannot act for another zone or perform governance actions.

The aggregator's economic accountability is separate from its signing authority and is carried by the THBG collateral bond described in the collateral-and-slashing model. The signing key lets the aggregator act; the bond is what it stands to lose if it acts dishonestly. If an aggregator key is compromised, the damage is bounded by two factors: the compromised key can only submit settlements (which are subject to the challenge-response window and fraud proofs), and the bond is at risk if those settlements are fraudulent. The governance authority can revoke a compromised aggregator's authorization.

---

## 7. User Wallets

Prosumers and consumers hold self-custody wallets — standard keypairs that sign their own transactions. A user wallet's authority is limited to acting on its own assets: signing swaps of its own GRX, redemptions of its own THBG, and submitting its own bids and offers to its zone's aggregator. A user wallet cannot affect vaults, the mint, other users' assets, or any governance action.

Because users self-custody, key loss is a user-side risk that the protocol cannot reverse — there is no administrative key that can recover or seize a user's wallet, which is a deliberate property that preserves user sovereignty over their own assets. For a production deployment serving ordinary electricity customers, this argues for wallet abstractions that ease key management for non-technical users (for example, custodial or social-recovery options offered at the application layer), while preserving the protocol-level property that the core system holds no power over user funds. Any such convenience layer is an application-level choice and should be clearly distinguished from the protocol's trust model.

---

## 8. Trust Boundaries and Separation of Powers

The authority structure enforces a separation of powers that bounds the damage from any single compromise. The table below summarizes what each authority can and cannot do.

| Authority | Can do | Cannot do |
|---|---|---|
| Governance (multisig) | admit/revoke/slash, set params | move vaults, mint at will, alter settled records |
| Program (PDA) | move vaults/mint via enforced logic | act outside program instructions |
| Mint (PDA) | mint THBG only under peg ceiling | mint without passing checks |
| Custodian | attest reserve value + freshness | mint, move vaults, slash |
| Aggregator | submit settlement for its zone | act for other zones, govern |
| User wallet | act on own assets | affect vaults, mint, others' assets |

Two properties follow. First, the most sensitive actions — moving vault funds and minting — are controlled by program logic via PDAs, not by any human key, so no key compromise alone can perform them outside the invariants. Second, the most powerful human authority (governance) is a multisig and is bounded away from the sensitive on-chain assets, so even the utilities cannot unilaterally drain funds or mint tokens. The custodian's power is the narrowest that is still critical, and it fails safe.

---

## 9. Key-Custody Principles

While implementation requires a security audit, the architecture implies several custody principles. The governance authority should be a multisignature arrangement with thresholds reflecting the territorial structure, held by institutionally-secured keys. The custodian key should likewise be multisig or institutionally held and subject to independent reserve audit. PDA-controlled assets need no key custody by design, which is a security benefit — there is no key to steal for the vaults or the mint. Aggregator keys are scoped and revocable, so their compromise is bounded and recoverable through revocation. User keys are self-custodied, with optional application-layer recovery aids that must not reintroduce protocol-level control over user funds. Across all of these, the unifying principle is that sensitive power is either held by no key at all (PDAs) or held by multiple parties (multisig), and never by a single recoverable point of failure.

---

## 10. Summary

GridTokenX distributes authority across governance, program (PDA), mint, custodian, aggregator, and user-wallet roles under a least-privilege model. The defining property is that the most sensitive assets — vaults and the mint — are controlled by program-derived addresses and act only through enforced program logic, so no human key compromise can move them outside the invariants. The governance authority, held as a territorially-structured multisig by EGAT, MEA, and PEA, holds the most powerful human authority but is bounded away from direct asset control. The custodian's narrow attestation power fails safe through the freshness rule. Aggregator authority is scoped and revocable, with economic accountability carried by the separate THBG bond. User wallets self-custody with no protocol-level override. Together these boundaries ensure that no single compromise — of a user, an aggregator, the custodian, or even a governance signer — can violate the system's invariants, and that the most dangerous actions require either program logic or multiple parties. Implementation of the underlying key custody requires a dedicated security audit.

---

*Note: This document describes the authority architecture and trust boundaries; it is not a key-management implementation guide and does not substitute for a security audit. Multisig thresholds, recovery mechanisms, and custody arrangements are design parameters to be set with security professionals. The author is not a security or legal advisor.*
