# GridTokenX Real-World Performance Report

## Executive Summary

- **Test Date**: 2025-12-16
- **Environment**: LiteSVM (In-Process Solana VM)
- **Scenarios Tested**: 4

## Scenario Results

| Scenario | Target TPS | Actual TPS | Avg Latency | p99 Latency | Success Rate |
|----------|------------|------------|-------------|-------------|--------------|
| Morning Peak (7-9 AM) | 50 | 59.1 | 0.00ms | 0.00ms | 0.0% |
| Evening Peak (5-8 PM) | 75 | 91.3 | 3.30ms | 6.71ms | 98.1% |
| Flash Sale Event | 150 | 206.9 | 2.82ms | 5.01ms | 93.2% |
| Market Volatility | 100 | 133.9 | 3.10ms | 7.27ms | 98.1% |

## Key Findings

1. **Average TPS across scenarios**: 122.8 TPS
2. **Peak TPS achieved**: 206.9 TPS
3. **Average latency**: 2.30ms

## Operation Performance

| Operation | Total Count | Avg Latency | Success Rate |
|-----------|-------------|-------------|--------------|
| mint_energy | 1276 | 2.06ms | 62.8% |
| place_buy_order | 3966 | 2.59ms | 81.0% |
| place_sell_order | 1297 | 2.46ms | 78.6% |
| cancel_order | 962 | 2.62ms | 87.5% |
| match_orders | 1323 | 2.68ms | 85.1% |
| update_oracle | 753 | 2.85ms | 87.6% |
| register_device | 133 | 2.60ms | 81.2% |
| query_balance | 585 | 2.41ms | 75.0% |

## Methodology

Real-world scenarios simulate actual energy trading platform usage patterns:
- **Morning Peak**: High producer activity as solar/wind comes online
- **Evening Peak**: Maximum consumer demand during evening hours
- **Flash Sale**: Promotional event with surge in buying activity
- **Market Volatility**: High-frequency trading during price fluctuations
