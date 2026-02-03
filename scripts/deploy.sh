#!/bin/bash
set -e

# Deployment Script for GridTokenX Anchor Programs
# Enforces verifiable builds and proper configuration.

CONFIG="Anchor.mainnet.toml"
CLUSTER="mainnet"

echo "🚀 Starting Deployment Process to $CLUSTER..."
echo "Using config: $CONFIG"

# 1. Build Verification
echo "🔍 Building Verifiable Artifacts..."
anchor build --verifiable --provider.cluster $CLUSTER --config $CONFIG

echo "✅ Build Complete."

# 2. Check Program Size (Optional check, good practice)
# echo "Checking program sizes..."
# ls -lh target/verifiable/

# 3. Prompt for Deployment
read -p "⚠️  Are you sure you want to deploy to Mainnet? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 Deploying..."
    anchor deploy --provider.cluster $CLUSTER --config $CONFIG
    echo "✅ Deployment Successful!"
else
    echo "❌ Deployment Cancelled."
    exit 1
fi
