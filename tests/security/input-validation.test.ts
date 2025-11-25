import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { SecurityTestFramework } from "./security-test-framework.js";
import { TestUtils } from "../utils/index.js";

/**
 * Input Validation Security Tests
 * Tests malicious input handling, buffer overflow protection, and data sanitization
 */

describe("Input Validation Security Tests", () => {
  let framework: SecurityTestFramework;
  let connection: anchor.web3.Connection;
  let provider: anchor.AnchorProvider;

  before(async () => {
    connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
    const wallet = anchor.Wallet.local();
    provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed"
    });
    anchor.setProvider(provider);

    framework = new SecurityTestFramework(connection);
  });

  describe("Buffer Overflow Protection", () => {
    it("Should reject oversized string inputs", async () => {
      const sessionId = "buffer_overflow_protection";
      framework.startSession(sessionId);
      
      try {
        const maliciousInputs = [
          {
            type: 'buffer_overflow' as const,
            payload: 'A'.repeat(10000),
            expectedBehavior: 'reject' as const,
            description: 'Large string buffer overflow test'
          },
          {
            type: 'buffer_overflow' as const,
            payload: Buffer.alloc(50000).fill('X').toString(),
            expectedBehavior: 'reject' as const,
            description: 'Extremely large string test'
          },
          {
            type: 'buffer_overflow' as const,
            payload: '\0'.repeat(10000),
            expectedBehavior: 'reject' as const,
            description: 'Null character buffer test'
          }
        ];

        await framework.testInputValidation(
          sessionId,
          "Buffer Overflow Protection",
          async (input: any) => {
            return TestUtils.simulateAuthorizationWithMaliciousInput(
              provider.wallet.publicKey,
              "create_token",
              input
            );
          },
          maliciousInputs
        );

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`Buffer overflow protection metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);

    it("Should handle large number inputs safely", async () => {
      const sessionId = "large_number_handling";
      framework.startSession(sessionId);
      
      try {
        const largeNumbers = [
          {
            type: 'integer_overflow' as const,
            payload: Number.MAX_SAFE_INTEGER.toString(),
            expectedBehavior: 'reject' as const,
            description: 'Maximum safe integer test'
          },
          {
            type: 'integer_overflow' as const,
            payload: '999999999999999999999999999999999999999',
            expectedBehavior: 'reject' as const,
            description: 'Extremely large number test'
          },
          {
            type: 'integer_overflow' as const,
            payload: '18446744073709551615', // 2^64 - 1
            expectedBehavior: 'reject' as const,
            description: 'Maximum 64-bit integer test'
          }
        ];

        await framework.testInputValidation(
          sessionId,
          "Large Number Handling",
          async (input: any) => {
            return TestUtils.simulateAuthorizationWithMaliciousInput(
              provider.wallet.publicKey,
              "create_token",
              input
            );
          },
          largeNumbers
        );

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`Large number handling metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);
  });

  describe("SQL Injection Prevention", () => {
    it("Should block SQL injection attempts", async () => {
      const sessionId = "sql_injection_prevention";
      framework.startSession(sessionId);
      
      try {
        const sqlInjectionPayloads = [
          {
            type: 'sql_injection' as const,
            payload: "'; DROP TABLE users; --",
            expectedBehavior: 'reject' as const,
            description: 'SQL DROP TABLE injection'
          },
          {
            type: 'sql_injection' as const,
            payload: "' OR '1'='1",
            expectedBehavior: 'reject' as const,
            description: 'SQL boolean injection'
          },
          {
            type: 'sql_injection' as const,
            payload: "'; INSERT INTO users VALUES('hacker', 'password'); --",
            expectedBehavior: 'reject' as const,
            description: 'SQL INSERT injection'
          },
          {
            type: 'sql_injection' as const,
            payload: "' UNION SELECT * FROM users --",
            expectedBehavior: 'reject' as const,
            description: 'SQL UNION injection'
          }
        ];

        await framework.testInputValidation(
          sessionId,
          "SQL Injection Prevention",
          async (input: any) => {
            return TestUtils.simulateAuthorizationWithMaliciousInput(
              provider.wallet.publicKey,
              "create_token",
              input
            );
          },
          sqlInjectionPayloads
        );

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`SQL injection prevention metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);
  });

  describe("XSS Prevention", () => {
    it("Should sanitize XSS attempts", async () => {
      const sessionId = "xss_prevention";
      framework.startSession(sessionId);
      
      try {
        const xssPayloads = [
          {
            type: 'xss' as const,
            payload: '<script>alert("XSS")</script>',
            expectedBehavior: 'sanitize' as const,
            description: 'Basic script injection'
          },
          {
            type: 'xss' as const,
            payload: 'javascript:alert("XSS")',
            expectedBehavior: 'sanitize' as const,
            description: 'JavaScript protocol injection'
          },
          {
            type: 'xss' as const,
            payload: '<img src="x" onerror="alert(\'XSS\')">',
            expectedBehavior: 'sanitize' as const,
            description: 'Image tag injection'
          },
          {
            type: 'xss' as const,
            payload: '<iframe src="javascript:alert(\'XSS\')"></iframe>',
            expectedBehavior: 'sanitize' as const,
            description: 'iframe injection'
          }
        ];

        await framework.testInputValidation(
          sessionId,
          "XSS Prevention",
          async (input: any) => {
            return TestUtils.simulateAuthorizationWithMaliciousInput(
              provider.wallet.publicKey,
              "create_token",
              input
            );
          },
          xssPayloads
        );

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`XSS prevention metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);
  });

  describe("Path Traversal Prevention", () => {
    it("Should block path traversal attempts", async () => {
      const sessionId = "path_traversal_prevention";
      framework.startSession(sessionId);
      
      try {
        const pathTraversalPayloads = [
          {
            type: 'path_traversal' as const,
            payload: '../../../etc/passwd',
            expectedBehavior: 'reject' as const,
            description: 'Unix path traversal'
          },
          {
            type: 'path_traversal' as const,
            payload: '..\\..\\..\\windows\\system32\\config\\system',
            expectedBehavior: 'reject' as const,
            description: 'Windows path traversal'
          },
          {
            type: 'path_traversal' as const,
            payload: '....//....//....//etc/passwd',
            expectedBehavior: 'reject' as const,
            description: 'Encoded path traversal'
          },
          {
            type: 'path_traversal' as const,
            payload: '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
            expectedBehavior: 'reject' as const,
            description: 'URL encoded path traversal'
          }
        ];

        await framework.testInputValidation(
          sessionId,
          "Path Traversal Prevention",
          async (input: any) => {
            return TestUtils.simulateAuthorizationWithMaliciousInput(
              provider.wallet.publicKey,
              "create_token",
              input
            );
          },
          pathTraversalPayloads
        );

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`Path traversal prevention metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);
  });

  describe("Command Injection Prevention", () => {
    it("Should block command injection attempts", async () => {
      const sessionId = "command_injection_prevention";
      framework.startSession(sessionId);
      
      try {
        const commandInjectionPayloads = [
          {
            type: 'command_injection' as const,
            payload: '; rm -rf /',
            expectedBehavior: 'reject' as const,
            description: 'Shell command injection'
          },
          {
            type: 'command_injection' as const,
            payload: '&& cat /etc/passwd',
            expectedBehavior: 'reject' as const,
            description: 'Command chaining injection'
          },
          {
            type: 'command_injection' as const,
            payload: '| whoami',
            expectedBehavior: 'reject' as const,
            description: 'Pipe command injection'
          },
          {
            type: 'command_injection' as const,
            payload: '`id`',
            expectedBehavior: 'reject' as const,
            description: 'Backtick command injection'
          }
        ];

        await framework.testInputValidation(
          sessionId,
          "Command Injection Prevention",
          async (input: any) => {
            return TestUtils.simulateAuthorizationWithMaliciousInput(
              provider.wallet.publicKey,
              "create_token",
              input
            );
          },
          commandInjectionPayloads
        );

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`Command injection prevention metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);
  });

  describe("String Format Attack Prevention", () => {
    it("Should prevent format string vulnerabilities", async () => {
      const sessionId = "string_format_prevention";
      framework.startSession(sessionId);
      
      try {
        const formatStringPayloads = [
          {
            type: 'string_format' as const,
            payload: '%s%s%s%s%s%s%s%s%s%s%s%s',
            expectedBehavior: 'reject' as const,
            description: 'Multiple format specifiers'
          },
          {
            type: 'string_format' as const,
            payload: '%x%x%x%x%x%x%x%x%x%x%x',
            expectedBehavior: 'reject' as const,
            description: 'Hex format specifiers'
          },
          {
            type: 'string_format' as const,
            payload: '%n%n%n%n%n%n%n%n%n%n',
            expectedBehavior: 'reject' as const,
            description: 'Write format specifiers'
          },
          {
            type: 'string_format' as const,
            payload: '%999999999999s',
            expectedBehavior: 'reject' as const,
            description: 'Large width specifier'
          }
        ];

        await framework.testInputValidation(
          sessionId,
          "String Format Attack Prevention",
          async (input: any) => {
            return TestUtils.simulateAuthorizationWithMaliciousInput(
              provider.wallet.publicKey,
              "create_token",
              input
            );
          },
          formatStringPayloads
        );

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`String format prevention metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);
  });

  describe("Data Type Validation", () => {
    it("Should validate input data types correctly", async () => {
      const sessionId = "data_type_validation";
      framework.startSession(sessionId);
      
      try {
        await framework.executeSecurityTest(
          sessionId,
          "Data Type Validation",
          async () => {
            // Test with various invalid data types
            const invalidInputs = [
              null,
              undefined,
              [],
              {},
              () => {},
              new Date(),
              /regex/
            ];

            for (const input of invalidInputs) {
              const result = await TestUtils.simulateAuthorizationWithMaliciousInput(
                provider.wallet.publicKey,
                "create_token",
                input
              );

              if (!result.rejected) {
                throw new Error(`Invalid data type was accepted: ${typeof input}`);
              }
            }

            console.log("✓ Data type validation working correctly");
          },
          "Data Type Validation Vulnerability",
          "medium"
        );

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`Data type validation metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);
  });

  describe("Unicode and Encoding Validation", () => {
    it("Should handle malicious Unicode sequences", async () => {
      const sessionId = "unicode_encoding_validation";
      framework.startSession(sessionId);
      
      try {
        const unicodePayloads = [
          '\u0000\u0000\u0000\u0000', // Null bytes
          '\uFEFF<script>alert("XSS")</script>', // BOM with script
          '\u202E<script>alert("XSS")</script>', // Right-to-left override
          '\u200B<script>alert("XSS")</script>', // Zero-width space
          '\uff1c\u0053\u0043\u0052\u0049\u0050\u0054\u003e' // Fullwidth HTML
        ];

        for (const payload of unicodePayloads) {
          await framework.executeSecurityTest(
            sessionId,
            `Unicode Validation - ${payload.substring(0, 20)}...`,
            async () => {
              const result = await TestUtils.simulateAuthorizationWithMaliciousInput(
                provider.wallet.publicKey,
                "create_token",
                payload
              );

              if (!result.rejected) {
                throw new Error(`Malicious Unicode sequence was accepted: ${payload}`);
              }

              console.log(`✓ Unicode payload rejected: ${payload.substring(0, 20)}...`);
            },
            "Unicode Encoding Vulnerability",
            "medium"
          );
        }

        const metrics = framework.getSecurityMetrics(sessionId);
        console.log(`Unicode encoding validation metrics:`, metrics);
        
      } finally {
        framework.stopSession(sessionId);
      }
    }).timeout(30000);
  });

  after(async () => {
    console.log("Input validation security tests completed");
  });
});
