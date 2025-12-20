import * as anchor from "@coral-xyz/anchor";
import { LoadTestFramework, LoadTestDataGenerator } from "./load-test-framework";
import { TestUtils } from "../utils/index";
import { expect } from "chai";

/**
 * Network Condition Tests
 * Tests system resilience under various network conditions (latency, packet loss, partitions)
 */
describe("Network Condition Tests", () => {
  let framework: LoadTestFramework;
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

    framework = new LoadTestFramework(connection);
  });

  describe("High Latency Network Simulation", () => {
    it("Should handle high latency network conditions (1000ms)", async () => {
      const sessionId = framework.startMonitoring("high_latency_1000ms");

      try {
        const operationCount = 50;
        const simulatedLatency = 1000;

        console.log(`Testing high latency: ${simulatedLatency}ms delay for ${operationCount} operations`);

        const results = [];
        for (let i = 0; i < operationCount; i++) {
          const result = await framework.executeTransaction(
            sessionId,
            () => framework.simulateNetworkConditions(
              async () => {
                await TestUtils.delay(Math.random() * 100 + 50);
                return {
                  signature: TestUtils.generateTestId(`latency_${i}`),
                  timestamp: Date.now()
                };
              },
              { latency: simulatedLatency }
            ),
            `High Latency Operation ${i + 1}/${operationCount}`
          );

          results.push(result);
        }

        const testResults = framework.stopMonitoring(sessionId);
        const successfulOps = results.filter(r => r.success).length;

        expect(successfulOps).to.be.at.least(operationCount * 0.95);
        expect(testResults.metrics.averageLatency).to.be.above(simulatedLatency * 0.8);

        console.log(`✅ High latency test completed:`);
        console.log(`   Success Rate: ${(successfulOps / operationCount * 100).toFixed(1)}%`);
        console.log(`   Average Latency: ${testResults.metrics.averageLatency.toFixed(2)}ms`);

        await framework.saveResults(sessionId, testResults);

      } catch (error) {
        console.error("High latency test failed:", error);
        throw error;
      }
    }).timeout(120000);

    it("Should handle variable latency conditions", async () => {
      const sessionId = framework.startMonitoring("variable_latency");

      try {
        const operationCount = 40;

        console.log(`Testing variable latency conditions for ${operationCount} operations`);

        const results = [];
        for (let i = 0; i < operationCount; i++) {
          const simulatedLatency = Math.random() * 2000 + 100; // 100-2100ms

          const result = await framework.executeTransaction(
            sessionId,
            () => framework.simulateNetworkConditions(
              async () => {
                await TestUtils.delay(Math.random() * 50 + 25);
                return {
                  signature: TestUtils.generateTestId(`variable_${i}`),
                  actualLatency: simulatedLatency,
                  timestamp: Date.now()
                };
              },
              { latency: simulatedLatency }
            ),
            `Variable Latency ${i + 1}/${operationCount}`
          );

          results.push(result);
        }

        const testResults = framework.stopMonitoring(sessionId);
        const successfulOps = results.filter(r => r.success).length;

        expect(successfulOps).to.be.at.least(operationCount * 0.9);
        expect(testResults.metrics.averageLatency).to.be.at.least(400);
        expect(testResults.metrics.averageLatency).to.be.below(1500);

        console.log(`✅ Variable latency test completed:`);
        console.log(`   Success Rate: ${(successfulOps / operationCount * 100).toFixed(1)}%`);
        console.log(`   Average Latency: ${testResults.metrics.averageLatency.toFixed(2)}ms`);

        await framework.saveResults(sessionId, testResults);

      } catch (error) {
        console.error("Variable latency test failed:", error);
        throw error;
      }
    }).timeout(180000);
  });

  describe("Packet Loss Simulation", () => {
    it("Should handle moderate packet loss (5%)", async () => {
      const sessionId = framework.startMonitoring("packet_loss_5_percent");

      try {
        const operationCount = 60;
        const packetLossRate = 0.05;

        console.log(`Testing packet loss: ${(packetLossRate * 100)}% loss rate for ${operationCount} operations`);

        const results = [];
        for (let i = 0; i < operationCount; i++) {
          const result = await framework.executeTransaction(
            sessionId,
            () => framework.simulateNetworkConditions(
              async () => {
                await TestUtils.delay(Math.random() * 80 + 40);
                return {
                  signature: TestUtils.generateTestId(`packet_loss_${i}`),
                  timestamp: Date.now()
                };
              },
              { packetLoss: packetLossRate }
            ),
            `Packet Loss Test ${i + 1}/${operationCount}`
          );

          results.push(result);
        }

        const testResults = framework.stopMonitoring(sessionId);
        const successfulOps = results.filter(r => r.success).length;
        const actualLossRate = (operationCount - successfulOps) / operationCount;

        expect(successfulOps).to.be.at.least(operationCount * 0.85);
        expect(actualLossRate).to.be.below(packetLossRate + 0.1);

        console.log(`✅ Packet loss test completed:`);
        console.log(`   Success Rate: ${(successfulOps / operationCount * 100).toFixed(1)}%`);
        console.log(`   Expected Loss: ${(packetLossRate * 100).toFixed(1)}%`);
        console.log(`   Actual Loss: ${(actualLossRate * 100).toFixed(1)}%`);

        await framework.saveResults(sessionId, testResults);

      } catch (error) {
        console.error("Packet loss test failed:", error);
        throw error;
      }
    }).timeout(150000);
  });

  describe("Network Partition Recovery", () => {
    it("Should handle temporary network partitions", async () => {
      const sessionId = framework.startMonitoring("network_partition");

      try {
        const operationCount = 30;

        console.log(`Testing network partition recovery for ${operationCount} operations`);

        const results = [];
        for (let i = 0; i < operationCount; i++) {
          const shouldSimulatePartition = i >= 10 && i <= 15;

          const result = await framework.executeTransaction(
            sessionId,
            () => framework.simulateNetworkConditions(
              async () => {
                if (shouldSimulatePartition) {
                  throw new Error("Network partition detected");
                }

                await TestUtils.delay(Math.random() * 100 + 50);
                return {
                  signature: TestUtils.generateTestId(`partition_${i}`),
                  partitioned: shouldSimulatePartition,
                  timestamp: Date.now()
                };
              },
              {
                timeout: shouldSimulatePartition ? 1000 : 10000,
                latency: shouldSimulatePartition ? 5000 : 0
              }
            ),
            `Partition Test ${i + 1}/${operationCount} ${shouldSimulatePartition ? '(Partitioned)' : '(Normal)'}`
          );

          results.push(result);

          // Simulate recovery
          if (shouldSimulatePartition && i === 15) {
            await TestUtils.delay(2000);
          }
        }

        const testResults = framework.stopMonitoring(sessionId);
        const successfulOps = results.filter(r => r.success).length;
        const normalOps = results.filter(r => r.success || (!r.result?.partitioned));
        const normalSuccessRate = normalOps.filter(r => r.success).length / normalOps.length;

        expect(normalSuccessRate).to.be.at.least(0.9);
        expect(successfulOps).to.be.at.least(operationCount * 0.7);

        console.log(`✅ Network partition test completed:`);
        console.log(`   Overall Success Rate: ${(successfulOps / operationCount * 100).toFixed(1)}%`);
        console.log(`   Normal Operations Success Rate: ${(normalSuccessRate * 100).toFixed(1)}%`);

        await framework.saveResults(sessionId, testResults);

      } catch (error) {
        console.error("Network partition test failed:", error);
        throw error;
      }
    }).timeout(120000);
  });

  describe("Bandwidth Limitation", () => {
    it("Should handle limited bandwidth scenarios", async () => {
      const sessionId = framework.startMonitoring("bandwidth_limitation");

      try {
        const operationCount = 40;

        console.log(`Testing bandwidth limitation for ${operationCount} operations`);

        const results = [];
        for (let i = 0; i < operationCount; i++) {
          const dataSize = Math.floor(Math.random() * 10000) + 1000; // 1KB-11KB

          const result = await framework.executeTransaction(
            sessionId,
            () => framework.simulateNetworkConditions(
              async () => {
                // Simulate bandwidth-limited data transfer
                const transferTime = dataSize / 1000; // Simulate 1KB/s transfer
                await TestUtils.delay(transferTime + Math.random() * 100);

                return {
                  signature: TestUtils.generateTestId(`bandwidth_${i}`),
                  dataSize,
                  transferTime,
                  timestamp: Date.now()
                };
              },
              { latency: dataSize / 500 } // Simulate bandwidth-induced latency
            ),
            `Bandwidth Test ${i + 1}/${operationCount} (${(dataSize / 1024).toFixed(1)}KB)`
          );

          results.push(result);
        }

        const testResults = framework.stopMonitoring(sessionId);
        const successfulOps = results.filter(r => r.success).length;

        expect(successfulOps).to.be.at.least(operationCount * 0.9);

        console.log(`✅ Bandwidth limitation test completed:`);
        console.log(`   Success Rate: ${(successfulOps / operationCount * 100).toFixed(1)}%`);
        console.log(`   Average Latency: ${testResults.metrics.averageLatency.toFixed(2)}ms`);

        await framework.saveResults(sessionId, testResults);

      } catch (error) {
        console.error("Bandwidth limitation test failed:", error);
        throw error;
      }
    }).timeout(180000);
  });
});
