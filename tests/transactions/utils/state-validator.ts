import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

/**
 * State validation error
 */
export interface ValidationError {
  field: string;
  expected: any;
  actual: any;
  message: string;
}

/**
 * State validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

/**
 * Cross-program state validator
 * Ensures data consistency across all 5 Anchor programs
 */
export class StateValidator {
  private connection: Connection;
  private programs: {
    registry?: anchor.Program;
    energyToken?: anchor.Program;
    governance?: anchor.Program;
    oracle?: anchor.Program;
    trading?: anchor.Program;
  };

  constructor(connection: Connection) {
    this.connection = connection;
    this.programs = {};
  }

  /**
   * Set program instances for validation
   */
  setPrograms(programs: {
    registry?: anchor.Program;
    energyToken?: anchor.Program;
    governance?: anchor.Program;
    oracle?: anchor.Program;
    trading?: anchor.Program;
  }): void {
    this.programs = programs;
  }

  /**
   * Validate token balances match expected values
   */
  async validateTokenBalance(
    tokenAccount: PublicKey,
    expectedBalance: number,
    tolerance: number = 0
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    try {
      const balance = await this.connection.getBalance(tokenAccount);

      if (Math.abs(balance - expectedBalance) > tolerance) {
        errors.push({
          field: "tokenBalance",
          expected: expectedBalance,
          actual: balance,
          message: `Token balance mismatch. Expected ${expectedBalance}, got ${balance}`,
        });
      }
    } catch (error: any) {
      errors.push({
        field: "tokenBalance",
        expected: expectedBalance,
        actual: null,
        message: `Failed to fetch token balance: ${error.message}`,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate meter settlement prevents double-minting
   * Ensures settled_net_generation matches expected value
   */
  async validateMeterSettlement(
    meterAccount: PublicKey,
    expectedSettled: number
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    if (!this.programs.registry) {
      warnings.push("Registry program not set, skipping meter settlement validation");
      return { valid: true, errors, warnings };
    }

    try {
      const meterData = await this.programs.registry.account.meterAccount.fetch(meterAccount);

      if (meterData.settledNetGeneration !== expectedSettled) {
        errors.push({
          field: "settledNetGeneration",
          expected: expectedSettled,
          actual: meterData.settledNetGeneration,
          message: `Settled balance mismatch. Expected ${expectedSettled}, got ${meterData.settledNetGeneration}`,
        });
      }

      // Verify settled amount doesn't exceed total generation
      if (meterData.settledNetGeneration > meterData.totalGeneration) {
        errors.push({
          field: "settledNetGeneration",
          expected: `<= ${meterData.totalGeneration}`,
          actual: meterData.settledNetGeneration,
          message: "Settled generation exceeds total generation (double-minting detected!)",
        });
      }
    } catch (error: any) {
      errors.push({
        field: "meterSettlement",
        expected: expectedSettled,
        actual: null,
        message: `Failed to fetch meter data: ${error.message}`,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate ERC certificate matches meter generation
   * Ensures claimed_erc_generation prevents double-claiming
   */
  async validateErcCertificate(
    ercCertificate: PublicKey,
    meterAccount: PublicKey,
    expectedErcAmount: number
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    if (!this.programs.governance || !this.programs.registry) {
      warnings.push("Governance or Registry program not set, skipping ERC validation");
      return { valid: true, errors, warnings };
    }

    try {
      const ercData = await this.programs.governance.account.ercCertificate.fetch(ercCertificate);
      const meterData = await this.programs.registry.account.meterAccount.fetch(meterAccount);

      // Verify ERC amount matches expected
      if (ercData.energyAmount !== expectedErcAmount) {
        errors.push({
          field: "ercEnergyAmount",
          expected: expectedErcAmount,
          actual: ercData.energyAmount,
          message: `ERC energy amount mismatch. Expected ${expectedErcAmount}, got ${ercData.energyAmount}`,
        });
      }

      // Verify ERC amount doesn't exceed total generation
      if (ercData.energyAmount > meterData.totalGeneration) {
        errors.push({
          field: "ercEnergyAmount",
          expected: `<= ${meterData.totalGeneration}`,
          actual: ercData.energyAmount,
          message: "ERC energy amount exceeds meter total generation",
        });
      }

      // Verify claimed_erc_generation is updated
      if (meterData.claimedErcGeneration < ercData.energyAmount) {
        warnings.push(
          `Meter claimed_erc_generation (${meterData.claimedErcGeneration}) is less than ERC amount (${ercData.energyAmount}). May indicate incomplete claim tracking.`
        );
      }

      // Verify ERC status is valid for trading if validated
      if (ercData.validatedForTrading && ercData.status !== "Valid") {
        errors.push({
          field: "ercStatus",
          expected: "Valid",
          actual: ercData.status,
          message: "ERC validated for trading but status is not Valid",
        });
      }
    } catch (error: any) {
      errors.push({
        field: "ercCertificate",
        expected: expectedErcAmount,
        actual: null,
        message: `Failed to fetch ERC or meter data: ${error.message}`,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate trade records match orders
   */
  async validateTradeRecord(
    tradeRecord: PublicKey,
    buyOrder: PublicKey,
    sellOrder: PublicKey
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    if (!this.programs.trading) {
      warnings.push("Trading program not set, skipping trade record validation");
      return { valid: true, errors, warnings };
    }

    try {
      const tradeData = await this.programs.trading.account.tradeRecord.fetch(tradeRecord);
      const buyOrderData = await this.programs.trading.account.order.fetch(buyOrder);
      const sellOrderData = await this.programs.trading.account.order.fetch(sellOrder);

      // Verify trade record references correct orders
      if (!tradeData.buyOrder.equals(buyOrder)) {
        errors.push({
          field: "tradeBuyOrder",
          expected: buyOrder.toBase58(),
          actual: tradeData.buyOrder.toBase58(),
          message: "Trade record buy order reference mismatch",
        });
      }

      if (!tradeData.sellOrder.equals(sellOrder)) {
        errors.push({
          field: "tradeSellOrder",
          expected: sellOrder.toBase58(),
          actual: tradeData.sellOrder.toBase58(),
          message: "Trade record sell order reference mismatch",
        });
      }

      // Verify trade amount is within order amounts
      if (tradeData.amount > buyOrderData.amount || tradeData.amount > sellOrderData.amount) {
        errors.push({
          field: "tradeAmount",
          expected: `<= min(${buyOrderData.amount}, ${sellOrderData.amount})`,
          actual: tradeData.amount,
          message: "Trade amount exceeds order amounts",
        });
      }

      // Verify price is within order price range
      if (tradeData.pricePerKwh > buyOrderData.pricePerKwh) {
        errors.push({
          field: "tradePrice",
          expected: `<= ${buyOrderData.pricePerKwh}`,
          actual: tradeData.pricePerKwh,
          message: "Trade price exceeds buy order max price",
        });
      }

      if (tradeData.pricePerKwh < sellOrderData.pricePerKwh) {
        errors.push({
          field: "tradePrice",
          expected: `>= ${sellOrderData.pricePerKwh}`,
          actual: tradeData.pricePerKwh,
          message: "Trade price below sell order min price",
        });
      }
    } catch (error: any) {
      errors.push({
        field: "tradeRecord",
        expected: "valid trade data",
        actual: null,
        message: `Failed to fetch trade or order data: ${error.message}`,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate user permissions are enforced
   */
  async validateUserPermissions(
    userAccount: PublicKey,
    expectedAuthority: PublicKey
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    if (!this.programs.registry) {
      warnings.push("Registry program not set, skipping user permission validation");
      return { valid: true, errors, warnings };
    }

    try {
      const userData = await this.programs.registry.account.userAccount.fetch(userAccount);

      if (!userData.authority.equals(expectedAuthority)) {
        errors.push({
          field: "userAuthority",
          expected: expectedAuthority.toBase58(),
          actual: userData.authority.toBase58(),
          message: "User authority mismatch",
        });
      }

      // Verify user status is active for trading
      if (userData.status !== "Active") {
        warnings.push(`User status is ${userData.status}, not Active. May affect trading permissions.`);
      }
    } catch (error: any) {
      errors.push({
        field: "userPermissions",
        expected: expectedAuthority.toBase58(),
        actual: null,
        message: `Failed to fetch user data: ${error.message}`,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate complete cross-program state consistency
   * Comprehensive validation across all programs
   */
  async validateFullState(validations: {
    tokenBalances?: Array<{ account: PublicKey; expected: number }>;
    meterSettlements?: Array<{ account: PublicKey; expected: number }>;
    ercCertificates?: Array<{
      certificate: PublicKey;
      meter: PublicKey;
      expectedAmount: number;
    }>;
    tradeRecords?: Array<{
      trade: PublicKey;
      buyOrder: PublicKey;
      sellOrder: PublicKey;
    }>;
    userPermissions?: Array<{ user: PublicKey; authority: PublicKey }>;
  }): Promise<ValidationResult> {
    const allErrors: ValidationError[] = [];
    const allWarnings: string[] = [];

    // Validate token balances
    if (validations.tokenBalances) {
      for (const { account, expected } of validations.tokenBalances) {
        const result = await this.validateTokenBalance(account, expected);
        allErrors.push(...result.errors);
        allWarnings.push(...result.warnings);
      }
    }

    // Validate meter settlements
    if (validations.meterSettlements) {
      for (const { account, expected } of validations.meterSettlements) {
        const result = await this.validateMeterSettlement(account, expected);
        allErrors.push(...result.errors);
        allWarnings.push(...result.warnings);
      }
    }

    // Validate ERC certificates
    if (validations.ercCertificates) {
      for (const { certificate, meter, expectedAmount } of validations.ercCertificates) {
        const result = await this.validateErcCertificate(certificate, meter, expectedAmount);
        allErrors.push(...result.errors);
        allWarnings.push(...result.warnings);
      }
    }

    // Validate trade records
    if (validations.tradeRecords) {
      for (const { trade, buyOrder, sellOrder } of validations.tradeRecords) {
        const result = await this.validateTradeRecord(trade, buyOrder, sellOrder);
        allErrors.push(...result.errors);
        allWarnings.push(...result.warnings);
      }
    }

    // Validate user permissions
    if (validations.userPermissions) {
      for (const { user, authority } of validations.userPermissions) {
        const result = await this.validateUserPermissions(user, authority);
        allErrors.push(...result.errors);
        allWarnings.push(...result.warnings);
      }
    }

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
    };
  }

  /**
   * Print validation result to console
   */
  printValidationResult(result: ValidationResult, title: string = "Validation"): void {
    console.log(`\n🔍 ${title}:`);

    if (result.valid) {
      console.log("  ✅ All validations passed");
    } else {
      console.log(`  ❌ ${result.errors.length} validation error(s) found:`);
      for (const error of result.errors) {
        console.log(`    - ${error.field}: ${error.message}`);
        console.log(`      Expected: ${JSON.stringify(error.expected)}`);
        console.log(`      Actual: ${JSON.stringify(error.actual)}`);
      }
    }

    if (result.warnings.length > 0) {
      console.log(`  ⚠️  ${result.warnings.length} warning(s):`);
      for (const warning of result.warnings) {
        console.log(`    - ${warning}`);
      }
    }

    console.log();
  }
}

export default StateValidator;
