# GridTokenX Anchor

GridTokenX is a decentralized energy trading platform built on Solana using Anchor framework. It enables peer-to-peer energy trading, renewable energy certification, and grid management through smart contracts.

## Project Structure

```
gridtokenx-anchor/
├── programs/               # Anchor programs (Solana smart contracts)
│   ├── energy-token/       # Energy credit token program
│   ├── governance/         # Governance module
│   ├── oracle/             # Price oracle for energy credits
│   ├── registry/           # User registration and management
│   └── trading/            # Energy trading marketplace
├── src/                   # Generated client libraries and utilities
│   ├── client.ts          # Unified client for all programs
│   ├── energy_token.ts    # Energy token types and client
│   ├── governance.ts      # Governance types and client
│   ├── oracle.ts          # Oracle types and client
│   ├── registry.ts        # Registry types and client
│   ├── trading.ts         # Trading types and client
│   └── README.md          # Client documentation
├── scripts/               # Deployment and utility scripts
│   └── wallet-setup/      # Wallet configuration scripts
├── tests/                 # Anchor test suite
│   ├── performance/       # Performance testing utilities
│   ├── transactions/      # Transaction testing utilities
│   └── utils/             # Test utilities
├── docs/                  # Documentation
├── generated/             # Generated code
├── keypairs/              # Development keypairs
└── target/                # Build artifacts
```

## Program Addresses

- **Energy Token**: `94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur`
- **Governance**: `4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe`
- **Oracle**: `DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE`
- **Registry**: `2XPQmFYMdXjP7ffoBB3mXeCdboSFg5Yeb6QmTSGbW8a7`
- **Trading**: `GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk`

## Performance Benchmarks

GridTokenX has been rigorously benchmarked using LiteSVM (in-process Solana VM) to ensure high throughput and low latency for real-time energy trading.

| Metric | Result | Description |
|--------|--------|-------------|
| **Peak Throughput** | **530.2 TPS** | Sustained baseline performance |
| **Real-World TPS** | **206.9 TPS** | Flash Sale scenario (100 concurrent users) |
| **Average Latency** | **1.96 ms** | Warm sequential processing |
| **p99 Latency** | **3.87 ms** | 99th percentile latency under load |
| **Scalability** | **93%** | Efficiency maintained at 200 concurrent users |

### Network Latency Simulation

Simulated performance across different geographical regions (Localnet):

| Region | Avg Latency | Throughput | Impact |
|--------|-------------|------------|--------|
| **Local (Data Center)** | **11.21 ms** | **699.3 TPS** | Baseline |
| **US-East (Nearby)** | **39.42 ms** | **218.8 TPS** | 3.5x latency |
| **EU-West (Cross-Atlantic)** | **116.15 ms** | **77.0 TPS** | 10.4x latency |
| **Asia-Pacific** | **228.52 ms** | **36.0 TPS** | 20.4x latency |

Full academic performance paper available in:
- [English Version](docs/academic/GridTokenX_Performance_Paper_EN.pdf)
- [Thai Version](docs/academic/GridTokenX_Performance_Paper_TH.pdf)

## Getting Started

### Prerequisites

- Node.js 18+
- Solana CLI 1.18+
- Anchor CLI 0.32.1
- Rust 1.70+
- pnpm (recommended package manager)

### Installation

```bash
# Install dependencies
pnpm install

# Build programs
anchor build

# Start local validator
solana-test-validator --reset

# Run tests
anchor test
```

## Local Development

### Setting Up Wallets

For comprehensive testing of the GridTokenX platform, we need multiple keypairs to simulate different roles in the energy trading ecosystem:

- **dev-wallet**: Primary development wallet for deployment and admin operations
- **wallet-1, wallet-2**: Standard user wallets for basic functionality testing
- **producer-1, producer-2, producer-3**: Energy producer wallets that generate and sell energy credits
- **consumer-1, consumer-2**: Energy consumer wallets that purchase and use energy credits
- **oracle-authority**: Wallet with permission to update price feeds and market data
- **governance-authority**: Wallet for protocol governance and parameter changes
- **treasury-wallet**: Wallet for collecting fees and managing protocol funds
- **test-wallet-3, test-wallet-4, test-wallet-5**: Additional wallets for stress testing and edge cases

### Automated Wallet Setup

Use the provided script to automatically create all required wallets:

```bash
# Create all wallets with default settings
npm run wallet:setup

# Or use the script directly
ts-node scripts/wallet-setup/setup-all-wallets.ts

# Additional options (if supported by script)
npm run wallet:setup -- --reset          # Delete existing wallets and create new ones
npm run wallet:setup -- --skip-airdrop    # Skip SOL airdrops to wallets
npm run wallet:setup -- --airdrop-only    # Only perform airdrops to existing wallets
```

### Manual Wallet Setup

If you prefer to set up wallets manually:

```bash
# Create new keypairs for comprehensive testing
# Base development and testing wallets
solana-keygen new -o ./keypairs/dev-wallet
solana-keygen new -o ./keypairs/wallet-1
solana-keygen new -o ./keypairs/wallet-2

# Energy producer wallets
solana-keygen new -o ./keypairs/producer-1
solana-keygen new -o ./keypairs/producer-2
solana-keygen new -o ./keypairs/producer-3

# Energy consumer wallets
solana-keygen new -o ./keypairs/consumer-1
solana-keygen new -o ./keypairs/consumer-2

# Oracle and governance wallets
solana-keygen new -o ./keypairs/oracle-authority
solana-keygen new -o ./keypairs/governance-authority
solana-keygen new -o ./keypairs/treasury-wallet

# Additional test wallets for stress testing
solana-keygen new -o ./keypairs/test-wallet-3
solana-keygen new -o ./keypairs/test-wallet-4
solana-keygen new -o ./keypairs/test-wallet-5

# Configure to use local validator
solana config set --url localhost

# Airdrop SOL to wallets
solana airdrop 1000
solana airdrop --keypair ./keypairs/wallet-1 500
solana airdrop --keypair ./keypairs/wallet-2 200
solana airdrop --keypair ./keypairs/producer-1 300
solana airdrop --keypair ./keypairs/producer-2 300
solana airdrop --keypair ./keypairs/producer-3 300
solana airdrop --keypair ./keypairs/consumer-1 250
solana airdrop --keypair ./keypairs/consumer-2 250
solana airdrop --keypair ./keypairs/oracle-authority 500
solana airdrop --keypair ./keypairs/governance-authority 500
solana airdrop --keypair ./keypairs/treasury-wallet 1000
```

### Running Tests

```bash
# Anchor test suite
npm test
anchor test

# Specific program tests
anchor test --skip-local-validator tests/grx-token.test.ts

# Performance testing
npm run test:performance

# Architecture performance tests
npm run test:performance-energy
npm run test:performance-architecture
npm run test:performance-benchmark

# Quick performance check
npm run performance:quick-check

# Transaction tests
npm run test:working
npm run test:solana

# Clean build artifacts
npm run clean
```

### Available NPM Scripts

```bash
# Development
npm test                    # Run anchor tests
npm run lint               # Run ESLint
npm run lint:fix           # Fix ESLint issues

# Testing
npm run test:grx           # Run GRX token tests
npm run test:working       # Run working transaction tests
npm run test:solana        # Run Solana-only tests
npm run test:performance   # Run performance tests

# Wallet Management
npm run wallet:setup       # Setup all development wallets

# Performance
npm run performance:quick-check  # Quick performance check

# Setup
npm run setup:loop-test    # Setup loop testing environment

# Utilities
npm run clean              # Clean build artifacts and temporary files
```

## Client Libraries

### TypeScript/JavaScript Client

The project includes generated TypeScript clients for all programs:

```typescript
import { Connection, Keypair } from '@solana/web3.js';
import { Wallet } from '@coral-xyz/anchor';
import { createGridTokenXClient } from './src/client';

// Create connection
const connection = new Connection('https://api.devnet.solana.com');

// Create wallet
const keypair = Keypair.generate();
const wallet = new Wallet(keypair);

// Create client
const client = createGridTokenXClient(connection, wallet);

// Access programs
const energyTokenProgram = client.energyToken;
const governanceProgram = client.governance;
const oracleProgram = client.oracle;
const registryProgram = client.registry;
const tradingProgram = client.trading;
```

For detailed client usage, see [`src/README.md`](src/README.md).

## Deployment

### Building Programs

```bash
# Build all programs
anchor build

# Build specific program
anchor build --program-name governance
```

### Program Architecture

### Energy Token

Standard SPL Token representing energy credits with:
- Mint authority controlled by governance
- Fixed or variable supply based on energy generation
- Renewable energy certification integration

### Registry

User and asset registration system:
- User profiles with energy production/consumption data
- Asset tokenization for renewable energy equipment
- Proof-of-generation verification

### Oracle

Price feed and data verification:
- Real-time energy prices from multiple sources
- Grid load and production metrics
- Weather and environmental data integration

### Trading

Decentralized energy marketplace:
- Peer-to-peer energy trading
- Automated matching algorithms
- Smart contract-based settlement
- Grid balancing incentives

### Governance

Decentralized decision making:
- Proposal system for protocol changes
- Voting based on energy token holdings
- Parameter adjustment for market stability

## Testing Strategy

### Unit Tests

```bash
# Run all tests
anchor test

# Run specific test
anchor test --skip-local-validator

# Test with coverage
anchor test --skip-deploy
```

### Performance Testing

The project includes comprehensive performance testing:

```bash
# Run all performance tests
npm run test:performance

# Run specific performance test suites
npm run test:performance-energy      # Energy trading performance
npm run test:performance-architecture # Architecture performance
npm run test:performance-benchmark   # Benchmark with JSON output

# Quick performance check
npm run performance:quick-check
```

Performance tests include:
- **Architecture Analysis**: System architecture performance evaluation
- **Energy Trading Performance**: Energy trading transaction performance
- **Benchmark Testing**: Comprehensive benchmarking with metrics collection
- **Throughput Testing**: Transaction throughput under various conditions
- **Latency Measurement**: End-to-end latency analysis

### Test Files Structure

```
tests/
├── energy-token.test.ts      # Energy token program tests
├── governance.test.ts         # Governance program tests
├── grx-token.test.ts         # GRX token specific tests
├── oracle.test.ts             # Oracle program tests
├── registry.test.ts           # Registry program tests
├── trading.test.ts            # Trading program tests
├── performance/               # Performance testing suite
│   ├── README.md             # Performance testing documentation
│   ├── architecture/         # Architecture performance tests
│   └── utils/                # Performance testing utilities
├── transactions/             # Transaction testing utilities
│   └── run-comprehensive-test.ts
└── utils/                    # Test utilities
    └── wallet-config.ts
```

## Configuration

### Anchor Configuration

The project uses Anchor configuration in `Anchor.toml`:

- **Toolchain**: Anchor 0.32.1 with pnpm package manager
- **Program Addresses**: Pre-defined program IDs for localnet
- **Test Configuration**: Optimized test settings with genesis programs
- **Provider**: Localnet cluster with dev-wallet as default

### Environment Variables

The project supports environment configuration through `.env` file for sensitive data and configuration.

## Security Considerations

1. **Key Management**
   - Never commit private keys to version control
   - Use hardware wallets for production
   - Implement proper key rotation
   - Store sensitive data in environment variables

2. **Program Security**
   - Validate all user inputs
   - Implement access controls
   - Use Solana program security best practices
   - Regular security audits

3. **Network Security**
   - Use secure RPC endpoints
   - Validate transaction signatures
   - Implement replay protection
   - Use proper error handling

## Documentation

Additional documentation is available in the `docs/` directory:

- Implementation guides and architecture documentation
- Security reviews and best practices
- Performance testing documentation
- Wallet management guides
- Task-specific implementation guides

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
