#!/usr/bin/env node

/**
 * GridTokenX Transaction Test Runner
 * 
 * Command-line interface for running comprehensive transaction tests
 */

import TransactionTestSuite, { getDefaultConfig } from "./transaction-test-suite.js";

// Parse command line arguments
const args = process.argv.slice(2);
const options: any = {
  program: undefined,
  scenario: undefined,
  keypair: undefined,
  crossProgram: false,
  skipValidation: false,
};

for (const arg of args) {
  if (arg.startsWith("--program=")) {
    options.program = arg.split("=")[1];
  } else if (arg.startsWith("--scenario=")) {
    options.scenario = arg.split("=")[1];
  } else if (arg.startsWith("--keypair=")) {
    options.keypair = arg.split("=")[1];
  } else if (arg === "--cross-program") {
    options.crossProgram = true;
  } else if (arg === "--skip-validation") {
    options.skipValidation = true;
  } else if (arg === "--full") {
    // Run full test suite (default behavior)
  } else if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  }
}

/**
 * Print help information
 */
function printHelp() {
  console.log(`
GridTokenX Transaction Test Runner

Usage:
  npm run test:transactions [options]

Options:
  --program=<name>     Test specific program only
                       (registry, energy-token, governance, oracle, trading)
  
  --scenario=<name>    Run specific scenario only
  
  --keypair=<name>     Test specific keypair only
  
  --cross-program      Run cross-program flows only
  
  --skip-validation    Skip state validation
  
  --full               Run complete test suite (default)
  
  --help, -h           Show this help message

Examples:
  npm run test:transactions
  npm run test:transactions --program=registry
  npm run test:transactions --cross-program
  npm run test:transactions --program=trading --skip-validation

Environment Variables:
  SOLANA_URL           Solana RPC endpoint (default: http://localhost:8899)
`);
}

/**
 * Main execution
 */
async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║               GridTokenX Comprehensive Transaction Tests                   ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
`);

  try {
    // Get configuration
    const config = getDefaultConfig();

    // Create and initialize test suite
    const testSuite = new TransactionTestSuite(config);
    await testSuite.initialize();

    // Run tests with specified options
    await testSuite.runAllTests(options);

    console.log("\n✅ All transaction tests completed successfully!\n");
    process.exit(0);

  } catch (error: any) {
    console.error(`\n❌ Test execution failed:`);
    console.error(`Error: ${error.message || error}`);
    if (error.stack) {
      console.error(`\nStack trace:`);
      console.error(error.stack);
    }
    console.error(`\nError object:`, error);
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  console.error("Fatal error:", error);
  console.error(error.stack);
  process.exit(1);
});

export { main };
