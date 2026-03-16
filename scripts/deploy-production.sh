#!/bin/bash
# GridTokenX Production-Ready Deployment Script
# This script automates the deployment and initialization of the Platform.

set -e

echo "🏗️ Building GridTokenX programs..."
anchor build

echo "🚀 Deploying programs to cluster..."
anchor deploy

# Check if we are on localnet to give faucet some SOL
if [[ $(anchor config get | grep "http://127.0.0.1:8899") ]]; then
    echo "💧 Airdropping SOL to deployment authority..."
    solana airdrop 10 -u http://127.0.0.1:8899 $(solana address) || true
fi

echo "⚙️ Initializing global Registry..."
anchor run init-registry

echo "⚙️ Initializing 16 Registry Shards..."
anchor run init-shards

echo "✅ Deployment and initialization complete."
echo "------------------------------------------------"
echo "Registry ID: $(anchor keys list | grep registry | awk '{print $2}')"
echo "------------------------------------------------"
