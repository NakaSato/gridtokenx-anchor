# GridTokenX Demo Video Script

## Video Details
- **Duration**: 5-7 minutes
- **Format**: Screen recording with voiceover
- **Tools**: OBS Studio or similar

---

## Script

### Scene 1: Introduction (0:00 - 0:30)

**[Show: Title slide with GridTokenX logo]**

**Voiceover**: 
"Welcome to GridTokenX - a high-performance blockchain platform for peer-to-peer energy trading. In this demo, I'll show you how our platform enables prosumers to trade renewable energy directly, with transaction speeds suitable for real-time applications."

---

### Scene 2: Architecture Overview (0:30 - 1:30)

**[Show: Architecture diagram]**

**Voiceover**:
"GridTokenX is built on Solana blockchain technology with Proof of Authority consensus. The platform consists of five integrated smart contracts:

- Energy Token for tokenized energy credits
- Trading program for order matching
- Oracle for price feeds
- Registry for prosumer management
- Governance for decentralized decision-making

Let me show you how these work together."

---

### Scene 3: Running Benchmarks (1:30 - 3:00)

**[Show: Terminal running benchmarks]**

**Voiceover**:
"Let's run our TPC-C style benchmark. This simulates energy order processing with the same transaction mix as the TPC-C database benchmark."

**[Run command: pnpm benchmark:tpc-c]**

**Voiceover**:
"As you can see, we're processing transactions with:
- 21,378 transactions per minute
- Average latency of 11 milliseconds
- 99th percentile under 20 milliseconds

This demonstrates production-level performance for energy trading."

---

### Scene 4: Monitoring Dashboard (3:00 - 4:00)

**[Show: Open dashboard/index.html in browser]**

**Voiceover**:
"Our monitoring dashboard shows real-time metrics. You can see:
- Current TPS rates
- Latency distribution
- Transaction types being processed

This gives operators visibility into platform performance."

---

### Scene 5: Comparative Analysis (4:00 - 5:00)

**[Show: Charts - throughput comparison and trust premium]**

**Voiceover**:
"Let's look at how GridTokenX compares to other platforms.

Our Trust Premium of 5.67x means we're only about 6 times slower than a centralized database - but with full blockchain benefits.

Compare this to Hyperledger Fabric at 175x or Ethereum at 6,000x. GridTokenX provides the best performance among blockchain platforms."

---

### Scene 6: Thesis Output (5:00 - 6:00)

**[Show: Generated thesis files in test-results/thesis/]**

**Voiceover**:
"All benchmark data feeds directly into thesis generation. We automatically produce:
- LaTeX chapters with tables
- CSV data for analysis
- SVG charts for visualization
- Presentation slides

This ensures reproducibility and rigorous documentation."

---

### Scene 7: Conclusion (6:00 - 6:30)

**[Show: Summary slide]**

**Voiceover**:
"In summary, GridTokenX demonstrates that blockchain can achieve production-level performance for P2P energy trading. With 21,378 tpmC and sub-20ms latency, we've shown that the Trust Premium is acceptable for applications requiring decentralized trust.

Thank you for watching. For more details, check the documentation and thesis appendix."

**[Show: End slide with links]**

---

## Recording Checklist

- [ ] Clean terminal with visible commands
- [ ] Browser with dashboard open
- [ ] VSCode with thesis files visible
- [ ] Architecture diagram ready
- [ ] Charts SVG files open
- [ ] Quiet recording environment
- [ ] Test audio levels

## Post-Production

1. Add background music (subtle)
2. Include captions
3. Export at 1080p
4. Add chapter markers
5. Upload to YouTube/Vimeo (unlisted)
