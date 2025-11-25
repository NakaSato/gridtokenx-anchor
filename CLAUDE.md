# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GridTokenX is a decentralized energy trading platform built on Solana using the Anchor framework. The platform enables peer-to-peer energy trading, renewable energy certification, and grid management through smart contracts. The system consists of five core programs that work together to create a comprehensive energy trading ecosystem.

## Core Architecture

### Five-Program System
The project is structured around five distinct Anchor programs:

1. **energy_token** (`94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur`) - SPL token representing energy credits
2. **governance** (`4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe`) - Decentralized governance system
3. **oracle** (`DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE`) - Price feed and data verification
4. **registry** (`9XS8uUEVErcA8LABrJQAdohWMXTToBwhFN7Rvur6dC5`) - User and asset registration
5. **trading** (`GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk`) - Decentralized energy marketplace

### Unified Client Architecture
All programs are accessed through a unified TypeScript client (`src/client.ts`) that provides:
- Single entry point for all programs
- Consistent API across all modules
- Centralized connection and wallet management
- Type-safe access to program methods

## Development Commands

### Build and Test
```bash
# Build all programs
anchor build
make build

# Run full test suite
anchor test
npm test
make test

# Clean build artifacts
make clean
npm run clean
```

### Individual Program Testing
```bash
# Test specific programs using Makefile
make test-energy    # Energy token tests
make test-gov       # Governance tests
make test-oracle    # Oracle tests
make test-registry  # Registry tests
make test-trading   # Trading tests
make test-individual # Run all individual tests

# Test specific programs using npm scripts
npm run test:grx    # GRX token specific tests
```

### Performance Testing
```bash
# Comprehensive performance tests
pnpm run test:performance
make performance

# Specific performance test suites
pnpm run test:performance-energy      # Energy trading performance
pnpm run test:performance-architecture # Architecture performance
pnpm run test:performance-benchmark   # Benchmark with JSON output

# Quick performance check
pnpm run performance:quick-check
```

### Latency Testing
```bash
# Run latency measurement demonstration (works without compilation)
pnpm run test:latency:demo

# Run full framework (requires TypeScript compilation)
pnpm run test:latency

# Run program-specific latency tests
pnpm run test:latency:energy-token
pnpm run test:latency:governance
pnpm run test:latency:oracle
pnpm run test:latency:registry
pnpm run test:latency:trading
```

### Transaction Testing
```bash
npm run test:working    # Working transaction tests
npm run test:solana     # Solana-only tests
```

### Development Setup
```bash
# Install dependencies
make deps
pnpm install

# Setup development wallets (critical for testing)
make wallet-setup
npm run wallet:setup

# Linting
make lint
make lint-fix
npm run lint
npm run lint:fix
```

## Development Environment Setup

### Wallet Configuration
The project requires multiple development wallets for comprehensive testing:

**Essential Wallets:**
- `dev-wallet` - Primary development wallet (configured in Anchor.toml)
- `producer-1`, `producer-2`, `producer-3` - Energy producers
- `consumer-1`, `consumer-2` - Energy consumers
- `oracle-authority` - Oracle permissions
- `governance-authority` - Governance permissions
- `treasury-wallet` - Protocol fee collection

Run `make wallet-setup` to automatically configure all required wallets with SOL airdrops.

### Local Validator
```bash
# Start local validator with reset
solana-test-validator --reset

# Configure for local development
solana config set --url localhost
```

## Testing Strategy

### Test Structure
- `tests/` - Anchor test suite with individual program tests
- `tests/performance/` - Performance testing infrastructure
- `tests/transactions/` - Transaction-specific testing utilities
- `tests/utils/` - Shared test utilities and wallet configurations

### Performance Testing Architecture
The project includes a sophisticated performance testing framework:
- Architecture performance analysis
- Energy trading throughput testing
- Latency measurement
- Benchmark testing with JSON output
- Quick health checks

### Test Genesis Programs
Anchor.toml configures genesis programs for consistent testing environment with pre-deployed program addresses.

## Code Generation and Client Libraries

### Generated TypeScript Client
- Unified client in `src/client.ts` provides access to all programs
- Type-safe program interfaces generated from IDLs
- Factory functions for easy client instantiation
- Consistent error handling across all programs

### Program Access Pattern
```typescript
const client = createGridTokenXClient(connection, wallet);
const energyToken = client.energyToken;
const trading = client.trading;
// etc.
```

## Configuration Files

### Anchor Configuration (Anchor.toml)
- Toolchain: Anchor 0.32.1 with pnpm package manager
- Pre-defined program IDs for localnet
- Genesis programs for consistent testing
- Local development wallet: `~/Developments/weekend/gridtokenx-anchor/keypairs/dev-wallet.json`

### Package Management
- Uses pnpm as preferred package manager (configured in Anchor.toml)
- TypeScript with strict configuration
- ESLint for code quality

## Security and Best Practices

- Private keys stored in `keypairs/` directory (never committed)
- Environment-based configuration for sensitive data
- Comprehensive input validation in all programs
- Access control through authority wallets
- Regular performance testing to ensure system reliability

## Common Development Patterns

### Program Development
- Each program in separate `programs/` subdirectory
- Consistent error handling across programs
- Authority-based access control
- Integration testing through unified client

### Testing Patterns
- Multi-wallet testing scenarios
- Genesis program deployment for consistency
- Performance benchmarking for all critical paths
- Transaction simulation before mainnet deployment
