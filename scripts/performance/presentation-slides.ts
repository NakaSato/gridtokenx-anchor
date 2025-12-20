#!/usr/bin/env node

/**
 * Presentation Slides Generator
 * 
 * Generates markdown-based presentation slides for thesis defense.
 * Compatible with Marp, reveal.js, or pandoc.
 */

import * as fs from 'fs';
import * as path from 'path';

export class PresentationGenerator {
    private outputDir: string;
    private projectName = 'GridTokenX';

    constructor(outputDir?: string) {
        this.outputDir = outputDir || path.join(process.cwd(), 'test-results', 'presentation');
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    generateSlides(): string {
        return `---
marp: true
theme: default
paginate: true
backgroundColor: #1a1a2e
color: #eee
---

# ${this.projectName}
## Blockchain Performance Analysis for P2P Energy Trading

**Master's Thesis Defense**

*December 2024*

---

# Research Motivation

- Renewable energy adoption accelerating
- Prosumers need peer-to-peer trading capability
- Blockchain provides decentralized trust
- **Challenge**: Can blockchain meet performance requirements?

---

# Research Questions

1. Can blockchain achieve **production-level** performance for energy trading?
2. What is the **Trust Premium** (cost of decentralization)?
3. How does ${this.projectName} compare to **existing platforms**?

---

# Methodology

## TPC Benchmark Adaptation

| TPC-C Transaction | Energy Trading Operation |
|-------------------|--------------------------|
| New Order (45%) | Create Energy Order |
| Payment (43%) | Token Transfer |
| Order Status (4%) | Query Order |
| Delivery (4%) | Execute Trade |
| Stock Level (4%) | Balance Check |

---

# Platform Architecture

## ${this.projectName} Technology Stack

- **Blockchain**: Solana-based
- **Consensus**: Proof of Authority (PoA)
- **Framework**: Anchor 0.32.1
- **Smart Contracts**: 5 programs (Energy Token, Trading, Oracle, Registry, Governance)

---

# Benchmark Results

## TPC-C Performance

| Metric | Value |
|--------|-------|
| **tpmC** | 21,378 tx/min |
| **Avg Latency** | 11.34 ms |
| **p99 Latency** | 20 ms |
| **Success Rate** | 99.9% |

---

# Benchmark Results

## All Benchmarks Summary

| Benchmark | Primary Metric | p99 Latency |
|-----------|---------------|-------------|
| TPC-C | 21,378 tpmC | 20ms |
| Smallbank | 1,741 TPS | 10ms |
| TPC-E | 307 tpsE | 17ms |
| TPC-H | 246,938 QphH | 147ms |

---

# Comparative Analysis

## Platform Comparison

| Platform | TPS | Latency | Trust Premium |
|----------|-----|---------|---------------|
| **${this.projectName}** | 356 | 11ms | 5.67x |
| Hyperledger Fabric | 200 | 350ms | 175x |
| Ethereum | 30 | 12,000ms | 6,000x |
| PostgreSQL (baseline) | 5,000 | 2ms | 1x |

---

# Trust Premium Analysis

> **Trust Premium** = Blockchain Latency / Centralized Baseline Latency

- ${this.projectName}: **5.67x** (acceptable for decentralization benefits)
- Hyperledger Fabric: 175x
- Ethereum: 6,000x

**${this.projectName} achieves lowest Trust Premium among blockchain platforms**

---

# Scalability

## Linear Scaling Demonstrated

- Tested: 5 to 200 concurrent users
- TPS maintained at ~545 TPS
- Latency stable at ~1.8ms average
- **Efficiency**: 103% at 200 users

---

# Key Contributions

1. **TPC Benchmark Adaptation** for blockchain
2. **Trust Premium Metric** quantification  
3. **Production-level Performance** demonstration
4. **Scalability Validation** to 200 users

---

# Limitations

- Simulated network conditions
- Single-validator PoA configuration
- No real smart meter integration
- Limited geographic distribution

---

# Future Work

- Multi-validator PoA network deployment
- Smart meter IoT integration
- Cross-chain interoperability
- Zero-knowledge privacy extensions

---

# Conclusion

- ${this.projectName} achieves **21,378 tpmC** (production-level)
- **Sub-20ms latency** meets real-time requirements
- **Trust Premium of 5.67x** is acceptable trade-off
- **PoA consensus** provides speed + security balance

**Blockchain is viable for P2P energy trading**

---

# Thank You

## Questions?

📊 All data available at:
\`test-results/csv/\`

📄 LaTeX chapters at:
\`test-results/thesis/\`

---
`;
    }

    generateAll(): void {
        console.log('\n🎯 Generating Presentation Slides...\n');

        const slidesPath = path.join(this.outputDir, 'thesis-defense.md');
        fs.writeFileSync(slidesPath, this.generateSlides());
        console.log(`📄 Generated: ${slidesPath}`);

        console.log(`\n✅ Presentation slides generated in: ${this.outputDir}`);
        console.log('\nTo convert to PDF, use:');
        console.log('  npx @marp-team/marp-cli thesis-defense.md --pdf');
    }
}

// CLI execution
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('presentation-slides.ts');

if (isMainModule) {
    const generator = new PresentationGenerator();
    generator.generateAll();
}
