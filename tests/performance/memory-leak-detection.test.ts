/**
 * Memory Leak Detection Tests
 * Tests for memory leaks in long-running operations and provides optimization recommendations
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import { TestUtils } from '../utils/index.js';

interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  arrayBuffers: number;
}

interface MemoryLeakReport {
  sessionId: string;
  testDuration: number;
  snapshots: MemorySnapshot[];
  leakDetected: boolean;
  leakRate: number;
  peakMemoryUsage: number;
  averageMemoryUsage: number;
  memoryGrowthPattern: number[];
  recommendations: string[];
}

/**
 * Memory Leak Detection Framework
 */
class MemoryLeakDetector {
  private snapshots: MemorySnapshot[] = [];
  private startTime: number = 0;
  private monitoringInterval: NodeJS.Timeout | null = null;

  /**
   * Start memory monitoring
   */
  startMonitoring(): void {
    this.startTime = Date.now();
    this.snapshots = [];
    
    // Take memory snapshot every 5 seconds
    this.monitoringInterval = setInterval(() => {
      this.takeSnapshot();
    }, 5000);
    
    console.log("🔍 Memory monitoring started");
  }

  /**
   * Stop memory monitoring and analyze results
   */
  stopMonitoring(): MemoryLeakReport {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    const testDuration = Date.now() - this.startTime;
    const report = this.analyzeMemoryUsage(testDuration);
    
    console.log("🔍 Memory monitoring stopped");
    return report;
  }

  /**
   * Take a memory snapshot
   */
  private takeSnapshot(): void {
    const memUsage = process.memoryUsage();
    
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
      arrayBuffers: memUsage.arrayBuffers || 0
    };
    
    this.snapshots.push(snapshot);
  }

  /**
   * Analyze memory usage for leaks
   */
  private analyzeMemoryUsage(testDuration: number): MemoryLeakReport {
    if (this.snapshots.length < 2) {
      throw new Error("Insufficient memory snapshots for analysis");
    }

    // Calculate memory growth pattern
    const memoryGrowthPattern = this.calculateMemoryGrowth();
    const leakRate = this.calculateLeakRate();
    const leakDetected = this.detectMemoryLeak(leakRate, memoryGrowthPattern);
    
    const recommendations = this.generateRecommendations(leakDetected, leakRate, memoryGrowthPattern);
    
    const peakMemoryUsage = Math.max(...this.snapshots.map(s => s.heapUsed));
    const averageMemoryUsage = this.snapshots.reduce((sum, s) => sum + s.heapUsed, 0) / this.snapshots.length;

    return {
      sessionId: `memory_leak_test_${Date.now()}`,
      testDuration,
      snapshots: this.snapshots,
      leakDetected,
      leakRate,
      peakMemoryUsage,
      averageMemoryUsage,
      memoryGrowthPattern,
      recommendations
    };
  }

  /**
   * Calculate memory growth pattern
   */
  private calculateMemoryGrowth(): number[] {
    const growthPattern: number[] = [];
    
    for (let i = 1; i < this.snapshots.length; i++) {
      const current = this.snapshots[i].heapUsed;
      const previous = this.snapshots[i - 1].heapUsed;
      const growth = (current - previous) / previous;
      growthPattern.push(growth);
    }
    
    return growthPattern;
  }

  /**
   * Calculate memory leak rate
   */
  private calculateLeakRate(): number {
    if (this.snapshots.length < 2) return 0;
    
    const first = this.snapshots[0].heapUsed;
    const last = this.snapshots[this.snapshots.length - 1].heapUsed;
    const timeDiff = (last - first) / (this.snapshots.length - 1);
    
    return timeDiff > 0 ? timeDiff : 0;
  }

  /**
   * Detect memory leak based on growth pattern
   */
  private detectMemoryLeak(leakRate: number, growthPattern: number[]): boolean {
    // Consistent positive growth indicates potential leak
    const positiveGrowthCount = growthPattern.filter(g => g > 0).length;
    const growthRatio = positiveGrowthCount / growthPattern.length;
    
    // Leak detected if >70% of measurements show growth
    return growthRatio > 0.7 && leakRate > 1024; // 1KB minimum leak rate
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(leakDetected: boolean, leakRate: number, growthPattern: number[]): string[] {
    const recommendations: string[] = [];
    
    if (leakDetected) {
      recommendations.push("🚨 MEMORY LEAK DETECTED - Immediate investigation required");
      recommendations.push(`   Leak rate: ${this.formatBytes(leakRate)} per interval`);
      
      if (leakRate > 1024 * 1024) { // 1MB per interval
        recommendations.push("   🔴 CRITICAL: High leak rate detected");
        recommendations.push("   - Check for unclosed event listeners");
        recommendations.push("   - Verify proper cleanup of large objects");
        recommendations.push("   - Review circular references");
      } else {
        recommendations.push("   🟡 MODERATE: Medium leak rate detected");
        recommendations.push("   - Review object lifecycle management");
        recommendations.push("   - Check for missed cleanup operations");
      }
    } else {
      recommendations.push("✅ No significant memory leaks detected");
    }
    
    // General optimization recommendations
    const avgGrowth = growthPattern.reduce((sum, g) => sum + g, 0) / growthPattern.length;
    if (avgGrowth > 0.01) { // 1% average growth
      recommendations.push("💡 OPTIMIZATION OPPORTUNITIES:");
      recommendations.push("   - Implement object pooling for frequently created objects");
      recommendations.push("   - Consider using Buffers for binary data");
      recommendations.push("   - Review memory allocation patterns");
    }
    
    // Peak memory recommendations
    const peakMemory = Math.max(...this.snapshots.map(s => s.heapUsed));
    if (peakMemory > 100 * 1024 * 1024) { // 100MB
      recommendations.push("📊 MEMORY USAGE:");
      recommendations.push(`   Peak usage: ${this.formatBytes(peakMemory)}`);
      recommendations.push("   - Consider memory budgeting");
      recommendations.push("   - Implement memory pressure handling");
    }
    
    return recommendations;
  }

  /**
   * Format bytes to human readable format
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}

/**
 * Memory Leak Test Runner
 */
async function runMemoryLeakTests() {
  console.log("🚀 Memory Leak Detection Tests");
  console.log("=".repeat(50));
  
  const detector = new MemoryLeakDetector();
  const connection = new Connection("http://localhost:8899", "confirmed");
  
  try {
    console.log("📋 Test 1: Long-Running Operations (5 minutes)");
    
    // Test 1: Long-running operations
    detector.startMonitoring();
    
    const longRunningOperations = async () => {
      const operations = [];
      
      // Simulate continuous operations for 5 minutes
      const endTime = Date.now() + (5 * 60 * 1000);
      
      while (Date.now() < endTime) {
        // Simulate various operations that might cause memory leaks
        const operation = {
          id: TestUtils.generateTestId("memory_test"),
          data: new Array(1000).fill(0).map(() => Math.random()),
          timestamp: Date.now()
        };
        
        operations.push(operation);
        
        // Simulate some cleanup (but intentionally incomplete for testing)
        if (operations.length > 100) {
          operations.splice(0, 50); // Partial cleanup
        }
        
        await TestUtils.delay(1000);
      }
    };
    
    await longRunningOperations();
    const report1 = detector.stopMonitoring();
    
    console.log("✅ Long-running operations test completed:");
    console.log(`   Duration: ${(report1.testDuration / 1000 / 60).toFixed(1)} minutes`);
    console.log(`   Leak Detected: ${report1.leakDetected ? 'YES' : 'NO'}`);
    console.log(`   Leak Rate: ${detector['formatBytes'](report1.leakRate)}/interval`);
    console.log(`   Peak Memory: ${detector['formatBytes'](report1.peakMemoryUsage)}`);
    
    report1.recommendations.forEach(rec => console.log(`   ${rec}`));
    
    console.log("\n📋 Test 2: High-Frequency Operations");
    
    // Test 2: High-frequency operations
    detector.startMonitoring();
    
    const highFrequencyOperations = async () => {
      const largeObjects = [];
      
      // Create and manipulate many objects quickly
      for (let i = 0; i < 10000; i++) {
        const largeObject = {
          id: i,
          data: new Array(10000).fill(0).map(() => Math.random()),
          metadata: {
            created: Date.now(),
            type: 'test_object',
            tags: Array(100).fill(0).map(() => TestUtils.generateTestId('tag'))
          }
        };
        
        largeObjects.push(largeObject);
        
        // Intentionally keep all objects to test memory growth
        if (i % 1000 === 0) {
          console.log(`   Processed ${i} objects, memory usage: ${process.memoryUsage().heapUsed / 1024 / 1024} MB`);
          await TestUtils.delay(100);
        }
      }
    };
    
    await highFrequencyOperations();
    const report2 = detector.stopMonitoring();
    
    console.log("✅ High-frequency operations test completed:");
    console.log(`   Duration: ${(report2.testDuration / 1000).toFixed(1)} seconds`);
    console.log(`   Leak Detected: ${report2.leakDetected ? 'YES' : 'NO'}`);
    console.log(`   Peak Memory: ${detector['formatBytes'](report2.peakMemoryUsage)}`);
    
    report2.recommendations.forEach(rec => console.log(`   ${rec}`));
    
    console.log("\n📋 Test 3: Garbage Collection Validation");
    
    // Test 3: Force garbage collection and validate
    detector.startMonitoring();
    
    const garbageCollectionTest = async () => {
      const objects = [];
      
      // Create many objects
      for (let i = 0; i < 5000; i++) {
        objects.push({
          id: i,
          data: new Array(5000).fill(0).map(() => Math.random()),
          timestamp: Date.now()
        });
      }
      
      console.log("   Created 5000 objects, forcing garbage collection...");
      
      // Clear references and force GC
      objects.length = 0;
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        console.log("   Forced garbage collection completed");
      } else {
        console.log("   GC not available, waiting for natural collection...");
        await TestUtils.delay(5000);
      }
      
      // Create objects again to test memory reuse
      for (let i = 0; i < 5000; i++) {
        objects.push({
          id: i,
          data: new Array(5000).fill(0).map(() => Math.random()),
          timestamp: Date.now()
        });
      }
    };
    
    await garbageCollectionTest();
    const report3 = detector.stopMonitoring();
    
    console.log("✅ Garbage collection test completed:");
    console.log(`   Leak Detected: ${report3.leakDetected ? 'YES' : 'NO'}`);
    console.log(`   Peak Memory: ${detector['formatBytes'](report3.peakMemoryUsage)}`);
    
    report3.recommendations.forEach(rec => console.log(`   ${rec}`));
    
    // Save comprehensive report
    const comprehensiveReport = {
      timestamp: Date.now(),
      testResults: [report1, report2, report3],
      summary: {
        totalTests: 3,
        leakDetectedCount: [report1, report2, report3].filter(r => r.leakDetected).length,
        averageLeakRate: (report1.leakRate + report2.leakRate + report3.leakRate) / 3,
        peakMemoryUsage: Math.max(report1.peakMemoryUsage, report2.peakMemoryUsage, report3.peakMemoryUsage),
        overallHealth: [report1, report2, report3].every(r => !r.leakDetected) ? 'HEALTHY' : 'NEEDS_ATTENTION'
      }
    };
    
    await TestUtils.ensureDirectoryExists('test-results/resource');
    await TestUtils.writeJsonFile(`test-results/resource/memory-leak-report-${Date.now()}.json`, comprehensiveReport);
    
    console.log("\n🎯 Memory Leak Detection Summary:");
    console.log("=".repeat(50));
    console.log(`✅ All memory leak tests completed successfully`);
    console.log(`📊 Comprehensive report saved to test-results/resource/`);
    console.log(`🔍 Overall Memory Health: ${comprehensiveReport.summary.overallHealth}`);
    
    if (comprehensiveReport.summary.leakDetectedCount > 0) {
      console.log(`⚠️  WARNING: ${comprehensiveReport.summary.leakDetectedCount}/3 tests detected memory leaks`);
      console.log(`🔧 Review recommendations in detailed report for optimization guidance`);
    } else {
      console.log(`🎉 EXCELLENT: No significant memory leaks detected`);
    }
    
  } catch (error) {
    console.error("❌ Memory leak detection tests failed:", error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runMemoryLeakTests().catch(console.error);
}

export { runMemoryLeakTests, MemoryLeakDetector, MemoryLeakReport };
