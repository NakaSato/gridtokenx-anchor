#!/usr/bin/env bash
# Generate genesis.bin for the PoA cluster

set -euo pipefail
export COPYFILE_DISABLE=1

CLUSTER_ROOT="/Users/chanthawat/Developments/gridtokenx-platform-infa/gridtokenx-anchor/scripts/poa-cluster"
GENESIS_DIR="/tmp/gridtokenx-poa/genesis"
LEDGER_DIR="${GENESIS_DIR}/ledger"

# Ensure genesis directory exists
mkdir -p "${LEDGER_DIR}"

# Validator identities
VAL1_ID="${CLUSTER_ROOT}/validators/validator-1/identity.json"
VAL1_VOTE="${CLUSTER_ROOT}/validators/validator-1/vote-account.json"
VAL1_STAKE="${CLUSTER_ROOT}/validators/validator-1/stake-account.json"

VAL2_ID="${CLUSTER_ROOT}/validators/validator-2/identity.json"
VAL2_VOTE="${CLUSTER_ROOT}/validators/validator-2/vote-account.json"
VAL2_STAKE="${CLUSTER_ROOT}/validators/validator-2/stake-account.json"

VAL3_ID="${CLUSTER_ROOT}/validators/validator-3/identity.json"
VAL3_VOTE="${CLUSTER_ROOT}/validators/validator-3/vote-account.json"
VAL3_STAKE="${CLUSTER_ROOT}/validators/validator-3/stake-account.json"

FAUCET_KEYPAIR="${CLUSTER_ROOT}/genesis/faucet-keypair.json"

# Extract pubkeys
VAL1_ID_PUB=$(solana-keygen pubkey "${VAL1_ID}")
VAL1_VOTE_PUB=$(solana-keygen pubkey "${VAL1_VOTE}")
VAL1_STAKE_PUB=$(solana-keygen pubkey "${VAL1_STAKE}")

VAL2_ID_PUB=$(solana-keygen pubkey "${VAL2_ID}")
VAL2_VOTE_PUB=$(solana-keygen pubkey "${VAL2_VOTE}")
VAL2_STAKE_PUB=$(solana-keygen pubkey "${VAL2_STAKE}")

VAL3_ID_PUB=$(solana-keygen pubkey "${VAL3_ID}")
VAL3_VOTE_PUB=$(solana-keygen pubkey "${VAL3_VOTE}")
VAL3_STAKE_PUB=$(solana-keygen pubkey "${VAL3_STAKE}")

FAUCET_PUB=$(solana-keygen pubkey "${FAUCET_KEYPAIR}")

# Check if genesis already exists
if [[ -f "${LEDGER_DIR}/genesis.bin" ]]; then
    echo "Genesis already exists at ${LEDGER_DIR}/genesis.bin"
    exit 0
fi

echo "Generating new genesis block..."

solana-genesis \
    --cluster-type development \
    --bootstrap-validator "${VAL1_ID_PUB}" "${VAL1_VOTE_PUB}" "${VAL1_STAKE_PUB}" \
    --bootstrap-validator "${VAL2_ID_PUB}" "${VAL2_VOTE_PUB}" "${VAL2_STAKE_PUB}" \
    --bootstrap-validator "${VAL3_ID_PUB}" "${VAL3_VOTE_PUB}" "${VAL3_STAKE_PUB}" \
    --faucet-pubkey "${FAUCET_PUB}" \
    --faucet-lamports 500000000000000000 \
    --hashes-per-tick sleep \
    --ledger "${LEDGER_DIR}"

echo "Genesis generated successfully!"
