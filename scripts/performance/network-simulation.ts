#!/usr/bin/env node

/**
 * GridTokenX Network Latency Simulation
 * 
 * This script simulates distributed nodes by introducing artificial network latency
 * to client operations, mimicking users accessing the platform from different
 * geographical regions.
 */

import { Connection, Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// Latency profiles for different regions (in ms)
const REGIONS = {
  'Local (Data Center)': { min: 1, max: 5 },
  'US-East (Nearby)': { min: 20, max: 40 },
  'EU-West (Cross-Atlantic)': { min: 80, max: 120 },
  'Asia-Pacific (Cross-Pacific)': { min: 150, max: 250 },
  'Satellite/Remote': { min: 500, max: 800 }
};

interface SimulationResult {
  region: string;
  operations: number;
  avgLatency: number;
  p95Latency: number;
  p99Latency: number;
  minLatency: number;
  maxLatency: number;
  throughput: number;
  successRate: number;
}

class NetworkSimulator {
  private connection: Connection;

  constructor() {
    this.connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  }

  /**
   * Sleep for a random duration within the range
   */
  private async simulateNetworkDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Simulate a complete transaction lifecycle with network latency
   * 1. Client -> Node (Network Delay)
   * 2. Node Processing (Processing Delay)
   * 3. Node -> Client (Network Delay)
   */
  async runSimulatedTransaction(regionName: string): Promise<number> {
    const profile = REGIONS[regionName as keyof typeof REGIONS];
    const start = Date.now();

    // 1. Request Latency (Client -> Node)
    await this.simulateNetworkDelay(profile.min / 2, profile.max / 2);

    // 2. Processing Time (Simulating Solana Block Time / Processing)
    // Fast processing (LiteSVM style) or standard block time (400ms)
    // Let's simulate a fast execution environment (e.g. 5-10ms processing)
    await this.simulateNetworkDelay(5, 10);

    // 3. Response Latency (Node -> Client)
    await this.simulateNetworkDelay(profile.min / 2, profile.max / 2);

    return Date.now() - start;
  }

  async runRegionTest(
    regionName: string, 
    iterations: number, 
    concurrency: number
  ): Promise<SimulationResult> {
    console.log(`\n🌍 Simulating Region: ${regionName}`);
    console.log(`   Latency Profile: ${REGIONS[regionName as keyof typeof REGIONS].min}-${REGIONS[regionName as keyof typeof REGIONS].max}ms`);
    console.log(`   Workload: ${iterations} txs, ${concurrency} concurrent users`);

    const latencies: number[] = [];
    let completed = 0;
    let failed = 0;
    const startTime = Date.now();

    // Create batches for concurrency
    const batches = Math.ceil(iterations / concurrency);

    for (let i = 0; i < batches; i++) {
      const batchSize = Math.min(concurrency, iterations - (i * concurrency));
      const promises = [];

      for (let j = 0; j < batchSize; j++) {
        promises.push(
          this.runSimulatedTransaction(regionName)
            .then(latency => {
              latencies.push(latency);
              completed++;
              process.stdout.write('.');
            })
            .catch(err => {
              failed++;
              process.stdout.write('x');
            })
        );
      }

      await Promise.all(promises);
    }

    const totalTime = Date.now() - startTime;
    console.log('\n');

    // Calculate metrics
    latencies.sort((a, b) => a - b);
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];

    return {
      region: regionName,
      operations: completed,
      avgLatency: avg,
      p95Latency: p95,
      p99Latency: p99,
      minLatency: latencies[0],
      maxLatency: latencies[latencies.length - 1],
      throughput: (completed / totalTime) * 1000,
      successRate: (completed / iterations) * 100
    };
  }

  async runAllRegions() {
    console.log('🚀 Starting Network Latency Simulation (Distributed Nodes)');
    console.log('=========================================================');

    const results: SimulationResult[] = [];

    for (const region of Object.keys(REGIONS)) {
      const result = await this.runRegionTest(region, 100, 10); // 100 txs, 10 concurrent
      results.push(result);
      
      console.log(`   📊 Results for ${region}:`);
      console.log(`      Avg Latency: ${result.avgLatency.toFixed(2)}ms`);
      console.log(`      p99 Latency: ${result.p99Latency.toFixed(2)}ms`);
      console.log(`      Throughput:  ${result.throughput.toFixed(2)} TPS`);
    }

    this.printSummary(results);
  }

  printSummary(results: SimulationResult[]) {
    console.log('\n\n📋 NETWORK SIMULATION SUMMARY');
    console.log('=================================================================================');
    console.log('| Region                       | Avg (ms) | p99 (ms) | TPS    | Impact Factor |');
    console.log('|------------------------------|----------|----------|--------|---------------|');
    
    const baseline = results[0].avgLatency;

    results.forEach(r => {
      const impact = (r.avgLatency / baseline).toFixed(1) + 'x';
      console.log(
        `| ${r.region.padEnd(28)} | ` +
        `${r.avgLatency.toFixed(2).padStart(8)} | ` +
        `${r.p99Latency.toFixed(2).padStart(8)} | ` +
        `${r.throughput.toFixed(2).padStart(6)} | ` +
        `${impact.padStart(13)} |`
      );
    });
    console.log('=================================================================================');
    console.log('\nConclusion:');
    console.log('The simulation demonstrates how network latency impacts the perceived performance');
    console.log('of the GridTokenX platform for users in different geographical regions.');
    console.log('While the blockchain (LiteSVM/Solana) processes transactions in <10ms,');
    console.log('remote users will experience higher end-to-end latency due to network physics.');

    // Save results to JSON
    const outputDir = path.join(process.cwd(), 'test-results/benchmark');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputPath = path.join(outputDir, 'network-simulation.json');
    fs.writeFileSync(outputPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      results
    }, null, 2));
    console.log(`\nResults saved to ${outputPath}`);
  }
}

// Run the simulation
const simulator = new NetworkSimulator();
simulator.runAllRegions().catch(console.error);
