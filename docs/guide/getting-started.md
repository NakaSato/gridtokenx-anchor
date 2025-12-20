# Getting Started

Welcome to GridTokenX, a high-performance Solana-based blockchain platform for peer-to-peer energy trading.

## Prerequisites

- Node.js 20+
- Rust 1.75+
- Solana CLI 2.0+
- Anchor CLI 0.32+
- pnpm 8+

## Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/gridtokenx-anchor.git
cd gridtokenx-anchor

# Install dependencies
pnpm install

# Build Anchor programs
anchor build

# Run tests
anchor test
```

## Quick Start

### 1. Start Local Validator

```bash
solana-test-validator
```

### 2. Deploy Programs

```bash
anchor deploy
```

### 3. Run Benchmarks

```bash
# Full TPC benchmark suite
pnpm performance:research

# Individual benchmarks
pnpm benchmark:tpc-c
pnpm benchmark:smallbank
```

## Project Structure

```
gridtokenx-anchor/
├── programs/           # Anchor smart contracts
│   ├── energy-token/   # Energy credit token
│   ├── trading/        # Order matching
│   ├── oracle/         # Price feeds
│   ├── registry/       # Prosumer registry
│   └── governance/     # DAO governance
├── tests/              # Test suites
│   └── benchmark/      # TPC workloads
├── scripts/            # Utility scripts
└── docs/               # This documentation
```

## Next Steps

- [Architecture Overview](/guide/architecture)
- [Energy Token Program](/guide/energy-token)
- [Running Benchmarks](/benchmarks/methodology)
