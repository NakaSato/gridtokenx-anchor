# Reference: Thailand Electricity Market & PDP2026

> **STATUS: EXTERNAL RESEARCH REFERENCE** — sourced from public reporting/analysis (Bangkok
> Post, Ember Energy, ScienceDirect, Krungsri, Chambers, Hunton, IEA, and others; 20 sources,
> adversarially verified 3-vote per claim), not GridTokenX internal design. Cited here to
> ground [`role-map.md`](./role-map.md)'s institution mapping in the real market structure
> it targets. Verified 2026-07-04. Facts here can go stale — PDP2026 is still pending
> approval; re-check before relying on any figure for a live decision.

---

## Why this doc exists

`role-map.md` maps GridTokenX's on-chain authority scheme onto Thailand's real
energy-sector institutions (ERC, EGAT, MEA, PEA). This doc is the factual backing for that
mapping — what those institutions actually do today, and where the regulatory market itself
is headed, so the on-chain design can be checked against reality rather than assumption.

---

## Current state (baseline)

- **Fossil-heavy generation.** Coal + gas supplied **over 80%** of Thailand's electricity
  generation in 2024; gas alone ~68%. This is the baseline every reform below is trying to
  shift away from.
- **Enhanced Single Buyer (ESB), no wholesale market.** All generation is procured and
  resold through the ESB structure — there is no spot/wholesale electricity market. Rapid
  rooftop-solar and independent-supply growth has strained this: EGAT reports **~THB 98
  billion cumulative losses**, met with an 8–12% tariff hike.
- **June 2026 tariff restructuring, contested.** PM Anutin Charnvirakul's plan caps rates at
  3 baht/unit for the first 200 units, ~3.95 baht/unit for 200–400, ~5 baht/unit above 400 —
  framed as "fair burden-sharing," but criticized (e.g. by former senator Rosana Tositrakul)
  as a cost shift among consumer tiers rather than a fix for structural issues (availability
  payments, adder subsidies to private producers).

## The plan transition: PDP2024 → PDP2026

- **PDP2024 scrapped.** Despite passing public hearings, PDP2024 (2024–2037 draft) was
  shelved after analyst objections (targets called outdated — e.g. by Gunkul Engineering's
  CEO) and a change of government.
- **PDP2026 in progress.** The replacement plan (2026–2050 horizon) is expected for
  National Energy Policy Committee approval around **August–September 2026**. If approved,
  it becomes the roadmap to Thailand's 2050 net-zero target.
- **Ambition raised.** PDP2024's target was 51% renewables by 2037 (up from 22% in 2024).
  PDP2026 raises this to **~60% clean electricity by 2050** — same ambition class, longer
  horizon.
- **First-ever nuclear.** PDP2026 introduces small modular reactors (SMRs) for the first
  time. PDP2024-era figures cited 600 MWe via two 300 MWe units (Northeast + South,
  targeting 2037 commercial operation); PDP2026's final SMR figure — including larger
  2,000–4,000 MW numbers floated in discussion — is **unresolved pending approval**.
- **Hydrogen blending.** Gas plants are targeted for hydrogen blending starting at 5%,
  rising to 20% by 2035–2037.
- **Climate commitment tightened.** Under NDC 3.0 (cabinet-approved Nov 2025), net emissions
  must fall to 152 MtCO₂eq by 2035 (a 47% cut from the 379 Mt 2019 baseline), and the
  net-zero target moved up 15 years, to 2050.

## Market liberalization already underway

- **ERC regulatory sandbox** — testing Renewable Energy Communities (RECs), Direct PPAs via
  Third-Party Access (TPA), and potential VPP/demand-response/battery-storage deployment
  (the latter three still pre-operational).
- **Direct PPA / TPA timeline:** ERC's TPA framework took effect 3 May 2022 (2017 National
  Reform Plan) → NEPC Resolution No. 1/2024 (25 June 2024) launched a pilot capped at
  **2,000 MW**, aimed largely at data centers → ERC released draft implementing regulations
  3 October 2025.

## Institution roles (matches `role-map.md`'s 2026-07-04 revision)

| Institution | Statutory role | Real-world market role |
|---|---|---|
| **ERC** (Energy Regulatory Commission) | Independent regulator: licenses, tariffs, REC oversight, enforcement | Sets the sandbox/liberalization agenda (TPA, Direct PPA); the body Thailand's REC framework flows through |
| **EGAT** | Transmission monopoly, Single Buyer | The wholesale-level actor — bulk generation/transmission, the entity absorbing the ESB losses described above |
| **MEA / PEA** | Distribution utilities (metro / provincial) | Retail-level actors — the tariff restructuring above lands directly on their metro/provincial customer base |

## Open questions (unresolved as of verification date)

1. Will PDP2026 actually be approved in the Aug–Sept 2026 window, retaining the ~60%-by-2050
   target and nuclear/SMR inclusion — or revised/delayed again?
2. Will the Direct PPA/TPA cap (2,000 MW) rise given reported demand from data centers and
   renewable developers?
3. Will the 2026 tariff critique lead to structural reform (availability payments, adder
   subsidies) — or does the ESB model persist unchanged?
4. What SMR capacity figure actually locks in for PDP2026 — 600 MW, or the larger
   2,000–4,000 MW floated — and does the 2037 target survive?

## Sources

Primary: [IEA PDP policy page](https://www.iea.org/policies/28793-power-development-plan-pdp-draft),
[Ember Energy — Thailand's 2037 power sector targets](https://ember-energy.org/latest-insights/thailands-cost-optimal-pathway-to-a-sustainable-economy/thailands-2037-power-sector-targets/),
[ScienceDirect — Thai electricity market reform](https://www.sciencedirect.com/science/article/abs/pii/S0957178725002565).

Secondary: [Bangkok Post — climate pressure spurs energy revamp](https://www.bangkokpost.com/business/general/3212863/climate-pressure-spurs-thailands-energy-revamp),
[Bangkok Post — anger at power tariff plan](https://www.bangkokpost.com/thailand/general/3247977/anger-at-power-tariff-plan),
[Krungsri Research — SMR 2026](https://www.krungsri.com/en/research/research-intelligence/smr-2026),
[Chambers — Third-Party Access](https://chambers.com/articles/advancing-thailand-s-electricity-market-introduction-of-third-party-access),
[Hunton — Direct PPA draft regulation](https://www.hunton.com/insights/legal/thailands-draft-regulation-on-direct-power-purchase-agreements-via-third-party-access-for-data-centers).

Full 20-source list and per-claim verification votes: see the research-brief artifact generated
2026-07-04 (not checked into this repo — ephemeral session artifact).
