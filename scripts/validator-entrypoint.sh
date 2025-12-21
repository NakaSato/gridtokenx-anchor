#!/bin/bash
# GridTokenX PoA Validator Entrypoint
# Handles bootstrap, secondary, and RPC node configurations

set -e

VALIDATOR_TYPE="${VALIDATOR_TYPE:-secondary}"
LEDGER_DIR="${LEDGER_DIR:-/data/ledger}"
GOSSIP_PORT="${GOSSIP_PORT:-8001}"
RPC_PORT="${RPC_PORT:-8899}"
IDENTITY_KEYPAIR="${IDENTITY_KEYPAIR:-/keys/identity.json}"
VOTE_ACCOUNT_KEYPAIR="${VOTE_ACCOUNT_KEYPAIR:-/keys/vote.json}"
ENTRYPOINT="${ENTRYPOINT:-}"

# Wait for entrypoint to be available (for secondary validators)
wait_for_entrypoint() {
    if [ -n "$ENTRYPOINT" ]; then
        echo "Waiting for entrypoint: $ENTRYPOINT"
        HOST=$(echo $ENTRYPOINT | cut -d: -f1)
        PORT=$(echo $ENTRYPOINT | cut -d: -f2)
        
        for i in $(seq 1 60); do
            if nc -z "$HOST" "$PORT" 2>/dev/null; then
                echo "Entrypoint $ENTRYPOINT is available"
                return 0
            fi
            echo "Waiting for $ENTRYPOINT... ($i/60)"
            sleep 2
        done
        
        echo "ERROR: Entrypoint $ENTRYPOINT not available after 120s"
        exit 1
    fi
}

# Generate keypairs if they don't exist
generate_keypairs() {
    if [ ! -f "$IDENTITY_KEYPAIR" ]; then
        echo "Generating identity keypair..."
        solana-keygen new --no-bip39-passphrase -o "$IDENTITY_KEYPAIR"
    fi
    
    if [ ! -f "$VOTE_ACCOUNT_KEYPAIR" ] && [ "$VALIDATOR_TYPE" != "rpc" ]; then
        echo "Generating vote account keypair..."
        solana-keygen new --no-bip39-passphrase -o "$VOTE_ACCOUNT_KEYPAIR"
    fi
}

# Start bootstrap validator (genesis node)
start_bootstrap() {
    echo "Starting BOOTSTRAP validator..."
    
    # Create genesis if ledger is empty
    if [ ! -d "$LEDGER_DIR/rocksdb" ]; then
        echo "Creating genesis ledger..."
        
        # Create faucet and stake keypairs
        FAUCET_KEYPAIR="/tmp/faucet.json"
        STAKE_KEYPAIR="/tmp/stake.json"
        solana-keygen new --no-bip39-passphrase -o "$FAUCET_KEYPAIR" --force
        solana-keygen new --no-bip39-passphrase -o "$STAKE_KEYPAIR" --force
        
        solana-genesis \
            --ledger "$LEDGER_DIR" \
            --bootstrap-validator "$IDENTITY_KEYPAIR" "$VOTE_ACCOUNT_KEYPAIR" "$STAKE_KEYPAIR" \
            --faucet-pubkey "$FAUCET_KEYPAIR" \
            --faucet-lamports 1000000000000000000 \
            --slots-per-epoch "${SLOTS_PER_EPOCH:-32}" \
            --ticks-per-slot "${TICKS_PER_SLOT:-64}" \
            --hashes-per-tick "${HASHES_PER_TICK:-auto}" \
            --cluster-type development \
            --max-genesis-archive-unpacked-size 1073741824
    fi
    
    exec solana-validator \
        --identity "$IDENTITY_KEYPAIR" \
        --vote-account "$VOTE_ACCOUNT_KEYPAIR" \
        --ledger "$LEDGER_DIR" \
        --rpc-port "$RPC_PORT" \
        --gossip-port "$GOSSIP_PORT" \
        --dynamic-port-range 8002-8020 \
        --no-port-check \
        --rpc-bind-address 0.0.0.0 \
        --enable-rpc-transaction-history \
        --full-rpc-api \
        --allow-private-addr \
        --log -
}

# Start secondary validator
start_secondary() {
    echo "Starting SECONDARY validator..."
    wait_for_entrypoint
    
    exec solana-validator \
        --identity "$IDENTITY_KEYPAIR" \
        --vote-account "$VOTE_ACCOUNT_KEYPAIR" \
        --ledger "$LEDGER_DIR" \
        --entrypoint "$ENTRYPOINT" \
        --rpc-port "$RPC_PORT" \
        --gossip-port "$GOSSIP_PORT" \
        --dynamic-port-range 8002-8020 \
        --no-port-check \
        --rpc-bind-address 0.0.0.0 \
        --expected-shred-version 0 \
        --allow-private-addr \
        --log -
}

# Start RPC node (no voting)
start_rpc() {
    echo "Starting RPC node (non-voting)..."
    wait_for_entrypoint
    
    exec solana-validator \
        --identity "$IDENTITY_KEYPAIR" \
        --no-voting \
        --ledger "$LEDGER_DIR" \
        --entrypoint "$ENTRYPOINT" \
        --rpc-port "$RPC_PORT" \
        --gossip-port "$GOSSIP_PORT" \
        --dynamic-port-range 8002-8020 \
        --no-port-check \
        --rpc-bind-address 0.0.0.0 \
        --enable-rpc-transaction-history \
        --full-rpc-api \
        --allow-private-addr \
        --log -
}

# Main
echo "=========================================="
echo "GridTokenX PoA Validator"
echo "Type: $VALIDATOR_TYPE"
echo "Ledger: $LEDGER_DIR"
echo "Identity: $IDENTITY_KEYPAIR"
echo "=========================================="

generate_keypairs

case "$VALIDATOR_TYPE" in
    bootstrap)
        start_bootstrap
        ;;
    secondary)
        start_secondary
        ;;
    rpc)
        start_rpc
        ;;
    *)
        echo "Unknown VALIDATOR_TYPE: $VALIDATOR_TYPE"
        echo "Valid options: bootstrap, secondary, rpc"
        exit 1
        ;;
esac
