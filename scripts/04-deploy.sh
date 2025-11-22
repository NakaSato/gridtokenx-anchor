#!/bin/bash
# GridTokenX Deployment Script
# This script deploys all programs to specified environment

set -e  # Exit on any error

# Default to development environment
ENVIRONMENT=${1:-development}
echo "🚀 Deploying GridTokenX to $ENVIRONMENT..."

# Validate environment
if [[ "$ENVIRONMENT" != "development" && "$ENVIRONMENT" != "testnet" && "$ENVIRONMENT" != "mainnet" ]]; then
    echo "❌ Invalid environment. Use: development, testnet, or mainnet"
    exit 1
fi

# Load configuration
CONFIG_FILE="configs/build/${ENVIRONMENT}.json"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Configuration file not found: $CONFIG_FILE"
    exit 1
fi

echo "📋 Loading configuration from: $CONFIG_FILE"

# Extract configuration values
CLUSTER=$(jq -r '.cluster' "$CONFIG_FILE")
LOG_LEVEL=$(jq -r '.log_level' "$CONFIG_FILE")
SKIP_LINT=$(jq -r '.skip_lint' "$CONFIG_FILE")

echo "🌐 Deploying to cluster: $CLUSTER"
echo "📝 Log level: $LOG_LEVEL"
echo "⏭ Skip lint: $SKIP_LINT"

# Check if build is up-to-date
if [ ! -f "target/deploy-manifest.json" ]; then
    echo "❌ Build manifest not found. Run ./scripts/build.sh first."
    exit 1
fi

# Verify all programs are built
echo "🔍 Verifying programs are built..."
./scripts/02-verify-build.sh

# Check if local validator needs to be running
if [ "$CLUSTER" = "localnet" ] || [ "$CLUSTER" = "http://127.0.0.1:8899" ]; then
    if ! pgrep -f "solana-test-validator" > /dev/null; then
        echo "🔄 Starting local validator..."
        solana-test-validator --reset --quiet &
        # Wait for validator to start
        sleep 5
        if ! pgrep -f "solana-test-validator" > /dev/null; then
            echo "❌ Failed to start local validator"
            exit 1
        fi
        echo "✅ Local validator started"
    else
        echo "✅ Local validator is already running"
    fi
fi

# Set Solana configuration
echo "⚙️  Setting Solana configuration..."
solana config set --url "$CLUSTER"
solana config set --keypair "$(jq -r '.wallets.default' "$CONFIG_FILE")"

# Check wallet balance
WALLET_ADDRESS=$(solana address)
WALLET_BALANCE=$(solana balance "$WALLET_ADDRESS" | awk '{print $1}')
echo "💰 Wallet: $WALLET_ADDRESS"
echo "💰 Balance: $WALLET_BALANCE SOL"

# Check if sufficient balance for deployment
MIN_BALANCE=5  # Minimum SOL required for deployment
# Extract just the number part for comparison (remove decimal part)
BALANCE_INT=$(echo "$WALLET_BALANCE" | awk '{print int($1)}')
if [ "$BALANCE_INT" -lt "$MIN_BALANCE" ]; then
    echo "❌ Insufficient balance for deployment. Need at least $MIN_BALANCE SOL."
    if [ "$CLUSTER" = "localnet" ] || [ "$CLUSTER" = "http://127.0.0.1:8899" ]; then
        echo "💸 Requesting airdrop..."
        solana airdrop 10 "$WALLET_ADDRESS" --url "$CLUSTER"
        echo "✅ Airdrop completed"
    else
        exit 1
    fi
fi

# Record deployment start time
DEPLOY_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TIMESTAMP=$(date +%Y%m%d%H%M%S)
echo "⏰ Deployment started at: $DEPLOY_START"

# Get program deployment order
PROGRAMS=$(jq -r '.programs | sort_by(.deploy_priority) | .[].name' "$CONFIG_FILE")

# Create deployment log
mkdir -p target/logs
DEPLOY_LOG="target/logs/deployment-${ENVIRONMENT}-$(date +%Y%m%d%H%M%S).log"
echo "📋 Deployment log: $DEPLOY_LOG"
echo "GridTokenX Deployment to $ENVIRONMENT" > "$DEPLOY_LOG"
echo "Started: $DEPLOY_START" >> "$DEPLOY_LOG"
echo "" >> "$DEPLOY_LOG"

# Deploy programs in dependency order
echo ""
echo "🚀 Deploying programs in dependency order..."
echo "" >> "$DEPLOY_LOG"
echo "Deploying programs:" >> "$DEPLOY_LOG"

DEPLOYED_PROGRAMS=()
FAILED_PROGRAMS=()

for program in $PROGRAMS; do
    echo "📦 Deploying $program..."
    echo "Deploying $program..." >> "$DEPLOY_LOG"

    # Get program path and ID
    PROGRAM_PATH=$(jq -r ".programs[] | select(.name==\"$program\") | .path" "$CONFIG_FILE")
    PROGRAM_ID=$(jq -r ".programs[] | select(.name==\"$program\") | .program_id" "$CONFIG_FILE")

    # Deploy the program
    PROGRAM_DEPLOY_START=$(date +%s)

    if anchor deploy --program-name "$program"; then
        PROGRAM_DEPLOY_END=$(date +%s)
        DEPLOY_TIME=$((PROGRAM_DEPLOY_END - PROGRAM_DEPLOY_START))

        echo "✅ $program deployed successfully in ${DEPLOY_TIME}s"
        echo "  Program ID: $PROGRAM_ID" >> "$DEPLOY_LOG"
        echo "  Deployment time: ${DEPLOY_TIME}s" >> "$DEPLOY_LOG"
        echo "  Status: Success" >> "$DEPLOY_LOG"
        echo "" >> "$DEPLOY_LOG"

        DEPLOYED_PROGRAMS+=("$program")
    else
        echo "❌ Failed to deploy $program"
        echo "  Program ID: $PROGRAM_ID" >> "$DEPLOY_LOG"
        echo "  Status: Failed" >> "$DEPLOY_LOG"
        echo "" >> "$DEPLOY_LOG"

        FAILED_PROGRAMS+=("$program")
    fi
done

# Record deployment completion
DEPLOY_END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "⏰ Deployment completed at: $DEPLOY_END"
echo "Deployment completed: $DEPLOY_END" >> "$DEPLOY_LOG"

# Generate deployment report
TOTAL_PROGRAMS=${#PROGRAMS[@]}
SUCCESS_COUNT=${#DEPLOYED_PROGRAMS[@]}
FAILED_COUNT=${#FAILED_PROGRAMS[@]}

# Create reports directory if it doesn't exist
mkdir -p target/reports

cat > "target/reports/deployment-${ENVIRONMENT}-${TIMESTAMP}.json" << EOF
{
  "environment": "$ENVIRONMENT",
  "cluster": "$CLUSTER",
  "started": "$DEPLOY_START",
  "completed": "$DEPLOY_END",
  "totalPrograms": $TOTAL_PROGRAMS,
  "successfulDeployments": $SUCCESS_COUNT,
  "failedDeployments": $FAILED_COUNT,
  "deployedPrograms": [
EOF

# Add deployed programs to report
comma=""
for program in "${DEPLOYED_PROGRAMS[@]}"; do
    PROGRAM_ID=$(jq -r ".programs[] | select(.name==\"$program\") | .program_id" "$CONFIG_FILE")
    echo "$comma    {\"name\": \"$program\", \"programId\": \"$PROGRAM_ID\"}" >> "target/reports/deployment-${ENVIRONMENT}-${TIMESTAMP}.json"
    comma=","
done

# Add failed programs to report
if [ $FAILED_COUNT -gt 0 ]; then
    echo "," >> "target/reports/deployment-${ENVIRONMENT}-${TIMESTAMP}.json"
    comma=""
    for program in "${FAILED_PROGRAMS[@]}"; do
        echo "$comma    {\"name\": \"$program\", \"status\": \"failed\"}" >> "target/reports/deployment-${ENVIRONMENT}-${TIMESTAMP}.json"
        comma=","
    done
fi

cat >> "target/reports/deployment-${ENVIRONMENT}-${TIMESTAMP}.json" << EOF
  ],
  "walletAddress": "$WALLET_ADDRESS",
  "finalBalance": "$(solana balance "$WALLET_ADDRESS" | awk '{print $1}') SOL"
}
EOF

# Deployment summary
echo ""
echo "📊 Deployment Summary:"
echo "=================="
echo "Environment: $ENVIRONMENT"
echo "Cluster: $CLUSTER"
echo "Total Programs: 5"
echo "Successful: $SUCCESS_COUNT"
echo "Failed: $FAILED_COUNT"
echo "Success Rate: $(( SUCCESS_COUNT * 100 / 5 ))%"
echo ""

if [ $FAILED_COUNT -eq 0 ]; then
    echo "🎉 All programs deployed successfully!"
    echo ""
    echo "Next steps:"
    echo "  1. Run ./scripts/verify-deployment.sh localnet to verify deployment"
    echo "  2. Run anchor test to test deployed programs"
    echo "  3. Update client configuration if needed"
    exit 0
else
    echo "❌ Some programs failed to deploy. Check the deployment log:"
    echo "  $DEPLOY_LOG"
    echo ""
    echo "Failed programs:"
    for program in "${FAILED_PROGRAMS[@]}"; do
        echo "  - $program"
    done
    exit 1
fi
