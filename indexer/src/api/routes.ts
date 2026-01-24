/**
 * REST API Routes for GridTokenX Indexer
 */

import { Router } from 'express';
import { DatabaseClient } from '../database/client';

export function createRestRoutes(db: DatabaseClient): Router {
    const router = Router();

    // ============================================
    // User Routes
    // ============================================

    router.get('/users', async (req, res) => {
        try {
            const { type, status, limit = 100, offset = 0 } = req.query;

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
            params.push(Number(limit), Number(offset));

            const users = await db.query(query, params);
            res.json({ users, count: users.length });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch users' });
        }
    });

    router.get('/users/:pubkey', async (req, res) => {
        try {
            const user = await db.getUserByPubkey(req.params.pubkey);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            res.json(user);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch user' });
        }
    });

    router.get('/users/:pubkey/meters', async (req, res) => {
        try {
            const meters = await db.query(
                'SELECT * FROM meters WHERE user_pubkey = $1 ORDER BY created_at DESC',
                [req.params.pubkey]
            );
            res.json({ meters });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch meters' });
        }
    });

    // ============================================
    // Order Routes
    // ============================================

    router.get('/orders', async (req, res) => {
        try {
            const { type, status, owner, limit = 100 } = req.query;

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
            params.push(Number(limit));

            const orders = await db.query(query, params);
            res.json({ orders, count: orders.length });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch orders' });
        }
    });

    router.get('/orders/book', async (req, res) => {
        try {
            const orderBook = await db.query(`
        SELECT 
          order_type,
          price_per_kwh,
          SUM(remaining_amount) as total_volume,
          COUNT(*) as order_count
        FROM orders
        WHERE status IN ('open', 'partial')
        GROUP BY order_type, price_per_kwh
        ORDER BY order_type, price_per_kwh
      `);

            const bids = orderBook.filter((o: any) => o.order_type === 'buy').reverse();
            const asks = orderBook.filter((o: any) => o.order_type === 'sell');

            res.json({
                bids,
                asks,
                spread: asks[0] && bids[0]
                    ? Number(asks[0].price_per_kwh) - Number(bids[0].price_per_kwh)
                    : null,
            });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch order book' });
        }
    });

    router.get('/orders/:pubkey', async (req, res) => {
        try {
            const [order] = await db.query(
                'SELECT * FROM orders WHERE pubkey = $1',
                [req.params.pubkey]
            );
            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }
            res.json(order);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch order' });
        }
    });

    // ============================================
    // Trade Routes
    // ============================================

    router.get('/trades', async (req, res) => {
        try {
            const { buyer, seller, limit = 100 } = req.query;

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
            params.push(Number(limit));

            const trades = await db.query(query, params);
            res.json({ trades, count: trades.length });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch trades' });
        }
    });

    router.get('/trades/stats', async (req, res) => {
        try {
            const [stats] = await db.query(`
        SELECT 
          COUNT(*) as total_trades,
          SUM(energy_amount) as total_volume,
          SUM(total_price) as total_value,
          AVG(price_per_kwh) as avg_price,
          MIN(price_per_kwh) as min_price,
          MAX(price_per_kwh) as max_price
        FROM trades
        WHERE executed_at > NOW() - INTERVAL '24 hours'
      `);

            res.json({
                period: '24h',
                ...stats,
            });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch trade stats' });
        }
    });

    // ============================================
    // Meter Routes
    // ============================================

    router.get('/meters', async (req, res) => {
        try {
            const { type, status, limit = 100 } = req.query;

            let query = 'SELECT * FROM meters WHERE 1=1';
            const params: any[] = [];
            let paramIndex = 1;

            if (type) {
                query += ` AND meter_type = $${paramIndex++}`;
                params.push(type);
            }
            if (status) {
                query += ` AND status = $${paramIndex++}`;
                params.push(status);
            }

            query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
            params.push(Number(limit));

            const meters = await db.query(query, params);
            res.json({ meters, count: meters.length });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch meters' });
        }
    });

    router.get('/meters/:pubkey/readings', async (req, res) => {
        try {
            const { from, to, limit = 100 } = req.query;

            let query = 'SELECT * FROM meter_readings WHERE meter_pubkey = $1';
            const params: any[] = [req.params.pubkey];
            let paramIndex = 2;

            if (from) {
                query += ` AND reading_timestamp >= $${paramIndex++}`;
                params.push(from);
            }
            if (to) {
                query += ` AND reading_timestamp <= $${paramIndex++}`;
                params.push(to);
            }

            query += ` ORDER BY reading_timestamp DESC LIMIT $${paramIndex}`;
            params.push(Number(limit));

            const readings = await db.query(query, params);
            res.json({ readings, count: readings.length });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch readings' });
        }
    });

    // ============================================
    // ERC Certificate Routes
    // ============================================

    router.get('/certificates', async (req, res) => {
        try {
            const { owner, status, source, limit = 100 } = req.query;

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
            params.push(Number(limit));

            const certificates = await db.query(query, params);
            res.json({ certificates, count: certificates.length });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch certificates' });
        }
    });

    // ============================================
    // Market Routes
    // ============================================

    router.get('/market/snapshot', async (req, res) => {
        try {
            const [snapshot] = await db.query(
                'SELECT * FROM market_snapshots ORDER BY timestamp DESC LIMIT 1'
            );
            res.json(snapshot || {});
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch market snapshot' });
        }
    });

    router.get('/market/history', async (req, res) => {
        try {
            const { interval = '1h', limit = 24 } = req.query;

            const snapshots = await db.query(
                `SELECT * FROM market_snapshots 
         ORDER BY timestamp DESC 
         LIMIT $1`,
                [Number(limit)]
            );
            res.json({ snapshots });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch market history' });
        }
    });

    // ============================================
    // Token Transfer Routes
    // ============================================

    router.get('/transfers', async (req, res) => {
        try {
            const { address, type, limit = 100 } = req.query;

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
            params.push(Number(limit));

            const transfers = await db.query(query, params);
            res.json({ transfers, count: transfers.length });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch transfers' });
        }
    });

    return router;
}
