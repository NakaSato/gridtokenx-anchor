#!/bin/bash
# GridTokenX Deployment Verification Script
# This script verifies that all programs are deployed correctly on specified environment

set -e  # Exit on any error

echo "🔍 Verifying GridTokenX deployment..."

# Validate environment parameter
ENVIRONMENT=${1:-localnet}
if [[ "$ENVIRONMENT" != "localnet" && "$ENVIRONMENT" != "devnet" && "$ENVIRONMENT" != "testnet" && "$ENVIRONMENT" != "mainnet" ]]; then
    echo "❌ Invalid environment. Use: localnet, devnet, testnet, or mainnet"
    exit 1
fi

echo "📋 Verifying deployment on: $ENVIRONMENT"

# Load deployment configuration
DEPLOYMENT_REPORT="target/reports/deployment-${ENVIRONMENT}-$(date +%Y%m%d --date='-1 day' | head -1)*.json"
if [ -z "$(ls $DEPLOYMENT_REPORT 2>/dev/null)" ]; then
    echo "❌ No deployment report found for $ENVIRONMENT"
    echo "   Run ./scripts/deploy.sh $ENVIRONMENT first"
    exit 1
fi

# Get the latest deployment report
LATEST_REPORT=$(ls -t $DEPLOYMENT_REPORT | head -1)
echo "📋 Using deployment report: $LATEST_REPORT"

# Set Solana configuration
CLUSTER=$(jq -r '.cluster' "$LATEST_REPORT")
solana config set --url "$CLUSTER"

# Program IDs and names
declare -A PROGRAMS=(
    ["94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur"]="energy_token"
    ["4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe"]="governance"
    ["DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE"]="oracle"
    ["2XPQmFYMdXjP7ffoBB3mXeCdboSFg5Yeb6QmTSGbW8a7"]="registry"
    ["GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk"]="trading"
)

echo ""
echo "🔍 Checking program deployment status..."

# Verify each program
DEPLOYED_COUNT=0
TOTAL_COUNT=0
MISSING_PROGRAMS=()

for program_id in "${!PROGRAMS[@]}"; do
    program_name="${PROGRAMS[$program_id]}"
    TOTAL_COUNT=$((TOTAL_COUNT + 1))

    if solana program show "$program_id" --url "$CLUSTER" >/dev/null 2>&1; then
        echo "  ✅ $program_name ($program_id)"
        DEPLOYED_COUNT=$((DEPLOYED_COUNT + 1))

        # Get additional program details
        PROGRAM_DATA=$(solana program show "$program_id" --url "$CLUSTER" --output json 2>/dev/null)

        # Extract and display program size if available
        if [ -n "$PROGRAM_DATA" ]; then
            PROGRAM_SIZE=$(echo "$PROGRAM_DATA" | jq -r '.programdata | length // "unknown"')
            echo "    Size: $PROGRAM_SIZE bytes"
        fi
    else
        echo "  ❌ $program_name ($program_id) - NOT DEPLOYED"
        MISSING_PROGRAMS+=("$program_name")
    fi
done

echo ""
echo "📊 Deployment Summary:"
echo "  Total Programs: $TOTAL_COUNT"
echo "  Deployed Programs: $DEPLOYED_COUNT"
echo "  Missing Programs: ${#MISSING_PROGRAMS[@]}"

# Calculate success rate
if [ $TOTAL_COUNT -gt 0 ]; then
    SUCCESS_RATE=$((DEPLOYED_COUNT * 100 / TOTAL_COUNT))
    echo "  Success Rate: ${SUCCESS_RATE}%"
else
    echo "  Success Rate: 0%"
fi

# Verify program initialization
echo ""
echo "🔍 Verifying program initialization..."

# Check if we can query program accounts
INITIALIZED_COUNT=0
NOT_INITIALIZED=()

for program_id in "${!PROGRAMS[@]}"; do
    program_name="${PROGRAMS[$program_id]}"

    # Skip if program is not deployed
    if [[ " ${MISSING_PROGRAMS[@]} " =~ " ${program_name} " ]]; then
        continue
    fi

    # Try to get program state (this varies by program)
    case "$program_name" in
        "energy_token")
            # Check if token info PDA exists
            if solana account --url "$CLUSTER" --output json 2>/dev/null | jq -e '.account' | grep -q "token_info"; then
                echo "  ✅ $program_name: Token info initialized"
                INITIALIZED_COUNT=$((INITIALIZED_COUNT + 1))
            else
                echo "  ⚠️  $program_name: Token info not found"
                NOT_INITIALIZED+=("$program_name")
            fi
            ;;
        "governance")
            # Check if PoA config exists
            if solana account --url "$CLUSTER" --output json 2>/dev/null | jq -e '.account' | grep -q "poa_config"; then
                echo "  ✅ $program_name: PoA initialized"
                INITIALIZED_COUNT=$((INITIALIZED_COUNT + 1))
            else
                echo "  ⚠️  $program_name: PoA config not found"
                NOT_INITIALIZED+=("$program_name")
            fi
            ;;
        "oracle")
            # Check if oracle data exists
            if solana account --url "$CLUSTER" --output json 2>/dev/null | jq -e '.account' | grep -q "oracle_data"; then
                echo "  ✅ $program_name: Oracle initialized"
                INITIALIZED_COUNT=$((INITIALIZED_COUNT + 1))
            else
                echo "  ⚠️  $program_name: Oracle data not found"
                NOT_INITIALIZED+=("$program_name")
            fi
            ;;
        "registry")
            # Check if registry account exists
            if solana account --url "$CLUSTER" --output json 2>/dev/null | jq -e '.account' | grep -q "registry"; then
                echo "  ✅ $program_name: Registry initialized"
                INITIALIZED_COUNT=$((INITIALIZED_COUNT + 1))
            else
                echo "  ⚠️  $program_name: Registry not found"
                NOT_INITIALIZED+=("$program_name")
            fi
            ;;
        "trading")
            # Check if market account exists
            if solana account --url "$CLUSTER" --output json 2>/dev/null | jq -e '.account' | grep -q "market"; then
                echo "  ✅ $program_name: Market initialized"
                INITIALIZED_COUNT=$((INITIALIZED_COUNT + 1))
            else
                echo "  ⚠️  $program_name: Market not found"
                NOT_INITIALIZED+=("$program_name")
            fi
            ;;
    esac
done

# Verify cross-program integration
echo ""
echo "🔍 Verifying cross-program integration..."

# Check if programs can communicate via CPI
if [ $DEPLOYED_COUNT -eq $TOTAL_COUNT ] && [ $DEPLOYED_COUNT -gt 0 ]; then
    echo "  ✅ All programs deployed - integration possible"

    # Test energy_token -> registry integration
    if [[ " ${MISSING_PROGRAMS[@]} " =~ " energy_token " && " ${MISSING_PROGRAMS[@]} " =~ " registry " ]]; then
        echo "  ✅ Energy token ↔ Registry integration possible"
    else
        echo "  ⚠️  Energy token ↔ Registry integration unavailable"
    fi

    # Test governance -> trading integration
    if [[ " ${MISSING_PROGRAMS[@]} " =~ " governance " && " ${MISSING_PROGRAMS[@]} " =~ " trading " ]]; then
        echo "  ✅ Governance ↔ Trading integration possible"
    else
        echo "  ⚠️  Governance ↔ Trading integration unavailable"
    fi

    # Test oracle -> registry integration
    if [[ " ${MISSING_PROGRAMS[@]} " =~ " oracle " && " ${MISSING_PROGRAMS[@]} " =~ " registry " ]]; then
        echo "  ✅ Oracle ↔ Registry integration possible"
    else
        echo "  ⚠️  Oracle ↔ Registry integration unavailable"
    fi
else
    echo "  ❌ Insufficient programs deployed for integration testing"
fi

# Generate verification report
VERIFICATION_REPORT="target/reports/verification-${ENVIRONMENT}-$(date +%Y%m%d%H%M%S).json"

cat > "$VERIFICATION_REPORT" << EOF
{
  "environment": "$ENVIRONMENT",
  "cluster": "$CLUSTER",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployment": {
    "totalPrograms": $TOTAL_COUNT,
    "deployedPrograms": $DEPLOYED_COUNT,
    "successRate": $([ $TOTAL_COUNT -gt 0 ] && echo "$((DEPLOYED_COUNT * 100 / TOTAL_COUNT))" || echo 0),
    "missingPrograms": [$(printf '"%s",' "${MISSING_PROGRAMS[@]}" | sed 's/,$//')]
  },
  "initialization": {
    "totalPrograms": $TOTAL_COUNT,
    "initializedPrograms": $INITIALIZED_COUNT,
    "successRate": $([ $TOTAL_COUNT -gt 0 ] && echo "$((INITIALIZED_COUNT * 100 / TOTAL_COUNT))" || echo 0),
    "notInitializedPrograms": [$(printf '"%s",' "${NOT_INITIALIZED[@]}" | sed 's/,$//')]
  },
  "integration": {
    "available": $([ $DEPLOYED_COUNT -eq $TOTAL_COUNT ] && [ $DEPLOYED_COUNT -gt 0 ] && echo "true" || echo "false"),
    "energyTokenRegistry": $([[ " ${MISSING_PROGRAMS[@]} " =~ " energy_token " && " ${MISSING_PROGRAMS[@]} " =~ " registry " ]] && echo "true" || echo "false"),
    "governanceTrading": $([[ " ${MISSING_PROGRAMS[@]} " =~ " governance " && " ${MISSING_PROGRAMS[@]} " =~ " trading " ]] && echo "true" || echo "false"),
    "oracleRegistry": $([[ " ${MISSING_PROGRAMS[@]} " =~ " oracle " && " ${MISSING_PROGRAMS[@]} " =~ " registry " ]] && echo "true" || echo "false")
  }
}
EOF

echo ""
echo "📋 Verification report created: $VERIFICATION_REPORT"

# Final verification result
echo ""
if [ $DEPLOYED_COUNT -eq $TOTAL_COUNT ] && [ ${#NOT_INITIALIZED[@]} -eq 0 ]; then
    echo "🎉 Deployment verification completed successfully!"
    echo ""
    echo "Next steps:"
    echo "  1. Run anchor test to test functionality"
    echo "  2. Run performance tests with scripts/loop-transfer-test.ts"
    echo "  3. Review verification report at $VERIFICATION_REPORT"
    exit 0
else
    echo "❌ Deployment verification failed!"
    echo ""
    if [ ${#MISSING_PROGRAMS[@]} -gt 0 ]; then
        echo "Missing programs:"
        for program in "${MISSING_PROGRAMS[@]}"; do
            echo "  - $program"
        done
        echo ""
        echo "Run: ./scripts/deploy.sh $ENVIRONMENT to deploy missing programs"
    fi

    if [ ${#NOT_INITIALIZED[@]} -gt 0 ]; then
        echo "Not initialized programs:"
        for program in "${NOT_INITIALIZED[@]}"; do
            echo "  - $program"
        done
        echo ""
        echo "Check program initialization scripts or run program-specific setup"
    fi

    exit 1
fi
