#!/usr/bin/env bash
# Start script for Validator 3

set -euo pipefail

VALIDATOR_PATH="/Users/chanthawat/Developments/gridtokenx-platform-infa/gridtokenx-anchor/scripts/poa-cluster/validators/validator-3"
GENESIS_LEDGER="/tmp/gridtokenx-poa/genesis/ledger"
VALIDATOR_LEDGER="/tmp/gridtokenx-poa/validators/validator-3/ledger"
RPC_PORT=9099
GOSSIP_PORT=8021
LOG_DIR="/Users/chanthawat/Developments/gridtokenx-platform-infa/gridtokenx-anchor/scripts/poa-cluster/logs"
LEDGER_LIMIT=50000000
export PATH="/Users/chanthawat/.local/share/solana/install/active_release/bin:$PATH"

# Copy genesis ledger if not exists
if [[ ! -d "${VALIDATOR_LEDGER}" ]]; then
    mkdir -p "${VALIDATOR_LEDGER}"
    cp -r "${GENESIS_LEDGER}/" "${VALIDATOR_LEDGER}/"
fi

# Build entrypoint list (all other validators)
ENTRYPOINTS=""
ENTRYPOINTS+="--entrypoint 127.0.0.1:8001 "

# Start validator
exec solana-validator \
    --identity "${VALIDATOR_PATH}/identity.json" \
    --vote-account "${VALIDATOR_PATH}/vote-account.json" \
    --authorized-voter "${VALIDATOR_PATH}/identity.json" \
    --ledger "${VALIDATOR_LEDGER}" \
    --rpc-port ${RPC_PORT} \
    --gossip-port ${GOSSIP_PORT} \
    --dynamic-port-range 8600-8650 \
    --log "${LOG_DIR}/validator-${VALIDATOR_PATH##*/}.log" \
    --limit-ledger-size ${LEDGER_LIMIT} \
    --enable-rpc-transaction-history \
    --full-rpc-api \
    --no-wait-for-vote-to-start-leader \
    --no-port-check \
    --allow-private-addr \
    --no-snapshot-fetch \
    ${ENTRYPOINTS} \
    "$@"
