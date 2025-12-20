#!/bin/bash
# GridTokenX Anchor Entrypoint Script

set -e

LEDGER_DIR="${LEDGER_DIR:-/data/ledger}"
RPC_PORT="${RPC_PORT:-8899}"

echo "🚀 Starting Solana Test Validator..."
echo "Ledger: $LEDGER_DIR"
echo "RPC Port: $RPC_PORT"

# Create ledger directory if not exists
mkdir -p $LEDGER_DIR

# Start validator
solana-test-validator \
    --ledger $LEDGER_DIR \
    --rpc-port $RPC_PORT \
    --bind-address 0.0.0.0 \
    --dynamic-port-range 8001-8020 \
    --log $LEDGER_DIR/validator.log \
    &

VALIDATOR_PID=$!

# Wait for validator to start
echo "Waiting for validator to start..."
for i in {1..60}; do
    if solana cluster-version --url http://localhost:$RPC_PORT &>/dev/null; then
        echo "✅ Validator started"
        break
    fi
    sleep 1
done

# Deploy programs
if [ -d "/app/programs" ] && [ "$(ls -A /app/programs/*.so 2>/dev/null)" ]; then
    echo "📦 Deploying programs..."
    for program in /app/programs/*.so; do
        PROGRAM_NAME=$(basename $program .so)
        echo "  Deploying: $PROGRAM_NAME"
        solana program deploy $program --url http://localhost:$RPC_PORT || true
    done
    echo "✅ Programs deployed"
fi

echo "🎯 Solana validator is ready"
echo "   RPC: http://localhost:$RPC_PORT"

# Keep validator running
wait $VALIDATOR_PID
