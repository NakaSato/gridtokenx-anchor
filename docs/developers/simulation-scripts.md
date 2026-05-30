# Simulation Scripts

GridTokenX comes packaged with a suite of background simulators to mimic a live energy grid and decentralized order book. You can find these in the `scripts/` directory.

## 1. Meter Stream Crank (`simulate-meter-stream.ts`)
This script acts as a real-time data ingestion crank.
- **Function:** Runs an asynchronous loop that calculates solar generation (peaking at noon) and household consumption (peaking in the evening).
- **Network Load:** Constantly feeds `submitMeterReading` transactions to the Oracle API Gateway.
- **Usage:**
  ```bash
  npx ts-node scripts/simulate-meter-stream.ts
  ```

## 2. Market Clearing Engine (`simulate-market-clearing.ts`)
This script demonstrates how an off-chain intersection engine interfaces with the `Trading` program.
- **Function:** Seeds the Trading program with a randomized order book of Bids (Buyers) and Asks (Sellers).
- **Execution:** It runs a price-time priority intersection algorithm off-chain to find matching overlaps, and then triggers `matchOrders` on-chain at the equilibrium clearing price.
- **Usage:**
  ```bash
  npx ts-node scripts/simulate-market-clearing.ts
  ```

## 3. Token Economics Flow (`simulate-token-lifecycle.ts`)
This script runs a full end-to-end integration test of the GRX lifecycle across three different Anchor programs.
- **Function:** Fetches unsettled meter balances from the Oracle, executes `settle_and_mint_tokens` via the Registry, and simulates a user staking their newly minted GRX into the global `grx_vault` to become a validator.
- **Usage:**
  ```bash
  npx ts-node scripts/simulate-token-lifecycle.ts
  ```
