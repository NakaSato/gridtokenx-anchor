# GridTokenX Roadmap - Quick Start Guide

## Overview

This guide provides a quick start for implementing the first phase of the GridTokenX roadmap, focusing on building the foundation infrastructure and implementing initial security measures.

## Prerequisites

Before starting, ensure you have:

- Anchor CLI installed (`anchor --version`)
- Solana CLI installed (`solana --version`)
- Node.js and npm installed
- jq for JSON processing
- Local validator ready to run

## Quick Start Commands

### 1. Initial Setup

```bash
# Navigate to project directory
cd gridtokenx-anchor

# Verify all programs exist
ls -la programs/

# Install dependencies if needed
pnpm install
```

### 2. Build All Programs

```bash
# Make build script executable and run it
chmod +x scripts/build.sh
./scripts/build.sh

# Verify build was successful
./scripts/verify-build.sh
```

### 3. Initial Security Review

```bash
# Review the security assessment
cat docs/security/initial-review.md

# Create a security issues tracker
mkdir -p docs/security/tracking
touch docs/security/tracking/issues.md
```

### 4. Deploy to Local Development Environment

```bash
# Make deployment script executable and run it
chmod +x scripts/deploy.sh
./scripts/deploy.sh development

# Verify deployment
chmod +x scripts/verify-deployment.sh
./scripts/verify-deployment.sh development
```

### 5. Run Initial Tests

```bash
# Run basic tests to verify deployment
anchor test --skip-local-validator tests/energy-token.test.ts

# Run performance test
ts-node scripts/loop-transfer-test.ts 10 0.5
```

## Common Issues and Solutions

### Build Issues

**Issue**: "Program too large" error during build
```bash
# Solution: Optimize program size
# 1. Remove unused dependencies
# 2. Optimize data structures
# 3. Use Borsh serialization efficiently
```

**Issue**: "TypeScript compilation errors"
```bash
# Solution: Update dependencies
pnpm update @coral-xyz/anchor anchor-spl

# Clean build artifacts
rm -rf target/
anchor build
```

### Deployment Issues

**Issue**: "Insufficient funds for deployment"
```bash
# Solution: Request airdrop (localnet only)
solana airdrop 10

# Or transfer from another wallet
solana transfer <RECIPIENT> 5 --from <SOURCE>
```

**Issue**: "Program already deployed"
```bash
# Solution: Check if deployment is needed
./scripts/verify-deployment.sh

# Or use upgrade path instead
anchor upgrade <PROGRAM_NAME>
```

### Test Issues

**Issue**: "Test timeout" or "Test not found"
```bash
# Solution: Check validator status
solana cluster-version

# Restart validator if needed
pkill -f solana-test-validator
solana-test-validator --reset
```

**Issue**: "Overly long loop turn" in performance tests
```bash
# Solution: Increase delay between transactions
# Edit scripts/loop-transfer-test.ts
# Increase setTimeout delay from 500ms to 1000ms
```

## Quick Security Fix Checklist

### Critical Fixes (First Week)

- [ ] **Oracle Authorization**: Implement signature verification
  ```rust
  // In programs/oracle/src/lib.rs
  // Add signature parameter and verify
  require!(
      signature.verify(&expected_message).is_ok(),
      ErrorCode::UnauthorizedGateway
  );
  ```

- [ ] **Trading Self-Trade Prevention**: Add self-trade check
  ```rust
  // In programs/trading/src/lib.rs
  // Add to match_orders function
  require!(
      buy_order.buyer != sell_order.seller,
      ErrorCode::SelfTradingNotAllowed
  );
  ```

- [ ] **Re-entrancy Guards**: Add state protection
  ```rust
  // In all programs with CPI calls
  // Add re-entrancy guard before CPI
  require!(
      !state.reentrancy_guard,
      ErrorCode::ReentrancyDetected
  );
  ```

## Monitoring Your Progress

### Daily Check-ins

At the end of each day, run:

```bash
# Check build status
./scripts/verify-build.sh

# Check deployment status
./scripts/verify-deployment.sh development

# Run a subset of tests
anchor test --skip-local-validator tests/energy-token.test.ts
```

### Weekly Reviews

At the end of each week:

```bash
# Run full test suite
anchor test

# Update implementation checklist
vim docs/roadmap/implementation-checklist.md

# Review security fixes
cat docs/security/initial-review.md
```

## Getting Help

### Common Commands

```bash
# Get help for Anchor
anchor --help

# Check Solana configuration
solana config get

# Get program accounts
solana account <PROGRAM_ID>

# Check transaction status
solana confirm <SIGNATURE>
```

### Troubleshooting Resources

- [Anchor Documentation](https://project-serum.github.io/anchor/)
- [Solana Program Library](https://solanacookbook.com/)
- [Solana Discord](https://discord.gg/solana)

## Next Steps

After completing Week 1-2:

1. Review your progress against the checklist
2. Update your implementation timeline
3. Start Phase 2: Feature Enhancement
4. Begin working on oracle enhancements
5. Implement trading system optimizations

## Success Metrics

For Week 1-2, aim to achieve:

- ✅ All programs build without errors
- ✅ All programs deploy successfully
- ✅ Critical security issues resolved
- ✅ Test coverage reaches 85%
- ✅ Local tests pass consistently
- ✅ Performance tests complete without errors

## Tips for Success

1. **Start Small**: Focus on one program at a time
2. **Test Frequently**: Run tests after each change
3. **Document Changes**: Keep notes on what works and what doesn't
4. **Ask for Help**: Use community resources when stuck
5. **Iterate Quickly**: Don't spend too long on one issue

By following this quick start guide, you'll establish a solid foundation for the GridTokenX project and be well on your way to production readiness.
