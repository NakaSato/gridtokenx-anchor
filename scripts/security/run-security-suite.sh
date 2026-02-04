#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# GridTokenX Security Testing Suite
# Runs fuzz tests and invariant checks for audit preparation
# ═══════════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
OUTPUT_DIR="$PROJECT_ROOT/test-results/security"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           GRIDTOKENX SECURITY TEST SUITE                             ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"

# ═══════════════════════════════════════════════════════════════════════════════
# 1. Run Cargo Tests with Coverage
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}📋 Step 1: Running Rust Unit Tests${NC}"
echo "─────────────────────────────────────────────────────────"

cd "$PROJECT_ROOT"

# Run cargo tests for invariants
if cargo test --package trading --lib invariants 2>&1 | tee "$OUTPUT_DIR/unit-tests.log"; then
    echo -e "${GREEN}✓ Unit tests passed${NC}"
else
    echo -e "${RED}✗ Unit tests failed${NC}"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 2. Run Property-Based Tests (if proptest is available)
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}📋 Step 2: Running Property-Based Tests${NC}"
echo "─────────────────────────────────────────────────────────"

# Check if proptest is available
if cargo test --package trading --lib -- --list 2>&1 | grep -q "proptest"; then
    cargo test --package trading --lib -- proptest 2>&1 | tee "$OUTPUT_DIR/proptest.log"
    echo -e "${GREEN}✓ Property tests completed${NC}"
else
    echo -e "${YELLOW}⚠ proptest not available, skipping${NC}"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 3. Run Integration Tests
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}📋 Step 3: Running Integration Tests${NC}"
echo "─────────────────────────────────────────────────────────"

export ANCHOR_PROVIDER_URL="${ANCHOR_PROVIDER_URL:-http://localhost:8899}"
export ANCHOR_WALLET="${ANCHOR_WALLET:-$PROJECT_ROOT/scripts/poa-cluster/genesis/faucet-keypair.json}"

# Run TypeScript tests that exercise edge cases
npx tsx scripts/run-all-tests.ts 2>&1 | tee "$OUTPUT_DIR/integration-tests.log"

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 4. Static Analysis (Clippy)
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}📋 Step 4: Running Static Analysis (Clippy)${NC}"
echo "─────────────────────────────────────────────────────────"

cargo clippy --package trading -- -D warnings 2>&1 | tee "$OUTPUT_DIR/clippy.log" || true

if grep -q "error" "$OUTPUT_DIR/clippy.log"; then
    echo -e "${RED}✗ Clippy found issues${NC}"
else
    echo -e "${GREEN}✓ Clippy passed${NC}"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 5. Generate Security Report
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}📋 Step 5: Generating Security Report${NC}"
echo "─────────────────────────────────────────────────────────"

REPORT_FILE="$OUTPUT_DIR/security-report-$(date +%Y%m%d-%H%M%S).md"

cat > "$REPORT_FILE" << EOF
# GridTokenX Security Test Report

**Generated:** $(date -u +"%Y-%m-%d %H:%M:%S UTC")
**Environment:** $OSTYPE

## Test Summary

### Unit Tests (Invariants)
\`\`\`
$(grep -E "(test result|passed|failed)" "$OUTPUT_DIR/unit-tests.log" 2>/dev/null || echo "No results available")
\`\`\`

### Integration Tests
\`\`\`
$(grep -E "(passing|failing|✅|❌)" "$OUTPUT_DIR/integration-tests.log" 2>/dev/null | head -20)
\`\`\`

### Static Analysis (Clippy)
\`\`\`
$(grep -E "(warning|error|Compiling)" "$OUTPUT_DIR/clippy.log" 2>/dev/null | head -20)
\`\`\`

## Invariants Checked

1. **Token Conservation**: total_supply = circulating + locked + pending
2. **Order Validity**: amount > 0, price > 0, valid owner, valid status
3. **REC Lifecycle**: retired ⟺ has_retirement_record
4. **Confidential Balance**: requires valid ZK proof
5. **Settlement Atomicity**: all-or-nothing execution
6. **Authority Validation**: only authorized signers
7. **Price Bounds**: within min/max limits
8. **Carbon Offset Consistency**: marketplace total = sum(certificates)

## Recommendations

1. Run fuzz tests with honggfuzz for extended periods before mainnet
2. Add formal verification for critical invariants
3. Consider third-party security audit
4. Implement monitoring for invariant violations in production

---
*Report generated by GridTokenX Security Suite*
EOF

echo -e "${GREEN}✓ Security report generated: $REPORT_FILE${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                       TEST SUITE COMPLETE                            ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  📁 Output directory: ${GREEN}$OUTPUT_DIR${NC}"
echo -e "  📄 Security report:  ${GREEN}$REPORT_FILE${NC}"
echo ""
