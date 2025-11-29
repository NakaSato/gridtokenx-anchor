# Deployment Guide

> **Deploy GridTokenX programs to Solana devnet or mainnet**

This guide covers deploying the GridTokenX smart contracts to Solana networks.

---

## Deployment Targets

| Network | Purpose | SOL Cost | URL |
|---------|---------|----------|-----|
| Localnet | Development | Free | localhost:8899 |
| Devnet | Testing | Free (airdrop) | api.devnet.solana.com |
| Mainnet | Production | Real SOL | api.mainnet-beta.solana.com |

---

## Pre-Deployment Checklist

- [ ] All tests passing
- [ ] Programs built successfully
- [ ] Wallet funded with sufficient SOL
- [ ] Program keypairs generated
- [ ] Environment configuration verified

---

## Devnet Deployment

### 1. Configure for Devnet

```bash
# Set Solana CLI to devnet
solana config set --url devnet

# Verify configuration
solana config get
```

### 2. Fund Your Wallet

```bash
# Request devnet SOL (max 2 SOL per request)
solana airdrop 2

# Check balance
solana balance
```

### 3. Update Anchor Configuration

Edit `Anchor.toml`:

```toml
[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"
```

### 4. Build Programs

```bash
anchor build
```

### 5. Deploy

```bash
# Deploy all programs
anchor deploy

# Deploy specific program
anchor deploy -p registry
```

### 6. Verify Deployment

```bash
# Check program accounts
solana program show <PROGRAM_ID>
```

---

## Mainnet Deployment

### Security Considerations

Before mainnet deployment:

1. **Audit**: Complete security audit
2. **Multi-sig**: Set up multi-signature authority
3. **Upgrade Authority**: Plan upgrade strategy
4. **Monitoring**: Set up alerting and monitoring
5. **Backup**: Secure keypair backups

### 1. Configure for Mainnet

```bash
solana config set --url mainnet-beta
```

### 2. Estimate Costs

```bash
# Check program size and rent
solana rent $(wc -c < target/deploy/registry.so)
```

Approximate costs (varies with program size):

| Program | Size | Rent (SOL) |
|---------|------|------------|
| Registry | ~200KB | ~1.4 SOL |
| Oracle | ~150KB | ~1.0 SOL |
| Energy Token | ~180KB | ~1.2 SOL |
| Trading | ~250KB | ~1.7 SOL |
| Governance | ~200KB | ~1.4 SOL |

### 3. Deploy with Upgrade Authority

```bash
# Deploy with specific upgrade authority
anchor deploy --program-keypair target/deploy/registry-keypair.json \
  --provider.cluster mainnet
```

### 4. Verify and Initialize

After deployment, initialize each program's state accounts.

---

## Program Initialization

After deployment, initialize program state:

### Initialize Registry

```bash
# Using SDK
npx ts-node scripts/initialize-registry.ts
```

### Initialize Oracle

```bash
npx ts-node scripts/initialize-oracle.ts
```

### Initialize Token

```bash
npx ts-node scripts/initialize-token.ts
```

### Initialize Trading

```bash
npx ts-node scripts/initialize-trading.ts
```

### Initialize Governance

```bash
npx ts-node scripts/initialize-governance.ts
```

---

## Upgrade Process

### Using Anchor Upgrade

```bash
# Build new version
anchor build

# Upgrade program
anchor upgrade target/deploy/registry.so \
  --program-id <PROGRAM_ID>
```

### Upgrade Authority Management

```bash
# Set new upgrade authority
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <NEW_AUTHORITY>

# Make program immutable (cannot be upgraded)
solana program set-upgrade-authority <PROGRAM_ID> --final
```

---

## Verification

### Check Deployed Programs

```bash
# List all programs
solana program show --programs

# Check specific program
solana program show <PROGRAM_ID>
```

### Verify IDL

```bash
# Initialize IDL on-chain
anchor idl init -f target/idl/registry.json <PROGRAM_ID>

# Upgrade IDL
anchor idl upgrade -f target/idl/registry.json <PROGRAM_ID>
```

---

## Rollback Strategy

If issues are discovered:

1. **Pause**: Use emergency pause in Governance
2. **Fix**: Deploy corrected version
3. **Upgrade**: Apply upgrade
4. **Resume**: Disable pause

---

## Post-Deployment

1. **Monitor**: Set up transaction monitoring
2. **Document**: Record deployment details
3. **Test**: Run post-deployment verification
4. **Announce**: Notify users of deployment

---

*For testing guidance, see [Testing Guide](./testing.md)*
