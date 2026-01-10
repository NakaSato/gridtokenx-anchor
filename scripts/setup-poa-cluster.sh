#!/usr/bin/env bash
# ==============================================================================
# Solana Permissioned Environment (SPE) Setup Script
# 
# This script configures a Solana cluster to operate in Proof of Authority (PoA)
# mode for TPC-C benchmarking. PoA is emulated by:
# 
# 1. Fixed validator set defined at genesis
# 2. 100% stake allocated to authorized validators
# 3. Disabled inflation and rewards
# 4. Restricted peer discovery
#
# Reference: Section 2.2 - "Configuring Solana as a Permissioned Environment (SPE)"
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POA_DIR="${SCRIPT_DIR}/poa-cluster"
GENESIS_DIR="${POA_DIR}/genesis"
VALIDATOR_DIR="${POA_DIR}/validators"
LOG_DIR="${POA_DIR}/logs"

# Configuration
NUM_VALIDATORS=${NUM_VALIDATORS:-3}
LEDGER_LIMIT=${LEDGER_LIMIT:-50000000}  # 50GB limit
BASE_PORT=${BASE_PORT:-8899}
FAUCET_SOL=${FAUCET_SOL:-1000000}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# ==============================================================================
# PHASE 1: Directory Setup
# ==============================================================================

setup_directories() {
    log_info "Setting up PoA cluster directories..."
    
    mkdir -p "${GENESIS_DIR}"
    mkdir -p "${LOG_DIR}"
    
    for i in $(seq 1 $NUM_VALIDATORS); do
        mkdir -p "${VALIDATOR_DIR}/validator-${i}"
    done
    
    log_info "Directories created at ${POA_DIR}"
}

# ==============================================================================
# PHASE 2: Generate Keypairs
# ==============================================================================

generate_keypairs() {
    log_info "Generating validator keypairs for ${NUM_VALIDATORS} validators..."
    
    # Faucet keypair (for airdrops during testing)
    if [[ ! -f "${GENESIS_DIR}/faucet-keypair.json" ]]; then
        solana-keygen new --no-bip39-passphrase -o "${GENESIS_DIR}/faucet-keypair.json" --force
        log_info "Generated faucet keypair"
    fi
    
    # Generate keypairs for each validator
    for i in $(seq 1 $NUM_VALIDATORS); do
        VALIDATOR_PATH="${VALIDATOR_DIR}/validator-${i}"
        
        # Identity keypair (validator identity)
        if [[ ! -f "${VALIDATOR_PATH}/identity.json" ]]; then
            solana-keygen new --no-bip39-passphrase -o "${VALIDATOR_PATH}/identity.json" --force
            log_info "Generated identity for validator-${i}"
        fi
        
        # Vote account keypair
        if [[ ! -f "${VALIDATOR_PATH}/vote-account.json" ]]; then
            solana-keygen new --no-bip39-passphrase -o "${VALIDATOR_PATH}/vote-account.json" --force
            log_info "Generated vote account for validator-${i}"
        fi
        
        # Stake account keypair
        if [[ ! -f "${VALIDATOR_PATH}/stake-account.json" ]]; then
            solana-keygen new --no-bip39-passphrase -o "${VALIDATOR_PATH}/stake-account.json" --force
            log_info "Generated stake account for validator-${i}"
        fi
    done
}

# ==============================================================================
# PHASE 3: Create Genesis Configuration
# ==============================================================================

create_genesis() {
    log_info "Creating genesis configuration for PoA cluster..."
    
    # Calculate stake per validator (equal distribution for PoA)
    TOTAL_STAKE=$((1000000000 * 1000000000))  # 1 billion SOL in lamports
    STAKE_PER_VALIDATOR=$((TOTAL_STAKE / NUM_VALIDATORS))
    
    # Build primordial accounts list
    PRIMORDIAL_ARGS=""
    
    # Add faucet with initial balance
    FAUCET_PUBKEY=$(solana-keygen pubkey "${GENESIS_DIR}/faucet-keypair.json")
    PRIMORDIAL_ARGS+=" --bootstrap-validator-lamports ${STAKE_PER_VALIDATOR}"
    PRIMORDIAL_ARGS+=" --faucet-lamports $((FAUCET_SOL * 1000000000))"
    PRIMORDIAL_ARGS+=" --faucet-pubkey ${FAUCET_PUBKEY}"
    
    # Build bootstrap validator arguments
    BOOTSTRAP_ARGS=""
    for i in $(seq 1 $NUM_VALIDATORS); do
        VALIDATOR_PATH="${VALIDATOR_DIR}/validator-${i}"
        
        IDENTITY=$(solana-keygen pubkey "${VALIDATOR_PATH}/identity.json")
        VOTE_ACCOUNT=$(solana-keygen pubkey "${VALIDATOR_PATH}/vote-account.json")
        STAKE_ACCOUNT=$(solana-keygen pubkey "${VALIDATOR_PATH}/stake-account.json")
        
        if [[ $i -eq 1 ]]; then
            # First validator is the bootstrap validator
            BOOTSTRAP_ARGS+=" --bootstrap-validator ${IDENTITY} ${VOTE_ACCOUNT} ${STAKE_ACCOUNT}"
        else
            # Additional validators added as primordial accounts
            PRIMORDIAL_ARGS+=" --primordial-account-for-stake ${STAKE_ACCOUNT}:${STAKE_PER_VALIDATOR}"
        fi
    done
    
    # Genesis configuration for PoA:
    # - Disable inflation (no new tokens minted)
    # - Disable rent collection (optional, for simpler testing)
    # - Set high transaction fee to prevent spam
    log_info "Generating genesis block..."
    
    rm -rf "${GENESIS_DIR}/ledger"
    
    solana-genesis \
        --cluster-type mainnet-beta \
        --ledger "${GENESIS_DIR}/ledger" \
        --hashes-per-tick auto \
        --target-tick-duration 400 \
        --slots-per-epoch 32 \
        --enable-warmup-epochs \
        --max-genesis-archive-unpacked-size 1073741824 \
        --inflation none \
        ${BOOTSTRAP_ARGS} \
        ${PRIMORDIAL_ARGS} \
        2>&1 | tee "${LOG_DIR}/genesis.log"
    
    log_info "Genesis block created at ${GENESIS_DIR}/ledger"
    
    # Export genesis hash
    GENESIS_HASH=$(solana-ledger-tool genesis-hash --ledger "${GENESIS_DIR}/ledger")
    echo "${GENESIS_HASH}" > "${GENESIS_DIR}/genesis-hash.txt"
    log_info "Genesis hash: ${GENESIS_HASH}"
}

# ==============================================================================
# PHASE 4: Generate Validator Configuration Files
# ==============================================================================

generate_validator_configs() {
    log_info "Generating validator configuration files..."
    
    for i in $(seq 1 $NUM_VALIDATORS); do
        VALIDATOR_PATH="${VALIDATOR_DIR}/validator-${i}"
        RPC_PORT=$((BASE_PORT + (i - 1) * 100))
        GOSSIP_PORT=$((8001 + (i - 1) * 10))
        TPU_PORT=$((8003 + (i - 1) * 10))
        
        # Create validator configuration
        cat > "${VALIDATOR_PATH}/config.toml" << EOF
# Solana Validator Configuration for PoA Cluster
# Validator ${i} of ${NUM_VALIDATORS}

[validator]
identity = "${VALIDATOR_PATH}/identity.json"
vote_account = "${VALIDATOR_PATH}/vote-account.json"
ledger = "${VALIDATOR_PATH}/ledger"
log_path = "${LOG_DIR}/validator-${i}.log"

# RPC Configuration
rpc_port = ${RPC_PORT}
enable_rpc_transaction_history = true
full_rpc_api = true

# Gossip Configuration (for peer discovery in PoA)
gossip_port = ${GOSSIP_PORT}

# TPU Configuration (Transaction Processing Unit)
tpu_port = ${TPU_PORT}

# Performance Tuning for Benchmarks
limit_ledger_size = ${LEDGER_LIMIT}
skip_poh_verify = false
no_voting = false

# PoA-specific: Disable features not needed for permissioned networks
no_ip_address_check = true
allow_private_addr = true
EOF

        # Create startup script for this validator
        cat > "${VALIDATOR_PATH}/start.sh" << EOF
#!/usr/bin/env bash
# Start script for Validator ${i}

set -euo pipefail

VALIDATOR_PATH="${VALIDATOR_PATH}"
GENESIS_LEDGER="${GENESIS_DIR}/ledger"
RPC_PORT=${RPC_PORT}
GOSSIP_PORT=${GOSSIP_PORT}

# Copy genesis ledger if not exists
if [[ ! -d "\${VALIDATOR_PATH}/ledger" ]]; then
    cp -r "\${GENESIS_LEDGER}" "\${VALIDATOR_PATH}/ledger"
fi

# Build entrypoint list (all other validators)
ENTRYPOINTS=""
EOF

        # Add entrypoints (connect to other validators)
        for j in $(seq 1 $NUM_VALIDATORS); do
            if [[ $j -ne $i ]]; then
                OTHER_GOSSIP=$((8001 + (j - 1) * 10))
                echo "ENTRYPOINTS+=\"--entrypoint 127.0.0.1:${OTHER_GOSSIP} \"" >> "${VALIDATOR_PATH}/start.sh"
            fi
        done

        cat >> "${VALIDATOR_PATH}/start.sh" << 'EOF'

# Start validator
exec solana-validator \
    --identity "${VALIDATOR_PATH}/identity.json" \
    --vote-account "${VALIDATOR_PATH}/vote-account.json" \
    --ledger "${VALIDATOR_PATH}/ledger" \
    --rpc-port ${RPC_PORT} \
    --gossip-port ${GOSSIP_PORT} \
    --dynamic-port-range 8100-8200 \
    --log "${LOG_DIR}/validator-${VALIDATOR_PATH##*/}.log" \
    --limit-ledger-size ${LEDGER_LIMIT} \
    --enable-rpc-transaction-history \
    --full-rpc-api \
    --no-wait-for-vote-to-start-leader \
    --no-ip-address-check \
    --allow-private-addr \
    ${ENTRYPOINTS} \
    "$@"
EOF

        chmod +x "${VALIDATOR_PATH}/start.sh"
        log_info "Generated configuration for validator-${i}"
    done
}

# ==============================================================================
# PHASE 5: Create Cluster Management Scripts
# ==============================================================================

create_management_scripts() {
    log_info "Creating cluster management scripts..."
    
    # Start all validators
    cat > "${POA_DIR}/start-cluster.sh" << EOF
#!/usr/bin/env bash
# Start all validators in the PoA cluster

set -euo pipefail

echo "Starting PoA cluster with ${NUM_VALIDATORS} validators..."

for i in \$(seq 1 ${NUM_VALIDATORS}); do
    VALIDATOR_PATH="${VALIDATOR_DIR}/validator-\${i}"
    echo "Starting validator-\${i}..."
    "\${VALIDATOR_PATH}/start.sh" &
    sleep 2
done

echo "All validators started. Waiting for cluster to stabilize..."
sleep 10

echo "Cluster status:"
for i in \$(seq 1 ${NUM_VALIDATORS}); do
    RPC_PORT=\$((${BASE_PORT} + (\$i - 1) * 100))
    echo -n "Validator \${i} (RPC: \${RPC_PORT}): "
    solana cluster-version --url "http://127.0.0.1:\${RPC_PORT}" 2>/dev/null || echo "Not ready"
done
EOF
    chmod +x "${POA_DIR}/start-cluster.sh"
    
    # Stop all validators
    cat > "${POA_DIR}/stop-cluster.sh" << 'EOF'
#!/usr/bin/env bash
# Stop all validators in the PoA cluster

echo "Stopping all Solana validators..."
pkill -f solana-validator || true
echo "Cluster stopped."
EOF
    chmod +x "${POA_DIR}/stop-cluster.sh"
    
    # Cluster status
    cat > "${POA_DIR}/cluster-status.sh" << EOF
#!/usr/bin/env bash
# Check status of all validators

echo "PoA Cluster Status"
echo "=================="

for i in \$(seq 1 ${NUM_VALIDATORS}); do
    RPC_PORT=\$((${BASE_PORT} + (\$i - 1) * 100))
    echo ""
    echo "Validator \${i} (RPC: http://127.0.0.1:\${RPC_PORT})"
    echo "----------------------------------------"
    
    solana cluster-version --url "http://127.0.0.1:\${RPC_PORT}" 2>/dev/null && \
    solana slot --url "http://127.0.0.1:\${RPC_PORT}" 2>/dev/null && \
    solana block-height --url "http://127.0.0.1:\${RPC_PORT}" 2>/dev/null || \
    echo "Validator not responding"
done
EOF
    chmod +x "${POA_DIR}/cluster-status.sh"
    
    log_info "Management scripts created"
}

# ==============================================================================
# PHASE 6: Create Anchor Configuration for PoA
# ==============================================================================

create_anchor_config() {
    log_info "Creating Anchor configuration for PoA cluster..."
    
    cat > "${POA_DIR}/Anchor.poa.toml" << EOF
# Anchor.toml configuration for PoA Cluster
# Copy this to your project root as Anchor.toml for PoA testing

[toolchain]
anchor_version = "0.32.1"

[features]
resolution = true
skip-lint = false

[programs.poa]
tpc_benchmark = "TpcC1111111111111111111111111111111111111111"
energy_token = "AZBstnPmUeRJnwv55128awdfi2tmCFzcK4W6NPXbTkWA"
governance = "2GprryNp7j7yxGuPNNjpJLHELfCdXH8UPfKSxXCvisjL"
oracle = "69e8LaTfPnFycbD1kAhStfkyJxe1LnN323k3NQAMYBHr"
registry = "9wvMT6f2Y7A37LB8y5LEQRSJxbnwLYqw1Bqq1RBtD3oM"
trading = "e7rS5sykWMXtciUEgUZ6xByqo6VqwNRNeAmQQn3Sbj2"

[provider]
cluster = "http://127.0.0.1:${BASE_PORT}"
wallet = "${GENESIS_DIR}/faucet-keypair.json"

[scripts]
benchmark-tpcc = "npx ts-node tests/performance/benchmarks/tpc-c-anchor.ts"
init-tpcc-schema = "npx ts-node scripts/init-tpcc-schema.ts"

[test]
startup_wait = 10000
shutdown_wait = 5000
upgradeable = false

# PoA-specific test configuration
[test.genesis]
# Use local PoA cluster instead of test validator
use_local_cluster = true
cluster_url = "http://127.0.0.1:${BASE_PORT}"
EOF

    log_info "Anchor configuration created at ${POA_DIR}/Anchor.poa.toml"
}

# ==============================================================================
# MAIN EXECUTION
# ==============================================================================

main() {
    log_info "Setting up Solana Permissioned Environment (SPE) for TPC-C Benchmarking"
    log_info "Configuration: ${NUM_VALIDATORS} validators, base port ${BASE_PORT}"
    echo ""
    
    setup_directories
    generate_keypairs
    create_genesis
    generate_validator_configs
    create_management_scripts
    create_anchor_config
    
    echo ""
    log_info "PoA cluster setup complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Start cluster:  ${POA_DIR}/start-cluster.sh"
    echo "  2. Check status:   ${POA_DIR}/cluster-status.sh"
    echo "  3. Stop cluster:   ${POA_DIR}/stop-cluster.sh"
    echo ""
    echo "For benchmarking:"
    echo "  cp ${POA_DIR}/Anchor.poa.toml ./Anchor.toml"
    echo "  anchor build"
    echo "  anchor deploy --provider.cluster poa"
    echo ""
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
