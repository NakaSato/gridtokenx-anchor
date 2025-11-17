sequenceDiagram
    participant User
    participant EnergyToken
    participant Registry
    participant MeterAccount
    participant SPLToken
    
    User->>EnergyToken: mint_grid_tokens()
    EnergyToken->>Registry: settle_meter_balance() [CPI]
    Registry->>MeterAccount: Read meter data
    MeterAccount-->>Registry: total_gen, total_cons, settled
    Registry->>Registry: Calculate unsettled amount
    Registry->>MeterAccount: Update settled_net_generation
    Registry-->>EnergyToken: Return tokens_to_mint
    EnergyToken->>SPLToken: mint_to() [CPI]
    SPLToken-->>EnergyToken: Mint successful
    EnergyToken->>EnergyToken: Update total_supply
    EnergyToken-->>User: Emit GridTokensMinted event