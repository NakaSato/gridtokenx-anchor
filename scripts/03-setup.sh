#!/bin/bash
# GridTokenX Comprehensive Setup Script
# Consolidates functionality of new-setup.sh, working-setup.sh, and final-setup.sh
# Usage: ./scripts/03-setup.sh [profile] [options]
#
# Profiles:
#   dev         - Development setup (equivalent to new-setup.sh)
#   working     - Working setup (equivalent to working-setup.sh)
#   prod        - Production setup (equivalent to final-setup.sh)
#   custom      - Custom configuration
#
# Options:
#   --validator-port <port>    - Set validator RPC port (default: 8899)
#   --wallet-count <count>     - Number of wallets to create (default: 2)
#   --token-name <name>        - Token name (default: GridTokenX)
#   --token-symbol <symbol>    - Token symbol (default: GRX)
#   --mint-amount <amount>     - Amount to mint to each wallet (default: 1000)
#   --reset-validator          - Reset validator state
#   --faucet-sol <amount>      - SOL amount for faucet (default: 0)
#   --parallel                 - Run operations in parallel (like final-setup.sh)
#   --summary                 - Display summary at end (like final-setup.sh)
#   --skip-validator          - Skip validator startup
#   --skip-token              - Skip token creation
#   --skip-wallets            - Skip wallet creation
#   --skip-minting            - Skip token minting
#   --help                    - Show this help

set -e

# Initialize configuration variables with default values
PROFILE="dev"
VALIDATOR_PORT="8899"
WALLET_COUNT="2"
TOKEN_NAME="GridTokenX"
TOKEN_SYMBOL="GRX"
TOKEN_DECIMALS="9"
MINT_AMOUNT="1000"
RESET_VALIDATOR="true"
FAUCET_SOL="0"
PARALLEL="false"
SUMMARY="false"
SKIP_VALIDATOR="false"
SKIP_TOKEN="false"
SKIP_WALLETS="false"
SKIP_MINTING="false"

# Function to apply profile configurations
apply_profile() {
    case "$1" in
        "DEV_CONFIG")
            VALIDATOR_PORT="8999"
            RESET_VALIDATOR="true"
            FAUCET_SOL="10000000000"
            ;;
        "WORKING_CONFIG")
            VALIDATOR_PORT="8899"
            RESET_VALIDATOR="false"
            FAUCET_SOL="0"
            ;;
        "PROD_CONFIG")
            VALIDATOR_PORT="8899"
            RESET_VALIDATOR="false"
            FAUCET_SOL="0"
            PARALLEL="true"
            SUMMARY="true"
            ;;
    esac
}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Helper functions
log() {
    local color="${2:-$NC}"
    echo -e "$color$1$NC"
}

log_info() {
    log "$1" "$BLUE"
}

log_success() {
    log "$1" "$GREEN"
}

log_warning() {
    log "$1" "$YELLOW"
}

log_error() {
    log "$1" "$RED"
}

show_help() {
    cat << EOF
${BLUE}GridTokenX Setup Script${NC}

${YELLOW}Usage:${NC}
  $0 [profile] [options]

${YELLOW}Profiles:${NC}
  dev         Development setup (equivalent to new-setup.sh)
  working     Working setup (equivalent to working-setup.sh)
  prod        Production setup (equivalent to final-setup.sh)
  custom      Custom configuration

${YELLOW}Options:${NC}
  --validator-port <port>    Set validator RPC port (default: 8899)
  --wallet-count <count>     Number of wallets to create (default: 2)
  --token-name <name>        Token name (default: GridTokenX)
  --token-symbol <symbol>    Token symbol (default: GRX)
  --mint-amount <amount>     Amount to mint to each wallet (default: 1000)
  --reset-validator          Reset validator state
  --faucet-sol <amount>      SOL amount for faucet (default: 0)
  --parallel                 Run operations in parallel (like final-setup.sh)
  --summary                 Display summary at end (like final-setup.sh)
  --skip-validator          Skip validator startup
  --skip-token              Skip token creation
  --skip-wallets            Skip wallet creation
  --skip-minting            Skip token minting
  --help                    Show this help

${YELLOW}Examples:${NC}
  # Default development setup
  $0 dev

  # Production setup with custom port
  $0 prod --validator-port 9988

  # Custom setup with 5 wallets and 5000 tokens each
  $0 custom --wallet-count 5 --mint-amount 5000

  # Resume setup, skipping validator and token creation
  $0 dev --skip-validator --skip-token

EOF
}

parse_arguments() {
    # Set profile
    PROFILE=${1:-"dev"}

    case "$PROFILE" in
        "dev"|"development")
            apply_profile "DEV_CONFIG"
            ;;
        "working"|"work")
            apply_profile "WORKING_CONFIG"
            ;;
        "prod"|"production")
            apply_profile "PROD_CONFIG"
            ;;
        "custom")
            # Use default configuration
            ;;
        "help"|"--help"|"-h")
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown profile: $PROFILE"
            show_help
            exit 1
            ;;
    esac

    # Parse command line options
    shift
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --validator-port)
                VALIDATOR_PORT="$2"
                shift 2
                ;;
            --wallet-count)
                WALLET_COUNT="$2"
                shift 2
                ;;
            --token-name)
                TOKEN_NAME="$2"
                shift 2
                ;;
            --token-symbol)
                TOKEN_SYMBOL="$2"
                shift 2
                ;;
            --mint-amount)
                MINT_AMOUNT="$2"
                shift 2
                ;;
            --reset-validator)
                RESET_VALIDATOR="true"
                shift
                ;;
            --faucet-sol)
                FAUCET_SOL="$2"
                shift 2
                ;;
            --parallel)
                PARALLEL="true"
                shift
                ;;
            --summary)
                SUMMARY="true"
                shift
                ;;
            --skip-validator)
                SKIP_VALIDATOR="true"
                shift
                ;;
            --skip-token)
                SKIP_TOKEN="true"
                shift
                ;;
            --skip-wallets)
                SKIP_WALLETS="true"
                shift
                ;;
            --skip-minting)
                SKIP_MINTING="true"
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

# This function is already defined above, removing duplicate

print_config() {
    log_info "Configuration:"
    echo "  Profile: $PROFILE"
    echo "  Validator Port: $VALIDATOR_PORT"
    echo "  Wallet Count: $WALLET_COUNT"
    echo "  Token Name: $TOKEN_NAME"
    echo "  Token Symbol: $TOKEN_SYMBOL"
    echo "  Token Decimals: $TOKEN_DECIMALS"
    echo "  Mint Amount: $MINT_AMOUNT"
    echo "  Reset Validator: $RESET_VALIDATOR"
    echo "  Faucet SOL: $FAUCET_SOL"
    echo "  Parallel Operations: $PARALLEL"
    echo "  Show Summary: $SUMMARY"
    echo "  Skip Validator: $SKIP_VALIDATOR"
    echo "  Skip Token: $SKIP_TOKEN"
    echo "  Skip Wallets: $SKIP_WALLETS"
    echo "  Skip Minting: $SKIP_MINTING"
    echo ""
}

start_validator() {
    if [[ "$SKIP_VALIDATOR" == "true" ]]; then
        log_info "Skipping validator startup (as requested)"

        # Check if validator is running
        if solana cluster-version --url http://localhost:$VALIDATOR_PORT &> /dev/null; then
            log_info "Validator is already running on port $VALIDATOR_PORT"
        else
            log_error "Validator is not running on port $VALIDATOR_PORT"
            log_error "Please start it manually or remove --skip-validator flag"
            exit 1
        fi
        return 0
    fi

    log_info "Starting local validator..."

    local validator_args=(
        "--rpc-port" "$VALIDATOR_PORT"
        "--quiet"
    )

    if [[ "$RESET_VALIDATOR" == "true" ]]; then
        validator_args+=("--reset")
    fi

    if [[ "$FAUCET_SOL" != "0" ]]; then
        validator_args+=("--faucet-sol" "$FAUCET_SOL")
    fi

    log_info "Command: solana-test-validator ${validator_args[*]}"

    solana-test-validator "${validator_args[@]}" &
    VALIDATOR_PID=$!

    log_success "Validator started with PID: $VALIDATOR_PID"

    # Wait for validator to start
    local wait_time=5
    if [[ "$PARALLEL" == "true" ]]; then
        wait_time=3
    fi

    log_info "Waiting $wait_time seconds for validator to start..."
    sleep $wait_time

    # Verify validator is running
    if ! solana cluster-version --url http://localhost:$VALIDATOR_PORT &> /dev/null; then
        log_error "Validator failed to start"
        exit 1
    fi

    log_success "Validator is running"
}

create_token() {
    if [[ "$SKIP_TOKEN" == "true" ]]; then
        log_info "Skipping token creation (as requested)"
        return 0
    fi

    log_info "Creating $TOKEN_NAME token mint..."

    # Check if mint already exists
    if [[ -f "./$TOKEN_SYMBOL-mint-keypair.json" ]]; then
        log_warning "Mint keypair already exists at ./$TOKEN_SYMBOL-mint-keypair.json"
        read -p "Do you want to use existing mint? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log_info "Using existing mint"
            MINT_PUBKEY=$(solana-keygen pubkey ./$TOKEN_SYMBOL-mint-keypair.json)
            TOKEN_ADDRESS=$MINT_PUBKEY
            return 0
        else
            rm ./$TOKEN_SYMBOL-mint-keypair.json
            log_info "Removed existing mint"
        fi
    fi

    # Create mint keypair
    if [[ "$PARALLEL" == "true" ]]; then
        solana-keygen new --no-bip39-passphrase --silent --force --outfile ./$TOKEN_SYMBOL-mint-keypair.json &
        wait
    else
        solana-keygen new --no-bip39-passphrase --silent --force --outfile ./$TOKEN_SYMBOL-mint-keypair.json
    fi

    MINT_PUBKEY=$(solana-keygen pubkey ./$TOKEN_SYMBOL-mint-keypair.json)
    log_success "Mint public key: $MINT_PUBKEY"

    # Create token
    if [[ "$PARALLEL" == "true" ]]; then
        spl-token create-token ./$TOKEN_SYMBOL-mint-keypair.json --decimals $TOKEN_DECIMALS &
        wait
    else
        spl-token create-token ./$TOKEN_SYMBOL-mint-keypair.json --decimals $TOKEN_DECIMALS
    fi

    TOKEN_ADDRESS=$(spl-token address --mint-authority ~/.config/solana/id.json)
    log_success "Token address: $TOKEN_ADDRESS"
}

create_wallets() {
    if [[ "$SKIP_WALLETS" == "true" ]]; then
        log_info "Skipping wallet creation (as requested)"
        return 0
    fi

    log_info "Creating $WALLET_COUNT test wallets..."

    # Create wallets directory if it doesn't exist
    mkdir -p wallets

    for i in $(seq 1 $WALLET_COUNT); do
        local wallet_file="./wallets/wallet-${i}-keypair.json"

        # Check if wallet already exists
        if [[ -f "$wallet_file" ]]; then
            log_warning "Wallet $i already exists at $wallet_file"
            read -p "Do you want to use existing wallet? (y/n) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                log_info "Using existing wallet $i"
                eval "WALLET${i}_PUBKEY=$(solana-keygen pubkey $wallet_file)"
                continue
            else
                rm "$wallet_file"
                log_info "Removed existing wallet $i"
            fi
        fi

        # Create wallet
        if [[ "$PARALLEL" == "true" ]]; then
            solana-keygen new --no-bip39-passphrase --silent --force --outfile "$wallet_file" &
            wait
        else
            solana-keygen new --no-bip39-passphrase --silent --force --outfile "$wallet_file"
        fi

        eval "WALLET${i}_PUBKEY=$(solana-keygen pubkey $wallet_file)"
        log_success "Wallet $i public key: $(eval echo \$WALLET${i}_PUBKEY)"
    done
}

create_token_accounts() {
    if [[ "$SKIP_WALLETS" == "true" ]]; then
        log_info "Skipping token account creation (wallet creation was skipped)"
        return 0
    fi

    log_info "Creating token accounts..."

    for i in $(seq 1 $WALLET_COUNT); do
        local wallet_pubkey_var="WALLET${i}_PUBKEY"
        local wallet_pubkey="${!wallet_pubkey_var}"

        # Check if wallet was created
        if [[ -z "$wallet_pubkey" ]]; then
            log_error "Wallet $i was not created properly"
            exit 1
        fi

        # Create token account
        if [[ "$PARALLEL" == "true" ]]; then
            spl-token create-account $TOKEN_ADDRESS --owner $wallet_pubkey &
            wait
        else
            spl-token create-account $TOKEN_ADDRESS --owner $wallet_pubkey
        fi

        eval "ACCOUNT${i}_ADDRESS=$(spl-token address --mint-authority $wallet_pubkey --token $TOKEN_ADDRESS)"
        log_success "Account $i address: $(eval echo \$ACCOUNT${i}_ADDRESS)"
    done
}

mint_tokens() {
    if [[ "$SKIP_MINTING" == "true" ]]; then
        log_info "Skipping token minting (as requested)"
        return 0
    fi

    log_info "Minting $MINT_AMOUNT tokens to each wallet..."

    for i in $(seq 1 $WALLET_COUNT); do
        local account_address_var="ACCOUNT${i}_ADDRESS"
        local account_address="${!account_address_var}"

        # Check if account was created
        if [[ -z "$account_address" ]]; then
            log_error "Token account $i was not created properly"
            exit 1
        fi

        # Mint tokens
        if [[ "$PARALLEL" == "true" ]]; then
            spl-token mint --mint-authority ~/.config/solana/id.json --token-address $TOKEN_ADDRESS $MINT_AMOUNT $account_address &
        else
            spl-token mint --mint-authority ~/.config/solana/id.json --token-address $TOKEN_ADDRESS $MINT_AMOUNT $account_address
        fi
    done

    if [[ "$PARALLEL" == "true" ]]; then
        wait
    fi

    log_success "Minting complete"
}

save_token_info() {
    log_info "Saving token information..."

    # Save token info to JSON
    cat > $TOKEN_SYMBOL-token-info.json << EOF
{
  "name": "$TOKEN_NAME",
  "symbol": "$TOKEN_SYMBOL",
  "mint": "$TOKEN_ADDRESS",
  "decimals": $TOKEN_DECIMALS,
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)",
  "config": {
    "profile": "$PROFILE",
    "walletCount": $WALLET_COUNT,
    "mintAmount": $MINT_AMOUNT
  }
}
EOF

    log_success "Token information saved to $TOKEN_SYMBOL-token-info.json"

    # Save wallet addresses to JSON
    local wallet_info="["
    for i in $(seq 1 $WALLET_COUNT); do
        local wallet_pubkey_var="WALLET${i}_PUBKEY"
        local account_address_var="ACCOUNT${i}_ADDRESS"
        local wallet_pubkey="${!wallet_pubkey_var}"
        local account_address="${!account_address_var}"

        if [[ $i -gt 1 ]]; then
            wallet_info+=","
        fi

        wallet_info+="
    {
      \"id\": $i,
      \"publicKey\": \"$wallet_pubkey\",
      \"tokenAccount\": \"$account_address\",
      \"keypairPath\": \"./wallets/wallet-$i-keypair.json\"
    }"
    done
    wallet_info+="
]"

    echo "$wallet_info" > wallets/wallets.json
    log_success "Wallet information saved to wallets/wallets.json"
}

show_summary() {
    if [[ "$SUMMARY" == "false" ]]; then
        return 0
    fi

    log_info "Setup Summary:"
    echo "================================"
    echo "Validator PID: $VALIDATOR_PID"
    echo "RPC URL: http://localhost:$VALIDATOR_PORT"
    echo "Token: $TOKEN_NAME ($TOKEN_SYMBOL)"
    echo "Token Address: $TOKEN_ADDRESS"
    echo "Wallets Created: $WALLET_COUNT"

    for i in $(seq 1 $WALLET_COUNT); do
        local wallet_pubkey_var="WALLET${i}_PUBKEY"
        local wallet_pubkey="${!wallet_pubkey_var}"
        echo "  Wallet $i: $wallet_pubkey"
    done

    echo ""
    echo "Token Management:"
    echo "  ts-node scripts/08-token-manager.ts mint <wallet> <amount>"
    echo ""
    echo "Wallet Management:"
    echo "  ts-node scripts/09-wallet-manager.ts list"
    echo ""
    if [[ -n "$VALIDATOR_PID" ]]; then
        echo "Stop validator with: kill $VALIDATOR_PID"
    fi
}

# Main execution
main() {
    log_info "GridTokenX Setup Script"
    echo "================================"

    parse_arguments "$@"

    print_config

    # Step 1: Start validator
    start_validator

    # Step 2: Create token
    create_token

    # Step 3: Create wallets
    create_wallets

    # Step 4: Create token accounts
    create_token_accounts

    # Step 5: Mint tokens
    mint_tokens

    # Step 6: Save information
    save_token_info

    # Step 7: Show summary
    show_summary

    log_success "Setup completed successfully!"
}

# Run main function with all arguments
main "$@"
