/**
 * BLOCKBENCH Comparison Report Generator
 * 
 * Generates comprehensive comparison reports between:
 * - Different blockchain platforms (conceptual - Solana vs Hyperledger vs Ethereum)
 * - Different workloads (YCSB variants, Smallbank, TPC-C)
 * - Layer-wise performance analysis
 * 
 * Output formats:
 * - Console summary
 * - JSON detailed report
 * - Markdown report
 * - CSV for data analysis
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// REFERENCE DATA (BLOCKBENCH Paper Results for Comparison)
// ============================================================================

/**
 * Reference throughput data from BLOCKBENCH paper (SIGMOD 2017)
 * Used for comparison with GridTokenX Solana implementation
 */
export const BLOCKBENCH_REFERENCE_DATA = {
  // Platform throughput ranges from paper
  hyperledgerFabric: {
    version: "v0.6 (PBFT)",
    ycsbThroughput: { min: 800, max: 1200 },
    smallbankThroughput: { min: 700, max: 1100 },
    scalabilityLimit: 16, // nodes before degradation
  },
  hyperledgerFabricV1: {
    version: "v1.x (Kafka/Raft)",
    ycsbThroughput: { min: 2000, max: 3500 },
    smallbankThroughput: { min: 1800, max: 3000 },
    scalabilityLimit: 100,
  },
  ethereumGeth: {
    version: "Private PoW",
    ycsbThroughput: { min: 50, max: 200 },
    smallbankThroughput: { min: 40, max: 180 },
    latencyMs: { min: 100, max: 500 },
  },
  parity: {
    version: "PoA (Aura)",
    ycsbThroughput: { min: 500, max: 1000 },
    smallbankThroughput: { min: 400, max: 900 },
  },
  // Optimized implementations
  fastFabric: {
    version: "FastFabric (Optimized)",
    ycsbThroughput: { min: 15000, max: 20000 },
    improvement: "7x over vanilla Fabric",
  },
};

/**
 * Theoretical limits for layer analysis
 */
export const LAYER_ANALYSIS_REFERENCE = {
  consensusOverhead: {
    description: "Pure consensus cost (DoNothing benchmark)",
    pbftComplexity: "O(N²) - quadratic message exchange",
    raftComplexity: "O(N) - leader-based",
    towerBftComplexity: "O(1) per vote - optimistic parallelism",
  },
  executionOverhead: {
    description: "Smart contract execution cost",
    evmOverhead: "High - stack-based bytecode interpretation + gas metering",
    bpfOverhead: "Low - JIT compiled, near-native performance",
    dockerOverhead: "Medium - container startup + gRPC",
  },
  storageOverhead: {
    description: "State read/write cost",
    merkleTrie: "High I/O amplification - path rehashing required",
    accountModel: "Lower - direct account access",
    readWriteSet: "Medium - conflict detection overhead",
  },
};

// ============================================================================
// REPORT DATA STRUCTURES
// ============================================================================

export interface BlockbenchComparisonReport {
  metadata: {
    generatedAt: string;
    version: string;
    platform: string;
    testEnvironment: string;
  };
  
  executionResults: {
    microBenchmarks: MicroBenchmarkSummary;
    macroBenchmarks: MacroBenchmarkSummary;
  };
  
  layerAnalysis: LayerAnalysis;
  
  platformComparison: PlatformComparison[];
  
  recommendations: Recommendation[];
  
  rawData?: any;
}

export interface MicroBenchmarkSummary {
  doNothing: BenchmarkMetrics;
  cpuHeavy: BenchmarkMetrics;
  ioHeavy: BenchmarkMetrics;
  analytics?: BenchmarkMetrics;
}

export interface MacroBenchmarkSummary {
  ycsbA?: BenchmarkMetrics;
  ycsbB?: BenchmarkMetrics;
  ycsbC?: BenchmarkMetrics;
  smallbank?: BenchmarkMetrics;
  tpcC?: BenchmarkMetrics;
}

export interface BenchmarkMetrics {
  throughputTps: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  successRate: number;
  avgComputeUnits?: number;
}

export interface LayerAnalysis {
  consensusLayer: {
    baselineTps: number;
    overhead: string;
    bottleneck: string;
  };
  executionLayer: {
    baselineTps: number;
    computeEfficiency: string;
    bottleneck: string;
  };
  dataModelLayer: {
    baselineTps: number;
    ioEfficiency: string;
    bottleneck: string;
  };
}

export interface PlatformComparison {
  platform: string;
  version: string;
  ycsbThroughput: number;
  smallbankThroughput: number;
  latencyMs: number;
  scalabilityNotes: string;
}

export interface Recommendation {
  category: string;
  finding: string;
  recommendation: string;
  priority: "high" | "medium" | "low";
}

// ============================================================================
// REPORT GENERATOR
// ============================================================================

export class BlockbenchReportGenerator {
  private resultsDir: string;
  
  constructor(resultsDir?: string) {
    this.resultsDir = resultsDir || path.join(__dirname, "../../../test-results/blockbench");
  }

  /**
   * Load latest benchmark results
   */
  loadLatestResults(): any | null {
    if (!fs.existsSync(this.resultsDir)) {
      console.error("Results directory not found:", this.resultsDir);
      return null;
    }

    const files = fs.readdirSync(this.resultsDir)
      .filter(f => f.startsWith("blockbench-suite-") && f.endsWith(".json"))
      .sort()
      .reverse();

    if (files.length === 0) {
      console.error("No benchmark results found");
      return null;
    }

    const latestFile = path.join(this.resultsDir, files[0]);
    console.log(`Loading results from: ${latestFile}`);
    
    return JSON.parse(fs.readFileSync(latestFile, "utf-8"));
  }

  /**
   * Generate comprehensive comparison report
   */
  generateReport(results?: any): BlockbenchComparisonReport {
    const data = results || this.loadLatestResults();
    
    const report: BlockbenchComparisonReport = {
      metadata: {
        generatedAt: new Date().toISOString(),
        version: "1.0.0",
        platform: "Solana (GridTokenX)",
        testEnvironment: data?.environment || "litesvm",
      },
      
      executionResults: this.extractExecutionResults(data),
      layerAnalysis: this.analyzeeLayers(data),
      platformComparison: this.generatePlatformComparison(data),
      recommendations: this.generateRecommendations(data),
      rawData: data,
    };

    return report;
  }

  private extractExecutionResults(data: any): BlockbenchComparisonReport["executionResults"] {
    const micro = data?.microBenchmarks || {};
    const macro = data?.macroBenchmarks || {};

    return {
      microBenchmarks: {
        doNothing: this.extractMetrics(micro.doNothing),
        cpuHeavy: this.extractMetrics(micro.cpuHeavySort),
        ioHeavy: this.extractMetrics(micro.ioHeavyWrite),
      },
      macroBenchmarks: {
        ycsbA: this.extractYcsbMetrics(macro.ycsbA),
        ycsbC: this.extractYcsbMetrics(macro.ycsbC),
        smallbank: this.extractSmallbankMetrics(macro.smallbank),
      },
    };
  }

  private extractMetrics(data: any): BenchmarkMetrics {
    if (!data || data.error) {
      return {
        throughputTps: 0,
        avgLatencyMs: 0,
        p99LatencyMs: 0,
        successRate: 0,
      };
    }

    return {
      throughputTps: data.throughput?.avgTps || 0,
      avgLatencyMs: data.latency?.avgMs || 0,
      p99LatencyMs: data.latency?.percentiles?.p99 || 0,
      successRate: data.throughput?.successfulTransactions 
        ? (data.throughput.successfulTransactions / data.throughput.totalTransactions) * 100 
        : 0,
      avgComputeUnits: data.resources?.avgComputeUnits || 0,
    };
  }

  private extractYcsbMetrics(data: any): BenchmarkMetrics {
    if (!data || data.error) {
      return { throughputTps: 0, avgLatencyMs: 0, p99LatencyMs: 0, successRate: 0 };
    }

    return {
      throughputTps: data.throughput || 0,
      avgLatencyMs: (data.avgLatencyUs || 0) / 1000,
      p99LatencyMs: (data.p99LatencyUs || 0) / 1000,
      successRate: data.successfulOps 
        ? (data.successfulOps / data.totalOps) * 100 
        : 0,
    };
  }

  private extractSmallbankMetrics(data: any): BenchmarkMetrics {
    if (!data || data.error) {
      return { throughputTps: 0, avgLatencyMs: 0, p99LatencyMs: 0, successRate: 0 };
    }

    return {
      throughputTps: data.tps || 0,
      avgLatencyMs: data.avgLatencyMs || 0,
      p99LatencyMs: data.latencyPercentiles?.p99 || 0,
      successRate: data.successfulTransactions 
        ? (data.successfulTransactions / data.totalTransactions) * 100 
        : 0,
    };
  }

  private analyzeeLayers(data: any): LayerAnalysis {
    const micro = data?.microBenchmarks || {};
    
    const doNothingTps = micro.doNothing?.throughput?.avgTps || 0;
    const cpuHeavyTps = micro.cpuHeavySort?.throughput?.avgTps || 0;
    const ioHeavyTps = micro.ioHeavyWrite?.throughput?.avgTps || 0;

    return {
      consensusLayer: {
        baselineTps: doNothingTps,
        overhead: doNothingTps > 1000 ? "Low" : doNothingTps > 500 ? "Medium" : "High",
        bottleneck: this.identifyConsensusBottleneck(doNothingTps),
      },
      executionLayer: {
        baselineTps: cpuHeavyTps,
        computeEfficiency: cpuHeavyTps > 500 ? "High (BPF JIT)" : "Medium",
        bottleneck: this.identifyExecutionBottleneck(cpuHeavyTps, doNothingTps),
      },
      dataModelLayer: {
        baselineTps: ioHeavyTps,
        ioEfficiency: ioHeavyTps > 500 ? "High (Account Model)" : "Medium",
        bottleneck: this.identifyStorageBottleneck(ioHeavyTps, doNothingTps),
      },
    };
  }

  private identifyConsensusBottleneck(tps: number): string {
    if (tps > 5000) return "Network bandwidth (theoretical)";
    if (tps > 1000) return "Signature verification";
    if (tps > 500) return "Block propagation";
    return "Consensus protocol (leader election/voting)";
  }

  private identifyExecutionBottleneck(cpuTps: number, consensusTps: number): string {
    const ratio = cpuTps / Math.max(consensusTps, 1);
    if (ratio > 0.8) return "Compute budget limits";
    if (ratio > 0.5) return "BPF instruction cost";
    return "Serial execution / VM overhead";
  }

  private identifyStorageBottleneck(ioTps: number, consensusTps: number): string {
    const ratio = ioTps / Math.max(consensusTps, 1);
    if (ratio > 0.8) return "Account access serialization";
    if (ratio > 0.5) return "Account data serialization";
    return "Write amplification / State commitment";
  }

  private generatePlatformComparison(data: any): PlatformComparison[] {
    const ycsbTps = data?.macroBenchmarks?.ycsbA?.throughput || 0;
    const smallbankTps = data?.macroBenchmarks?.smallbank?.tps || 0;
    const latencyMs = data?.microBenchmarks?.doNothing?.latency?.avgMs || 0;

    return [
      {
        platform: "Solana (GridTokenX)",
        version: "Current",
        ycsbThroughput: ycsbTps,
        smallbankThroughput: smallbankTps,
        latencyMs: latencyMs,
        scalabilityNotes: "Tower BFT - 1000+ validators supported",
      },
      {
        platform: "Hyperledger Fabric",
        version: "v0.6 (PBFT)",
        ycsbThroughput: 1000,
        smallbankThroughput: 900,
        latencyMs: 50,
        scalabilityNotes: "Limited to 16 nodes (O(N²) consensus)",
      },
      {
        platform: "Hyperledger Fabric",
        version: "v1.x (Raft)",
        ycsbThroughput: 2750,
        smallbankThroughput: 2400,
        latencyMs: 30,
        scalabilityNotes: "100+ nodes with ordering service separation",
      },
      {
        platform: "Ethereum (Geth)",
        version: "Private PoW",
        ycsbThroughput: 125,
        smallbankThroughput: 110,
        latencyMs: 300,
        scalabilityNotes: "Sequential EVM limits throughput",
      },
      {
        platform: "Parity",
        version: "PoA (Aura)",
        ycsbThroughput: 750,
        smallbankThroughput: 650,
        latencyMs: 100,
        scalabilityNotes: "Better than PoW, limited by EVM",
      },
      {
        platform: "FastFabric",
        version: "Optimized",
        ycsbThroughput: 17500,
        smallbankThroughput: 15000,
        latencyMs: 20,
        scalabilityNotes: "7x improvement through parallelization",
      },
    ];
  }

  private generateRecommendations(data: any): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const micro = data?.microBenchmarks || {};

    // Analyze consensus layer
    const doNothingTps = micro.doNothing?.throughput?.avgTps || 0;
    if (doNothingTps < 500) {
      recommendations.push({
        category: "Consensus Layer",
        finding: `Baseline consensus throughput is ${doNothingTps.toFixed(0)} TPS`,
        recommendation: "Consider transaction batching or preflight optimization",
        priority: "high",
      });
    }

    // Analyze execution layer
    const cpuTps = micro.cpuHeavySort?.throughput?.avgTps || 0;
    const cpuCu = micro.cpuHeavySort?.resources?.avgComputeUnits || 0;
    if (cpuCu > 100000) {
      recommendations.push({
        category: "Execution Layer",
        finding: `High compute unit usage (${cpuCu.toFixed(0)} CU average)`,
        recommendation: "Optimize program logic, consider algorithm improvements",
        priority: "medium",
      });
    }

    // Analyze data layer
    const ioTps = micro.ioHeavyWrite?.throughput?.avgTps || 0;
    if (ioTps < doNothingTps * 0.5) {
      recommendations.push({
        category: "Data Model Layer",
        finding: `IO operations reduce throughput to ${((ioTps/doNothingTps)*100).toFixed(0)}% of baseline`,
        recommendation: "Reduce account size, batch state updates, use zero-copy deserialization",
        priority: "high",
      });
    }

    // General recommendations
    recommendations.push({
      category: "Architecture",
      finding: "BLOCKBENCH methodology applied successfully",
      recommendation: "Continue layer-wise optimization starting with highest bottleneck",
      priority: "medium",
    });

    return recommendations;
  }

  /**
   * Generate Markdown report
   */
  generateMarkdownReport(report: BlockbenchComparisonReport): string {
    const md: string[] = [];

    md.push("# BLOCKBENCH Performance Analysis Report");
    md.push("");
    md.push(`**Generated:** ${report.metadata.generatedAt}`);
    md.push(`**Platform:** ${report.metadata.platform}`);
    md.push(`**Environment:** ${report.metadata.testEnvironment}`);
    md.push("");

    // Executive Summary
    md.push("## Executive Summary");
    md.push("");
    md.push("This report presents the results of BLOCKBENCH-style benchmarking adapted for Solana/Anchor.");
    md.push("The methodology follows the hierarchical layer analysis from the SIGMOD 2017 paper.");
    md.push("");

    // Layer Analysis
    md.push("## Layer-wise Performance Analysis");
    md.push("");
    md.push("| Layer | Baseline TPS | Efficiency | Bottleneck |");
    md.push("|-------|-------------|------------|------------|");
    md.push(`| Consensus | ${report.layerAnalysis.consensusLayer.baselineTps.toFixed(0)} | ${report.layerAnalysis.consensusLayer.overhead} | ${report.layerAnalysis.consensusLayer.bottleneck} |`);
    md.push(`| Execution | ${report.layerAnalysis.executionLayer.baselineTps.toFixed(0)} | ${report.layerAnalysis.executionLayer.computeEfficiency} | ${report.layerAnalysis.executionLayer.bottleneck} |`);
    md.push(`| Data Model | ${report.layerAnalysis.dataModelLayer.baselineTps.toFixed(0)} | ${report.layerAnalysis.dataModelLayer.ioEfficiency} | ${report.layerAnalysis.dataModelLayer.bottleneck} |`);
    md.push("");

    // Micro-benchmark Results
    md.push("## Micro-benchmark Results");
    md.push("");
    md.push("| Benchmark | Throughput (TPS) | Avg Latency (ms) | P99 Latency (ms) | Success Rate |");
    md.push("|-----------|-----------------|------------------|------------------|--------------|");
    const micro = report.executionResults.microBenchmarks;
    md.push(`| DoNothing | ${micro.doNothing.throughputTps.toFixed(2)} | ${micro.doNothing.avgLatencyMs.toFixed(3)} | ${micro.doNothing.p99LatencyMs.toFixed(3)} | ${micro.doNothing.successRate.toFixed(1)}% |`);
    md.push(`| CPUHeavy | ${micro.cpuHeavy.throughputTps.toFixed(2)} | ${micro.cpuHeavy.avgLatencyMs.toFixed(3)} | ${micro.cpuHeavy.p99LatencyMs.toFixed(3)} | ${micro.cpuHeavy.successRate.toFixed(1)}% |`);
    md.push(`| IOHeavy | ${micro.ioHeavy.throughputTps.toFixed(2)} | ${micro.ioHeavy.avgLatencyMs.toFixed(3)} | ${micro.ioHeavy.p99LatencyMs.toFixed(3)} | ${micro.ioHeavy.successRate.toFixed(1)}% |`);
    md.push("");

    // Macro-benchmark Results
    md.push("## Macro-benchmark Results (YCSB & Smallbank)");
    md.push("");
    md.push("| Workload | Throughput | Avg Latency (ms) | P99 Latency (ms) | Success Rate |");
    md.push("|----------|-----------|------------------|------------------|--------------|");
    const macro = report.executionResults.macroBenchmarks;
    if (macro.ycsbA) {
      md.push(`| YCSB-A (Update Heavy) | ${macro.ycsbA.throughputTps.toFixed(2)} ops/s | ${macro.ycsbA.avgLatencyMs.toFixed(3)} | ${macro.ycsbA.p99LatencyMs.toFixed(3)} | ${macro.ycsbA.successRate.toFixed(1)}% |`);
    }
    if (macro.ycsbC) {
      md.push(`| YCSB-C (Read Only) | ${macro.ycsbC.throughputTps.toFixed(2)} ops/s | ${macro.ycsbC.avgLatencyMs.toFixed(3)} | ${macro.ycsbC.p99LatencyMs.toFixed(3)} | ${macro.ycsbC.successRate.toFixed(1)}% |`);
    }
    if (macro.smallbank) {
      md.push(`| Smallbank | ${macro.smallbank.throughputTps.toFixed(2)} TPS | ${macro.smallbank.avgLatencyMs.toFixed(3)} | ${macro.smallbank.p99LatencyMs.toFixed(3)} | ${macro.smallbank.successRate.toFixed(1)}% |`);
    }
    md.push("");

    // Platform Comparison
    md.push("## Platform Comparison");
    md.push("");
    md.push("| Platform | Version | YCSB TPS | Smallbank TPS | Latency (ms) | Notes |");
    md.push("|----------|---------|----------|---------------|--------------|-------|");
    for (const platform of report.platformComparison) {
      md.push(`| ${platform.platform} | ${platform.version} | ${platform.ycsbThroughput} | ${platform.smallbankThroughput} | ${platform.latencyMs.toFixed(1)} | ${platform.scalabilityNotes} |`);
    }
    md.push("");

    // Recommendations
    md.push("## Recommendations");
    md.push("");
    for (const rec of report.recommendations) {
      md.push(`### ${rec.category} (${rec.priority.toUpperCase()} priority)`);
      md.push("");
      md.push(`**Finding:** ${rec.finding}`);
      md.push("");
      md.push(`**Recommendation:** ${rec.recommendation}`);
      md.push("");
    }

    // Reference
    md.push("## References");
    md.push("");
    md.push("- BLOCKBENCH: A Framework for Analyzing Private Blockchains (SIGMOD 2017)");
    md.push("- YCSB: Benchmarking Cloud Serving Systems (SoCC 2010)");
    md.push("- TPC-C: Transaction Processing Performance Council Benchmark");
    md.push("");

    return md.join("\n");
  }

  /**
   * Save report in multiple formats
   */
  saveReport(report: BlockbenchComparisonReport): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    
    // JSON
    const jsonPath = path.join(this.resultsDir, `blockbench-report-${timestamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`📄 JSON report saved: ${jsonPath}`);

    // Markdown
    const mdPath = path.join(this.resultsDir, `blockbench-report-${timestamp}.md`);
    fs.writeFileSync(mdPath, this.generateMarkdownReport(report));
    console.log(`📝 Markdown report saved: ${mdPath}`);

    // CSV summary
    const csvPath = path.join(this.resultsDir, `blockbench-summary-${timestamp}.csv`);
    this.saveCSVSummary(report, csvPath);
    console.log(`📊 CSV summary saved: ${csvPath}`);
  }

  private saveCSVSummary(report: BlockbenchComparisonReport, filepath: string): void {
    const rows: string[] = [];
    rows.push("Benchmark,Throughput,AvgLatencyMs,P99LatencyMs,SuccessRate");
    
    const micro = report.executionResults.microBenchmarks;
    rows.push(`DoNothing,${micro.doNothing.throughputTps},${micro.doNothing.avgLatencyMs},${micro.doNothing.p99LatencyMs},${micro.doNothing.successRate}`);
    rows.push(`CPUHeavy,${micro.cpuHeavy.throughputTps},${micro.cpuHeavy.avgLatencyMs},${micro.cpuHeavy.p99LatencyMs},${micro.cpuHeavy.successRate}`);
    rows.push(`IOHeavy,${micro.ioHeavy.throughputTps},${micro.ioHeavy.avgLatencyMs},${micro.ioHeavy.p99LatencyMs},${micro.ioHeavy.successRate}`);
    
    const macro = report.executionResults.macroBenchmarks;
    if (macro.ycsbA) {
      rows.push(`YCSB-A,${macro.ycsbA.throughputTps},${macro.ycsbA.avgLatencyMs},${macro.ycsbA.p99LatencyMs},${macro.ycsbA.successRate}`);
    }
    if (macro.smallbank) {
      rows.push(`Smallbank,${macro.smallbank.throughputTps},${macro.smallbank.avgLatencyMs},${macro.smallbank.p99LatencyMs},${macro.smallbank.successRate}`);
    }

    fs.writeFileSync(filepath, rows.join("\n"));
  }
}

// ============================================================================
// CLI EXECUTION
// ============================================================================

const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('blockbench-report.ts');

if (isMainModule) {
  const generator = new BlockbenchReportGenerator();
  const report = generator.generateReport();
  
  // Print summary to console
  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  BLOCKBENCH COMPARISON REPORT");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Generated: ${report.metadata.generatedAt}`);
  console.log(`  Platform: ${report.metadata.platform}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("LAYER ANALYSIS:");
  console.log(`  Consensus: ${report.layerAnalysis.consensusLayer.baselineTps.toFixed(0)} TPS`);
  console.log(`  Execution: ${report.layerAnalysis.executionLayer.baselineTps.toFixed(0)} TPS`);
  console.log(`  Data Model: ${report.layerAnalysis.dataModelLayer.baselineTps.toFixed(0)} TPS`);
  console.log("");

  generator.saveReport(report);
}
