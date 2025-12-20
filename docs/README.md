# GridTokenX Documentation

A high-performance Solana-based blockchain platform for peer-to-peer energy trading.

## Overview

GridTokenX enables prosumers (producer-consumers) to trade renewable energy directly through a decentralized marketplace built on Solana blockchain technology with Proof of Authority (PoA) consensus.

### Key Features

- **High Performance**: 21,378 tpmC on TPC-C benchmarks
- **Low Latency**: Sub-20ms transaction confirmation
- **Scalable**: Linear scaling to 200+ concurrent users
- **Energy Trading**: Order book, matching engine, settlement

## Quick Start

```bash
# Install dependencies
pnpm install

# Build programs
anchor build

# Run tests
anchor test

# Run benchmarks
pnpm performance:research
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     GridTokenX Platform                      │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ Energy   │ │ Trading  │ │ Oracle   │ │ Registry │        │
│  │ Token    │ │ Program  │ │ Program  │ │ Program  │        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│  ┌──────────┐                                               │
│  │Governance│                                               │
│  │ Program  │                                               │
│  └──────────┘                                               │
├─────────────────────────────────────────────────────────────┤
│                   Solana Runtime (PoA)                       │
└─────────────────────────────────────────────────────────────┘
```

## Programs

| Program | Description |
|---------|-------------|
| **energy-token** | SPL Token 2022 for energy credits |
| **trading** | Order book and matching engine |
| **oracle** | Price feeds and market data |
| **registry** | Prosumer and asset registration |
| **governance** | DAO proposals and voting |

## Performance

### Benchmark Results

| Benchmark | Metric | Value | p99 Latency |
|-----------|--------|-------|-------------|
| TPC-C | tpmC | 21,378 | 20ms |
| Smallbank | TPS | 1,741 | 10ms |
| TPC-E | tpsE | 307 | 17ms |
| TPC-H | QphH | 246,938 | 147ms |

### Trust Premium

The "cost of decentralization" compared to centralized databases:

| Platform | Trust Premium |
|----------|---------------|
| GridTokenX (PoA) | 5.67x |
| Hyperledger Fabric | 175x |
| Ethereum | 6,000x |

## Commands

```bash
# Benchmarks
pnpm benchmark:tpc-c          # TPC-C OLTP
pnpm benchmark:smallbank      # Consensus stress test
pnpm benchmark:tpc-e          # Trading workload
pnpm benchmark:tpc-h          # Analytics queries

# Research tools
pnpm performance:research     # Full benchmark suite
pnpm export:csv              # Export CSV data
pnpm charts:generate         # Generate SVG charts
pnpm generate:appendix       # Generate thesis appendix
pnpm generate:chapters       # Generate thesis chapters
pnpm thesis:all              # Full thesis package
```

## Documentation

- [Performance Analysis](./docs/performance-analysis.md)
- [TPC Methodology](./docs/tpc-methodology.md)
- [AWS Deployment](./docs/aws-deployment.md)
- [Research Findings](./docs/research-findings.md)

## License

MIT License
