#!/usr/bin/env bash
# ==============================================================================
# Script to setup development environment on a fresh Linux instance
# Installs: Rust, Solana CLI, Anchor CLI, Node.js, Yarn/PNPM, and system utils
# ==============================================================================

set -e  # Exit on error

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 1. Update System and Install Essentials
log_info "Updating system and installing build dependencies..."
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y \
    build-essential \
    pkg-config \
    libudev-dev \
    libssl-dev \
    git \
    curl \
    jq \
    unzip \
    gcc \
    g++ \
    make

# 2. Install Rust
if ! command -v rustc &> /dev/null; then
    log_info "Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
else
    log_info "Rust is already installed."
    source "$HOME/.cargo/env"
fi
rustup update stable
rustup component add rustfmt clippy

# 3. Install Solana CLI (if not present)
if ! command -v solana &> /dev/null; then
    log_info "Installing Solana CLI..."
    sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
    
    # Add to shell config if not present
    if ! grep -q "solana/install/active_release/bin" "$HOME/.bashrc"; then
        echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> "$HOME/.bashrc"
    fi
else
    log_info "Solana CLI is already installed."
fi

# 4. Install Node.js (via NVM)
if ! command -v node &> /dev/null; then
    log_info "Installing Node.js (LTS)..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    
    nvm install --lts
    nvm use --lts
    
    # Install Package Managers
    npm install -g yarn pnpm
else
    log_info "Node.js is already installed."
fi

# 5. Install Anchor CLI (via avm)
if ! command -v anchor &> /dev/null; then
    log_info "Installing Anchor CLI (avm)..."
    cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
    avm install latest
    avm use latest
    
    # Verify installation
    if ! command -v anchor &> /dev/null; then
         # Sometimes avm doesn't set path immediately or correctly in non-interactive
         export PATH="$HOME/.avm/bin:$PATH"
    fi
else
    log_info "Anchor CLI is already installed."
fi

# 6. Basic Configuration
log_info "Configuring Solana to use Localhost..."
solana config set --url localhost

# 7. Final Verification
echo ""
echo "=========================================="
echo "      Installation Complete!"
echo "=========================================="
echo "Versions:"
echo "Rust:   $(rustc --version || echo 'Not found')"
echo "Solana: $(solana --version || echo 'Not found')"
echo "Anchor: $(anchor --version || echo 'Not found')"
echo "Node:   $(node --version || echo 'Not found')"
echo "PNPM:   $(pnpm --version || echo 'Not found')"

log_info "Please run: source ~/.bashrc (or restart your terminal) to apply changes."
