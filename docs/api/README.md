# API Reference

> **SDK and instruction reference documentation for GridTokenX platform**

This section contains comprehensive API reference documentation for integrating with the GridTokenX platform.

---

## SDK Documentation

The TypeScript SDK provides a convenient interface for interacting with GridTokenX programs.

### Installation

```bash
npm install @gridtokenx/sdk
# or
pnpm add @gridtokenx/sdk
```

### Quick Start

```typescript
import { GridTokenXClient } from "@gridtokenx/sdk";
import { Connection, Keypair } from "@solana/web3.js";

// Initialize client
const connection = new Connection("https://api.devnet.solana.com");
const wallet = Keypair.generate();
const client = new GridTokenXClient(connection, wallet);

// Register a user
await client.registry.registerUser({
  userType: 'prosumer',
  name: 'Solar Producer',
  location: 'Bangkok, Thailand'
});

// Check token balance
const balance = await client.energyToken.getBalance(wallet.publicKey);
```

### SDK Modules

| Module | Description | Documentation |
|--------|-------------|---------------|
| **Overview** | Installation & initialization | [README](./sdk/README.md) |
| **Registry** | User and meter registration | [registry.md](./sdk/registry.md) |
| **Oracle** | Price feeds & validation | [oracle.md](./sdk/oracle.md) |
| **Energy Token** | GRID token operations | [energy-token.md](./sdk/energy-token.md) |
| **Trading** | P2P marketplace | [trading.md](./sdk/trading.md) |
| **Governance** | Proposals & voting | [governance.md](./sdk/governance.md) |

---

## Instruction Reference

Direct program instruction documentation for advanced integrations and raw transaction building.

| Program | Description | Documentation |
|---------|-------------|---------------|
| **Overview** | Common patterns & PDAs | [README](./instructions/README.md) |
| **Registry** | `register_user`, `register_meter` | [registry.md](./instructions/registry.md) |
| **Oracle** | `update_price_feed`, `validate_meter_reading` | [oracle.md](./instructions/oracle.md) |
| **Energy Token** | `mint_tokens`, `burn_tokens`, `transfer` | [energy-token.md](./instructions/energy-token.md) |
| **Trading** | `create_order`, `match_order`, `cancel_order` | [trading.md](./instructions/trading.md) |
| **Governance** | `create_proposal`, `vote`, `execute_proposal` | [governance.md](./instructions/governance.md) |

---

## Program IDs

| Program | Program ID |
|---------|------------|
| Registry | `2XPQmRp1wz9ZdVxGLdgBEJjKL7gaV7g7ScvhzSGBV2ek` |
| Oracle | `DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE` |
| Energy Token | `94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur` |
| Trading | `GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk` |
| Governance | `4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe` |

---

## IDL Files

Interface Definition Language (IDL) files are available for all programs:

```
target/idl/
├── registry.json
├── oracle.json
├── energy_token.json
├── trading.json
└── governance.json
```

### Using IDL with Anchor

```typescript
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Registry } from "../target/types/registry";
import registryIdl from "../target/idl/registry.json";

const program = new Program<Registry>(
  registryIdl,
  programId,
  provider
);
```

---

## Error Codes

Each program defines specific error codes. See individual program documentation for complete error references.

| Range | Program |
|-------|---------|
| 6000-6099 | Registry |
| 6100-6199 | Oracle |
| 6200-6299 | Energy Token |
| 6300-6399 | Trading |
| 6400-6499 | Governance |

---

## Related Documentation

- **Technical**: [System Architecture](../technical/architecture/system-overview.md) | [P2P Trading](../technical/architecture/p2p-trading.md)
- **Guides**: [Getting Started](../guides/getting-started.md) | [Testing](../guides/testing.md) | [Performance](../guides/performance-testing.md)
- **Academic**: [System Design](../academic/03-system-architecture.md) | [Token Economics](../academic/05-token-economics.md)

---

*For framework-specific documentation, see [Anchor Reference](../anchor/)*
