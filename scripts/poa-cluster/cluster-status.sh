#!/usr/bin/env bash
# Check status of all validators

echo "PoA Cluster Status"
echo "=================="

for i in $(seq 1 3); do
    RPC_PORT=$((8899 + ($i - 1) * 100))
    echo ""
    echo "Validator ${i} (RPC: http://127.0.0.1:${RPC_PORT})"
    echo "----------------------------------------"
    
    solana cluster-version --url "http://127.0.0.1:${RPC_PORT}" 2>/dev/null &&     solana slot --url "http://127.0.0.1:${RPC_PORT}" 2>/dev/null &&     solana block-height --url "http://127.0.0.1:${RPC_PORT}" 2>/dev/null ||     echo "Validator not responding"
done
