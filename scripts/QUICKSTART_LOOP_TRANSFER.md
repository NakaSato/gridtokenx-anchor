# Loop Transfer Test - Quick Start Guide

## TL;DR - Run Test in 3 Commands

```bash
# Terminal 1: Start validator (if not running)
cd anchor && anchor localnet

# Terminal 2: Build and setup (one-time)
cd anchor && anchor build              # Build programs first (5-10 min)
make setup-loop-transfer               # Setup wallets and mint tokens

# Run test
make test-loop-transfer-quick          # Run test (20 iterations, ~30 seconds)
```

## What This Does

Tests transaction **latency** and **throughput** by looping token transfers between 2 wallets:

- ✅ Alternates direction (Wallet 1 ↔ Wallet 2)
- ✅ Measures each transaction time
- ✅ Reports detailed performance metrics
- ✅ Shows latency distribution
- ✅ Validates balances before/after

## Commands

### Setup (One-time)

```bash
make setup-loop-transfer
```

This will:
1. Create 2 test wallets
2. Request SOL airdrop
3. Mint 2000 GRX to each wallet
4. Verify balances

### Run Tests

```bash
# Quick test (20 iterations, ~30 sec)
make test-loop-transfer-quick

# Standard test (100 iterations, ~2-3 min)
make test-loop-transfer

# Stress test (500 iterations, ~10-15 min)
make test-loop-transfer-stress
```

### Custom Test

```bash
cd anchor
ts-node scripts/loop-transfer-test.ts [iterations] [amount]

# Examples:
ts-node scripts/loop-transfer-test.ts 50 1      # 50 transfers of 1 GRX
ts-node scripts/loop-transfer-test.ts 200 0.5   # 200 transfers of 0.5 GRX
```

## Sample Output

```bash
🚀 GridTokenX Loop Transfer Performance Test

======================================================================
RPC Endpoint:     http://localhost:8899
Iterations:       20
Amount per TX:    1.000000000 GRX
======================================================================

💰 Wallet Balances:
  Wallet 1: 2000.000000000 GRX
  Wallet 2: 2000.000000000 GRX

🔄 Starting loop transfer test...

  [  1/20] Wallet 1 → Wallet 2       756ms ✅
  [ 10/20] Wallet 2 → Wallet 1       801ms ✅
  [ 20/20] Wallet 2 → Wallet 1       778ms ✅

======================================================================
  Loop Transfer Test (20 iterations)
======================================================================
  Total Transactions:      20
  Successful:              20 ✅
  Failed:                  0 ❌
  Total Duration:          16234.56 ms
  Throughput:              1.2320 tx/sec
----------------------------------------------------------------------
  Avg Latency:             811.73 ms
  Min Latency:             652.12 ms
  Max Latency:             1105.34 ms
  P50 Latency (Median):    785.23 ms
  P95 Latency:             989.56 ms
  P99 Latency:             1076.89 ms
======================================================================

📊 Performance Criteria:
  Throughput:      1.2320 tx/sec ✅ PASS
  Avg Latency:     811.73 ms ✅ PASS
  P95 Latency:     989.56 ms ✅ PASS
  Success Rate:    100.00% ✅ PASS

📊 Latency Distribution:
  0-100ms       1 ( 5.0%) ██
  100-500ms     3 (15.0%) ████████
  500ms-1s     14 (70.0%) ███████████████████████████████████
  1-2s          2 (10.0%) █████
  2-5s          0 ( 0.0%)
  5s+           0 ( 0.0%)

✅ Loop transfer test completed!
```

## Metrics Explained

### Throughput
- **What**: Transactions per second
- **Good**: > 1.0 tx/sec
- **Target**: Higher is better

### Latency
- **Avg**: Mean transaction time
- **P50**: 50% faster than this (median)
- **P95**: 95% faster than this
- **P99**: 99% faster than this
- **Target**: Lower is better

### Success Rate
- **What**: % of successful transactions
- **Good**: > 95%
- **Target**: 100%

## Troubleshooting

### "Solana validator not running"
```bash
cd anchor && anchor localnet
```

### "Token accounts not initialized"
```bash
make setup-loop-transfer
```

### "Insufficient balance"
```bash
cd anchor
ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json \
  ts-node scripts/grx-wallet-manager.ts mint 1 5000
ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json \
  ts-node scripts/grx-wallet-manager.ts mint 2 5000
```

### Check Wallet Balances
```bash
cd anchor
ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json \
  ts-node scripts/grx-wallet-manager.ts balances
```

## Files Created

- `anchor/scripts/loop-transfer-test.ts` - Main test script
- `anchor/scripts/setup-loop-test.sh` - Setup automation
- `anchor/wallet-1-keypair.json` - Test wallet 1
- `anchor/wallet-2-keypair.json` - Test wallet 2

## Full Documentation

For complete documentation, see:
- **`anchor/scripts/LOOP_TRANSFER_GUIDE.md`** - Detailed guide

---

**Ready? Run `make setup-loop-transfer` then `make test-loop-transfer-quick`! 🚀**
