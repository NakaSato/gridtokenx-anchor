# Getting Started

> **Set up your development environment for GridTokenX**

This guide walks you through setting up a local development environment and running the GridTokenX platform.

---

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| Node.js | 18+ | JavaScript runtime |
| pnpm | 8+ | Package manager |
| Rust | 1.70+ | Program compilation |
| Solana CLI | 1.17+ | Blockchain interaction |
| Anchor | 0.29+ | Smart contract framework |

### System Requirements

- **OS**: macOS, Linux, or WSL2 on Windows
- **RAM**: 8GB minimum, 16GB recommended
- **Storage**: 10GB free space

---

## Installation

### 1. Install Solana CLI

```bash
# Install Solana
sh -c "$(curl -sSfL https://release.solana.com/v1.17.0/install)"

# Add to PATH
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Verify installation
solana --version
```

### 2. Install Rust

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Verify installation
rustc --version
cargo --version
```

### 3. Install Anchor

```bash
# Install Anchor using cargo
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force

# Install Anchor CLI
avm install latest
avm use latest

# Verify installation
anchor --version
```

### 4. Clone Repository

```bash
git clone https://github.com/NakaSato/gridtokenx-anchor.git
cd gridtokenx-anchor
```

### 5. Install Dependencies

```bash
# Install Node.js dependencies
pnpm install
```

---

## Configuration

### Set Up Solana Wallet

```bash
# Generate new keypair (for development only)
solana-keygen new -o ~/.config/solana/id.json

# Set configuration
solana config set --url localhost
solana config set --keypair ~/.config/solana/id.json

# Verify configuration
solana config get
```

### Configure Anchor

The `Anchor.toml` file is pre-configured for local development:

```toml
[features]
seeds = false
skip-lint = false

[programs.localnet]
registry = "9XS8uUEVErcA8LABrJQAdohWMXTToBwhFN7Rvur6dC5"
oracle = "DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE"
energy_token = "94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur"
trading = "GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk"
governance = "4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe"

[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"
```

---

## Build and Test

### Build Programs

```bash
# Build all programs
anchor build

# Build specific program
anchor build -p registry
```

### Run Local Validator

```bash
# Start local validator
solana-test-validator

# In another terminal, check validator status
solana cluster-version
```

### Deploy Programs

```bash
# Deploy to localnet
anchor deploy

# Or deploy specific program
anchor deploy -p registry
```

### Run Tests

```bash
# Run all tests
anchor test

# Run specific test file
anchor test --skip-deploy tests/registry.test.ts
```

---

## Project Structure

```
gridtokenx-anchor/
├── programs/               # Anchor programs (smart contracts)
│   ├── registry/          # User and meter registration
│   ├── oracle/            # Data validation
│   ├── energy-token/      # GRID token management
│   ├── trading/           # P2P marketplace
│   └── governance/        # ERC certification
├── sdk/                   # TypeScript SDK
├── tests/                 # Integration tests
├── docs/                  # Documentation
├── scripts/               # Utility scripts
├── Anchor.toml            # Anchor configuration
└── Cargo.toml             # Rust workspace config
```

---

## Next Steps

- [Deployment Guide](./deployment.md) - Deploy to devnet/mainnet
- [Testing Guide](./testing.md) - Comprehensive testing
- [Technical Documentation](../technical/) - Architecture details

---

## Troubleshooting

### Common Issues

**Build fails with "program not found"**
```bash
# Ensure Solana tools are installed
solana --version
cargo --version

# Rebuild
anchor build --force
```

**Tests fail with "insufficient funds"**
```bash
# Airdrop SOL to test wallet
solana airdrop 10
```

**Validator won't start**
```bash
# Clean and restart
rm -rf test-ledger/
solana-test-validator
```

---

*For more help, see [GitHub Issues](https://github.com/NakaSato/gridtokenx-anchor/issues)*
