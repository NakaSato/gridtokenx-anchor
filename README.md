gridtokenx-anchor/
├── programs/          # Anchor programs (Solana smart contracts)
│   ├── governance/     # Governance module
│   ├── oracle/         # Price oracle for energy credits
│   ├── registry/       # User registration and management
│   ├── trading/        # Energy trading marketplace
│   └── token/          # Energy credit token
├── src/               # Client libraries and utilities
│   └── client/js/     # JavaScript/TypeScript client
├── test-transactions/ # Transaction testing utilities
│   └── comprehensive/  # Full test suite
├── scripts/           # Deployment and utility scripts
├── tests/             # Anchor test suite
└── configs/           # Configuration files
```

## Getting Started

### Prerequisites

- Node.js 18+
- Solana CLI 1.18+
- Anchor CLI 0.32.1
- Rust 1.70+

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
npm run wallet:setup-all

# Or use the script directly
ts-node scripts/wallet-setup/setup-all-wallets.ts

# Additional options
npm run wallet:setup-all -- --reset          # Delete existing wallets and create new ones
npm run wallet:setup-all -- --skip-airdrop    # Skip SOL airdrops to wallets
npm run wallet:setup-all -- --airdrop-only    # Only perform airdrops to existing wallets
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
# Basic transaction tests
npx ts-node test-transactions/working/run-working-test.ts

# Multi-wallet transaction testing
npx ts-node test-transactions/multi-wallet/run-multi-wallet-test.ts

# Energy producer/consumer flow testing
npx ts-node test-transactions/energy-flow/run-energy-flow-test.ts

# Oracle and governance testing
npx ts-node test-transactions/oracle-gov/run-oracle-gov-test.ts

# Comprehensive test suite with all keypairs
./tests/test-transactions/run-comprehensive-test.sh

# Full integration test with all wallets
./tests/test-transactions/run-full-integration-test.sh

# Stress testing with all generated keypairs
./tests/stress/run-stress-test.sh

# Anchor tests
anchor test
```

## Deployment

### Building Programs

```bash
# Build all programs
anchor build

# Build specific program
anchor build --program-name governance
```

## Program Architecture

### Energy Token (Token)

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

### Integration Tests

```bash
# Transaction tests with all keypairs
./test-transactions/comprehensive/run-comprehensive-test.sh

# Multi-wallet scenarios (5+ wallets)
./test-transactions/multi-wallet/run-test.sh

# Producer-consumer transaction flows
./test-transactions/producer-consumer/run-test.sh

# Oracle and governance transactions
./test-transactions/oracle-governance/run-test.sh

# Fee testing with varying wallet balances
./test-transactions/fee-testing/run-test.sh

# Cross-program interaction testing
./test-transactions/cross-program/run-test.sh
```

### E2E Testing

```bash
# End-to-end energy trading flow with all roles
./test-transactions/e2e/energy-trading-flow.sh

# Full governance cycle testing
./test-transactions/e2e/governance-cycle.sh

# Complete energy marketplace simulation
./test-transactions/e2e/marketplace-simulation.sh

# Stress testing with all generated keypairs
./test-transactions/e2e/stress-all-keypairs.sh
```

### Performance Testing

```bash
# Transaction throughput with all keypairs
./test-transactions/performance/throughput-test.sh

# Latency measurement across different wallet types
./test-transactions/performance/latency-test.sh

# Resource usage under high load
./test-transactions/performance/resource-test.sh
```

## Security Considerations

1. **Key Management**
   - Never commit private keys to version control
   - Use hardware wallets for production
   - Implement proper key rotation

2. **Program Security**
   - Validate all user inputs
   - Implement access controls
   - Use Solana program security best practices

3. **Network Security**
   - Use secure RPC endpoints
   - Validate transaction signatures
   - Implement replay protection

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
