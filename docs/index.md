---
layout: home

hero:
  name: GridTokenX
  text: Blockchain Performance Analysis
  tagline: "A Thesis on TPC Benchmark Methodology for P2P Energy Trading Platforms"
  actions:
    - theme: brand
      text: Read Thesis
      link: /guide/getting-started
    - theme: alt
      text: View Results
      link: /benchmarks/results

features:
  - icon: §1
    title: Introduction
    details: Research background, problem statement, and objectives for blockchain-based energy trading evaluation
  - icon: §2
    title: Literature Review
    details: Blockchain technology, P2P energy markets, and TPC benchmark methodology
  - icon: §3
    title: Methodology
    details: TPC-C adaptation framework, test environment, and statistical methodology
  - icon: §4
    title: Results
    details: Performance evaluation across TPC-C, Smallbank, TPC-E, and TPC-H benchmarks
  - icon: §5
    title: Discussion
    details: Trust Premium analysis, scalability findings, and comparison with literature
  - icon: §6
    title: Conclusion
    details: Key contributions, limitations, and future research directions
---

## Abstract

This thesis presents a comprehensive performance evaluation of GridTokenX, a Solana-based blockchain platform designed for peer-to-peer energy trading. Adapting Transaction Processing Performance Council (TPC) benchmark methodology for distributed ledger technology, we demonstrate that blockchain can achieve production-level performance suitable for real-time energy market applications.

Our evaluation reveals GridTokenX achieves **21,378 tpmC** on TPC-C benchmarks with average latency of **11.34ms**, representing a Trust Premium of **5.67×** compared to centralized database baselines. These findings validate blockchain viability for P2P energy trading while quantifying the performance cost of decentralization.

---

## Key Findings

| Benchmark | Primary Metric | Latency (p99) |
|-----------|----------------|---------------|
| TPC-C | 21,378 tpmC | 20ms |
| Smallbank | 1,741 TPS | 10ms |
| TPC-E | 307 tpsE | 17ms |
| TPC-H | 246,938 QphH | 147ms |

---

## Research Contributions

1. **TPC Benchmark Adaptation Framework** — Methodology for applying database benchmarks to blockchain evaluation

2. **Trust Premium Metric** — Quantitative measure of blockchain overhead relative to centralized alternatives

3. **GridTokenX Platform** — Five integrated Anchor smart contracts for energy trading

4. **Scalability Analysis** — Demonstrated linear scaling characteristics up to 200 concurrent users

---

## Navigation

- [Chapter 1: Introduction](/guide/getting-started)
- [Chapter 2: Literature Review](/guide/architecture)
- [Chapter 3: Methodology](/benchmarks/methodology)
- [Chapter 4: Results](/benchmarks/results)
- [Chapter 5: Discussion](/benchmarks/comparison)
- [Appendix: API Reference](/api/programs)

---

<div style="text-align: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--vp-c-divider);">
  <p style="font-style: italic; color: var(--vp-c-text-3);">
    Master's Thesis<br>
    Department of Computer Science<br>
    December 2024
  </p>
</div>
