# Installation

Complete installation guide for GridTokenX development.

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 cores | 8 cores |
| RAM | 8 GB | 16 GB |
| Storage | 50 GB SSD | 100 GB SSD |
| OS | macOS/Linux | Ubuntu 22.04 |

## Install Dependencies

### 1. Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
rustup default stable
```

### 2. Solana CLI

```bash
sh -c "$(curl -sSfL https://release.solana.com/v2.0.13/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Verify
solana --version
```

### 3. Anchor CLI

```bash
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install latest
avm use latest

# Verify
anchor --version
```

### 4. Node.js & pnpm

```bash
# Using nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20

# Install pnpm
npm install -g pnpm
```

## Clone & Setup

```bash
# Clone repository
git clone https://github.com/your-repo/gridtokenx-anchor.git
cd gridtokenx-anchor

# Install Node dependencies
pnpm install

# Build Anchor programs
anchor build
```

## Configure Solana

```bash
# Set to localnet
solana config set --url localhost

# Generate keypair
solana-keygen new --outfile ~/.config/solana/id.json

# Airdrop SOL (localnet)
solana airdrop 10
```

## Verify Installation

```bash
# Run tests
anchor test

# Run a benchmark
pnpm benchmark:tpc-c

# Expected output:
# tpmC: ~21,000
# Latency: ~11ms
```

## Troubleshooting

### Error: "Program not found"

```bash
anchor build
anchor deploy
```

### Error: "Insufficient funds"

```bash
solana airdrop 10
```

### Error: "Connection refused"

```bash
solana-test-validator
```
