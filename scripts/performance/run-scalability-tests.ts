/**
 * Scalability Test Suite
 * 
 * Runs benchmarks with varying parameters to measure:
 * - Throughput scalability with load
 * - Latency under different concurrency levels
 * - Performance with varying data sizes
 */

import * as fs from 'fs';
import * as path from 'path';
import { LiteSVM } from 'litesvm';
import { Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';

interface ScalabilityResult {
  parameter: string;
  value: number;
  throughput: number;
  avgLatency: number;
  p99Latency: number;
  successRate: number;
}

interface ScalabilityReport {
  timestamp: string;
  testType: string;
  results: ScalabilityResult[];
  summary: {
    bestThroughput: ScalabilityResult;
    bestLatency: ScalabilityResult;
    scalabilityFactor: number;
  };
}

class ScalabilityTester {
  private svm: LiteSVM;
  private payer: Keypair;
  private results: ScalabilityReport[] = [];

  constructor() {
    this.svm = new LiteSVM();
    this.payer = Keypair.generate();
    this.svm.airdrop(this.payer.publicKey, BigInt(1000_000_000_000));
  }

  async runConcurrencyScaling(): Promise<ScalabilityReport> {
    console.log('\n📊 Running Concurrency Scaling Test...\n');
    
    const concurrencyLevels = [1, 2, 4, 8, 16, 32, 64];
    const results: ScalabilityResult[] = [];
    
    for (const concurrency of concurrencyLevels) {
      console.log(`  Testing concurrency level: ${concurrency}`);
      
      const startTime = Date.now();
      const totalOps = 1000;
      const batchSize = Math.min(concurrency, totalOps);
      let successful = 0;
      const latencies: number[] = [];
      
      for (let i = 0; i < totalOps; i += batchSize) {
        const currentBatch = Math.min(batchSize, totalOps - i);
        const batchStart = Date.now();
        
        // Create batch of transfer transactions
        const txPromises = [];
        for (let j = 0; j < currentBatch; j++) {
          const recipient = Keypair.generate();
          const instruction = SystemProgram.transfer({
            fromPubkey: this.payer.publicKey,
            toPubkey: recipient.publicKey,
            lamports: BigInt(1000),
          });
          
          const tx = new Transaction().add(instruction);
          tx.feePayer = this.payer.publicKey;
          tx.recentBlockhash = this.svm.latestBlockhash();
          tx.sign(this.payer);
          
          txPromises.push(this.executeTransaction(tx));
        }
        
        const txResults = await Promise.all(txPromises);
        successful += txResults.filter(r => r.success).length;
        latencies.push(Date.now() - batchStart);
      }
      
      const duration = (Date.now() - startTime) / 1000;
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const sortedLatencies = [...latencies].sort((a, b) => a - b);
      const p99Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || avgLatency;
      
      results.push({
        parameter: 'concurrency',
        value: concurrency,
        throughput: totalOps / duration,
        avgLatency,
        p99Latency,
        successRate: (successful / totalOps) * 100,
      });
      
      console.log(`    Throughput: ${(totalOps / duration).toFixed(2)} TPS, Avg Latency: ${avgLatency.toFixed(2)}ms`);
    }
    
    const bestThroughput = results.reduce((a, b) => a.throughput > b.throughput ? a : b);
    const bestLatency = results.reduce((a, b) => a.avgLatency < b.avgLatency ? a : b);
    const scalabilityFactor = bestThroughput.throughput / results[0].throughput;
    
    return {
      timestamp: new Date().toISOString(),
      testType: 'concurrency_scaling',
      results,
      summary: { bestThroughput, bestLatency, scalabilityFactor },
    };
  }

  async runDataSizeScaling(): Promise<ScalabilityReport> {
    console.log('\n📊 Running Data Size Scaling Test...\n');
    
    const dataSizes = [32, 64, 128, 256, 512, 1024, 2048];
    const results: ScalabilityResult[] = [];
    
    for (const dataSize of dataSizes) {
      console.log(`  Testing data size: ${dataSize} bytes`);
      
      const startTime = Date.now();
      const totalOps = 500;
      let successful = 0;
      const latencies: number[] = [];
      
      for (let i = 0; i < totalOps; i++) {
        const opStart = Date.now();
        
        // Create account with specified data size
        const newAccount = Keypair.generate();
        const space = dataSize;
        const rentLamports = this.svm.minimumBalanceForRentExemption(BigInt(space));
        
        const createIx = SystemProgram.createAccount({
          fromPubkey: this.payer.publicKey,
          newAccountPubkey: newAccount.publicKey,
          lamports: Number(rentLamports),
          space: space,
          programId: SystemProgram.programId,
        });
        
        const tx = new Transaction().add(createIx);
        tx.feePayer = this.payer.publicKey;
        tx.recentBlockhash = this.svm.latestBlockhash();
        tx.sign(this.payer, newAccount);
        
        const result = await this.executeTransaction(tx);
        if (result.success) successful++;
        latencies.push(Date.now() - opStart);
      }
      
      const duration = (Date.now() - startTime) / 1000;
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const sortedLatencies = [...latencies].sort((a, b) => a - b);
      const p99Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || avgLatency;
      
      results.push({
        parameter: 'data_size',
        value: dataSize,
        throughput: totalOps / duration,
        avgLatency,
        p99Latency,
        successRate: (successful / totalOps) * 100,
      });
      
      console.log(`    Throughput: ${(totalOps / duration).toFixed(2)} TPS, Avg Latency: ${avgLatency.toFixed(2)}ms`);
    }
    
    const bestThroughput = results.reduce((a, b) => a.throughput > b.throughput ? a : b);
    const bestLatency = results.reduce((a, b) => a.avgLatency < b.avgLatency ? a : b);
    const scalabilityFactor = results[0].throughput / results[results.length - 1].throughput;
    
    return {
      timestamp: new Date().toISOString(),
      testType: 'data_size_scaling',
      results,
      summary: { bestThroughput, bestLatency, scalabilityFactor },
    };
  }

  async runLoadDurationTest(): Promise<ScalabilityReport> {
    console.log('\n📊 Running Load Duration Test...\n');
    
    const durations = [5, 10, 15, 30, 60]; // seconds
    const results: ScalabilityResult[] = [];
    
    for (const duration of durations) {
      console.log(`  Testing sustained load for ${duration}s`);
      
      const startTime = Date.now();
      const endTime = startTime + duration * 1000;
      let totalOps = 0;
      let successful = 0;
      const latencies: number[] = [];
      
      while (Date.now() < endTime) {
        const opStart = Date.now();
        
        const recipient = Keypair.generate();
        const instruction = SystemProgram.transfer({
          fromPubkey: this.payer.publicKey,
          toPubkey: recipient.publicKey,
          lamports: BigInt(1000),
        });
        
        const tx = new Transaction().add(instruction);
        tx.feePayer = this.payer.publicKey;
        tx.recentBlockhash = this.svm.latestBlockhash();
        tx.sign(this.payer);
        
        const result = await this.executeTransaction(tx);
        if (result.success) successful++;
        totalOps++;
        latencies.push(Date.now() - opStart);
      }
      
      const actualDuration = (Date.now() - startTime) / 1000;
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const sortedLatencies = [...latencies].sort((a, b) => a - b);
      const p99Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || avgLatency;
      
      results.push({
        parameter: 'duration',
        value: duration,
        throughput: totalOps / actualDuration,
        avgLatency,
        p99Latency,
        successRate: (successful / totalOps) * 100,
      });
      
      console.log(`    Throughput: ${(totalOps / actualDuration).toFixed(2)} TPS, Total ops: ${totalOps}`);
    }
    
    const bestThroughput = results.reduce((a, b) => a.throughput > b.throughput ? a : b);
    const bestLatency = results.reduce((a, b) => a.avgLatency < b.avgLatency ? a : b);
    const throughputVariance = Math.abs(results[results.length - 1].throughput - results[0].throughput) / results[0].throughput;
    
    return {
      timestamp: new Date().toISOString(),
      testType: 'load_duration',
      results,
      summary: { bestThroughput, bestLatency, scalabilityFactor: 1 - throughputVariance },
    };
  }

  private async executeTransaction(tx: Transaction): Promise<{ success: boolean }> {
    try {
      this.svm.sendTransaction(tx);
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  async runAllTests(): Promise<void> {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║           SOLANA SCALABILITY TEST SUITE                          ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');

    const concurrencyReport = await this.runConcurrencyScaling();
    this.results.push(concurrencyReport);

    const dataSizeReport = await this.runDataSizeScaling();
    this.results.push(dataSizeReport);

    const durationReport = await this.runLoadDurationTest();
    this.results.push(durationReport);

    this.printSummary();
    this.saveResults();
  }

  private printSummary(): void {
    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║                    SCALABILITY TEST SUMMARY                       ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');

    for (const report of this.results) {
      console.log(`\n📊 ${report.testType.toUpperCase().replace(/_/g, ' ')}`);
      console.log('─'.repeat(60));
      console.log(`   Best Throughput: ${report.summary.bestThroughput.throughput.toFixed(2)} TPS (at ${report.summary.bestThroughput.parameter}=${report.summary.bestThroughput.value})`);
      console.log(`   Best Latency: ${report.summary.bestLatency.avgLatency.toFixed(2)}ms (at ${report.summary.bestLatency.parameter}=${report.summary.bestLatency.value})`);
      console.log(`   Scalability Factor: ${report.summary.scalabilityFactor.toFixed(2)}x`);
    }

    // Generate LaTeX table
    console.log('\n\n📄 LaTeX Table Output:\n');
    console.log('\\begin{table}[htbp]');
    console.log('\\centering');
    console.log('\\caption{Scalability Test Results}');
    console.log('\\begin{tabular}{llrrr}');
    console.log('\\toprule');
    console.log('Test Type & Parameter & Throughput (TPS) & Avg Latency (ms) & Success Rate \\\\');
    console.log('\\midrule');

    for (const report of this.results) {
      for (const result of report.results) {
        const testType = report.testType.replace(/_/g, ' ');
        console.log(`${testType} & ${result.value} & ${result.throughput.toFixed(1)} & ${result.avgLatency.toFixed(1)} & ${result.successRate.toFixed(1)}\\% \\\\`);
      }
      console.log('\\midrule');
    }

    console.log('\\bottomrule');
    console.log('\\end{tabular}');
    console.log('\\label{tab:scalability}');
    console.log('\\end{table}');
  }

  private saveResults(): void {
    const outputDir = path.join(process.cwd(), 'test-results', 'scalability');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filename = `scalability-${Date.now()}.json`;
    const filepath = path.join(outputDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(this.results, null, 2));
    console.log(`\n📁 Results saved to: ${filepath}`);

    // Also save LaTeX table
    const latexPath = path.join(outputDir, 'scalability-table.tex');
    const latexContent = this.generateLatexTable();
    fs.writeFileSync(latexPath, latexContent);
    console.log(`📄 LaTeX table saved to: ${latexPath}`);
  }

  private generateLatexTable(): string {
    let latex = `% Auto-generated scalability results table
% Generated: ${new Date().toISOString()}

\\begin{table}[htbp]
\\centering
\\caption{GridTokenX Scalability Analysis Results}
\\label{tab:scalability-results}
\\begin{tabular}{@{}llrrrr@{}}
\\toprule
\\textbf{Test Type} & \\textbf{Parameter} & \\textbf{TPS} & \\textbf{Latency (ms)} & \\textbf{p99 (ms)} & \\textbf{Success} \\\\
\\midrule
`;

    for (const report of this.results) {
      const testName = report.testType.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      for (const result of report.results) {
        latex += `${testName} & ${result.value} & ${result.throughput.toFixed(1)} & ${result.avgLatency.toFixed(1)} & ${result.p99Latency.toFixed(1)} & ${result.successRate.toFixed(1)}\\% \\\\\n`;
      }
      latex += '\\midrule\n';
    }

    latex += `\\bottomrule
\\end{tabular}
\\end{table}
`;

    return latex;
  }
}

// Run the tests
const tester = new ScalabilityTester();
tester.runAllTests().catch(console.error);
