#!/usr/bin/env bash

echo "GridTokenX Project Clean-up Script"
echo "===================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠️${NC} $1"
}

print_error() {
    echo -e "${RED}❌${NC} $1"
}

# Check if running in a git repository
if [ ! -d ".git" ]; then
    print_warning "Not in a git repository"
    echo "Initialize with: git init"
fi

# Clean build artifacts
echo ""
echo "Cleaning build artifacts..."
if [ -d "target" ]; then
    rm -rf target/deploy
    rm -rf target/release
    rm -rf target/debug
    print_status "Removed build artifacts"
else
    echo "No build artifacts to clean"
fi

# Clean node modules
echo ""
echo "Cleaning dependencies..."
if [ -d "node_modules" ]; then
    rm -rf node_modules
    print_status "Removed node_modules"
else
    echo "No node_modules to clean"
fi

# Clean cache directories
echo ""
echo "Cleaning caches..."
if [ -d "node_modules/.cache" ]; then
    rm -rf node_modules/.cache
    print_status "Removed npm cache"
else
    echo "No npm cache to clean"
fi

if [ -d ".anchor" ]; then
    rm -rf .anchor
    print_status "Removed Anchor cache"
else
    echo "No Anchor cache to clean"
fi

# Clean test ledger
echo ""
echo "Cleaning test ledgers..."
if [ -d "test-ledger" ]; then
    rm -rf test-ledger
    print_status "Removed test ledger"
else
    echo "No test ledger to clean"
fi

# Clean logs
echo ""
echo "Cleaning log files..."
find . -name "*.log" -type f -delete
print_status "Removed log files"

# Clean temporary files
echo ""
echo "Cleaning temporary files..."
find . -name "*.tmp" -type f -delete
find . -name ".DS_Store" -type f -delete
print_status "Removed temporary files"

# Clean test artifacts (except comprehensive)
echo ""
echo "Cleaning test artifacts..."
if [ -d "test-transactions" ]; then
    # Backup comprehensive test
    if [ -d "test-transactions/comprehensive" ]; then
        cp -r test-transactions/comprehensive test-transactions-backup/
        print_status "Backed up comprehensive test suite"
    fi

    # Remove other test directories
    rm -rf test-transactions/basic
    rm -rf test-transactions/minimal
    rm -rf test-transactions/simple
    rm -rf test-transactions/solana-only
    rm -rf test-transactions/working
    rm -f test-transactions/run-test.ts
    rm -f test-transactions/test-transaction.ts
    print_status "Cleaned test artifacts"
else
    echo "No test artifacts to clean"
fi

# Reset package-lock files
echo ""
echo "Resetting package managers..."
if [ -f "package-lock.json" ]; then
    rm package-lock.json
    print_status "Removed package-lock.json"
fi

if [ -f "pnpm-lock.yaml" ]; then
    rm pnpm-lock.yaml
    print_status "Removed pnpm-lock.yaml"
fi

# Clean Docker artifacts
echo ""
echo "Cleaning Docker artifacts..."
if [ -d "target/docker" ]; then
    rm -rf target/docker
    print_status "Removed Docker artifacts"
fi

# Search for and clean any Solana program artifacts
echo ""
echo "Cleaning Solana program artifacts..."
find . -name "*.so" -not -path "./node_modules/*" -delete
print_status "Removed compiled program files"

# Clean program targets in each program directory
echo ""
echo "Cleaning Anchor program files..."
for program_dir in programs/*/; do
    if [ -d "$program_dir/target" ]; then
        rm -rf "$program_dir/target"
        print_status "Cleaned program target directory: $program_dir"
    fi
done

# Summary
echo ""
echo -e "${GREEN}🎉 Project cleanup completed!${NC}"
echo ""
echo "Next steps:"
echo "1. Run 'pnpm install' to reinstall dependencies"
echo "2. Run 'anchor build' to rebuild programs"
echo "3. Run 'anchor test' to run tests"
echo "4. Run 'solana-test-validator' to start local validator"
echo "5. Run './test-transactions/comprehensive/run-comprehensive-test.sh' to test transactions"
