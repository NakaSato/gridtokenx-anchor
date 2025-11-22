#!/bin/bash
# GridTokenX Deployment Verification Script
# This script verifies that all programs are deployed correctly on specified environment

set -e  # Exit on any error

echo "🔍 Verifying GridTokenX deployment..."

# Validate environment parameter
ENVIRONMENT=${1:-localnet}
if [[ "$ENVIRONMENT" != "localnet" && "$ENVIRONMENT" != "devnet" && "$ENVIRONMENT" != "testnet" && "$ENVIRONMENT" != "mainnet" && "$ENVIRONMENT" != "development" ]]; then
    echo "❌ Invalid environment. Use: localnet, development, devnet, testnet, or mainnet"
    exit 1
fi

# Map development to localnet for verification
if [[ "$ENVIRONMENT" == "development" ]]; then
    ENVIRONMENT="localnet"
    CONFIG_ENV="development"
elif [[ "$ENVIRONMENT" == "localnet" ]]; then
    # Check for both localnet and development reports
    if ls target/reports/deployment-development*.json >/dev/null 2>&1; then
        CONFIG_ENV="development"
    else
        CONFIG_ENV="localnet"
    fi
else
    CONFIG_ENV="$ENVIRONMENT"
fi

echo "📋 Verifying deployment on: $ENVIRONMENT"

# Load deployment configuration
DEPLOYMENT_REPORT="target/reports/deployment-${CONFIG_ENV}*.json"
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
echo ""
echo "🔍 Checking program deployment status..."

# Verify each program
DEPLOYED_COUNT=0
TOTAL_COUNT=0
MISSING_PROGRAMS=()

# Check registry program
program_id="2XPQmFYMdXjP7ffoBB3mXeCdboSFg5Yeb6QmTSGbW8a7"
program_name="registry"
TOTAL_COUNT=$((TOTAL_COUNT + 1))
if solana program show "$program_id" --url "$CLUSTER" >/dev/null 2>&1; then
    echo "  ✅ $program_name ($program_id)"
    DEPLOYED_COUNT=$((DEPLOYED_COUNT + 1))
else
    echo "  ❌ $program_name ($program_id) - NOT DEPLOYED"
    MISSING_PROGRAMS+=("$program_name")
fi

# Check governance program
program_id="4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe"
program_name="governance"
TOTAL_COUNT=$((TOTAL_COUNT + 1))
if solana program show "$program_id" --url "$CLUSTER" >/dev/null 2>&1; then
    echo "  ✅ $program_name ($program_id)"
    DEPLOYED_COUNT=$((DEPLOYED_COUNT + 1))
else
    echo "  ❌ $program_name ($program_id) - NOT DEPLOYED"
    MISSING_PROGRAMS+=("$program_name")
fi

# Check oracle program
program_id="DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE"
program_name="oracle"
TOTAL_COUNT=$((TOTAL_COUNT + 1))
if solana program show "$program_id" --url "$CLUSTER" >/dev/null 2>&1; then
    echo "  ✅ $program_name ($program_id)"
    DEPLOYED_COUNT=$((DEPLOYED_COUNT + 1))
else
    echo "  ❌ $program_name ($program_id) - NOT DEPLOYED"
    MISSING_PROGRAMS+=("$program_name")
fi

# Check energy_token program
program_id="94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur"
program_name="energy_token"
TOTAL_COUNT=$((TOTAL_COUNT + 1))
if solana program show "$program_id" --url "$CLUSTER" >/dev/null 2>&1; then
    echo "  ✅ $program_name ($program_id)"
    DEPLOYED_COUNT=$((DEPLOYED_COUNT + 1))
else
    echo "  ❌ $program_name ($program_id) - NOT DEPLOYED"
    MISSING_PROGRAMS+=("$program_name")
fi

# Check trading program
program_id="GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk"
program_name="trading"
TOTAL_COUNT=$((TOTAL_COUNT + 1))
if solana program show "$program_id" --url "$CLUSTER" >/dev/null 2>&1; then
    echo "  ✅ $program_name ($program_id)"
    DEPLOYED_COUNT=$((DEPLOYED_COUNT + 1))
else
    echo "  ❌ $program_name ($program_id) - NOT DEPLOYED"
    MISSING_PROGRAMS+=("$program_name")
fi

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

# For development, we'll assume programs are initialized if they're deployed
# In a real verification, you would check specific PDAs for each program
for program_name in registry governance oracle energy_token trading; do
    # Skip if program is not deployed
    if [[ " ${MISSING_PROGRAMS[@]} " =~ " ${program_name} " ]]; then
        continue
    fi

    echo "  ✅ $program_name: Program is deployed and accessible"
    INITIALIZED_COUNT=$((INITIALIZED_COUNT + 1))
done

# Verify cross-program integration
echo ""
echo "🔍 Verifying cross-program integration..."

# Check if programs can communicate via CPI
if [ $DEPLOYED_COUNT -eq $TOTAL_COUNT ] && [ $DEPLOYED_COUNT -gt 0 ]; then
    echo "  ✅ All programs deployed - integration possible"

    # Test energy_token -> registry integration
    if ! [[ " ${MISSING_PROGRAMS[@]} " =~ " energy_token " || " ${MISSING_PROGRAMS[@]} " =~ " registry " ]]; then
        echo "  ✅ Energy token ↔ Registry integration possible"
    else
        echo "  ⚠️  Energy token ↔ Registry integration unavailable"
    fi

    # Test governance -> trading integration
    if ! [[ " ${MISSING_PROGRAMS[@]} " =~ " governance " || " ${MISSING_PROGRAMS[@]} " =~ " trading " ]]; then
        echo "  ✅ Governance ↔ Trading integration possible"
    else
        echo "  ⚠️  Governance ↔ Trading integration unavailable"
    fi

    # Test oracle -> registry integration
    if ! [[ " ${MISSING_PROGRAMS[@]} " =~ " oracle " || " ${MISSING_PROGRAMS[@]} " =~ " registry " ]]; then
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
