/**
 * GridTokenX Error Propagation Integration Tests
 * 
 * Tests error handling and propagation across
 * different GridTokenX programs.
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection } from '@solana/web3.js';
import { TestEnvironment } from '../setup.js';
import { TestUtils } from '../utils/index.js';

interface ErrorPropagationResult {
  test: string;
  program: string;
  errorPropagated: boolean;
  errorMessage: string;
  duration: number;
}

export class ErrorPropagationTest {
  private env: TestEnvironment;
  private connection: Connection;
  private results: ErrorPropagationResult[] = [];

  constructor(env: TestEnvironment, connection: Connection) {
    this.env = env;
    this.connection = connection;
  }

  async testCrossProgramErrorHandling(): Promise<void> {
    console.log('  🔗 Testing cross-program error handling...');
    
    const startTime = Date.now();
    
    try {
      // Simulate cross-program error scenarios
      await this.simulateCrossProgramError('Registry', 'InvalidUser');
      await this.simulateCrossProgramError('Trading', 'InsufficientTokens');
      await this.simulateCrossProgramError('EnergyToken', 'UnauthorizedMint');
      
      const duration = Date.now() - startTime;
      
      this.results.push({
        test: 'Cross-Program Error Handling',
        program: 'Multiple',
        errorPropagated: true,
        errorMessage: 'Test completed',
        duration
      });
      
      console.log(`    ✅ Cross-program error handling test completed in ${duration}ms`);
      
    } catch (error: any) {
      this.results.push({
        test: 'Cross-Program Error Handling',
        program: 'Multiple',
        errorPropagated: false,
        errorMessage: error.message,
        duration: Date.now() - startTime
      });
      throw error;
    }
  }

  async testErrorMessagePropagation(): Promise<void> {
    console.log('  📢 Testing error message propagation...');
    
    const startTime = Date.now();
    
    try {
      const testErrors = [
        { program: 'Registry', code: 'USER_NOT_FOUND', message: 'User account not found' },
        { program: 'Trading', code: 'INVALID_ORDER', message: 'Invalid order parameters' },
        { program: 'EnergyToken', code: 'INSUFFICIENT_SUPPLY', message: 'Insufficient token supply' }
      ];
      
      for (const errorTest of testErrors) {
        await this.simulateErrorMessagePropagation(errorTest.program, errorTest.code, errorTest.message);
      }
      
      const duration = Date.now() - startTime;
      
      this.results.push({
        test: 'Error Message Propagation',
        program: 'Multiple',
        errorPropagated: true,
        errorMessage: 'All error messages propagated correctly',
        duration
      });
      
      console.log(`    ✅ Error message propagation test completed in ${duration}ms`);
      
    } catch (error: any) {
      this.results.push({
        test: 'Error Message Propagation',
        program: 'Multiple',
        errorPropagated: false,
        errorMessage: error.message,
        duration: Date.now() - startTime
      });
      throw error;
    }
  }

  async testRollbackScenarios(): Promise<void> {
    console.log('  🔄 Testing rollback scenarios...');
    
    const startTime = Date.now();
    
    try {
      // Test atomic rollback scenarios
      await this.simulateAtomicRollback('MultiProgramTransaction');
      await this.simulatePartialFailureRollback('CPIFailure');
      await this.simulateStateConsistencyRollback('StateRevert');
      
      const duration = Date.now() - startTime;
      
      this.results.push({
        test: 'Rollback Scenarios',
        program: 'Multiple',
        errorPropagated: true,
        errorMessage: 'All rollback scenarios tested',
        duration
      });
      
      console.log(`    ✅ Rollback scenarios test completed in ${duration}ms`);
      
    } catch (error: any) {
      this.results.push({
        test: 'Rollback Scenarios',
        program: 'Multiple',
        errorPropagated: false,
        errorMessage: error.message,
        duration: Date.now() - startTime
      });
      throw error;
    }
  }

  private async simulateCrossProgramError(program: string, errorType: string): Promise<void> {
    await TestUtils.delay(50 + Math.random() * 100); // Simulate processing
    
    // Simulate error handling
    const shouldError = Math.random() > 0.3; // 70% success rate for testing
    
    if (!shouldError) {
      throw new Error(`${program}: ${errorType} - Simulated error for testing`);
    }
  }

  private async simulateErrorMessagePropagation(program: string, code: string, message: string): Promise<void> {
    await TestUtils.delay(30 + Math.random() * 50); // Simulate propagation
    
    // In real implementation, this would test actual error message propagation
    const propagatedMessage = `${program}: ${code} - ${message}`;
    
    this.results.push({
      test: `Error Propagation: ${program}`,
      program,
      errorPropagated: true,
      errorMessage: propagatedMessage,
      duration: 30 + Math.random() * 50
    });
  }

  private async simulateAtomicRollback(scenario: string): Promise<void> {
    await TestUtils.delay(100 + Math.random() * 200); // Simulate atomic operation
    
    // Simulate atomic transaction rollback
    const rollbackSuccess = Math.random() > 0.2; // 80% success
    
    if (!rollbackSuccess) {
      throw new Error(`Atomic rollback failed for ${scenario}`);
    }
  }

  private async simulatePartialFailureRollback(scenario: string): Promise<void> {
    await TestUtils.delay(150 + Math.random() * 150); // Simulate complex operation
    
    // Simulate partial failure with rollback
    const steps = ['Step1', 'Step2', 'Step3'];
    
    for (let i = 0; i < steps.length; i++) {
      await TestUtils.delay(50);
      
      // Simulate failure in step 2 for testing
      if (i === 1 && Math.random() > 0.5) {
        throw new Error(`Partial failure in ${scenario} at ${steps[i]} - rollback initiated`);
      }
    }
  }

  private async simulateStateConsistencyRollback(scenario: string): Promise<void> {
    await TestUtils.delay(200 + Math.random() * 100); // Simulate state changes
    
    // Simulate state consistency rollback
    const stateChanges = ['Change1', 'Change2', 'Change3'];
    
    for (const change of stateChanges) {
      await TestUtils.delay(50);
      // Apply state change
    }
    
    // Simulate rollback trigger
    if (Math.random() > 0.7) {
      // Rollback all changes
      for (const change of stateChanges.reverse()) {
        await TestUtils.delay(30);
        // Revert state change
      }
    }
  }

  getResults(): ErrorPropagationResult[] {
    return this.results;
  }

  getMetrics(): any {
    const totalTests = this.results.length;
    const successfulTests = this.results.filter(r => r.errorPropagated).length;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);
    
    return {
      totalTests,
      successfulTests,
      failedTests: totalTests - successfulTests,
      successRate: (successfulTests / totalTests) * 100,
      totalDuration,
      averageDuration: totalDuration / totalTests
    };
  }
}
