#!/bin/bash

# Airdrop Verification Script
# This script runs comprehensive tests to verify airdrop functionality for new accounts

set -e

echo "🔍 GridTokenX Airdrop Verification"
echo "===================================="
echo ""
echo "This script verifies that:"
echo "  ✓ New accounts can be registered"
echo "  ✓ Initial tokens are properly distributed (airdrop)"
echo "  ✓ Token balances are correctly initialized"
echo "  ✓ Multiple accounts receive proper airdrop amounts"
echo ""

# Check if running in the correct directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found"
    echo "Please run this script from the gridtokenx-anchor directory"
    exit 1
fi

# Check if tests directory exists
if [ ! -d "tests" ]; then
    echo "❌ Error: tests directory not found"
    exit 1
fi

# Check if airdrop test file exists
if [ ! -f "tests/airdrop_verification.ts" ]; then
    echo "❌ Error: airdrop_verification.ts test file not found"
    echo "Please ensure the test file exists in tests/airdrop_verification.ts"
    exit 1
fi

echo "📝 Prerequisites:"
echo "  ✓ Anchor will start a test validator automatically"
echo "  ✓ Anchor programs will be built"
echo ""

echo "📦 Installing dependencies if needed..."
if [ ! -d "node_modules" ]; then
    pnpm install || npm install
fi

echo ""
echo "🏗️  Building anchor programs..."
anchor build --skip-lint || true

echo ""
echo "🧪 Running airdrop verification tests..."
echo "========================================"
echo ""

# Run using anchor test which handles validator automatically
npm run test:airdrop

EXIT_CODE=$?

echo ""
echo "========================================"
if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ All airdrop verification tests passed!"
else
    echo "❌ Some tests failed with exit code: $EXIT_CODE"
    echo ""
    echo "Troubleshooting tips:"
    echo "  • Check that programs are properly built: anchor build"
    echo "  • Verify test file syntax is correct"
    echo "  • Check for type definition issues in TypeScript"
    echo "  • Review logs for specific error messages"
fi

exit $EXIT_CODE
