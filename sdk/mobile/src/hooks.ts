/**
 * React hooks for GridTokenX Mobile SDK
 */

import { useState, useEffect, useCallback } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useConnection, useWallet } from './providers';
import { GridTokenXClient } from './client';
import type { Order, Trade, RecCertificate, MeterReading } from './types';

/**
 * Hook for energy trading operations
 */
export function useEnergyTrading() {
    const { connection } = useConnection();
    const wallet = useWallet();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const [pricePeriod, setPricePeriod] = useState<string>('mid-peak');

    const client = wallet.connected
        ? new GridTokenXClient({
            connection,
            wallet: wallet as any
        })
        : null;

    // Fetch current price
    const refreshPrice = useCallback(async () => {
        if (!client) return;
        try {
            const priceInfo = await client.getCurrentPrice();
            setCurrentPrice(priceInfo.price);
            setPricePeriod(priceInfo.period);
        } catch (err) {
            console.error('Failed to fetch price:', err);
        }
    }, [client]);

    useEffect(() => {
        refreshPrice();
        const interval = setInterval(refreshPrice, 60000); // Refresh every minute
        return () => clearInterval(interval);
    }, [refreshPrice]);

    const createSellOrder = async (amount: number, price: number) => {
        if (!client) throw new Error('Wallet not connected');
        setLoading(true);
        setError(null);
        try {
            const signature = await client.createSellOrder(amount, price);
            return signature;
        } catch (err) {
            setError(err as Error);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const createBuyOrder = async (amount: number, maxPrice: number) => {
        if (!client) throw new Error('Wallet not connected');
        setLoading(true);
        setError(null);
        try {
            const signature = await client.createBuyOrder(amount, maxPrice);
            return signature;
        } catch (err) {
            setError(err as Error);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const cancelOrder = async (orderPda: PublicKey) => {
        if (!client) throw new Error('Wallet not connected');
        setLoading(true);
        setError(null);
        try {
            const signature = await client.cancelOrder(orderPda);
            return signature;
        } catch (err) {
            setError(err as Error);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    return {
        createSellOrder,
        createBuyOrder,
        cancelOrder,
        currentPrice,
        pricePeriod,
        refreshPrice,
        loading,
        error,
        connected: wallet.connected,
    };
}

/**
 * Hook for order management
 */
export function useOrders() {
    const { connection } = useConnection();
    const wallet = useWallet();
    const [orders, setOrders] = useState<Order[]>([]);
    const [orderBook, setOrderBook] = useState<{ bids: Order[]; asks: Order[] }>({
        bids: [],
        asks: []
    });
    const [trades, setTrades] = useState<Trade[]>([]);
    const [loading, setLoading] = useState(false);

    const client = wallet.connected
        ? new GridTokenXClient({ connection, wallet: wallet as any })
        : null;

    const fetchOrders = useCallback(async () => {
        if (!client) return;
        setLoading(true);
        try {
            const [userOrders, book, history] = await Promise.all([
                client.getUserOrders(),
                client.getOrderBook(),
                client.getTradeHistory(),
            ]);
            setOrders(userOrders);
            setOrderBook(book);
            setTrades(history);
        } catch (err) {
            console.error('Failed to fetch orders:', err);
        } finally {
            setLoading(false);
        }
    }, [client]);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    return {
        orders,
        orderBook,
        trades,
        refresh: fetchOrders,
        loading,
        connected: wallet.connected,
    };
}

/**
 * Hook for carbon credits management
 */
export function useCarbonCredits() {
    const { connection } = useConnection();
    const wallet = useWallet();
    const [certificates, setCertificates] = useState<RecCertificate[]>([]);
    const [totalOffset, setTotalOffset] = useState<number>(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const client = wallet.connected
        ? new GridTokenXClient({ connection, wallet: wallet as any })
        : null;

    const fetchCertificates = useCallback(async () => {
        if (!client) return;
        setLoading(true);
        try {
            const certs = await client.getRecCertificates();
            setCertificates(certs);

            // Calculate total offset
            const total = certs.reduce((sum, cert) => sum + cert.carbonOffset, 0);
            setTotalOffset(total);
        } catch (err) {
            console.error('Failed to fetch certificates:', err);
        } finally {
            setLoading(false);
        }
    }, [client]);

    useEffect(() => {
        fetchCertificates();
    }, [fetchCertificates]);

    const retireCredits = async (
        certificate: PublicKey,
        amount: number,
        beneficiary: string
    ) => {
        if (!client) throw new Error('Wallet not connected');
        setLoading(true);
        setError(null);
        try {
            const signature = await client.retireRec(certificate, amount, beneficiary);
            await fetchCertificates(); // Refresh after retirement
            return signature;
        } catch (err) {
            setError(err as Error);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    return {
        certificates,
        totalOffset,
        retireCredits,
        refresh: fetchCertificates,
        loading,
        error,
        connected: wallet.connected,
    };
}

/**
 * Hook for meter readings
 */
export function useMeterReadings(meterPubkey?: PublicKey) {
    const { connection } = useConnection();
    const wallet = useWallet();
    const [readings, setReadings] = useState<MeterReading[]>([]);
    const [loading, setLoading] = useState(false);

    const client = wallet.connected
        ? new GridTokenXClient({ connection, wallet: wallet as any })
        : null;

    const fetchReadings = useCallback(async () => {
        if (!client || !meterPubkey) return;
        setLoading(true);
        try {
            const meterReadings = await client.getMeterReadings(meterPubkey);
            setReadings(meterReadings);
        } catch (err) {
            console.error('Failed to fetch readings:', err);
        } finally {
            setLoading(false);
        }
    }, [client, meterPubkey]);

    useEffect(() => {
        fetchReadings();
    }, [fetchReadings]);

    return {
        readings,
        refresh: fetchReadings,
        loading,
        connected: wallet.connected,
    };
}

/**
 * Hook for private/confidential balances
 */
export function usePrivateBalance() {
    const { connection } = useConnection();
    const wallet = useWallet();
    const [balance, setBalance] = useState<{ commitment: string; encrypted: boolean } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const client = wallet.connected
        ? new GridTokenXClient({ connection, wallet: wallet as any })
        : null;

    const fetchBalance = useCallback(async () => {
        if (!client) return;
        setLoading(true);
        try {
            const privateBalance = await client.getPrivateBalance();
            setBalance(privateBalance);
        } catch (err) {
            console.error('Failed to fetch private balance:', err);
        } finally {
            setLoading(false);
        }
    }, [client]);

    useEffect(() => {
        fetchBalance();
    }, [fetchBalance]);

    const shield = async (amount: number) => {
        if (!client) throw new Error('Wallet not connected');
        setLoading(true);
        setError(null);
        try {
            const signature = await client.shieldTokens(amount);
            await fetchBalance();
            return signature;
        } catch (err) {
            setError(err as Error);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const unshield = async (amount: number) => {
        if (!client) throw new Error('Wallet not connected');
        setLoading(true);
        setError(null);
        try {
            const signature = await client.unshieldTokens(amount);
            await fetchBalance();
            return signature;
        } catch (err) {
            setError(err as Error);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    return {
        balance,
        shield,
        unshield,
        refresh: fetchBalance,
        loading,
        error,
        connected: wallet.connected,
    };
}
