/**
 * GridTokenX Mobile Wallet SDK
 * 
 * React Native SDK for interacting with GridTokenX on Solana
 * Supports Solana Mobile Wallet Adapter for seamless mobile experience
 */

// Core exports
export { GridTokenXClient } from './client';
export { WalletProvider, useWallet, useConnection } from './providers';
export { useEnergyTrading, useOrders, useCarbonCredits } from './hooks';

// Types
export type {
    Order,
    OrderType,
    Trade,
    MeterReading,
    RecCertificate,
    PrivateBalance,
    PricingInfo,
} from './types';

// Components
export {
    ConnectWalletButton,
    OrderBookView,
    TradeHistoryView,
    MeterReadingsView,
    CarbonCreditsView,
    PrivateBalanceView,
} from './components';

// Utilities
export {
    formatEnergy,
    formatPrice,
    formatCarbonOffset,
    calculateCost,
} from './utils';

// Constants
export {
    TRADING_PROGRAM_ID,
    REGISTRY_PROGRAM_ID,
    ORACLE_PROGRAM_ID,
    GOVERNANCE_PROGRAM_ID,
    ENERGY_TOKEN_PROGRAM_ID,
} from './constants';
