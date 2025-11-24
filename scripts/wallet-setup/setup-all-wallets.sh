#!/bin/bash

# GridTokenX Comprehensive Wallet Setup Script
# Creates all role-based wallets needed for comprehensive testing
# Usage: ./scripts/wallet-setup/setup-all-wallets.sh [options]
#
# Options:
#   --reset                 - Delete existing wallets and create new ones
#   --airdrop-only          - Only perform airdrops to existing wallets
#   --skip-airdrop          - Skip SOL airdrops to wallets
#   --keypair-dir <path>    - Directory to store keypairs (default: ./keypairs)
#   --validator-url <url>   - Validator RPC URL (default: localhost)
#   --help                  - Show this help

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
RESET=false
AIRDROP_ONLY=false
SKIP_AIRDROP=false
KEYPAIR_DIR="./keypairs"
VALIDATOR_URL="localhost"

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --reset)
            RESET=true
            shift
            ;;
        --airdrop-only)
            AIRDROP_ONLY=true
            shift
            ;;
        --skip-airdrop)
            SKIP_AIRDROP=true
            shift
            ;;
        --keypair-dir)
            KEYPAIR_DIR="$2"
            shift 2
            ;;
        --validator-url)
            VALIDATOR_URL="$2"
            shift 2
            ;;
        --help)
            echo "GridTokenX Wallet Setup Script"
            echo ""
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --reset                 Delete existing wallets and create new ones"
            echo "  --airdrop-only          Only perform airdrops to existing wallets"
            echo "  --skip-airdrop          Skip SOL airdrops to wallets"
            echo "  --keypair-dir <path>    Directory to store keypairs (default: ./keypairs)"
            echo "  --validator-url <url>   Validator RPC URL (default: localhost)"
            echo "  --help                  Show this help"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Configure Solana CLI to use the specified validator
log_info "Configuring Solana CLI to use validator: $VALIDATOR_URL"
solana config set --url "$VALIDATOR_URL"

# Check if validator is running
if ! solana cluster-version > /dev/null 2>&1; then
    log_error "Cannot connect to validator at $VALIDATOR_URL. Please ensure the validator is running."
    exit 1
fi

# Create keypair directory if it doesn't exist
mkdir -p "$KEYPAIR_DIR"

# Define all wallets with their airdrop amounts
declare -A WALLET_AMOUNTS=(
    ["dev-wallet"]=1000
    ["wallet-1"]=500
    ["wallet-2"]=200
    ["producer-1"]=300
    ["producer-2"]=300
    ["producer-3"]=300
    ["consumer-1"]=250
    ["consumer-2"]=250
    ["oracle-authority"]=500
    ["governance-authority"]=500
    ["treasury-wallet"]=1000
    ["test-wallet-3"]=150
    ["test-wallet-4"]=150
    ["test-wallet-5"]=150
)

# Function to create a single wallet
create_wallet() {
    local wallet_name="$1"
    local wallet_path="$KEYPAIR_DIR/$wallet_name"

    if [[ -f "$wallet_path" ]]; then
        if [[ "$RESET" == "true" ]]; then
            log_info "Removing existing wallet: $wallet_name"
            rm "$wallet_path"
        else
            log_warning "Wallet $wallet_name already exists. Use --reset to recreate."
            return 0
        fi
    fi

    log_info "Creating wallet: $wallet_name"
    solana-keygen new --no-bip39-passphrase --silent --force --outfile "$wallet_path"

    local pubkey=$(solana-keygen pubkey "$wallet_path")
    log_success "Created wallet $wallet_name with public key: $pubkey"
}

# Function to airdrop SOL to a wallet
airdrop_sol() {
    local wallet_name="$1"
    local amount="$2"
    local wallet_path="$KEYPAIR_DIR/$wallet_name"

    if [[ ! -f "$wallet_path" ]]; then
        log_error "Wallet $wallet_name not found at $wallet_path"
        return 1
    fi

    local pubkey=$(solana-keygen pubkey "$wallet_path")
    log_info "Airdropping $amount SOL to $wallet_name ($pubkey)"

    if solana airdrop "$amount" --keypair "$wallet_path" > /dev/null 2>&1; then
        local balance=$(solana balance "$pubkey" | awk '{print $1}')
        log_success "Airdropped $amount SOL to $wallet_name. New balance: $balance SOL"
    else
        log_error "Failed to airdrop SOL to $wallet_name"
        return 1
    fi
}

# Main script execution

if [[ "$AIRDROP_ONLY" == "true" ]]; then
    log_info "Performing airdrops only to existing wallets..."

    for wallet_name in "${!WALLET_AMOUNTS[@]}"; do
        airdrop_sol "$wallet_name" "${WALLET_AMOUNTS[$wallet_name]}"
    done

    log_success "Airdrops completed for all existing wallets"
    exit 0
fi

# Create all wallets
log_info "Creating all role-based wallets..."

for wallet_name in "${!WALLET_AMOUNTS[@]}"; do
    create_wallet "$wallet_name"
done

# Perform airdrops if not skipped
if [[ "$SKIP_AIRDROP" != "true" ]]; then
    log_info "Performing SOL airdrops to all wallets..."

    for wallet_name in "${!WALLET_AMOUNTS[@]}"; do
        airdrop_sol "$wallet_name" "${WALLET_AMOUNTS[$wallet_name]}"
    done
else
    log_warning "Skipping SOL airdrops as requested"
fi

# Display wallet information summary
log_info "Wallet Setup Summary"
echo "======================="

for wallet_name in "${!WALLET_AMOUNTS[@]}"; do
    if [[ -f "$KEYPAIR_DIR/$wallet_name" ]]; then
        local pubkey=$(solana-keygen pubkey "$KEYPAIR_DIR/$wallet_name")
        local balance=$(solana balance "$pubkey" | awk '{print $1}')
        echo -e "${BLUE}$wallet_name${NC}: $pubkey (Balance: $balance SOL)"
    fi
done

log_success "All wallets have been set up successfully!"
log_info "Keypair files are stored in: $KEYPAIR_DIR"
log_info "You can now run tests with these wallets using the commands in the README."
