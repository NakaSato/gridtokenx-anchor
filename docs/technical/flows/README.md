# Process Flows

> **End-to-end process documentation for GridTokenX operations**

---

## Overview

This section documents the complete data flows and process sequences in the GridTokenX platform.

---

## Flows

### [Smart Meter to Settlement](./smart-meter-to-settlement.md)
Complete flow from energy production to trade settlement.

```
Smart Meter → Oracle Validation → Token Minting → Order Creation → Trade Match → Settlement
```

**Covers:**
- Meter reading submission
- Oracle validation
- Token minting
- Order placement
- Trade execution
- Final settlement

### [Token Minting Flow](./token-minting-flow.md)
Energy production to GRID token conversion.

```
Production Reading → Validation → Mint Calculation → Token Issuance
```

**Covers:**
- Reading verification
- Anomaly detection
- 1:1 kWh to GRID conversion
- Token distribution

---

## Flow Diagrams

### High-Level Trading Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Prosumer   │     │   Oracle    │     │  Consumer   │
│  (Seller)   │     │  (Validator)│     │   (Buyer)   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │ 1. Submit Reading │                   │
       │──────────────────▶│                   │
       │                   │                   │
       │ 2. Validation OK  │                   │
       │◀──────────────────│                   │
       │                   │                   │
       │ 3. Mint GRID      │                   │
       │───────────────────┼──────────────────▶│
       │                   │                   │
       │ 4. Create Order   │                   │
       │───────────────────┼──────────────────▶│
       │                   │                   │
       │                   │ 5. Match Order    │
       │◀──────────────────┼───────────────────│
       │                   │                   │
       │ 6. Settlement     │                   │
       │◀──────────────────┼──────────────────▶│
       │                   │                   │
```

---

## Key Metrics

| Flow | Avg. Latency | Max TPS |
|------|--------------|---------|
| Meter Reading | ~400ms | 1000+ |
| Token Minting | ~500ms | 500+ |
| Order Creation | ~400ms | 1000+ |
| Trade Match | ~600ms | 500+ |

---

## Related

- [Architecture](../architecture/) - System design
- [Programs](../programs/) - Program details
- [API Reference](../../api/) - SDK documentation
