# Anchor Programs Reference

This section provides full technical details for the Anchor programs contained in this repository. These programs constitute the GridTokenX platform and associated benchmarks.

## Programs Overview

| Program | ID | Description |
|---------|----|-------------|
| **[Governance](./governance.md)** | `2WrMSfreZvCCKdQMQGY7bTFgXKgr42fYipJR6VXn1Q8c` | Central authority governance, ERC issuance validation, and system configuration. |
| **[Energy Token](./energy-token.md)** | `5T7PuWV6wbzhJP9WDfDegPMGRiadMhxHrUc2n2LAB9gY` | Implements the GRX token using Token 2022 extensions. Handles minting and transfers. |
| **[Registry](./registry.md)** | `HWoKSbNy4jJBFJ7g7drxZgAfTmjFqvg1Sx6vXosfJNAi` | Manages user and smart meter registration/identities. |
| **[Oracle](./oracle.md)** | `5z6Qaf6UUv42uCqbxQLfKz7cSXhMABsq73mRMwvHKzFA` | Ingests off-chain AMI data via API Gateway and validates readings. |
| **[Trading](./trading.md)** | `Fmk6vb74MjZpXVE9kAS5q4U5L8hr2AEJcDikfRSFTiyY` | P2P energy trading market, order matching, and settlement. |
| **[Blockbench](./blockbench.md)** | `BfsR4GtThj5bvF9NS8Ltx5GzDKjvVrGmU7tGwLX8z3PW` | Implementation of BLOCKBENCH micro-benchmarks and YCSB workloads. |
| **[TPC-Benchmark](./tpc-benchmark.md)** | `6m4qnVFJF3HAz7QNjW73EuXzy37r5dUzh7Zey5A9JHPr` | Implementation of the TPC-C benchmark suite adapted for Solana accounts. |

## Network Configuration

These programs are configured for `localnet` deployment in `Anchor.toml`.

```toml
[programs.localnet]
blockbench = "BfsR4GtThj5bvF9NS8Ltx5GzDKjvVrGmU7tGwLX8z3PW"
energy_token = "5T7PuWV6wbzhJP9WDfDegPMGRiadMhxHrUc2n2LAB9gY"
governance = "2WrMSfreZvCCKdQMQGY7bTFgXKgr42fYipJR6VXn1Q8c"
oracle = "5z6Qaf6UUv42uCqbxQLfKz7cSXhMABsq73mRMwvHKzFA"
registry = "HWoKSbNy4jJBFJ7g7drxZgAfTmjFqvg1Sx6vXosfJNAi"
tpc_benchmark = "6m4qnVFJF3HAz7QNjW73EuXzy37r5dUzh7Zey5A9JHPr"
trading = "Fmk6vb74MjZpXVE9kAS5q4U5L8hr2AEJcDikfRSFTiyY"
```
