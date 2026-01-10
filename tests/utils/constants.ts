import * as anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Program IDs (matching Anchor.toml)
export const PROGRAM_IDS = {
  energy_token: "94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur",
  governance: "4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe",
  oracle: "DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE",
  registry: "9XS8uUEVErcA8LABrJQAdohWMXTToBwhFN7Rvur6dC5",
  trading: "GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk",
} as const;

// Solana Program IDs
export const SOLANA_PROGRAMS = {
  TOKEN: TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN: ASSOCIATED_TOKEN_PROGRAM_ID,
  SYSTEM: anchor.web3.SystemProgram.programId,
  RENT: anchor.web3.SYSVAR_RENT_PUBKEY,
  CLOCK: anchor.web3.SYSVAR_CLOCK_PUBKEY,
  INSTRUCTIONS: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
} as const;

// Token constants
export const TOKEN_CONSTANTS = {
  DECIMALS: 9,
  LAMPORTS_PER_TOKEN: Math.pow(10, 9),
  ZERO_AMOUNT: 0,
  MAX_SUPPLY: 18446744073709551615n, // u64::MAX
} as const;

// Test amounts (in smallest units - lamports)
export const TEST_AMOUNTS = {
  ONE_TOKEN: 1_000_000_000,
  TEN_TOKENS: 10_000_000_000,
  HUNDRED_TOKENS: 100_000_000_000,
  THOUSAND_TOKENS: 1_000_000_000_000,
  MILLION_TOKENS: 1_000_000_000_000_000,
  SMALL_AMOUNT: 100_000_000, // 0.1 tokens
  MEDIUM_AMOUNT: 1_000_000_000, // 1 token
  LARGE_AMOUNT: 10_000_000_000, // 10 tokens
} as const;

// SOL amounts for testing
export const SOL_AMOUNTS = {
  ONE_SOL: 1 * anchor.web3.LAMPORTS_PER_SOL,
  TWO_SOL: 2 * anchor.web3.LAMPORTS_PER_SOL,
  FIVE_SOL: 5 * anchor.web3.LAMPORTS_PER_SOL,
  TEN_SOL: 10 * anchor.web3.LAMPORTS_PER_SOL,
} as const;

// Energy measurement constants
export const ENERGY_CONSTANTS = {
  KWH_UNIT: 1, // 1 kWh base unit
  MWH_UNIT: 1000, // 1 MWh = 1000 kWh
  GWH_UNIT: 1000000, // 1 GWh = 1,000,000 kWh
} as const;

// Renewable energy sources
export const RENEWABLE_SOURCES = [
  "Solar",
  "Wind",
  "Hydro",
  "Biomass",
  "Geothermal",
] as const;

// Test locations
export const TEST_LOCATIONS = [
  "Bangkok, Thailand",
  "Chiang Mai, Thailand",
  "Phuket, Thailand",
  "Pattaya, Thailand",
  "Samut Prakan, Thailand",
] as const;

// Time constants (in milliseconds)
export const TIME_CONSTANTS = {
  ONE_SECOND: 1000,
  FIVE_SECONDS: 5000,
  TEN_SECONDS: 10000,
  THIRTY_SECONDS: 30000,
  ONE_MINUTE: 60000,
  FIVE_MINUTES: 300000,
  TEN_MINUTES: 600000,
} as const;

// Gas and fee constants
export const FEE_CONSTANTS = {
  BASE_PRIORITY_FEE: 5000, // microlamports
  MAX_PRIORITY_FEE: 100000, // microlamports
  COMPUTE_UNIT_LIMIT: 200000,
  ADDITIONAL_FEE_BUFFER: 0.1, // 10% buffer
} as const;

// Error codes (matching program error enums)
export const ERROR_CODES = {
  ENERGY_TOKEN: {
    UNAUTHORIZED_AUTHORITY: 6000,
    INVALID_METER: 6001,
    INSUFFICIENT_BALANCE: 6002,
    INVALID_METADATA_ACCOUNT: 6003,
    NO_UNSETTLED_BALANCE: 6004,
  },
  GOVERNANCE: {
    UNAUTHORIZED_AUTHORITY: 7000,
    INVALID_CERTIFICATE: 7001,
    CERTIFICATE_ALREADY_VALIDATED: 7002,
    SYSTEM_PAUSED: 7003,
    INVALID_AMOUNT: 7004,
    EXPIRED_CERTIFICATE: 7005,
  },
  ORACLE: {
    UNAUTHORIZED_ORACLE: 8000,
    INVALID_PRICE_FEED: 8001,
    STALE_PRICE_DATA: 8002,
    INVALID_TIMESTAMP: 8003,
  },
  REGISTRY: {
    UNAUTHORIZED_OWNER: 9000,
    METER_ALREADY_EXISTS: 9001,
    INVALID_METER_DATA: 9002,
    DUPLICATE_METER_ID: 9003,
  },
  TRADING: {
    INSUFFICIENT_TOKENS: 10000,
    INVALID_ORDER_TYPE: 10001,
    ORDER_NOT_FOUND: 10002,
    ORDER_ALREADY_FILLED: 10003,
    INVALID_PRICE: 10004,
  },
} as const;

// Event types
export const EVENT_TYPES = {
  ENERGY_TOKEN: {
    TOKENS_MINTED: "TokensMinted",
    TOKENS_BURNED: "TokensBurned",
    TOKENS_TRANSFERRED: "TokensTransferred",
    GRID_TOKENS_MINTED: "GridTokensMinted",
  },
  GOVERNANCE: {
    POA_INITIALIZED: "PoaInitialized",
    EMERGENCY_PAUSED: "EmergencyPaused",
    EMERGENCY_UNPAUSED: "EmergencyUnpaused",
    ERC_ISSUED: "ErcIssued",
    ERC_VALIDATED: "ErcValidated",
  },
  ORACLE: {
    PRICE_UPDATED: "PriceUpdated",
    ORACLE_INITIALIZED: "OracleInitialized",
  },
  REGISTRY: {
    METER_REGISTERED: "MeterRegistered",
    METER_UPDATED: "MeterUpdated",
    ENERGY_DATA_SUBMITTED: "EnergyDataSubmitted",
  },
  TRADING: {
    ORDER_CREATED: "OrderCreated",
    ORDER_FILLED: "OrderFilled",
    ORDER_CANCELLED: "OrderCancelled",
    TRADE_EXECUTED: "TradeExecuted",
  },
} as const;

// Test configuration
export const TEST_CONFIG = {
  DEFAULT_TIMEOUT: 30000, // 30 seconds
  AVERAGE_BLOCK_TIME: 400, // milliseconds (Solana average)
  MAX_RETRIES: 3,
  RETRY_DELAY_BASE: 1000, // milliseconds
  CONFIRMATION_WAIT_TIME: 5000, // milliseconds
} as const;

// Network configuration
export const NETWORK_CONFIG = {
  LOCALNET: {
    URL: "http://127.0.0.1:8899",
    COMMITMENT: "confirmed" as anchor.web3.Commitment,
    PREFLIGHT_COMMITMENT: "processed" as anchor.web3.Commitment,
  },
  DEVNET: {
    URL: "https://api.devnet.solana.com",
    COMMITMENT: "confirmed" as anchor.web3.Commitment,
    PREFLIGHT_COMMITMENT: "processed" as anchor.web3.Commitment,
  },
  MAINNET: {
    URL: "https://api.mainnet-beta.solana.com",
    COMMITMENT: "confirmed" as anchor.web3.Commitment,
    PREFLIGHT_COMMITMENT: "processed" as anchor.web3.Commitment,
  },
} as const;

// Validation constants
export const VALIDATION_CONSTANTS = {
  MAX_METER_ID_LENGTH: 100,
  MAX_LOCATION_LENGTH: 200,
  MAX_CERTIFICATE_ID_LENGTH: 100,
  MAX_VALIDATION_DATA_LENGTH: 500,
  MIN_ENERGY_AMOUNT: 1,
  MAX_ENERGY_AMOUNT: 18446744073709551615n, // u64::MAX
  ERC_VALIDITY_PERIOD_DAYS: 365, // 1 year
} as const;

// Type exports
export type ProgramId = typeof PROGRAM_IDS[keyof typeof PROGRAM_IDS];
export type RenewableSource = typeof RENEWABLE_SOURCES[number];
export type TestLocation = typeof TEST_LOCATIONS[number];
export type NetworkType = keyof typeof NETWORK_CONFIG;
