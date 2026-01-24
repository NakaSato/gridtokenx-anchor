/**
 * Type definitions for GridTokenX Mobile SDK
 */

import { PublicKey } from '@solana/web3.js';

// Order types
export type OrderType = 'buy' | 'sell';
export type OrderStatus = 'active' | 'partially_filled' | 'completed' | 'cancelled' | 'expired';

export interface Order {
    publicKey: PublicKey;
    orderType: OrderType;
    owner: PublicKey;
    amount: number;
    filledAmount: number;
    pricePerKwh: number;
    status: OrderStatus;
    createdAt: Date;
    expiresAt: Date;
}

export interface Trade {
    publicKey: PublicKey;
    buyOrder: PublicKey;
    sellOrder: PublicKey;
    buyer: PublicKey;
    seller: PublicKey;
    amount: number;
    price: number;
    totalValue: number;
    fee: number;
    executedAt: Date;
}

// Meter types
export interface Meter {
    publicKey: PublicKey;
    owner: PublicKey;
    meterId: string;
    meterType: 'production' | 'consumption' | 'bidirectional';
    location: string;
    isActive: boolean;
    lastReading: number;
    lastReadingAt: Date;
}

export interface MeterReading {
    meter: PublicKey;
    value: number;
    readingType: 'production' | 'consumption';
    timestamp: Date;
    verified: boolean;
    verifiedBy?: PublicKey;
    anomalyFlags: number;
    confidence: number;
}

// Carbon credit types
export type RecType = 'solar' | 'wind' | 'hydro' | 'biomass' | 'geothermal' | 'mixed';
export type RetirementReason = 'voluntary' | 'compliance' | 'corporate' | 'mandate' | 'personal';

export interface RecCertificate {
    publicKey: PublicKey;
    certificateId: number;
    owner: PublicKey;
    issuer: PublicKey;
    recType: RecType;
    energyAmount: number;
    recAmount: number;
    carbonOffset: number;
    generationStart: Date;
    generationEnd: Date;
    issuedAt: Date;
    isRetired: boolean;
    retirementReason?: RetirementReason;
    retiredAt?: Date;
    retiredBy?: PublicKey;
    beneficiary?: string;
}

export interface CarbonListing {
    publicKey: PublicKey;
    listingId: number;
    seller: PublicKey;
    certificate: PublicKey;
    amount: number;
    pricePerRec: number;
    paymentMint: PublicKey;
    minPurchase: number;
    expiresAt: Date;
    createdAt: Date;
    isActive: boolean;
    totalSold: number;
}

export interface RetirementRecord {
    retirementId: number;
    certificate: PublicKey;
    amount: number;
    carbonOffset: number;
    reason: RetirementReason;
    retiredBy: PublicKey;
    beneficiary: string;
    compliancePeriod: string;
    retiredAt: Date;
}

// Privacy types
export interface PrivateBalance {
    publicKey: PublicKey;
    owner: PublicKey;
    mint: PublicKey;
    commitment: string;
    isEncrypted: boolean;
    lastUpdateSlot: number;
    txCounter: number;
}

// Pricing types
export type TimePeriod = 'off-peak' | 'mid-peak' | 'on-peak' | 'super-peak';
export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

export interface PricingInfo {
    basePrice: number;
    currentPrice: number;
    timePeriod: TimePeriod;
    season: Season;
    touMultiplier: number;
    seasonalMultiplier: number;
    supplyDemandAdjustment: number;
    congestionFactor: number;
    nextPeriodChange: Date;
}

export interface PriceForecast {
    time: Date;
    price: number;
    period: TimePeriod;
    confidence: number;
}

// User types
export interface User {
    publicKey: PublicKey;
    userType: 'consumer' | 'prosumer' | 'producer';
    registeredAt: Date;
    totalProduction: number;
    totalConsumption: number;
    carbonOffset: number;
}

// Market types
export interface MarketStats {
    totalVolume: number;
    totalTrades: number;
    activeOrders: number;
    lastClearingPrice: number;
    volumeWeightedPrice: number;
}

export interface OrderBook {
    bids: OrderBookEntry[];
    asks: OrderBookEntry[];
    spread: number;
    midPrice: number;
}

export interface OrderBookEntry {
    price: number;
    totalVolume: number;
    orderCount: number;
}
