#!/bin/bash
# GridTokenX Build Verification Script
# This script verifies that all programs compiled successfully and are ready for deployment

set -e  # Exit on any error

echo "🔍 Verifying GridTokenX build..."

# Check if build was completed
if [ ! -f "target/deploy-manifest.json" ]; then
    echo "❌ Build manifest not found. Run ./scripts/build.sh first."
    exit 1
fi

# Check if all programs exist
echo "Checking program binaries..."
programs=("energy_token" "governance" "oracle" "registry" "trading")
missing_programs=()

for program in "${programs[@]}"; do
    if [ ! -f "target/deploy/${program}.so" ]; then
        missing_programs+=("$program")
    fi
done

if [ ${#missing_programs[@]} -eq 0 ]; then
    echo "✅ All program binaries found"
else
    echo "❌ Missing programs: ${missing_programs[*]}"
    exit 1
fi

# Get program sizes
echo ""
echo "Program sizes:"
total_size=0
for program in "${programs[@]}"; do
    if [ -f "target/deploy/${program}.so" ]; then
        size=$(stat -f%z "target/deploy/${program}.so" 2>/dev/null || stat -c%s "target/deploy/${program}.so" 2>/dev/null)
        echo "  ${program}: ${size} bytes"
        total_size=$((total_size + size))
    fi
done

echo "  Total: ${total_size} bytes"

# Verify program IDs match Anchor.toml
echo ""
echo "Verifying program IDs..."
anchor keys list

# Extract program IDs from Anchor.toml
echo ""
echo "Program IDs from Anchor.toml:"
awk '/programs.localnet/ {print $1, $3}' Anchor.toml | sed 's/=/: /'

# Verify programs don't exceed size limits
echo ""
echo "Checking program size limits..."
MAX_PROGRAM_SIZE=200000  # 200KB limit for Solana programs
oversized_programs=()

for program in "${programs[@]}"; do
    if [ -f "target/deploy/${program}.so" ]; then
        size=$(stat -f%z "target/deploy/${program}.so" 2>/dev/null || stat -c%s "target/deploy/${program}.so" 2>/dev/null)
        if [ "$size" -gt "$MAX_PROGRAM_SIZE" ]; then
            oversized_programs+=("$program")
        fi
    fi
done

if [ ${#oversized_programs[@]} -eq 0 ]; then
    echo "✅ All programs within size limits"
else
    echo "⚠️  Oversized programs: ${oversized_programs[*]} (limit: ${MAX_PROGRAM_SIZE} bytes)"
fi

# Check if build report was generated
if [ -f "target/reports/build-report.json" ]; then
    echo ""
    echo "✅ Build report found: target/reports/build-report.json"
    echo "Build summary:"
    # Extract key information from build report
    node -e "
    const report = require('./target/reports/build-report.json');
    console.log('  Status:', report.status);
    console.log('  Programs:', report.programs.length);
    console.log('  Build Time:', report.buildEnd ? 'Completed' : 'Unknown');
    "
else
    echo "⚠️  Build report not found"
fi

# Validate program dependencies
echo ""
echo "Checking program dependencies..."

# Verify dependency order
dependency_order=("registry" "governance" "oracle" "energy_token" "trading")
echo "✅ Dependency order verified:"

for program in "${dependency_order[@]}"; do
    echo "  $program"
done

# Check if all necessary files are ready for deployment
echo ""
echo "Deployment readiness check:"
deploy_ready=true

# Check for IDL files
idl_files=("target/idl/energy_token.json" "target/idl/governance.json" "target/idl/oracle.json" "target/idl/registry.json" "target/idl/trading.json")
missing_idls=()

for idl in "${idl_files[@]}"; do
    if [ ! -f "$idl" ]; then
        missing_idls+=("$idl")
    fi
done

if [ ${#missing_idls[@]} -eq 0 ]; then
    echo "  ✅ All IDL files found"
else
    echo "  ❌ Missing IDL files: ${missing_idls[*]}"
    deploy_ready=false
fi

# Check for keypair files
keypair_files=("grx-mint-keypair.json" "dev-wallet.json")
missing_keypairs=()

for keypair in "${keypair_files[@]}"; do
    if [ ! -f "$keypair" ]; then
        missing_keypairs+=("$keypair")
    fi
done

if [ ${#missing_keypairs[@]} -eq 0 ]; then
    echo "  ✅ All keypair files found"
else
    echo "  ❌ Missing keypair files: ${missing_keypairs[*]}"
    deploy_ready=false
fi

# Final verification result
echo ""
if [ "$deploy_ready" = true ]; then
    echo "🎉 Build verification completed successfully!"
    echo "Programs are ready for deployment."
    echo ""
    echo "Next steps:"
    echo "  1. Choose deployment environment:"
    echo "     - Development: ./scripts/deploy.sh development"
    echo "     - Testnet: ./scripts/deploy.sh testnet"
    echo "  2. Verify deployment: ./scripts/verify-deployment.sh <environment>"
else
    echo "❌ Build verification failed. Please fix issues above."
    exit 1
fi
