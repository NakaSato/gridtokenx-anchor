# GridTokenX Real-World Performance Report

## Executive Summary

- **Test Date**: 2025-12-20
- **Environment**: LiteSVM (In-Process Solana VM)
- **Scenarios Tested**: 4

## Scenario Results

| Scenario | Target TPS | Actual TPS | Avg Latency | p99 Latency | Success Rate |
|----------|------------|------------|-------------|-------------|--------------|
| Morning Peak (7-9 AM) | 50 | 58.8 | 0.00ms | 0.00ms | 0.0% |
| Evening Peak (5-8 PM) | 75 | 88.4 | 3.19ms | 5.38ms | 98.4% |
| Flash Sale Event | 150 | 228.1 | 2.22ms | 3.51ms | 93.2% |
| Market Volatility | 100 | 141.8 | 2.63ms | 3.66ms | 98.1% |

## Key Findings

1. **Average TPS across scenarios**: 129.3 TPS
2. **Peak TPS achieved**: 228.1 TPS
3. **Average latency**: 2.01ms

## Operation Performance

| Operation | Total Count | Avg Latency | Success Rate |
|-----------|-------------|-------------|--------------|
| mint_energy | 1317 | 1.89ms | 65.3% |
| place_buy_order | 4168 | 2.23ms | 81.9% |
| place_sell_order | 1459 | 2.18ms | 77.2% |
| cancel_order | 974 | 2.35ms | 90.0% |
| match_orders | 1253 | 2.26ms | 85.0% |
| update_oracle | 721 | 2.39ms | 88.1% |
| register_device | 177 | 2.00ms | 79.1% |
| query_balance | 609 | 2.25ms | 76.8% |

## Methodology

Real-world scenarios simulate actual energy trading platform usage patterns:
- **Morning Peak**: High producer activity as solar/wind comes online
- **Evening Peak**: Maximum consumer demand during evening hours
- **Flash Sale**: Promotional event with surge in buying activity
- **Market Volatility**: High-frequency trading during price fluctuations
