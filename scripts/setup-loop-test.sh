#!/bin/bash

# Setup script for loop transfer test
# This script sets up wallets and mints tokens for the loop transfer performance test

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "🔧 Setting up loop transfer test environment..."
echo ""

# Check if validator is running
if ! solana cluster-version --url http://localhost:8899 &> /dev/null; then
    echo "❌ Solana validator not running!"
    echo "   Please start it in another terminal: cd anchor && anchor localnet"
    exit 1
fi

echo "✅ Validator is running"
echo ""

# Set environment variables
export ANCHOR_PROVIDER_URL=http://localhost:8899
export ANCHOR_WALLET=~/.config/solana/id.json

echo "🚀 Running standalone setup..."
echo ""
ts-node scripts/setup-loop-test-standalone.ts
