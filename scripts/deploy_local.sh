#!/bin/bash
set -e

# Localnet Deployment Script
# Simulates a production deployment locally.

CONFIG="Anchor.toml"
CLUSTER="localnet"

echo "🚀 Starting Localnet Deployment..."
echo "Using config: $CONFIG"

# 1. Build (Verifiable to ensure reproducibility even locally)
echo "🔍 Building..."
# Note: In local dev, --verifiable is slow (docker). We use standard build for speed unless specified.
if [ "$1" == "--verifiable" ]; then
    anchor build --verifiable
else
    anchor build
fi

echo "✅ Build Complete."

# 2. Deploy
echo "🚀 Deploying to Localnet..."
# Ensure validator is running
if ! pgrep -x "solana-test-validator" > /dev/null; then
    echo "⚠️  Solana Test Validator not running. Starting it..."
    # anchor localnet would handle this, but for pure deploy we expect it running or use anchor deploy
fi

anchor deploy

echo "✅ Localnet Deployment Successful!"
