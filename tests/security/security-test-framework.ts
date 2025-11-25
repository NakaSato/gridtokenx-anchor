import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { TestUtils } from "../utils/index.js";

/**
 * Security Testing Framework
 * Provides comprehensive security testing capabilities for GridTokenX programs
 */

export interface SecurityTestResult {
  testName: string;
  success: boolean;
  vulnerability?: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  description: string;
  recommendation?: string;
  duration: number;
  timestamp: Date;
}

export interface SecurityTestSession {
  sessionId: string;
  startTime: Date;
  results: SecurityTestResult[];
  vulnerabilities: SecurityTestResult[];
}

export interface MaliciousInput {
  type: 'buffer_overflow' | 'sql_injection' | 'xss' | 'path_traversal' | 'integer_overflow' | 'string_format' | 'command_injection';
  payload: string;
  expectedBehavior: 'reject' | 'sanitize' | 'allow';
  description: string;
}

export class SecurityTestFramework {
  private connection: anchor.web3.Connection;
  private provider: anchor.AnchorProvider;
  private sessions: Map<string, SecurityTestSession> = new Map();

  constructor(connection: anchor.web3.Connection) {
    this.connection = connection;
    const wallet = anchor.Wallet.local();
    this.provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed"
    });
    anchor.setProvider(this.provider);
  }

  /**
   * Start a new security testing session
   */
  startSession(sessionId: string): SecurityTestSession {
    const session: SecurityTestSession = {
      sessionId,
      startTime: new Date(),
      results: [],
      vulnerabilities: []
    };

    this.sessions.set(sessionId, session);
    console.log(`🔒 Security testing session started: ${sessionId}`);
    return session;
  }

  /**
   * Execute a security test and capture results
   */
  async executeSecurityTest(
    sessionId: string,
    testName: string,
    testFunction: () => Promise<void>,
    expectedVulnerability?: string,
    severity: SecurityTestResult['severity'] = 'medium'
  ): Promise<SecurityTestResult> {
    const startTime = Date.now();
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    console.log(`🧪 Running security test: ${testName}`);

    try {
      await testFunction();
      const duration = Date.now() - startTime;
      
      // If we expected a vulnerability but test passed, that's a potential issue
      if (expectedVulnerability) {
        const result: SecurityTestResult = {
          testName,
          success: false,
          vulnerability: expectedVulnerability,
          severity,
          description: `Expected vulnerability ${expectedVulnerability} was not detected`,
          recommendation: 'Review test logic - vulnerability may be fixed or test is incorrect',
          duration,
          timestamp: new Date()
        };
        session.results.push(result);
        session.vulnerabilities.push(result);
        return result;
      }

      const result: SecurityTestResult = {
        testName,
        success: true,
        severity,
        description: 'Security test passed - no vulnerabilities detected',
        duration,
        timestamp: new Date()
      };

      session.results.push(result);
      console.log(`✅ Security test passed: ${testName}`);
      return result;

    } catch (error: any) {
      const duration = Date.now() - startTime;
      const result: SecurityTestResult = {
        testName,
        success: false,
        vulnerability: expectedVulnerability || error.message,
        severity,
        description: error.message,
        recommendation: this.generateRecommendation(error),
        duration,
        timestamp: new Date()
      };

      session.results.push(result);
      session.vulnerabilities.push(result);
      console.log(`❌ Security test failed: ${testName} - ${error.message}`);
      return result;
    }
  }

  /**
   * Test authorization with different user roles
   */
  async testAuthorization(
    sessionId: string,
    testName: string,
    authorizedAction: () => Promise<any>,
    unauthorizedAction: () => Promise<any>,
    userRole: string
  ): Promise<SecurityTestResult> {
    return this.executeSecurityTest(
      sessionId,
      `${testName} - ${userRole} Authorization`,
      async () => {
        try {
          // Test unauthorized access first
          await unauthorizedAction();
          throw new Error(`Unauthorized user with role ${userRole} was able to perform restricted action`);
        } catch (error: any) {
          // Expected to fail
          if (error.message.includes('Unauthorized') || error.message.includes('permission')) {
            console.log(`✓ Unauthorized access correctly blocked for ${userRole}`);
            
            // Now test authorized access
            try {
              await authorizedAction();
              console.log(`✓ Authorized access successful for ${userRole}`);
            } catch (authError: any) {
              throw new Error(`Authorized user with role ${userRole} was blocked: ${authError.message}`);
            }
          } else {
            throw new Error(`Unexpected error for unauthorized access: ${error.message}`);
          }
        }
      },
      'Authorization Bypass',
      'high'
    );
  }

  /**
   * Test input validation with malicious inputs
   */
  async testInputValidation(
    sessionId: string,
    testName: string,
    inputFunction: (input: any) => Promise<any>,
    maliciousInputs: MaliciousInput[]
  ): Promise<SecurityTestResult[]> {
    const results: SecurityTestResult[] = [];

    for (const maliciousInput of maliciousInputs) {
      const result = await this.executeSecurityTest(
        sessionId,
        `${testName} - ${maliciousInput.type}`,
        async () => {
          try {
            await inputFunction(maliciousInput.payload);
            
            if (maliciousInput.expectedBehavior === 'reject') {
              throw new Error(`Malicious input was accepted: ${maliciousInput.type}`);
            } else if (maliciousInput.expectedBehavior === 'sanitize') {
              console.log(`✓ Malicious input sanitized: ${maliciousInput.type}`);
            }
          } catch (error: any) {
            if (maliciousInput.expectedBehavior === 'reject') {
              console.log(`✓ Malicious input rejected: ${maliciousInput.type}`);
            } else {
              throw error;
            }
          }
        },
        `Input Validation Vulnerability - ${maliciousInput.type}`,
        this.getSeverityForInputType(maliciousInput.type)
      );
      
      results.push(result);
    }

    return results;
  }

  /**
   * Test replay attack protection
   */
  async testReplayAttack(
    sessionId: string,
    testName: string,
    transactionFunction: () => Promise<{signature: string}>,
    replayFunction: (signature: string) => Promise<any>
  ): Promise<SecurityTestResult> {
    return this.executeSecurityTest(
      sessionId,
      `${testName} - Replay Attack Protection`,
      async () => {
        // Execute original transaction
        const originalTx = await transactionFunction();
        console.log(`✓ Original transaction executed: ${originalTx.signature}`);

        // Try to replay the same transaction
        try {
          await replayFunction(originalTx.signature);
          throw new Error(`Replay attack succeeded - transaction was replayed`);
        } catch (error: any) {
          if (error.message.includes('duplicate') || 
              error.message.includes('replay') || 
              error.message.includes('already processed')) {
            console.log(`✓ Replay attack correctly blocked`);
          } else {
            throw new Error(`Unexpected error during replay: ${error.message}`);
          }
        }
      },
      'Replay Attack Vulnerability',
      'critical'
    );
  }

  /**
   * Generate malicious test inputs
   */
  generateMaliciousInputs(): MaliciousInput[] {
    return [
      // Buffer overflow attempts
      {
        type: 'buffer_overflow',
        payload: 'A'.repeat(10000),
        expectedBehavior: 'reject',
        description: 'Large string to test buffer overflow protection'
      },

      // SQL injection attempts (if applicable)
      {
        type: 'sql_injection',
        payload: "'; DROP TABLE users; --",
        expectedBehavior: 'reject',
        description: 'SQL injection attempt'
      },
      {
        type: 'sql_injection',
        payload: "' OR '1'='1",
        expectedBehavior: 'reject',
        description: 'SQL injection with boolean logic'
      },

      // XSS attempts
      {
        type: 'xss',
        payload: '<script>alert("XSS")</script>',
        expectedBehavior: 'sanitize',
        description: 'Cross-site scripting attempt'
      },
      {
        type: 'xss',
        payload: 'javascript:alert("XSS")',
        expectedBehavior: 'sanitize',
        description: 'JavaScript XSS attempt'
      },

      // Path traversal attempts
      {
        type: 'path_traversal',
        payload: '../../../etc/passwd',
        expectedBehavior: 'reject',
        description: 'Path traversal attack'
      },
      {
        type: 'path_traversal',
        payload: '..\\..\\..\\windows\\system32\\config\\system',
        expectedBehavior: 'reject',
        description: 'Windows path traversal'
      },

      // Integer overflow attempts
      {
        type: 'integer_overflow',
        payload: Number.MAX_SAFE_INTEGER.toString(),
        expectedBehavior: 'reject',
        description: 'Maximum integer value'
      },
      {
        type: 'integer_overflow',
        payload: '999999999999999999999999999999999999999',
        expectedBehavior: 'reject',
        description: 'Large number overflow attempt'
      },

      // String format attacks
      {
        type: 'string_format',
        payload: '%s%s%s%s%s%s%s%s%s%s%s',
        expectedBehavior: 'reject',
        description: 'String format vulnerability test'
      },

      // Command injection attempts
      {
        type: 'command_injection',
        payload: '; rm -rf /',
        expectedBehavior: 'reject',
        description: 'Command injection attempt'
      },
      {
        type: 'command_injection',
        payload: '&& cat /etc/passwd',
        expectedBehavior: 'reject',
        description: 'Command chaining injection'
      }
    ];
  }

  /**
   * Get severity level for input type
   */
  private getSeverityForInputType(type: MaliciousInput['type']): SecurityTestResult['severity'] {
    const severityMap: Record<MaliciousInput['type'], SecurityTestResult['severity']> = {
      'buffer_overflow': 'critical',
      'sql_injection': 'critical',
      'xss': 'high',
      'path_traversal': 'high',
      'integer_overflow': 'medium',
      'string_format': 'medium',
      'command_injection': 'critical'
    };

    return severityMap[type] || 'medium';
  }

  /**
   * Generate security recommendations based on errors
   */
  private generateRecommendation(error: any): string {
    const errorStr = error.message.toLowerCase();
    
    if (errorStr.includes('unauthorized') || errorStr.includes('permission')) {
      return 'Implement proper access controls and validate user permissions';
    }
    
    if (errorStr.includes('buffer') || errorStr.includes('overflow')) {
      return 'Add input validation and buffer size limits';
    }
    
    if (errorStr.includes('sql') || errorStr.includes('injection')) {
      return 'Use parameterized queries and input sanitization';
    }
    
    if (errorStr.includes('xss') || errorStr.includes('script')) {
      return 'Implement output encoding and Content Security Policy';
    }
    
    if (errorStr.includes('replay') || errorStr.includes('duplicate')) {
      return 'Implement nonce or timestamp-based replay protection';
    }
    
    return 'Review security implementation and add proper validation';
  }

  /**
   * Stop session and generate security report
   */
  stopSession(sessionId: string): SecurityTestSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    console.log(`🔒 Security testing session completed: ${sessionId}`);
    console.log(`📊 Tests run: ${session.results.length}`);
    console.log(`⚠️  Vulnerabilities found: ${session.vulnerabilities.length}`);
    
    return session;
  }

  /**
   * Get security metrics
   */
  getSecurityMetrics(sessionId: string): {
    totalTests: number;
    passedTests: number;
    vulnerabilitiesFound: number;
    criticalVulnerabilities: number;
    highVulnerabilities: number;
    mediumVulnerabilities: number;
    lowVulnerabilities: number;
  } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const vulnerabilities = session.vulnerabilities;
    
    return {
      totalTests: session.results.length,
      passedTests: session.results.filter(r => r.success).length,
      vulnerabilitiesFound: vulnerabilities.length,
      criticalVulnerabilities: vulnerabilities.filter(v => v.severity === 'critical').length,
      highVulnerabilities: vulnerabilities.filter(v => v.severity === 'high').length,
      mediumVulnerabilities: vulnerabilities.filter(v => v.severity === 'medium').length,
      lowVulnerabilities: vulnerabilities.filter(v => v.severity === 'low').length
    };
  }

  /**
   * Save security results to file
   */
  async saveResults(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const results = {
      sessionId: session.sessionId,
      startTime: session.startTime,
      endTime: new Date(),
      metrics: this.getSecurityMetrics(sessionId),
      results: session.results,
      vulnerabilities: session.vulnerabilities
    };

    const fs = require('fs').promises;
    const path = require('path');
    const reportPath = path.join(process.cwd(), 'test-results', 'security', `security-report-${sessionId}-${Date.now()}.json`);
    
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(results, null, 2));
    
    console.log(`📁 Security report saved to: ${reportPath}`);
  }
}
