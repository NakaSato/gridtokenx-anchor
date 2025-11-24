#!/bin/bash

echo "🚀 Comprehensive Solana Transaction Test Runner"
echo "========================================"

# Check if local validator is running
echo "Checking for local validator..."
if ! curl -s http://localhost:8899/health > /dev/null; then
    echo "❌ Local validator not running. Please start it with:"
    echo "solana-test-validator"
    exit 1
fi

echo "✅ Local validator detected"
echo ""

# Set wallet paths
WALLETS=("dev-wallet.json" "wallet-1-keypair.json" "wallet-2-keypair.json")

# Display initial wallet states
echo "=== Initial Wallet States ==="
for wallet in "${WALLETS[@]}"; do
    if [ -f "$wallet" ]; then
        ADDRESS=$(solana address -k "$wallet")
        BALANCE=$(solana balance -k "$wallet" | awk '{print $1}')
        WALLET_NAME=$(echo "$wallet" | cut -d'.' -f1 | cut -d'-' -f1)
        echo "${WALLET_NAME}: ${ADDRESS} - ${BALANCE} SOL"
    fi
done

echo ""
echo "Starting comprehensive transaction tests..."
echo ""

# Run TypeScript test
npx ts-node test-transactions/comprehensive/run-comprehensive-test.ts
