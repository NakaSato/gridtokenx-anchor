# Program Documentation

> **Individual Solana program implementation details**

---

## Programs Overview

GridTokenX consists of 5 Anchor programs that work together to enable P2P energy trading.

| Program | Description | Program ID |
|---------|-------------|------------|
| [Registry](./registry.md) | User/meter registration | `2XPQm...V2ek` |
| [Oracle](./oracle.md) | Price feeds & validation | `DvdtU...qAoE` |
| [Energy Token](./energy-token.md) | GRID token operations | `94G1r...yEur` |
| [Trading](./trading.md) | P2P marketplace | `GZnqN...sctk` |
| [Governance](./governance.md) | Proposals & voting | `4DY97...SvXe` |

---

## Program Interactions

```
                 ┌──────────────┐
                 │   Registry   │
                 │  (Users &    │
                 │   Meters)    │
                 └──────┬───────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
         ▼              ▼              ▼
  ┌──────────┐   ┌──────────┐   ┌──────────┐
  │  Oracle  │   │  Energy  │   │ Trading  │
  │  (Price  │──▶│  Token   │◀──│  (P2P    │
  │   Feed)  │   │  (GRID)  │   │  Market) │
  └──────────┘   └──────────┘   └──────────┘
         │              │              │
         └──────────────┼──────────────┘
                        │
                 ┌──────▼───────┐
                 │  Governance  │
                 │  (PoA/ERC)   │
                 └──────────────┘
```

---

## Common Patterns

### PDA Derivation
All programs use PDAs for state management:
```rust
#[account(
    seeds = [b"account_type", identifier.as_bytes()],
    bump
)]
pub account: Account<'info, AccountType>,
```

### Access Control
Owner/authority validation:
```rust
require!(ctx.accounts.authority.key() == state.authority, ErrorCode::Unauthorized);
```

### Event Emission
All state changes emit events:
```rust
emit!(EventName {
    field1: value1,
    timestamp: Clock::get()?.unix_timestamp,
});
```

---

## Related

- [Architecture](../architecture/) - System design
- [Flows](../flows/) - Process documentation
- [API Instructions](../../api/instructions/) - Instruction reference
