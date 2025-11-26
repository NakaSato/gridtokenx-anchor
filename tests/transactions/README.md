# GridTokenX Transaction Test Suite

Comprehensive transaction testing framework for all keypairs and core business logic across the GridTokenX blockchain ecosystem.

## Overview

This test suite provides:
- **Centralized Keypair Management**: Manages all 16 test wallets with role-based access
- **Program Testing**: Individual test scenarios for each of the 5 Anchor programs
- **Cross-Program Flows**: End-to-end transaction flows spanning multiple programs
- **Comprehensive Reporting**: Detailed metrics, JSON/CSV exports, and validation reports
- **State Validation**: Cross-program consistency checks

## Architecture

### Infrastructure Components

```
tests/transactions/
├── keypair-manager.ts          # Centralized wallet management
├── transaction-test-suite.ts   # Main test orchestrator
├── run-transaction-tests.ts    # CLI test runner
├── utils/
│   ├── transaction-reporter.ts # Metrics and reporting
│   ├── state-validator.ts      # Cross-program validation
│   └── index.ts                # Utility exports
└── scenarios/
    ├── registry-scenarios.ts      # Registry program tests
    ├── energy-token-scenarios.ts  # Energy Token tests
    ├── governance-scenarios.ts    # Governance tests
    ├── oracle-scenarios.ts        # Oracle tests
    ├── trading-scenarios.ts       # Trading tests
    └── cross-program-flows.ts     # End-to-end flows
```

### Keypair Roles

The test suite uses 16 keypairs organized by role:

| Role | Keypairs | Purpose |
|------|----------|---------|
| **Authorities** | `dev-wallet`, `governance-authority`, `oracle-authority`, `treasury-wallet` | Program initialization, admin operations |
| **Producers** | `producer-1`, `producer-2`, `producer-3` | Energy generation, sell orders, ERC issuance |
| **Consumers** | `consumer-1`, `consumer-2` | Energy consumption, buy orders |
| **Testing** | `wallet-1`, `wallet-2`, `test-wallet-3/4/5` | Performance and edge case testing |

## Usage

### Prerequisites

1. **Start local validator**:
   ```bash
   solana-test-validator
   ```

2. **Build and deploy programs**:
   ```bash
   anchor build
   anchor deploy
   ```

3. **Setup wallets** (if not already done):
   ```bash
   npm run wallet:setup
   ```

### Running Tests

#### Full Test Suite
Run all transaction tests across all programs:
```bash
npm run test:transactions
```

#### Program-Specific Tests
Test individual programs:
```bash
npm run test:transactions:registry
npm run test:transactions:energy-token
npm run test:transactions:governance
npm run test:transactions:oracle
npm run test:transactions:trading
```

#### Cross-Program Flows
Test end-to-end flows:
```bash
npm run test:transactions:cross-program
```

#### Advanced Options
```bash
# Test specific program
node --loader ts-node/esm tests/transactions/run-transaction-tests.ts --program=registry

# Run cross-program flows only
node --loader ts-node/esm tests/transactions/run-transaction-tests.ts --cross-program

# Skip validation checks
node --loader ts-node/esm tests/transactions/run-transaction-tests.ts --skip-validation

# Show help
node --loader ts-node/esm tests/transactions/run-transaction-tests.ts --help
```

## Test Scenarios

### Registry Program

- **Multi-User Registration**: Register all producers and consumers
- **Multi-Meter Registration**: Register meters for all producers
- **Concurrent Meter Updates**: Submit readings from all meters
- **Balance Settlement Flow**: Settle balances for all producers
- **Authorization Checks**: Verify access controls

### Energy Token Program

- Token initialization with authority
- Batch token minting to producers
- Cross-wallet token transfers
- Token burning from consumers
- Authority validation tests

### Governance Program

- PoA initialization with governance authority
- Bulk ERC issuance for producers
- ERC validation for trading
- Emergency pause/unpause controls
- Unauthorized access tests

### Oracle Program

- Oracle initialization with oracle authority
- Batch meter reading submission
- Data validation boundary tests
- Market clearing triggers
- Gateway authorization checks

### Trading Program

- Market initialization
- Multi-producer sell orders with ERC validation
- Multi-consumer buy orders
- Automated order matching
- Batch trade execution
- Order cancellation tests

### Cross-Program Flows

- Complete energy trading journey (all programs)
- Multi-participant market rounds
- Emergency shutdown across programs
- CPI validation flows

## Output

### Console Output

The test suite provides real-time console output:
```
📋 Starting scenario: Multi-User Registration (Registry)
  ✓ registerUser (producer-1): 145ms [3KJ8hN2...]
  ✓ registerUser (producer-2): 132ms [9mP4xW7...]
  ✗ registerUser (consumer-1): Insufficient balance
✓ Completed scenario: Multi-User Registration (3/3 succeeded)

═══════════════════════════════════════════════════════════
📊 Test Suite Report: GridTokenX Transaction Tests
═══════════════════════════════════════════════════════════

📈 Overall Statistics:
  Total Scenarios:      12
  Total Transactions:   156
  Successful:           154 (98.72%)
  Failed:               2
  Average Duration:     127.45ms
  Throughput:           12.34 tx/s
  Total Duration:       12.64s
```

### Report Files

After test execution, reports are saved to `./test-results/transactions/`:

- **JSON Report**: `transaction-report-{timestamp}.json`
  - Complete test data with all transactions
  - Program and keypair statistics
  - Suitable for CI/CD integration

- **CSV Report**: `transaction-report-{timestamp}.csv`
  - Transaction-level data for analysis
  - Import into spreadsheets or analytics tools

## Validation

The state validator performs cross-program consistency checks:

- **Token Balances**: Verify balances match expected values
- **Meter Settlement**: Ensure settled balances prevent double-minting
- **ERC Certificates**: Validate ERCs match meter generation
- **Trade Records**: Verify trades match orders
- **User Permissions**: Confirm authorization is enforced

## Extending the Test Suite

### Adding New Scenarios

1. **Create scenario file**: `tests/transactions/scenarios/my-scenario.ts`
2. **Import in test suite**: Update `transaction-test-suite.ts`
3. **Follow pattern**: Use existing scenarios as templates

Example scenario structure:
```typescript
export class MyScenarios {
  private program: anchor.Program;
  private keypairManager: KeypairManager;
  private reporter: TransactionReporter;
  private validator: StateValidator;

  constructor(...) { }

  async runAllScenarios(): Promise<void> {
    await this.testScenario1();
    await this.testScenario2();
  }

  async testScenario1(): Promise<void> {
    this.reporter.startScenario("My Test", "MyProgram");
    
    // Execute transactions
    for (const keypair of this.keypairManager.getAllKeypairs()) {
      const startTime = Date.now();
      try {
        const signature = await this.program.methods
          .myOperation()
          .accounts({ ... })
          .signers([keypair.keypair])
          .rpc();

        this.reporter.recordTransaction({
          program: "MyProgram",
          operation: "myOperation",
          keypair: keypair.name,
          signature,
          success: true,
          duration: Date.now() - startTime,
          timestamp: startTime,
        });
      } catch (error) {
        // Handle error
      }
    }

    this.reporter.endScenario();
  }
}
```

## Development Status

### ✅ Completed
- Keypair manager with role-based access
- Transaction reporter with metrics tracking
- State validator for cross-program checks
- Test suite orchestrator
- Main test runner with CLI
- Registry program scenarios (full implementation)
- npm scripts for all test configurations

### 🚧 In Progress
- Energy Token scenarios
- Governance scenarios
- Oracle scenarios
- Trading scenarios
- Cross-program flows

### 📋 Planned
- Performance benchmarking integration
- Concurrent transaction stress testing
- Network condition simulation
- Advanced state machine validation

## Troubleshooting

### Insufficient SOL Balance
```bash
npm run wallet:setup
```

### Programs Not Deployed
```bash
anchor build
anchor deploy
```

### Connection Issues
Check `SOLANA_URL` environment variable:
```bash
export SOLANA_URL=http://localhost:8899
```

### Account Already Exists Errors
These are expected when re-running tests. The test suite handles them gracefully.

## Contributing

When adding new test scenarios:

1. Follow the existing pattern in `registry-scenarios.ts`
2. Use the reporter to track all transactions
3. Include authorization/security tests
4. Add state validation where applicable
5. Update this README with new scenarios

## License

Part of the GridTokenX project.
