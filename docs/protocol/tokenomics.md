# Tokenomics Lifecycle

The GridTokenX tokenomics model mathematically pegs network utility (GRX) to real-world energy generation (kWh).

## The GRX Token
GRX is an SPL Token-2022 asset. 
**1 GRX = 1 kWh** of cryptographically verified, solar-generated energy.

Because it uses Token-2022, we natively support advanced transfer hooks, metadata, and zero-knowledge privacy extensions at the protocol level.

## Settlement Flow
Unlike traditional centralized energy markets where billing occurs monthly, GridTokenX settles in real-time.

1. **Generation:** A solar farm produces 5,000 kWh of energy during peak hours. The IoT meter signs this data and pushes it to the Oracle.
2. **Settlement:** The owner calls `settle_and_mint_tokens()` on the Registry.
3. **Minting:** The Oracle verifies the unsettled balance, zeroes it out, and instructs the Energy-Token program to mint exactly 5,000 GRX to the user's wallet.

## REC Validators & Staking
To participate in the consensus layer and earn network fees (from the decentralized spot market), users must become **Renewable Energy Certificate (REC) Validators**.

- **Staking Requirement:** Users must stake **10,000 GRX** into the global `grx_vault`.
- **Slashing:** Malicious behavior (such as spoofing meter IDs) results in slashing of the staked GRX.
- **Yield:** Active validators receive a pro-rata distribution of the trading fees captured by the `Trading` program.
