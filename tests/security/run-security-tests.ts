import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface SecurityTestResult {
  suite: string;
  passed: number;
  failed: number;
  errors: string[];
  duration: number;
}

interface SecurityReport {
  timestamp: string;
  totalPassed: number;
  totalFailed: number;
  totalErrors: number;
  suites: SecurityTestResult[];
  recommendations: string[];
}

/**
 * Security Test Runner
 * Orchestrates all security tests and generates comprehensive reports
 */

class SecurityTestRunner {
  private results: SecurityTestResult[] = [];
  private startTime: number = 0;

  async runAllTests(): Promise<void> {
    console.log("🔒 GridTokenX Security Test Suite");
    console.log("=" .repeat(50));
    
    this.startTime = Date.now();
    
    const testSuites = [
      {
        name: "Authorization Tests",
        script: "test:security:authorization",
        file: "tests/security/authorization.test.ts"
      },
      {
        name: "Input Validation Tests", 
        script: "test:security:input-validation",
        file: "tests/security/input-validation.test.ts"
      },
      {
        name: "Replay Attack Tests",
        script: "test:security:replay-attacks", 
        file: "tests/security/replay-attacks.test.ts"
      }
    ];

    console.log("🚀 Running security test suites...\n");

    for (const suite of testSuites) {
      console.log(`📋 Running ${suite.name}...`);
      const result = await this.runTestSuite(suite);
      this.results.push(result);
      
      console.log(`✅ ${suite.name} completed:`);
      console.log(`   Passed: ${result.passed}`);
      console.log(`   Failed: ${result.failed}`);
      console.log(`   Errors: ${result.errors.length}`);
      console.log(`   Duration: ${(result.duration / 1000).toFixed(2)}s\n`);
    }

    await this.generateReport();
  }

  private async runTestSuite(suite: { name: string; script: string; file: string }): Promise<SecurityTestResult> {
    const startTime = Date.now();
    
    try {
      const result = await this.runNpmScript(suite.script);
      const duration = Date.now() - startTime;
      
      return {
        suite: suite.name,
        passed: result.passed,
        failed: result.failed,
        errors: result.errors,
        duration
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      return {
        suite: suite.name,
        passed: 0,
        failed: 1,
        errors: [error.message || "Unknown error"],
        duration
      };
    }
  }

  private async runNpmScript(script: string): Promise<{ passed: number; failed: number; errors: string[] }> {
    return new Promise((resolve) => {
      const child = spawn('npm', ['run', script], {
        stdio: 'pipe',
        shell: true,
        cwd: process.cwd()
      });

      let stdout = '';
      let stderr = '';
      let passed = 0;
      let failed = 0;
      const errors: string[] = [];

      child.stdout?.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        
        // Parse Mocha output
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.includes('✓') || line.includes('passing')) {
            passed++;
          } else if (line.includes('✗') || line.includes('failing')) {
            failed++;
          } else if (line.includes('Error:') || line.includes('AssertionError')) {
            errors.push(line.trim());
          }
        }
      });

      child.stderr?.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        errors.push(output.trim());
      });

      child.on('close', (code) => {
        if (code !== 0 && failed === 0) {
          failed = 1; // At least one test failed if process exited with non-zero code
        }
        
        resolve({ passed, failed, errors });
      });

      child.on('error', (error) => {
        errors.push(`Process error: ${error.message}`);
        resolve({ passed: 0, failed: 1, errors });
      });
    });
  }

  private async generateReport(): Promise<void> {
    const totalDuration = Date.now() - this.startTime;
    const totalPassed = this.results.reduce((sum, r) => sum + r.passed, 0);
    const totalFailed = this.results.reduce((sum, r) => sum + r.failed, 0);
    const totalErrors = this.results.reduce((sum, r) => sum + r.errors.length, 0);

    const report: SecurityReport = {
      timestamp: new Date().toISOString(),
      totalPassed,
      totalFailed,
      totalErrors,
      suites: this.results,
      recommendations: this.generateRecommendations()
    };

    // Save report to file
    await this.saveReport(report);

    // Display summary
    console.log("📊 Security Test Summary");
    console.log("=" .repeat(50));
    console.log(`Total Tests Run: ${totalPassed + totalFailed}`);
    console.log(`✅ Passed: ${totalPassed}`);
    console.log(`❌ Failed: ${totalFailed}`);
    console.log(`🚫 Errors: ${totalErrors}`);
    console.log(`⏱️  Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`📈 Success Rate: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(2)}%`);

    if (totalFailed > 0 || totalErrors > 0) {
      console.log("\n⚠️  Security Issues Detected:");
      this.results.forEach(suite => {
        if (suite.failed > 0 || suite.errors.length > 0) {
          console.log(`\n🔍 ${suite.suite}:`);
          suite.errors.forEach(error => console.log(`   - ${error}`));
        }
      });
    }

    console.log("\n💡 Recommendations:");
    report.recommendations.forEach(rec => console.log(`   - ${rec}`));

    console.log(`\n📄 Detailed report saved to: test-results/security/security-report-${Date.now()}.json`);
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    
    this.results.forEach(suite => {
      if (suite.failed > 0) {
        switch (suite.suite) {
          case "Authorization Tests":
            recommendations.push("Review and strengthen access control mechanisms");
            recommendations.push("Implement proper role-based permissions");
            break;
          case "Input Validation Tests":
            recommendations.push("Enhance input sanitization and validation");
            recommendations.push("Implement comprehensive input filtering");
            break;
          case "Replay Attack Tests":
            recommendations.push("Strengthen transaction replay protection");
            recommendations.push("Implement proper nonce and timestamp validation");
            break;
        }
      }
    });

    const totalFailed = this.results.reduce((sum, r) => sum + r.failed, 0);
    if (totalFailed === 0) {
      recommendations.push("All security tests passed! Continue monitoring and regular testing");
    }

    return recommendations;
  }

  private async saveReport(report: SecurityReport): Promise<void> {
    const reportsDir = path.join(process.cwd(), 'test-results', 'security');
    
    // Ensure directory exists
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const filename = `security-report-${Date.now()}.json`;
    const filepath = path.join(reportsDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
  }
}

// Main execution
async function main() {
  const runner = new SecurityTestRunner();
  
  try {
    await runner.runAllTests();
    process.exit(0);
  } catch (error: any) {
    console.error("❌ Security test runner failed:", error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { SecurityTestRunner, SecurityTestResult, SecurityReport };
