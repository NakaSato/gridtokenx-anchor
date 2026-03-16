#!/usr/bin/env bash
# =============================================================================
# run-tests.sh — GridTokenX Anchor test runner
#
# Runs the full optimised test suite against a local Solana validator.
# Can be used standalone (CI) or as part of the anchor test harness.
#
# Usage:
#   ./scripts/run-tests.sh [--skip-build] [--skip-deploy] [--suite <name>]
#
# Suites:
#   all        (default) oracle + registry_sharding + governance
#   oracle     oracle tests only
#   registry   registry sharding tests only
#   governance governance ERC + authority tests
#   tpc-stress TPC-C stress benchmark (requires tpc_benchmark .so)
#
# Environment variables (override defaults):
#   ANCHOR_PROVIDER_URL   RPC endpoint  (default: http://127.0.0.1:8899)
#   ANCHOR_WALLET         Path to signer keypair
#   TEST_TIMEOUT_MS       Per-test timeout in ms  (default: 120000)
#   VALIDATOR_WAIT_SEC    Seconds to wait for validator on startup (default: 15)
# =============================================================================

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Defaults ──────────────────────────────────────────────────────────────────
SKIP_BUILD=false
SKIP_DEPLOY=false
SUITE="all"
ANCHOR_PROVIDER_URL="${ANCHOR_PROVIDER_URL:-http://127.0.0.1:8899}"
ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
TEST_TIMEOUT_MS="${TEST_TIMEOUT_MS:-120000}"
VALIDATOR_WAIT_SEC="${VALIDATOR_WAIT_SEC:-15}"
RESULTS_DIR="test-results"
TIMESTAMP="$(date +%Y%m%dT%H%M%S)"

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)   SKIP_BUILD=true;  shift ;;
    --skip-deploy)  SKIP_DEPLOY=true; shift ;;
    --suite)        SUITE="$2";       shift 2 ;;
    --help|-h)
      sed -n '/^# Usage:/,/^# =/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo -e "${RED}Unknown option: $1${RESET}" >&2; exit 1 ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────
log()     { echo -e "${CYAN}[run-tests]${RESET} $*"; }
success() { echo -e "${GREEN}[run-tests] ✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}[run-tests] ⚠${RESET} $*"; }
error()   { echo -e "${RED}[run-tests] ✗${RESET} $*" >&2; }

die() { error "$*"; exit 1; }

# Check that a command exists
need() { command -v "$1" &>/dev/null || die "Required command not found: $1"; }

# ── Pre-flight checks ─────────────────────────────────────────────────────────
log "Pre-flight checks..."
need anchor
need solana
need node
need npx

[[ -f "$ANCHOR_WALLET" ]] || die "Wallet keypair not found: $ANCHOR_WALLET"
[[ -f "Anchor.toml" ]]    || die "Must be run from the gridtokenx-anchor directory"

# ── Resolve test files per suite ──────────────────────────────────────────────
case "$SUITE" in
  all)
    TEST_FILES=(
      "tests/oracle.ts"
      "tests/registry_sharding.ts"
      "tests/governance.ts"
    )
    ;;
  oracle)
    TEST_FILES=("tests/oracle.ts")
    ;;
  registry)
    TEST_FILES=("tests/registry_sharding.ts")
    ;;
  governance)
    TEST_FILES=("tests/governance.ts")
    ;;
  tpc-stress)
    TEST_FILES=("tests/tpc_stress_test.ts")
    ;;
  blockbench)
    TEST_FILES=("tests/blockbench.ts")
    ;;
  smallbank)
    TEST_FILES=("tests/smallbank.ts")
    ;;
  *)
    die "Unknown suite: $SUITE. Valid suites: all, oracle, registry, governance, tpc-stress, blockbench, smallbank"
    ;;
esac

# Verify test files exist
for f in "${TEST_FILES[@]}"; do
  [[ -f "$f" ]] || die "Test file not found: $f"
done

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║        GridTokenX Anchor Test Suite Runner                  ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""
log "Suite:    ${BOLD}${SUITE}${RESET}"
log "RPC:      $ANCHOR_PROVIDER_URL"
log "Wallet:   $ANCHOR_WALLET"
log "Timeout:  ${TEST_TIMEOUT_MS}ms per test"
log "Files:    ${TEST_FILES[*]}"
echo ""

# ── Step 1: Build ─────────────────────────────────────────────────────────────
if [[ "$SKIP_BUILD" == "false" ]]; then
  log "Building programs..."
  START_BUILD=$SECONDS
  if anchor build 2>&1 | tee /tmp/anchor-build.log | grep -E "^error"; then
    error "Build failed. See /tmp/anchor-build.log for details."
    exit 1
  fi
  # Check the last line for success
  if grep -q "Finished" /tmp/anchor-build.log; then
    ELAPSED=$(( SECONDS - START_BUILD ))
    success "Build completed in ${ELAPSED}s"
  fi
else
  warn "Skipping build (--skip-build)"
fi

# ── Step 2: Validator health-check / wait ─────────────────────────────────────
log "Checking validator at $ANCHOR_PROVIDER_URL..."
VALIDATOR_STARTED=false

if ! solana cluster-version -u "$ANCHOR_PROVIDER_URL" &>/dev/null; then
  warn "Validator not reachable — waiting up to ${VALIDATOR_WAIT_SEC}s..."
  for (( i=0; i<VALIDATOR_WAIT_SEC; i++ )); do
    sleep 1
    if solana cluster-version -u "$ANCHOR_PROVIDER_URL" &>/dev/null; then
      VALIDATOR_STARTED=true
      break
    fi
    echo -n "."
  done
  echo ""
  if [[ "$VALIDATOR_STARTED" == "false" ]]; then
    die "Validator did not become available within ${VALIDATOR_WAIT_SEC}s.
Tip: start the local validator with:
  solana-test-validator --reset &
or use:
  anchor localnet"
  fi
fi

CLUSTER_VERSION=$(solana cluster-version -u "$ANCHOR_PROVIDER_URL" 2>/dev/null || echo "unknown")
success "Validator running — Solana $CLUSTER_VERSION"

# ── Step 3: Wallet balance check ──────────────────────────────────────────────
WALLET_PUBKEY=$(solana-keygen pubkey "$ANCHOR_WALLET" 2>/dev/null)
BALANCE=$(solana balance -u "$ANCHOR_PROVIDER_URL" "$WALLET_PUBKEY" 2>/dev/null | awk '{print $1}' || echo "0")
log "Wallet: $WALLET_PUBKEY (${BALANCE} SOL)"

# Airdrop if balance is low (localnet only)
if (( $(echo "$BALANCE < 5" | bc -l 2>/dev/null || echo 0) )); then
  warn "Balance below 5 SOL — requesting airdrop..."
  solana airdrop 100 "$WALLET_PUBKEY" -u "$ANCHOR_PROVIDER_URL" &>/dev/null || true
fi

# ── Step 4: Deploy (optional) ─────────────────────────────────────────────────
if [[ "$SKIP_DEPLOY" == "false" ]]; then
  log "Deploying programs..."
  PROGRAMS=(trading oracle governance energy_token registry)
  DEPLOY_ERRORS=0

  for prog in "${PROGRAMS[@]}"; do
    SO_FILE="target/deploy/${prog}.so"
    KEYPAIR_FILE="target/deploy/${prog}-keypair.json"

    if [[ ! -f "$SO_FILE" ]]; then
      warn "No .so file for ${prog} — skipping deploy"
      continue
    fi
    if [[ ! -f "$KEYPAIR_FILE" ]]; then
      warn "No keypair for ${prog} — skipping deploy"
      continue
    fi

    PROG_ID=$(solana-keygen pubkey "$KEYPAIR_FILE" 2>/dev/null || echo "unknown")
    echo -n "  Deploying ${prog} (${PROG_ID:0:8}...)... "
    if solana program deploy \
        --program-id "$KEYPAIR_FILE" \
        "$SO_FILE" \
        -u "$ANCHOR_PROVIDER_URL" \
        --keypair "$ANCHOR_WALLET" &>/dev/null; then
      echo -e "${GREEN}✓${RESET}"
    else
      echo -e "${RED}✗${RESET}"
      DEPLOY_ERRORS=$(( DEPLOY_ERRORS + 1 ))
    fi
  done

  if (( DEPLOY_ERRORS > 0 )); then
    warn "${DEPLOY_ERRORS} program(s) failed to deploy — tests may fail"
  else
    success "All programs deployed"
  fi
else
  warn "Skipping deploy (--skip-deploy)"
fi

# ── Step 5: Run tests ─────────────────────────────────────────────────────────
mkdir -p "$RESULTS_DIR"
JUNIT_REPORT="$RESULTS_DIR/junit-${SUITE}-${TIMESTAMP}.xml"
JSON_REPORT="$RESULTS_DIR/results-${SUITE}-${TIMESTAMP}.json"

log "Running test suite: ${BOLD}${SUITE}${RESET}"
echo ""

START_TEST=$SECONDS

# Build the mocha command
MOCHA_ARGS=(
  "--timeout" "$TEST_TIMEOUT_MS"
  "--exit"
  "--reporter" "spec"
)

# Add all test files
for f in "${TEST_FILES[@]}"; do
  MOCHA_ARGS+=("$f")
done

# Run with environment variables set
set +e
ANCHOR_PROVIDER_URL="$ANCHOR_PROVIDER_URL" \
ANCHOR_WALLET="$ANCHOR_WALLET" \
  npx tsx node_modules/.bin/mocha "${MOCHA_ARGS[@]}"
TEST_EXIT_CODE=$?
set -e

TEST_ELAPSED=$(( SECONDS - START_TEST ))

# ── Step 6: Results ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}──────────────────────────────────────────────────────────────${RESET}"

if [[ $TEST_EXIT_CODE -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}  ✓ All tests passed${RESET}  (${TEST_ELAPSED}s)"
else
  echo -e "${RED}${BOLD}  ✗ Some tests failed${RESET}  (exit code: $TEST_EXIT_CODE, elapsed: ${TEST_ELAPSED}s)"
fi

echo -e "${BOLD}──────────────────────────────────────────────────────────────${RESET}"
echo ""

# ── Step 7: Persist JSON summary ─────────────────────────────────────────────
cat > "$JSON_REPORT" <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "suite": "${SUITE}",
  "exitCode": ${TEST_EXIT_CODE},
  "durationSeconds": ${TEST_ELAPSED},
  "rpc": "${ANCHOR_PROVIDER_URL}",
  "wallet": "${WALLET_PUBKEY}",
  "files": $(printf '%s\n' "${TEST_FILES[@]}" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().splitlines()))")
}
EOF
log "Result summary saved to: $JSON_REPORT"

# ── Step 8: TPC-C performance gate (stress suite only) ────────────────────────
if [[ "$SUITE" == "tpc-stress" ]]; then
  LATEST_TPC=$(ls -t "$RESULTS_DIR/tpc/tpc-c-results-"*.json 2>/dev/null | head -1 || true)
  if [[ -n "$LATEST_TPC" ]]; then
    TPS=$(python3 -c "import json; d=json.load(open('$LATEST_TPC')); print(d.get('tps',0))" 2>/dev/null || echo "0")
    SUCCESS_RATE=$(python3 -c "import json; d=json.load(open('$LATEST_TPC')); print(d.get('successRate','0%'))" 2>/dev/null || echo "0%")
    AVG_LAT=$(python3 -c "import json; d=json.load(open('$LATEST_TPC')); print(round(d.get('avgLatencyMs',0),1))" 2>/dev/null || echo "0")
    P95_LAT=$(python3 -c "import json; d=json.load(open('$LATEST_TPC')); print(round(d.get('p95LatencyMs',0),1))" 2>/dev/null || echo "0")

    echo -e "${BOLD}TPC-C Performance Results${RESET}"
    echo "  Throughput:    ${BOLD}${TPS}${RESET} TPS"
    echo "  Success rate:  ${SUCCESS_RATE}"
    echo "  Avg latency:   ${AVG_LAT}ms"
    echo "  P95 latency:   ${P95_LAT}ms"
    echo ""

    # Fail the run if TPS drops below the baseline gate (5 TPS on localnet)
    TPS_INT=$(python3 -c "print(int(float('${TPS}'.split()[0])+0.5))" 2>/dev/null || echo "0")
    if (( TPS_INT < 5 )); then
      error "TPS ${TPS} is below the minimum gate of 5 TPS"
      exit 1
    else
      success "TPS gate passed (${TPS} ≥ 5 TPS)"
    fi
  fi
fi

exit $TEST_EXIT_CODE
