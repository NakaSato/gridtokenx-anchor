/**
 * GridTokenX Stablecoin & Bridge Client
 * 
 * TypeScript client for Phase 2 payment features:
 * - USDC/USDT stablecoin payments
 * - Wormhole cross-chain bridge transfers
 */

import { Connection, PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, BN, Wallet } from '@coral-xyz/anchor';
import {
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';

// Trading program ID
const TRADING_PROGRAM_ID = new PublicKey('CrfC5coUm2ty6DphLBFhAmr8m1AMutf8KTW2JYS38Z5J');

// Known stablecoin mints
export const STABLECOIN_MINTS = {
    USDC_MAINNET: new PublicKey('EPjFWdd5AufqSSqZEM6d1Hetq9ePVNJ4LNM2UCVd7pHj'),
    USDC_DEVNET: new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'),
    USDT_MAINNET: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
};

// Wormhole program addresses
export const WORMHOLE = {
    CORE_BRIDGE_MAINNET: new PublicKey('worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth'),
    TOKEN_BRIDGE_MAINNET: new PublicKey('wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWvKtSmj1t7N'),
    CORE_BRIDGE_DEVNET: new PublicKey('3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5'),
    TOKEN_BRIDGE_DEVNET: new PublicKey('DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe'),
};

// Supported chains
export enum WormholeChain {
    Solana = 1,
    Ethereum = 2,
    BinanceSmartChain = 4,
    Polygon = 5,
    Avalanche = 6,
    Arbitrum = 23,
    Optimism = 24,
    Base = 30,
}

// Payment token types
export enum PaymentToken {
    Grid = 0,
    Usdc = 1,
    Usdt = 2,
    WormholeWrapped = 3,
}

export interface TokenConfig {
    market: PublicKey;
    tokenType: PaymentToken;
    mint: PublicKey;
    decimals: number;
    enabled: boolean;
    minOrderSize: BN;
    lastPrice: BN;
    lastPriceUpdate: BN;
    maxPriceDeviationBps: number;
}

export interface BridgeConfig {
    market: PublicKey;
    wormholeProgram: PublicKey;
    tokenBridgeProgram: PublicKey;
    authority: PublicKey;
    enabled: boolean;
    minBridgeAmount: BN;
    bridgeFeeBps: number;
    relayerFee: BN;
    supportedChains: number;
    totalBridgedOut: BN;
    totalBridgedIn: BN;
    bridgeCount: BN;
}

export interface BridgeTransfer {
    user: PublicKey;
    sourceMint: PublicKey;
    destinationChain: WormholeChain;
    destinationAddress: Uint8Array;
    amount: BN;
    fee: BN;
    status: number;
    sequence: BN;
    initiatedAt: BN;
    completedAt: BN;
}

/**
 * Client for stablecoin and cross-chain operations
 */
export class PaymentClient {
    private connection: Connection;
    private program: Program;
    private provider: AnchorProvider;

    constructor(connection: Connection, wallet: Wallet) {
        this.connection = connection;
        this.provider = new AnchorProvider(connection, wallet, {});
        this.program = null as any; // Would be initialized with IDL
    }

    // ============================================
    // PDA Derivation Functions
    // ============================================

    getMarketPda(): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('market')],
            TRADING_PROGRAM_ID
        );
    }

    getTokenConfigPda(market: PublicKey, tokenType: PaymentToken): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('token_config'), market.toBuffer(), Buffer.from([tokenType])],
            TRADING_PROGRAM_ID
        );
    }

    getBridgeConfigPda(market: PublicKey): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('bridge_config'), market.toBuffer()],
            TRADING_PROGRAM_ID
        );
    }

    getPaymentInfoPda(order: PublicKey): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('payment_info'), order.toBuffer()],
            TRADING_PROGRAM_ID
        );
    }

    getBridgeTransferPda(user: PublicKey, timestamp: number): [PublicKey, number] {
        const timestampBuffer = Buffer.alloc(8);
        timestampBuffer.writeBigInt64LE(BigInt(timestamp));

        return PublicKey.findProgramAddressSync(
            [Buffer.from('bridge_transfer'), user.toBuffer(), timestampBuffer],
            TRADING_PROGRAM_ID
        );
    }

    // ============================================
    // Stablecoin Payment Functions
    // ============================================

    /**
     * Configure a stablecoin for use in the market
     */
    async configurePaymentToken(
        market: PublicKey,
        tokenMint: PublicKey,
        tokenType: PaymentToken,
        minOrderSize: BN,
        maxPriceDeviationBps: number,
        authority: Keypair
    ): Promise<string> {
        const [tokenConfigPda] = this.getTokenConfigPda(market, tokenType);

        const tx = await this.program.methods
            .configurePaymentToken(tokenType, minOrderSize, maxPriceDeviationBps)
            .accounts({
                market,
                tokenConfig: tokenConfigPda,
                tokenMint,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([authority])
            .rpc();

        return tx;
    }

    /**
     * Create a sell order with stablecoin payment option
     */
    async createStablecoinSellOrder(
        market: PublicKey,
        energyAmount: BN,
        pricePerKwh: BN,
        paymentToken: PaymentToken,
        seller: Keypair
    ): Promise<{ signature: string; orderPda: PublicKey }> {
        const [marketData] = this.getMarketPda();
        const [tokenConfigPda] = this.getTokenConfigPda(market, paymentToken);

        // Calculate order PDA (would need active_orders count from market)
        const orderCount = 0; // Would fetch from market account
        const orderCountBuffer = Buffer.alloc(8);
        orderCountBuffer.writeBigInt64LE(BigInt(orderCount));

        const [orderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('order'), seller.publicKey.toBuffer(), orderCountBuffer],
            TRADING_PROGRAM_ID
        );

        const [paymentInfoPda] = this.getPaymentInfoPda(orderPda);

        const tx = await this.program.methods
            .createStablecoinSellOrder(energyAmount, pricePerKwh, paymentToken)
            .accounts({
                market,
                order: orderPda,
                paymentInfo: paymentInfoPda,
                tokenConfig: tokenConfigPda,
                authority: seller.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([seller])
            .rpc();

        return { signature: tx, orderPda };
    }

    /**
     * Execute settlement with stablecoin payment
     */
    async executeStablecoinSettlement(
        market: PublicKey,
        buyOrder: PublicKey,
        sellOrder: PublicKey,
        stablecoinMint: PublicKey,
        energyMint: PublicKey,
        amount: BN,
        exchangeRate: BN,
        escrowAuthority: Keypair
    ): Promise<string> {
        const [buyPaymentInfo] = this.getPaymentInfoPda(buyOrder);
        const [sellPaymentInfo] = this.getPaymentInfoPda(sellOrder);

        // Would need to fetch/derive token accounts
        const buyerStablecoin = await getAssociatedTokenAddress(
            stablecoinMint,
            escrowAuthority.publicKey // Would be buyer's pubkey
        );

        const sellerStablecoin = await getAssociatedTokenAddress(
            stablecoinMint,
            escrowAuthority.publicKey // Would be seller's pubkey
        );

        const buyerEnergy = await getAssociatedTokenAddress(
            energyMint,
            escrowAuthority.publicKey
        );

        const sellerEnergy = await getAssociatedTokenAddress(
            energyMint,
            escrowAuthority.publicKey
        );

        const feeCollector = await getAssociatedTokenAddress(
            stablecoinMint,
            escrowAuthority.publicKey // Would be fee collector address
        );

        const tx = await this.program.methods
            .executeStablecoinSettlement(amount, exchangeRate)
            .accounts({
                market,
                buyOrder,
                sellOrder,
                buyPaymentInfo,
                sellPaymentInfo,
                stablecoinMint,
                energyMint,
                buyerStablecoin,
                sellerStablecoin,
                buyerEnergy,
                sellerEnergy,
                feeCollector,
                escrowAuthority: escrowAuthority.publicKey,
                authority: escrowAuthority.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
                energyTokenProgram: TOKEN_2022_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([escrowAuthority])
            .rpc();

        return tx;
    }

    // ============================================
    // Cross-Chain Bridge Functions
    // ============================================

    /**
     * Initialize the Wormhole bridge
     */
    async initializeBridge(
        market: PublicKey,
        minBridgeAmount: BN,
        bridgeFeeBps: number,
        relayerFee: BN,
        authority: Keypair,
        isDevnet: boolean = false
    ): Promise<string> {
        const [bridgeConfigPda] = this.getBridgeConfigPda(market);

        const wormholeProgram = isDevnet
            ? WORMHOLE.CORE_BRIDGE_DEVNET
            : WORMHOLE.CORE_BRIDGE_MAINNET;

        const tokenBridgeProgram = isDevnet
            ? WORMHOLE.TOKEN_BRIDGE_DEVNET
            : WORMHOLE.TOKEN_BRIDGE_MAINNET;

        const tx = await this.program.methods
            .initializeBridge(minBridgeAmount, bridgeFeeBps, relayerFee)
            .accounts({
                market,
                bridgeConfig: bridgeConfigPda,
                wormholeProgram,
                tokenBridgeProgram,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([authority])
            .rpc();

        return tx;
    }

    /**
     * Initiate a cross-chain transfer
     */
    async initiateBridgeTransfer(
        market: PublicKey,
        tokenMint: PublicKey,
        destinationChain: WormholeChain,
        destinationAddress: Uint8Array,
        amount: BN,
        user: Keypair
    ): Promise<{ signature: string; transferPda: PublicKey }> {
        const [bridgeConfigPda] = this.getBridgeConfigPda(market);
        const timestamp = Math.floor(Date.now() / 1000);
        const [bridgeTransferPda] = this.getBridgeTransferPda(user.publicKey, timestamp);

        const userTokenAccount = await getAssociatedTokenAddress(
            tokenMint,
            user.publicKey
        );

        // Bridge escrow would be a PDA
        const [bridgeEscrow] = PublicKey.findProgramAddressSync(
            [Buffer.from('bridge_escrow'), tokenMint.toBuffer()],
            TRADING_PROGRAM_ID
        );

        const tx = await this.program.methods
            .initiateBridgeTransfer(destinationChain, Array.from(destinationAddress), amount)
            .accounts({
                bridgeConfig: bridgeConfigPda,
                bridgeTransfer: bridgeTransferPda,
                tokenMint,
                userTokenAccount,
                bridgeEscrow,
                user: user.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([user])
            .rpc();

        return { signature: tx, transferPda: bridgeTransferPda };
    }

    // ============================================
    // Utility Functions
    // ============================================

    /**
     * Convert an Ethereum address to 32-byte format
     */
    normalizeEthAddress(ethAddress: string): Uint8Array {
        const cleanAddress = ethAddress.startsWith('0x')
            ? ethAddress.slice(2)
            : ethAddress;

        const addressBytes = Buffer.from(cleanAddress, 'hex');
        const normalized = new Uint8Array(32);
        normalized.set(addressBytes, 12);

        return normalized;
    }

    /**
     * Get supported chains from bridge config bitmap
     */
    getSupportedChains(supportedChainsBitmap: number): WormholeChain[] {
        const chains: WormholeChain[] = [];

        const allChains = [
            WormholeChain.Ethereum,
            WormholeChain.Polygon,
            WormholeChain.Arbitrum,
            WormholeChain.Base,
            WormholeChain.Avalanche,
            WormholeChain.BinanceSmartChain,
            WormholeChain.Optimism,
        ];

        for (const chain of allChains) {
            if (supportedChainsBitmap & (1 << chain)) {
                chains.push(chain);
            }
        }

        return chains;
    }

    /**
     * Calculate output amount for a token swap
     */
    calculateSwapOutput(inputAmount: BN, rate: BN, feeBps: number): BN {
        const grossOutput = inputAmount
            .mul(new BN(1_000_000_000))
            .div(rate);

        const fee = grossOutput.mul(new BN(feeBps)).div(new BN(10_000));

        return grossOutput.sub(fee);
    }

    /**
     * Calculate GRID equivalent for a stablecoin amount
     */
    toGridEquivalent(stablecoinAmount: BN, gridPriceUsd: BN): BN {
        if (gridPriceUsd.isZero()) {
            return new BN(0);
        }

        // GRID uses 9 decimals, stablecoins typically use 6
        return stablecoinAmount
            .mul(new BN(1_000_000_000))
            .div(gridPriceUsd);
    }
}

/**
 * Factory function to create a PaymentClient
 */
export function createPaymentClient(
    connection: Connection,
    wallet: Wallet
): PaymentClient {
    return new PaymentClient(connection, wallet);
}

// Export types
export type { TokenConfig, BridgeConfig, BridgeTransfer };
