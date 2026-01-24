/**
 * Constants for GridTokenX Mobile SDK
 */

// Program IDs
export const TRADING_PROGRAM_ID = 'CrfC5coUm2ty6DphLBFhAmr8m1AMutf8KTW2JYS38Z5J';
export const REGISTRY_PROGRAM_ID = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
export const ORACLE_PROGRAM_ID = 'HdMcDuMk9ZnNp4yEYMtwMEQkQYCkM8LJLLMHefn6yN6u';
export const GOVERNANCE_PROGRAM_ID = 'GoVERNancE111111111111111111111111111111111';
export const ENERGY_TOKEN_PROGRAM_ID = 'ENrGy111111111111111111111111111111111111111';

// Token mints
export const GRID_TOKEN_MINT = 'GRiD111111111111111111111111111111111111111';
export const REC_TOKEN_MINT = 'REC1111111111111111111111111111111111111111';
export const CARBON_TOKEN_MINT = 'CARB111111111111111111111111111111111111111';

// Stablecoins
export const USDC_MINT_MAINNET = 'EPjFWdd5AufqSSqZEM6d1Hetq9ePVNJ4LNM2UCVd7pHj';
export const USDC_MINT_DEVNET = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';
export const USDT_MINT_MAINNET = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// RPC endpoints
export const RPC_ENDPOINTS = {
    mainnet: 'https://api.mainnet-beta.solana.com',
    devnet: 'https://api.devnet.solana.com',
    testnet: 'https://api.testnet.solana.com',
    localnet: 'http://127.0.0.1:8899',
};

// Default values
export const DEFAULT_COMMITMENT = 'confirmed';
export const DEFAULT_TX_TIMEOUT = 60000; // 60 seconds

// Pricing constants
export const PRICE_DECIMALS = 6;
export const ENERGY_DECIMALS = 3; // 0.001 kWh precision
export const REC_DECIMALS = 9;
export const CARBON_DECIMALS = 6;

// Time periods (hours)
export const TOU_PERIODS = {
    OFF_PEAK: { start: 22, end: 9 },
    MID_PEAK: { start: 9, end: 18 },
    ON_PEAK: { start: 18, end: 22 },
};

// Carbon conversion factors
export const CARBON_FACTORS = {
    SOLAR: 450,      // g CO2e/kWh
    WIND: 470,
    HYDRO: 480,
    BIOMASS: 300,
    GEOTHERMAL: 400,
    MIXED: 420,
};

// Fee rates (basis points)
export const FEE_RATES = {
    TRADING: 25,      // 0.25%
    MINTING: 10,      // 0.10%
    RETIREMENT: 5,    // 0.05%
    BRIDGE: 50,       // 0.50%
};

// Limits
export const LIMITS = {
    MIN_ORDER_SIZE: 0.001,    // kWh
    MAX_ORDER_SIZE: 1000000,  // kWh
    MIN_PRICE: 0.01,          // per kWh
    MAX_PRICE: 100,           // per kWh
    ORDER_EXPIRY: 86400,      // 24 hours in seconds
};
