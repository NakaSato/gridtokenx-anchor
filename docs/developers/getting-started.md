# Getting Started

Welcome to the GridTokenX developer documentation! This guide will walk you through setting up the Solana Anchor development environment and running the decentralized energy exchange locally.

## Prerequisites
- **Node.js** v18+
- **Rust** v1.75+
- **Solana CLI** v1.18+
- **Anchor CLI** v0.30.1

## 1. Local Network Setup

First, spin up a local Solana test validator. This acts as your private blockchain instance.
```bash
solana-test-validator -r
```
*Note: The `-r` flag resets the ledger state, ensuring a clean slate for the DAO configurations.*

## 2. Build & Deploy

Open a new terminal in the `gridtokenx-anchor` root directory. Build the 5 core programs:
```bash
anchor build
```

Sync the generated program IDs to your Anchor.toml and source code:
```bash
anchor keys sync
```

Deploy the programs to your local validator:
```bash
anchor deploy
```

## 3. Protocol Initialization

Before the network can process energy readings or trades, the master configurations (like the DAO PoA multisig) must be initialized. 

Run the governance initialization script:
```bash
npx ts-node scripts/init-governance.ts
```

## 4. Run the Dashboard

The project includes a fully integrated Vite + React web application.
```bash
cd app
npm install
npm run dev
```
Navigate to `http://localhost:5173` to view the Live Grid Dashboard.
