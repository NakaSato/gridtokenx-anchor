#!/usr/bin/env bash
# Stop all validators in the PoA cluster

echo "Stopping all Solana validators..."
pkill -f solana-validator || true
echo "Cluster stopped."
