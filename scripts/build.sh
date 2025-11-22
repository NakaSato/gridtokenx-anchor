#!/bin/bash

# GridTokenX Automated Build Script
# This script builds all programs and generates deployment manifest

set -e  # Exit on any error

echo "🚀 Building GridTokenX programs..."

# Create output directories
mkdir -p target/deploy
mkdir -p target/reports

# Record build start time
BUILD_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "Build started at: $BUILD_START"

# Check if Anchor is available
if ! command -v anchor &> /dev/null; then
    echo "❌ Anchor CLI not found. Please install Anchor."
    exit 1
fi

# Check if programs directory exists
if [ ! -d "programs" ]; then
    echo "❌ Programs directory not found."
    exit 1
fi

# Build all programs
echo "Building programs with Anchor..."
anchor build --skip-lint

# Check if build was successful
if [ $? -ne 0 ]; then
    echo "❌ Build failed."
    exit 1
fi

echo "✅ All programs compiled successfully"

# List compiled programs
echo ""
echo "Compiled programs:"
ls -la target/deploy/

# Get program sizes
echo ""
echo "Program sizes:"
for program in energy_token governance oracle registry trading; do
    if [ -f "target/deploy/${program}.so" ]; then
        size=$(stat -f%z "target/deploy/${program}.so" 2>/dev/null || stat -c%s "target/deploy/${program}.so" 2>/dev/null)
        echo "  ${program}: ${size} bytes"
    else
        echo "  ${program}: ❌ Not found"
    fi
done

# Get program IDs from Anchor.toml
echo ""
echo "Program IDs:"
awk '/programs.localnet/ {print $1, $3}' Anchor.toml | sed 's/=/: /'

# Verify all required programs exist
programs=("energy_token" "governance" "oracle" "registry" "trading")
missing_programs=()

for program in "${programs[@]}"; do
    if [ ! -f "target/deploy/${program}.so" ]; then
        missing_programs+=("$program")
    fi
done

if [ ${#missing_programs[@]} -ne 0 ]; then
    echo ""
    echo "❌ Missing programs: ${missing_programs[*]}"
    exit 1
fi

# Create deployment manifest
echo ""
echo "Creating deployment manifest..."
cat > target/deploy-manifest.json << EOF
{
  "timestamp": "$BUILD_START",
  "environment": "$(node -p "process.env.ANCHOR_PROVIDER_URL?.includes('devnet') ? 'devnet' : (process.env.ANCHOR_PROVIDER_URL?.includes('mainnet') ? 'mainnet' : 'localnet')")",
  "programs": [
    {"name": "energy_token", "path": "target/deploy/energy_token.so"},
    {"name": "governance", "path": "target/deploy/governance.so"},
    {"name": "oracle", "path": "target/deploy/oracle.so"},
    {"name": "registry", "path": "target/deploy/registry.so"},
    {"name": "trading", "path": "target/deploy/trading.so"}
  ]
}
EOF

echo "✅ Deployment manifest created: target/deploy-manifest.json"

# Create build report
cat > target/reports/build-report.json << EOF
{
  "buildStart": "$BUILD_START",
  "buildEnd": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "success",
  "programs": [
EOF

# Add program details to report
comma=""
for program in "${programs[@]}"; do
    if [ -f "target/deploy/${program}.so" ]; then
        size=$(stat -f%z "target/deploy/${program}.so" 2>/dev/null || stat -c%s "target/deploy/${program}.so" 2>/dev/null)
        echo "${comma}    {\"name\": \"${program}\", \"size\": ${size}}" >> target/reports/build-report.json
        comma=","
    fi
done

echo "" >> target/reports/build-report.json
cat >> target/reports/build-report.json << EOF
  ],
  "manifestPath": "target/deploy-manifest.json"
}
EOF

echo "✅ Build report created: target/reports/build-report.json"

# Verify program IDs match Anchor.toml
echo ""
echo "Verifying program IDs..."
anchor keys list

# Record build completion
BUILD_END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo ""
echo "✅ Build completed successfully at: $BUILD_END"
echo "📊 Total build time: $(node -e "console.log(((new Date('$BUILD_END') - new Date('$BUILD_START')) / 1000).toFixed(2) + ' seconds')")"

echo ""
echo "Next steps:"
echo "  1. Run ./scripts/verify-build.sh to verify build"
echo "  2. Run ./scripts/deploy.sh <environment> to deploy to target environment"
echo "  3. Run ./scripts/test-deployment.sh <environment> to test deployment"
