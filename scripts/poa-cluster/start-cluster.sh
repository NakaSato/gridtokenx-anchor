#!/usr/bin/env bash
# Start all validators in the PoA cluster

set -euo pipefail

echo "Starting PoA cluster with 3 validators..."

for i in $(seq 1 3); do
    VALIDATOR_PATH="/Users/chanthawat/Developments/gridtokenx-platform-infa/gridtokenx-anchor/scripts/poa-cluster/validators/validator-${i}"
    echo "Starting validator-${i}..."
    if [ $i -eq 1 ]; then
        "${VALIDATOR_PATH}/start.sh" &
    else
        "${VALIDATOR_PATH}/start.sh" --no-snapshot-fetch &
    fi
    sleep 2
done

echo "All validators started. Waiting for cluster to stabilize..."
sleep 10

echo "Cluster status:"
for i in $(seq 1 3); do
    RPC_PORT=$((8899 + ($i - 1) * 100))
    echo -n "Validator ${i} (RPC: ${RPC_PORT}): "
    solana cluster-version --url "http://127.0.0.1:${RPC_PORT}" 2>/dev/null || echo "Not ready"
done
