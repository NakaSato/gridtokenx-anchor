#!/bin/bash
set -e

echo "🔥 Starting Chaos Test..."
CWD=$(pwd)

# 1. Start workload in background
echo "📈 Starting background workload..."
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
export ANCHOR_WALLET=/Users/chanthawat/Developments/gridtokenx-platform-infa/gridtokenx-anchor/scripts/poa-cluster/genesis/faucet-keypair.json
npx tsx tests/performance/benchmarks/smallbank-anchor.ts --duration 60000 & 
WORKLOAD_PID=$!

sleep 10

# 2. Stop Validator 2
echo "⛔ Stopping Validator 2..."
# Find PID for validator-2
V2_PID=$(ps aux | grep "validator-2" | grep "solana-validator" | awk '{print $2}')
if [ ! -z "$V2_PID" ]; then
    kill -9 $V2_PID
    echo "✅ Validator 2 stopped."
else
    echo "⚠️  Validator 2 not found."
fi

sleep 15

# 3. Check if validator-1 is still producing blocks
SLOT=$(solana slot --url http://127.0.0.1:8899)
echo "💎 Current Slot on Validator 1: $SLOT (Should be increasing)"

# 4. Restart Validator 2
echo "🚀 Restarting Validator 2..."
./scripts/poa-cluster/start-cluster.sh --node 2

sleep 15

# 5. Stop Validator 3
echo "⛔ Stopping Validator 3..."
V3_PID=$(ps aux | grep "validator-3" | grep "solana-validator" | awk '{print $2}')
if [ ! -z "$V3_PID" ]; then
    kill -9 $V3_PID
    echo "✅ Validator 3 stopped."
else
    echo "⚠️  Validator 3 not found."
fi

sleep 15

# 6. Restart Validator 3
echo "🚀 Restarting Validator 3..."
./scripts/poa-cluster/start-cluster.sh --node 3

sleep 10

echo "🎉 Chaos Test Sequence Complete."
kill $WORKLOAD_PID || true
