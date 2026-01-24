/**
 * React providers for GridTokenX Mobile SDK
 */

import React, {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    ReactNode
} from 'react';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import {
    transact,
    Web3MobileWallet,
} from '@solana-mobile/mobile-wallet-adapter-protocol';

// Connection Context
interface ConnectionContextState {
    connection: Connection;
    endpoint: string;
}

const ConnectionContext = createContext<ConnectionContextState | null>(null);

export interface ConnectionProviderProps {
    endpoint: string;
    children: ReactNode;
}

export function ConnectionProvider({ endpoint, children }: ConnectionProviderProps) {
    const [connection] = useState(() => new Connection(endpoint, 'confirmed'));

    return (
        <ConnectionContext.Provider value={{ connection, endpoint }}>
            {children}
        </ConnectionContext.Provider>
    );
}

export function useConnection() {
    const context = useContext(ConnectionContext);
    if (!context) {
        throw new Error('useConnection must be used within ConnectionProvider');
    }
    return context;
}

// Wallet Context
interface WalletContextState {
    publicKey: PublicKey | null;
    connected: boolean;
    connecting: boolean;
    disconnecting: boolean;
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    signTransaction: (tx: Transaction) => Promise<Transaction>;
    signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}

const WalletContext = createContext<WalletContextState | null>(null);

export interface WalletProviderProps {
    children: ReactNode;
    appIdentity: {
        name: string;
        uri: string;
        icon: string;
    };
}

export function WalletProvider({ children, appIdentity }: WalletProviderProps) {
    const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);

    const connect = useCallback(async () => {
        setConnecting(true);
        try {
            await transact(async (wallet: Web3MobileWallet) => {
                const authResult = await wallet.authorize({
                    cluster: 'mainnet-beta',
                    identity: appIdentity,
                });

                const pubkey = new PublicKey(authResult.accounts[0].publicKey);
                setPublicKey(pubkey);
            });
        } catch (error) {
            console.error('Failed to connect wallet:', error);
            throw error;
        } finally {
            setConnecting(false);
        }
    }, [appIdentity]);

    const disconnect = useCallback(async () => {
        setDisconnecting(true);
        try {
            await transact(async (wallet: Web3MobileWallet) => {
                await wallet.deauthorize({
                    auth_token: '', // Would need to store auth token
                });
            });
            setPublicKey(null);
        } catch (error) {
            console.error('Failed to disconnect wallet:', error);
        } finally {
            setDisconnecting(false);
        }
    }, []);

    const signTransaction = useCallback(async (tx: Transaction): Promise<Transaction> => {
        if (!publicKey) throw new Error('Wallet not connected');

        return await transact(async (wallet: Web3MobileWallet) => {
            const authResult = await wallet.authorize({
                cluster: 'mainnet-beta',
                identity: appIdentity,
            });

            const signedTxs = await wallet.signTransactions({
                transactions: [tx.serialize({ requireAllSignatures: false })],
            });

            return Transaction.from(signedTxs[0]);
        });
    }, [publicKey, appIdentity]);

    const signAllTransactions = useCallback(async (txs: Transaction[]): Promise<Transaction[]> => {
        if (!publicKey) throw new Error('Wallet not connected');

        return await transact(async (wallet: Web3MobileWallet) => {
            const authResult = await wallet.authorize({
                cluster: 'mainnet-beta',
                identity: appIdentity,
            });

            const serializedTxs = txs.map(tx =>
                tx.serialize({ requireAllSignatures: false })
            );

            const signedTxs = await wallet.signTransactions({
                transactions: serializedTxs,
            });

            return signedTxs.map(tx => Transaction.from(tx));
        });
    }, [publicKey, appIdentity]);

    const signMessage = useCallback(async (message: Uint8Array): Promise<Uint8Array> => {
        if (!publicKey) throw new Error('Wallet not connected');

        return await transact(async (wallet: Web3MobileWallet) => {
            const authResult = await wallet.authorize({
                cluster: 'mainnet-beta',
                identity: appIdentity,
            });

            const signedMessages = await wallet.signMessages({
                addresses: [publicKey.toBytes()],
                payloads: [message],
            });

            return signedMessages[0];
        });
    }, [publicKey, appIdentity]);

    const value: WalletContextState = {
        publicKey,
        connected: !!publicKey,
        connecting,
        disconnecting,
        connect,
        disconnect,
        signTransaction,
        signAllTransactions,
        signMessage,
    };

    return (
        <WalletContext.Provider value={value}>
            {children}
        </WalletContext.Provider>
    );
}

export function useWallet() {
    const context = useContext(WalletContext);
    if (!context) {
        throw new Error('useWallet must be used within WalletProvider');
    }
    return context;
}
