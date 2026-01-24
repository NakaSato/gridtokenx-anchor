#!/usr/bin/env ts-node

/**
 * GridTokenX Transaction Test Suite
 * 
 * Comprehensive transaction testing for all keypairs across all programs
 * Tests core business logic flows and cross-program interactions
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import KeypairManager from "./keypair-manager.js";
import { TransactionReporter, StateValidator } from "./utils/index.js";
import * as path from "path";
import * as fs from "fs";

/**
 * Test suite configuration
 */
interface TestSuiteConfig {
  rpcUrl: string;
  programIds: {
    registry: string;
    energyToken: string;
    governance: string;
    oracle: string;
    trading: string;
  };
  keypairsDir: string;
  outputDir: string;
  validateBalances: boolean;
  airdropIfNeeded: boolean;
}

/**
 * Test execution options
 */
interface TestExecutionOptions {
  program?: string;  // Run tests for specific program only
  scenario?: string; // Run specific scenario only
  keypair?: string;  // Test specific keypair only
  crossProgram?: boolean; // Run cross-program flows
  skipValidation?: boolean; // Skip state validation
}

/**
 * Main transaction test suite orchestrator
 */
export class TransactionTestSuite {
  private config: TestSuiteConfig;
  private connection: Connection;
  private keypairManager: KeypairManager;
  private reporter: TransactionReporter;
  private validator: StateValidator;
  private programs: {
    registry?: anchor.Program;
    energyToken?: anchor.Program;
    governance?: anchor.Program;
    oracle?: anchor.Program;
    trading?: anchor.Program;
  } = {};

  constructor(config: TestSuiteConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, "confirmed");
    this.keypairManager = new KeypairManager(this.connection, config.keypairsDir);
    this.reporter = new TransactionReporter("GridTokenX Transaction Tests", config.outputDir);
    this.validator = new StateValidator(this.connection);
  }

  /**
   * Initialize test suite
   */
  async initialize(): Promise<void> {
    console.log("🚀 Initializing GridTokenX Transaction Test Suite\n");
    console.log("═".repeat(80));

    // Load all keypairs
    await this.keypairManager.loadAllKeypairs();
    this.keypairManager.printSummary();

    // Validate balances
    if (this.config.validateBalances) {
      const balancesValid = await this.keypairManager.validateBalances();

      if (!balancesValid && this.config.airdropIfNeeded) {
        console.log("💸 Requesting airdrops for insufficient balances...\n");
        await this.keypairManager.airdropToAll(10);
        await this.keypairManager.validateBalances();
      }
    }

    // Load program IDLs
    await this.loadPrograms();

    // Set programs in validator
    this.validator.setPrograms(this.programs);

    console.log("✅ Test suite initialized successfully\n");
    console.log("═".repeat(80) + "\n");
  }

  /**
   * Load all Anchor programs
   */
  private async loadPrograms(): Promise<void> {
    console.log("📚 Loading Anchor programs...");

    const provider = new anchor.AnchorProvider(
      this.connection,
      new anchor.Wallet(this.keypairManager.getDevWallet()),
      { commitment: "confirmed" }
    );

    anchor.setProvider(provider);

    try {
      // Load each program's IDL
      const idlDir = path.join(process.cwd(), "target/idl");

      // Registry
      if (fs.existsSync(path.join(idlDir, "registry.json"))) {
        const registryIdl = JSON.parse(
          fs.readFileSync(path.join(idlDir, "registry.json"), "utf8")
        );
        this.programs.registry = new anchor.Program(registryIdl as any, provider);
        console.log("  ✓ Registry program loaded");
      }

      // Energy Token
      if (fs.existsSync(path.join(idlDir, "energy_token.json"))) {
        const energyTokenIdl = JSON.parse(
          fs.readFileSync(path.join(idlDir, "energy_token.json"), "utf8")
        );
        this.programs.energyToken = new anchor.Program(energyTokenIdl as any, provider);
        console.log("  ✓ Energy Token program loaded");
      }

      // Governance
      if (fs.existsSync(path.join(idlDir, "governance.json"))) {
        const governanceIdl = JSON.parse(
          fs.readFileSync(path.join(idlDir, "governance.json"), "utf8")
        );
        this.programs.governance = new anchor.Program(governanceIdl as any, provider);
        console.log("  ✓ Governance program loaded");
      }

      // Oracle
      if (fs.existsSync(path.join(idlDir, "oracle.json"))) {
        const oracleIdl = JSON.parse(
          fs.readFileSync(path.join(idlDir, "oracle.json"), "utf8")
        );
        this.programs.oracle = new anchor.Program(oracleIdl as any, provider);
        console.log("  ✓ Oracle program loaded");
      }

      // Trading
      if (fs.existsSync(path.join(idlDir, "trading.json"))) {
        const tradingIdl = JSON.parse(
          fs.readFileSync(path.join(idlDir, "trading.json"), "utf8")
        );
        this.programs.trading = new anchor.Program(tradingIdl as any, provider);
        console.log("  ✓ Trading program loaded");
      }

      console.log();
    } catch (error: any) {
      console.error(`⚠️  Error loading programs: ${error.message}\n`);
    }
  }

  /**
   * Run all transaction tests
   */
  async runAllTests(options: TestExecutionOptions = {}): Promise<void> {
    console.log("🧪 Running Comprehensive Transaction Tests\n");
    console.log("═".repeat(80) + "\n");

    try {
      // Run program-specific tests if specified, otherwise run all
      if (options.program) {
        await this.runProgramTests(options.program);
      } else {
        // Run tests for each program
        await this.runProgramTests("registry");
        await this.runProgramTests("energy-token");
        await this.runProgramTests("governance");
        await this.runProgramTests("oracle");
        await this.runProgramTests("trading");
      }

      // Run cross-program flows
      if (options.crossProgram || !options.program) {
        await this.runCrossProgramFlows();
      }

      // Generate and display report
      console.log("\n" + "═".repeat(80));
      this.reporter.printSummary();

      // Save reports
      const jsonReport = this.reporter.saveReport();
      const csvReport = this.reporter.saveReportCSV();

      console.log(`\n📄 Reports saved:`);
      console.log(`  JSON: ${jsonReport}`);
      console.log(`  CSV:  ${csvReport}`);

    } catch (error: any) {
      console.error(`\n❌ Test suite failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Run tests for a specific program
   */
  async runProgramTests(programName: string): Promise<void> {
    console.log(`\n🔧 Running ${programName} tests...`);

    switch (programName.toLowerCase()) {
      case "registry":
        if (this.programs.registry) {
          const { RegistryScenarios } = await import("./scenarios/registry-scenarios.js");
          const scenarios = new RegistryScenarios(
            this.programs.registry,
            this.keypairManager,
            this.reporter,
            this.validator
          );
          await scenarios.runAllScenarios();
        } else {
          console.warn(`  ⚠️  Registry program not loaded, skipping`);
        }
        break;

      case "energy-token":
        if (this.programs.energyToken) {
          const { EnergyTokenScenarios } = await import("./scenarios/energy-token-scenarios.js");
          const scenarios = new EnergyTokenScenarios(
            this.programs.energyToken,
            this.keypairManager,
            this.reporter,
            this.validator
          );
          await scenarios.runAllScenarios();
        } else {
          console.warn(`  ⚠️  Energy Token program not loaded, skipping`);
        }
        break;

      case "governance":
        if (this.programs.governance) {
          const { GovernanceScenarios } = await import("./scenarios/governance-scenarios.js");
          const scenarios = new GovernanceScenarios(
            this.programs.governance,
            this.keypairManager,
            this.reporter,
            this.validator,
            this.programs.registry // Pass registry for state preparation
          );
          await scenarios.runAllScenarios();
        } else {
          console.warn(`  ⚠️  Governance program not loaded, skipping`);
        }
        break;

      case "oracle":
        if (this.programs.oracle) {
          const { OracleScenarios } = await import("./scenarios/oracle-scenarios.js");
          const scenarios = new OracleScenarios(
            this.programs.oracle,
            this.keypairManager,
            this.reporter,
            this.validator
          );
          await scenarios.runAllScenarios();
        } else {
          console.warn(`  ⚠️  Oracle program not loaded, skipping`);
        }
        break;

      case "trading":
        if (this.programs.trading) {
          const { TradingScenarios } = await import("./scenarios/trading-scenarios.js");
          const scenarios = new TradingScenarios(
            this.programs.trading,
            this.keypairManager,
            this.reporter,
            this.validator
          );
          await scenarios.runAllScenarios();
        } else {
          console.warn(`  ⚠️  Trading program not loaded, skipping`);
        }
        break;

      case "privacy":
        if (this.programs.trading) {
          const { PrivacyScenarios } = await import("./scenarios/privacy-scenarios.js");
          const scenarios = new PrivacyScenarios(
            this.programs.trading,
            this.keypairManager,
            this.reporter,
            this.validator
          );
          await scenarios.runAllScenarios();
        } else {
          console.warn(`  ⚠️  Trading (Privacy) program not loaded, skipping`);
        }
        break;

      default:
        console.warn(`  ⚠️  Unknown program: ${programName}`);
    }
  }

  /**
   * Run cross-program integration flows
   */
  async runCrossProgramFlows(): Promise<void> {
    console.log("\n🔄 Running Cross-Program Flows...");

    try {
      const { CrossProgramFlows } = await import("./scenarios/cross-program-flows.js");
      const flows = new CrossProgramFlows(
        this.programs,
        this.keypairManager,
        this.reporter,
        this.validator
      );
      await flows.runAllFlows();
    } catch (error: any) {
      console.warn(`  ⚠️  Cross-program flows not available: ${error.message}`);
    }
  }

  /**
   * Get test suite summary
   */
  getSummary(): any {
    return this.reporter.generateReport();
  }
}

/**
 * Default configuration for localnet testing
 */
export function getDefaultConfig(): TestSuiteConfig {
  return {
    rpcUrl: process.env.SOLANA_URL || "http://localhost:8899",
    programIds: {
      registry: "EgpmmYPFDAX8QfawUEFissBXi3yG6AapoxNfB6KdGtBQ",
      energyToken: "G8dC1NwdDiMhfrnPwkf9dMaR2AgrnFXcjWcepyGSHTfA",
      governance: "3d1BQT3EiwbspkD8HYKAnyLvKjs5kZwSbRBWwS5NHof9",
      oracle: "4Agkm8isGD6xDegsfoFzWN5Xp5WLVoqJyPDQLRsjh85u",
      trading: "GTuRUUwCfvmqW7knqQtzQLMCy61p4UKUrdT5ssVgZbat",
    },
    keypairsDir: "./keypairs",
    outputDir: "./test-results/transactions",
    validateBalances: true,
    airdropIfNeeded: true,
  };
}

export default TransactionTestSuite;
