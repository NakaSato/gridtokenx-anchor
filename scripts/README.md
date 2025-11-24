# Build programs
./scripts/01-build.sh

# Set up development environment
./scripts/03-setup.sh

# Deploy to local network
./scripts/04-deploy.sh localnet

# Verify deployment
./scripts/05-verify-deployment.sh localnet

# Generate clients
./scripts/06-generate-clients.js
```

### Token Management Workflow
```bash
# Create GRX token
ts-node scripts/08-token-manager.ts create --spl

# Create test wallets
ts-node scripts/09-wallet-manager.ts create wallet1
ts-node scripts/09-wallet-manager.ts create wallet2

# Mint tokens to wallets
ts-node scripts/08-token-manager.ts mint wallet1 1000
ts-node scripts/08-token-manager.ts mint wallet2 1000

# Check balances
ts-node scripts/08-token-manager.ts balance wallet1
ts-node scripts/08-token-manager.ts balance wallet2

# Transfer tokens
ts-node scripts/08-token-manager.ts transfer wallet1 wallet2 500
```

### Testing Workflow
```bash
# Set up test environment
ts-node scripts/10-setup-loop-test-standalone.ts

# Inspect results
ts-node scripts/11-inspect.ts
```

## Notes
- All scripts must be run from the project root directory
- Ensure proper environment variables are set (ANCHOR_PROVIDER_URL, ANCHOR_WALLET)
- Token operations (`08-token-manager.ts`) require a running validator
- For wallet operations, use `09-wallet-manager.ts` for wallet management and `08-token-manager.ts` for token operations

## Recent Changes
- Removed duplicate wallet management scripts
- Consolidated functionality into `08-token-manager.ts` and `09-wallet-manager.ts`
- Removed redundant `setup-loop-test.sh` wrapper script
- Renumbered scripts to maintain sequential order
