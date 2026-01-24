/**
 * GraphQL Server for GridTokenX Indexer
 */

import { createSchema, createYoga } from 'graphql-yoga';
import { DatabaseClient } from '../database/client';

export function createGraphQLServer(db: DatabaseClient) {
    const schema = createSchema({
        typeDefs: /* GraphQL */ `
      type Query {
        # Users
        users(type: String, status: String, limit: Int, offset: Int): [User!]!
        user(pubkey: String!): User
        
        # Meters
        meters(userPubkey: String, type: String, status: String, limit: Int): [Meter!]!
        meter(pubkey: String!): Meter
        meterReadings(meterPubkey: String!, from: String, to: String, limit: Int): [MeterReading!]!
        
        # Orders
        orders(type: String, status: String, owner: String, limit: Int): [Order!]!
        order(pubkey: String!): Order
        orderBook: OrderBook!
        
        # Trades
        trades(buyer: String, seller: String, limit: Int): [Trade!]!
        tradeStats(period: String): TradeStats!
        
        # Certificates
        certificates(owner: String, status: String, source: String, limit: Int): [ErcCertificate!]!
        certificate(pubkey: String!): ErcCertificate
        
        # Market
        marketSnapshot: MarketSnapshot
        marketHistory(interval: String, limit: Int): [MarketSnapshot!]!
        
        # Transfers
        tokenTransfers(address: String, type: String, limit: Int): [TokenTransfer!]!
      }

      type User {
        pubkey: String!
        userType: String!
        status: String!
        latitude: Float
        longitude: Float
        totalEnergyProduced: Float
        totalEnergyConsumed: Float
        createdAt: String!
        updatedAt: String!
        meters: [Meter!]!
      }

      type Meter {
        pubkey: String!
        userPubkey: String!
        meterId: String!
        meterType: String!
        status: String!
        totalGenerated: Float!
        totalConsumed: Float!
        settledNetGeneration: Float!
        lastReadingAt: String
        createdAt: String!
        owner: User
      }

      type MeterReading {
        id: Int!
        meterPubkey: String!
        energyGenerated: Float!
        energyConsumed: Float!
        netEnergy: Float!
        readingTimestamp: String!
      }

      type Order {
        pubkey: String!
        ownerPubkey: String!
        orderType: String!
        energyAmount: Float!
        pricePerKwh: Float!
        filledAmount: Float!
        remainingAmount: Float!
        status: String!
        createdAt: String!
        expiresAt: String
        owner: User
      }

      type OrderBook {
        bids: [OrderBookLevel!]!
        asks: [OrderBookLevel!]!
        spread: Float
      }

      type OrderBookLevel {
        price: Float!
        totalVolume: Float!
        orderCount: Int!
      }

      type Trade {
        id: Int!
        buyOrderPubkey: String!
        sellOrderPubkey: String!
        buyerPubkey: String!
        sellerPubkey: String!
        energyAmount: Float!
        pricePerKwh: Float!
        totalPrice: Float!
        wheelingCharge: Float!
        marketFee: Float!
        executedAt: String!
        signature: String!
        buyer: User
        seller: User
      }

      type TradeStats {
        period: String!
        totalTrades: Int!
        totalVolume: Float!
        totalValue: Float!
        avgPrice: Float
        minPrice: Float
        maxPrice: Float
      }

      type ErcCertificate {
        pubkey: String!
        certificateId: String!
        ownerPubkey: String!
        energyAmount: Float!
        renewableSource: String!
        status: String!
        issuedAt: String!
        expiresAt: String
        validationData: String
        owner: User
      }

      type MarketSnapshot {
        id: Int!
        timestamp: String!
        bestBidPrice: Float
        bestAskPrice: Float
        bidVolume: Float!
        askVolume: Float!
        lastTradePrice: Float
        volume24h: Float!
        tradeCount24h: Int!
        vwap24h: Float
      }

      type TokenTransfer {
        id: Int!
        fromPubkey: String!
        toPubkey: String!
        amount: Float!
        transferType: String!
        executedAt: String!
        signature: String!
      }
    `,
        resolvers: {
            Query: {
                users: async (_, { type, status, limit = 100, offset = 0 }) => {
                    let query = 'SELECT * FROM users WHERE 1=1';
                    const params: any[] = [];
                    let paramIndex = 1;

                    if (type) {
                        query += ` AND user_type = $${paramIndex++}`;
                        params.push(type);
                    }
                    if (status) {
                        query += ` AND status = $${paramIndex++}`;
                        params.push(status);
                    }

                    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
                    params.push(limit, offset);

                    return db.query(query, params);
                },

                user: async (_, { pubkey }) => {
                    const [user] = await db.query('SELECT * FROM users WHERE pubkey = $1', [pubkey]);
                    return user || null;
                },

                meters: async (_, { userPubkey, type, status, limit = 100 }) => {
                    let query = 'SELECT * FROM meters WHERE 1=1';
                    const params: any[] = [];
                    let paramIndex = 1;

                    if (userPubkey) {
                        query += ` AND user_pubkey = $${paramIndex++}`;
                        params.push(userPubkey);
                    }
                    if (type) {
                        query += ` AND meter_type = $${paramIndex++}`;
                        params.push(type);
                    }
                    if (status) {
                        query += ` AND status = $${paramIndex++}`;
                        params.push(status);
                    }

                    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
                    params.push(limit);

                    return db.query(query, params);
                },

                orders: async (_, { type, status, owner, limit = 100 }) => {
                    let query = 'SELECT * FROM orders WHERE 1=1';
                    const params: any[] = [];
                    let paramIndex = 1;

                    if (type) {
                        query += ` AND order_type = $${paramIndex++}`;
                        params.push(type);
                    }
                    if (status) {
                        query += ` AND status = $${paramIndex++}`;
                        params.push(status);
                    }
                    if (owner) {
                        query += ` AND owner_pubkey = $${paramIndex++}`;
                        params.push(owner);
                    }

                    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
                    params.push(limit);

                    return db.query(query, params);
                },

                orderBook: async () => {
                    const orderBook = await db.query(`
            SELECT 
              order_type,
              price_per_kwh as price,
              SUM(remaining_amount) as total_volume,
              COUNT(*) as order_count
            FROM orders
            WHERE status IN ('open', 'partial')
            GROUP BY order_type, price_per_kwh
            ORDER BY order_type, price_per_kwh
          `);

                    const bids = orderBook.filter((o: any) => o.order_type === 'buy').reverse();
                    const asks = orderBook.filter((o: any) => o.order_type === 'sell');

                    return {
                        bids: bids.map((b: any) => ({
                            price: Number(b.price),
                            totalVolume: Number(b.total_volume),
                            orderCount: Number(b.order_count),
                        })),
                        asks: asks.map((a: any) => ({
                            price: Number(a.price),
                            totalVolume: Number(a.total_volume),
                            orderCount: Number(a.order_count),
                        })),
                        spread: asks[0] && bids[0] ? Number(asks[0].price) - Number(bids[0].price) : null,
                    };
                },

                trades: async (_, { buyer, seller, limit = 100 }) => {
                    let query = 'SELECT * FROM trades WHERE 1=1';
                    const params: any[] = [];
                    let paramIndex = 1;

                    if (buyer) {
                        query += ` AND buyer_pubkey = $${paramIndex++}`;
                        params.push(buyer);
                    }
                    if (seller) {
                        query += ` AND seller_pubkey = $${paramIndex++}`;
                        params.push(seller);
                    }

                    query += ` ORDER BY executed_at DESC LIMIT $${paramIndex}`;
                    params.push(limit);

                    return db.query(query, params);
                },

                tradeStats: async (_, { period = '24h' }) => {
                    const interval = period === '7d' ? '7 days' : '24 hours';
                    const [stats] = await db.query(`
            SELECT 
              COUNT(*) as total_trades,
              COALESCE(SUM(energy_amount), 0) as total_volume,
              COALESCE(SUM(total_price), 0) as total_value,
              AVG(price_per_kwh) as avg_price,
              MIN(price_per_kwh) as min_price,
              MAX(price_per_kwh) as max_price
            FROM trades
            WHERE executed_at > NOW() - INTERVAL '${interval}'
          `);

                    return {
                        period,
                        totalTrades: Number(stats?.total_trades || 0),
                        totalVolume: Number(stats?.total_volume || 0),
                        totalValue: Number(stats?.total_value || 0),
                        avgPrice: stats?.avg_price ? Number(stats.avg_price) : null,
                        minPrice: stats?.min_price ? Number(stats.min_price) : null,
                        maxPrice: stats?.max_price ? Number(stats.max_price) : null,
                    };
                },

                certificates: async (_, { owner, status, source, limit = 100 }) => {
                    let query = 'SELECT * FROM erc_certificates WHERE 1=1';
                    const params: any[] = [];
                    let paramIndex = 1;

                    if (owner) {
                        query += ` AND owner_pubkey = $${paramIndex++}`;
                        params.push(owner);
                    }
                    if (status) {
                        query += ` AND status = $${paramIndex++}`;
                        params.push(status);
                    }
                    if (source) {
                        query += ` AND renewable_source = $${paramIndex++}`;
                        params.push(source);
                    }

                    query += ` ORDER BY issued_at DESC LIMIT $${paramIndex}`;
                    params.push(limit);

                    return db.query(query, params);
                },

                marketSnapshot: async () => {
                    const [snapshot] = await db.query(
                        'SELECT * FROM market_snapshots ORDER BY timestamp DESC LIMIT 1'
                    );
                    return snapshot || null;
                },

                marketHistory: async (_, { limit = 24 }) => {
                    return db.query(
                        'SELECT * FROM market_snapshots ORDER BY timestamp DESC LIMIT $1',
                        [limit]
                    );
                },

                tokenTransfers: async (_, { address, type, limit = 100 }) => {
                    let query = 'SELECT * FROM token_transfers WHERE 1=1';
                    const params: any[] = [];
                    let paramIndex = 1;

                    if (address) {
                        query += ` AND (from_pubkey = $${paramIndex} OR to_pubkey = $${paramIndex})`;
                        params.push(address);
                        paramIndex++;
                    }
                    if (type) {
                        query += ` AND transfer_type = $${paramIndex++}`;
                        params.push(type);
                    }

                    query += ` ORDER BY executed_at DESC LIMIT $${paramIndex}`;
                    params.push(limit);

                    return db.query(query, params);
                },
            },

            // Field resolvers for relationships
            User: {
                userType: (user: any) => user.user_type,
                createdAt: (user: any) => user.created_at,
                updatedAt: (user: any) => user.updated_at,
                totalEnergyProduced: (user: any) => user.total_energy_produced,
                totalEnergyConsumed: (user: any) => user.total_energy_consumed,
                meters: async (user: any) => {
                    return db.query('SELECT * FROM meters WHERE user_pubkey = $1', [user.pubkey]);
                },
            },

            Meter: {
                userPubkey: (m: any) => m.user_pubkey,
                meterId: (m: any) => m.meter_id,
                meterType: (m: any) => m.meter_type,
                totalGenerated: (m: any) => m.total_generated,
                totalConsumed: (m: any) => m.total_consumed,
                settledNetGeneration: (m: any) => m.settled_net_generation,
                lastReadingAt: (m: any) => m.last_reading_at,
                createdAt: (m: any) => m.created_at,
                owner: async (m: any) => {
                    const [user] = await db.query('SELECT * FROM users WHERE pubkey = $1', [m.user_pubkey]);
                    return user || null;
                },
            },

            Order: {
                ownerPubkey: (o: any) => o.owner_pubkey,
                orderType: (o: any) => o.order_type,
                energyAmount: (o: any) => o.energy_amount,
                pricePerKwh: (o: any) => o.price_per_kwh,
                filledAmount: (o: any) => o.filled_amount,
                remainingAmount: (o: any) => o.remaining_amount,
                createdAt: (o: any) => o.created_at,
                expiresAt: (o: any) => o.expires_at,
            },

            Trade: {
                buyOrderPubkey: (t: any) => t.buy_order_pubkey,
                sellOrderPubkey: (t: any) => t.sell_order_pubkey,
                buyerPubkey: (t: any) => t.buyer_pubkey,
                sellerPubkey: (t: any) => t.seller_pubkey,
                energyAmount: (t: any) => t.energy_amount,
                pricePerKwh: (t: any) => t.price_per_kwh,
                totalPrice: (t: any) => t.total_price,
                wheelingCharge: (t: any) => t.wheeling_charge,
                marketFee: (t: any) => t.market_fee,
                executedAt: (t: any) => t.executed_at,
            },

            ErcCertificate: {
                certificateId: (c: any) => c.certificate_id,
                ownerPubkey: (c: any) => c.owner_pubkey,
                energyAmount: (c: any) => c.energy_amount,
                renewableSource: (c: any) => c.renewable_source,
                issuedAt: (c: any) => c.issued_at,
                expiresAt: (c: any) => c.expires_at,
                validationData: (c: any) => c.validation_data,
            },

            MarketSnapshot: {
                bestBidPrice: (s: any) => s.best_bid_price,
                bestAskPrice: (s: any) => s.best_ask_price,
                bidVolume: (s: any) => s.bid_volume,
                askVolume: (s: any) => s.ask_volume,
                lastTradePrice: (s: any) => s.last_trade_price,
                volume24h: (s: any) => s.volume_24h,
                tradeCount24h: (s: any) => s.trade_count_24h,
                vwap24h: (s: any) => s.vwap_24h,
            },

            TokenTransfer: {
                fromPubkey: (t: any) => t.from_pubkey,
                toPubkey: (t: any) => t.to_pubkey,
                transferType: (t: any) => t.transfer_type,
                executedAt: (t: any) => t.executed_at,
            },
        },
    });

    return createYoga({
        schema,
        graphiql: true,
        landingPage: false,
    });
}
