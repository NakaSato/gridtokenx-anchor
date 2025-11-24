# GridTokenX Wallet Setup Scripts

This directory contains scripts for setting up role-based wallets needed for comprehensive testing of the GridTokenX platform.

## Scripts

### setup-all-wallets.ts / setup-all-wallets.sh

These scripts create all role-based wallets needed for comprehensive testing of the GridTokenX platform. Both Bash and TypeScript versions are provided with equivalent functionality.

#### Usage

**TypeScript (Recommended):**

```bash
# Create all wallets with default settings
pnpm run wallet:setup-all

# Or use the script directly
ts-node scripts/wallet-setup/setup-all-wallets.ts
```

**Bash:**

```bash
# Make the script executable (first time only)
chmod +x scripts/wallet-setup/setup-all-wallets.sh

# Run the script
./scripts/wallet-setup/setup-all-wallets.sh
```

#### Options

Both scripts support the following options:

- `--reset`: Delete existing wallets and create new ones
- `--airdrop-only`: Only perform airdrops to existing wallets
- `--skip-airdrop`: Skip SOL airdrops to wallets
- `--keypair-dir <path>`: Directory to store keypairs (default: ./keypairs)
- `--validator-url <url>`: Validator RPC URL (default: localhost)
- `--help`: Show help information

#### Examples

```bash
# Create all wallets with default settings
pnpm run wallet:setup-all

# Delete existing wallets and create new ones
pnpm run wallet:setup-all -- --reset

# Only perform airdrops to existing wallets
pnpm run wallet:setup-all -- --airdrop-only

# Create wallets in a custom directory
pnpm run wallet:setup-all -- --keypair-dir ./custom-keypairs

# Connect to a specific validator
pnpm run wallet:setup-all -- --validator-url devnet
```

## Wallet Types

The scripts create the following wallet types with their respective SOL amounts:

| Wallet Name | SOL Amount | Purpose |
|-------------|------------|---------|
| dev-wallet | 1000 | Primary development wallet for deployment and admin operations |
| wallet-1 | 500 | Standard user wallet for basic functionality testing |
| wallet-2 | 200 | Standard user wallet for basic functionality testing |
| producer-1 | 300 | Energy producer wallet that generates and sells energy credits |
| producer-2 | 300 | Energy producer wallet that generates and sells energy credits |
| producer-3 | 300 | Energy producer wallet that generates and sells energy credits |
| consumer-1 | 250 | Energy consumer wallet that purchases and uses energy credits |
| consumer-2 | 250 | Energy consumer wallet that purchases and uses energy credits |
| oracle-authority | 500 | Wallet with permission to update price feeds and market data |
| governance-authority | 500 | Wallet for protocol governance and parameter changes |
| treasury-wallet | 1000 | Wallet for collecting fees and managing protocol funds |
| test-wallet-3 | 150 | Additional wallet for stress testing and edge cases |
| test-wallet-4 | 150 | Additional wallet for stress testing and edge cases |
| test-wallet-5 | 150 | Additional wallet for stress testing and edge cases |

## Integration with Testing

These wallets are designed to work seamlessly with the GridTokenX test suites:

- **Basic transaction tests**: Use dev-wallet, wallet-1, and wallet-2
- **Multi-wallet scenarios**: Use producer and consumer wallets
- **Oracle and governance testing**: Use oracle-authority and governance-authority
- **Treasury operations**: Use treasury-wallet
- **Stress testing**: Use all wallets including test-wallet-3/4/5

## Security Considerations

1. **Never commit private keys**: The keypairs directory is included in .gitignore to prevent accidental commits
2. **Use in local development only**: These wallets are intended for local development and testing
3. **Reset before use**: Use the --reset flag to ensure clean state between test runs
