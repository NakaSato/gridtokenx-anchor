# GridTokenX Indexer

**Multi-threaded** off-chain indexer for GridTokenX Anchor programs. Indexes blockchain events into PostgreSQL for efficient querying via REST API and GraphQL.

## Features

- **Multi-threaded processing** - Each program runs in its own Worker Thread
- **Real-time indexing** - Subscribes to Solana program logs
- **Historical backfill** - Processes missed transactions on startup
- **Auto-recovery** - Workers restart automatically on failure
- **PostgreSQL storage** - Efficient SQL queries and aggregations
- **Redis caching** - Deduplication and performance optimization
- **REST API** - Simple HTTP endpoints for all data
- **GraphQL API** - Flexible queries with relationships
- **Health monitoring** - Per-worker stats and health checks
- **Docker support** - Easy deployment with docker-compose
- **REST API** - Simple HTTP endpoints for all data
- **GraphQL API** - Flexible queries with relationships
- **Docker support** - Easy deployment with docker-compose

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm
- Docker & Docker Compose
- Running Solana validator (local or remote)

### Setup

1. **Install dependencies:**
   ```bash
   cd indexer
   pnpm install
   ```

2. **Start infrastructure:**
   ```bash
   docker-compose up -d postgres redis
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your Solana RPC URL
   ```

4. **Run migrations:**
   ```bash
   pnpm db:migrate
   ```

5. **Start the indexer:**
   ```bash
   pnpm dev
   ```

## API Endpoints

### REST API (http://localhost:4000/api)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/users` | GET | List users |
| `/api/users/:pubkey` | GET | Get user details |
| `/api/orders` | GET | List orders |
| `/api/orders/book` | GET | Get order book |
| `/api/trades` | GET | List trades |
| `/api/trades/stats` | GET | Trade statistics |
| `/api/meters` | GET | List meters |
| `/api/meters/:pubkey/readings` | GET | Get meter readings |
| `/api/certificates` | GET | List ERC certificates |
| `/api/market/snapshot` | GET | Current market state |
| `/api/transfers` | GET | Token transfers |

### GraphQL API (http://localhost:4000/graphql)

```graphql
# Example: Get order book with user details
query {
  orderBook {
    bids {
      price
      totalVolume
    }
    asks {
      price
      totalVolume
    }
    spread
  }
  tradeStats(period: "24h") {
    totalTrades
    totalVolume
    avgPrice
  }
}
```

## Architecture (Multi-threaded)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       GridTokenX Indexer (Multi-threaded)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         MAIN THREAD                                  │    │
│  │                                                                      │    │
│  │   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐          │    │
│  │   │  Express    │     │   Health    │     │   Worker    │          │    │
│  │   │  API Server │     │   Monitor   │     │   Manager   │          │    │
│  │   └─────────────┘     └─────────────┘     └─────────────┘          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│                         ┌────────────┴────────────┐                         │
│                         │    Worker Pool          │                         │
│                         │    (5 threads)          │                         │
│                         └────────────┬────────────┘                         │
│                                      │                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Worker 1 │  │ Worker 2 │  │ Worker 3 │  │ Worker 4 │  │ Worker 5 │      │
│  │ Registry │  │ Trading  │  │  Oracle  │  │Governance│  │  Token   │      │
│  │          │  │          │  │          │  │          │  │          │      │
│  │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │      │
│  │ │Solana│ │  │ │Solana│ │  │ │Solana│ │  │ │Solana│ │  │ │Solana│ │      │
│  │ │ WS   │ │  │ │ WS   │ │  │ │ WS   │ │  │ │ WS   │ │  │ │ WS   │ │      │
│  │ └──────┘ │  │ └──────┘ │  │ └──────┘ │  │ └──────┘ │  │ └──────┘ │      │
│  │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │      │
│  │ │ DB   │ │  │ │ DB   │ │  │ │ DB   │ │  │ │ DB   │ │  │ │ DB   │ │      │
│  │ │ Pool │ │  │ │ Pool │ │  │ │ Pool │ │  │ │ Pool │ │  │ │ Pool │ │      │
│  │ └──────┘ │  │ └──────┘ │  │ └──────┘ │  │ └──────┘ │  │ └──────┘ │      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
│                                      │                                       │
│                         ┌────────────┴────────────┐                         │
│                         ▼                         ▼                         │
│                  ┌─────────────┐          ┌─────────────┐                   │
│                  │ PostgreSQL  │          │    Redis    │                   │
│                  │  Database   │          │    Cache    │                   │
│                  └─────────────┘          └─────────────┘                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Benefits of Multi-threading

| Feature | Single-threaded | Multi-threaded |
|---------|-----------------|----------------|
| **CPU Utilization** | 1 core | All cores |
| **Transaction Processing** | Sequential | Parallel |
| **Failure Isolation** | Crashes all | Only affected worker |
| **Throughput** | ~100 TPS | ~500+ TPS |
| **Recovery** | Manual restart | Auto-restart workers |

## Event Handlers

| Handler | Program | Events Indexed |
|---------|---------|----------------|
| `RegistryHandler` | Registry | User registration, meter registration, readings |
| `TradingHandler` | Trading | Orders, matches, settlements |
| `OracleHandler` | Oracle | Meter readings, market clearing |
| `GovernanceHandler` | Governance | ERC certificates, authority changes |
| `EnergyTokenHandler` | Energy Token | Mints, burns, transfers |

## Database Schema

The indexer maintains the following tables:

- `users` - Registered users
- `meters` - Smart meters
- `meter_readings` - Historical readings
- `orders` - Trading orders
- `trades` - Executed trades
- `erc_certificates` - Renewable energy certificates
- `token_transfers` - Token transfer history
- `market_snapshots` - Market state snapshots
- `indexer_state` - Indexer progress tracking
- `indexer_errors` - Error logs

## Docker Deployment

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f indexer

# Stop services
docker-compose down

# With admin tools (Adminer, Redis Commander)
docker-compose --profile tools up -d
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SOLANA_RPC_URL` | `http://127.0.0.1:8899` | Solana RPC endpoint |
| `SOLANA_WS_URL` | `ws://127.0.0.1:8900` | Solana WebSocket endpoint |
| `DATABASE_URL` | - | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `API_PORT` | `4000` | API server port |
| `LOG_LEVEL` | `info` | Logging level |
| `COMMITMENT` | `confirmed` | Solana commitment level |

## Development

```bash
# Run in development mode with hot reload
pnpm dev

# Build for production
pnpm build

# Run production build
pnpm start

# Run tests
pnpm test

# Lint code
pnpm lint
```

## License

MIT
