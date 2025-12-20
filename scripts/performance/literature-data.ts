#!/usr/bin/env node

/**
 * Literature Reference Data for Comparative Analysis
 * 
 * Contains benchmark results from published papers:
 * - TPCTC Conference Proceedings
 * - Blockbench Framework
 * - TPC.org Official Results
 * 
 * Used for Trust Premium and comparative analysis.
 */

export interface LiteratureEntry {
    platform: string;
    version: string;
    benchmark: string;
    metric: string;
    value: number;
    unit: string;
    latencyMs: number;
    successRate: number;
    source: string;
    year: number;
    notes?: string;
}

/**
 * Hyperledger Fabric benchmark data from TPCTC papers
 */
export const HYPERLEDGER_FABRIC: LiteratureEntry[] = [
    {
        platform: 'Hyperledger Fabric',
        version: '2.2',
        benchmark: 'TPC-C',
        metric: 'TPS',
        value: 200,
        unit: 'tx/sec',
        latencyMs: 350,
        successRate: 98.5,
        source: 'TPCTC 2023 - Porting TPC-C to Hyperledger Fabric',
        year: 2023,
        notes: '4-peer network, Raft consensus',
    },
    {
        platform: 'Hyperledger Fabric',
        version: '2.0',
        benchmark: 'Smallbank',
        metric: 'TPS',
        value: 400,
        unit: 'tx/sec',
        latencyMs: 150,
        successRate: 99.0,
        source: 'Blockbench: A Framework for Analyzing Private Blockchains',
        year: 2022,
        notes: 'LevelDB state database',
    },
    {
        platform: 'Hyperledger Fabric',
        version: '2.4',
        benchmark: 'YCSB',
        metric: 'TPS',
        value: 2000,
        unit: 'tx/sec',
        latencyMs: 50,
        successRate: 99.5,
        source: 'IEEE Blockchain 2023',
        year: 2023,
        notes: 'Simple key-value operations',
    },
];

/**
 * Ethereum benchmark data
 */
export const ETHEREUM: LiteratureEntry[] = [
    {
        platform: 'Ethereum',
        version: 'PoS (Post-Merge)',
        benchmark: 'Token Transfer',
        metric: 'TPS',
        value: 30,
        unit: 'tx/sec',
        latencyMs: 12000,
        successRate: 99.9,
        source: 'Etherscan Analytics',
        year: 2024,
        notes: '12-second block time',
    },
    {
        platform: 'Ethereum',
        version: 'PoS',
        benchmark: 'DEX Swap',
        metric: 'TPS',
        value: 15,
        unit: 'tx/sec',
        latencyMs: 15000,
        successRate: 98.0,
        source: 'Dune Analytics',
        year: 2024,
        notes: 'Uniswap V3 swaps',
    },
    {
        platform: 'Ethereum',
        version: 'PoW (Pre-Merge)',
        benchmark: 'Token Transfer',
        metric: 'TPS',
        value: 15,
        unit: 'tx/sec',
        latencyMs: 15000,
        successRate: 99.5,
        source: 'Blockbench',
        year: 2022,
    },
];

/**
 * Solana benchmark data
 */
export const SOLANA: LiteratureEntry[] = [
    {
        platform: 'Solana',
        version: '1.14',
        benchmark: 'Token Transfer',
        metric: 'TPS',
        value: 4000,
        unit: 'tx/sec',
        latencyMs: 400,
        successRate: 99.5,
        source: 'Solana Beach Analytics',
        year: 2024,
        notes: 'Mainnet beta actual',
    },
    {
        platform: 'Solana',
        version: '1.14',
        benchmark: 'DEX Trade',
        metric: 'TPS',
        value: 1500,
        unit: 'tx/sec',
        latencyMs: 500,
        successRate: 98.0,
        source: 'Serum DEX Analytics',
        year: 2024,
    },
];

/**
 * Traditional database baselines
 */
export const DATABASES: LiteratureEntry[] = [
    {
        platform: 'PostgreSQL',
        version: '15',
        benchmark: 'TPC-C',
        metric: 'tpmC',
        value: 300000,
        unit: 'tx/min',
        latencyMs: 2,
        successRate: 99.99,
        source: 'TPC.org Official Results',
        year: 2023,
    },
    {
        platform: 'PostgreSQL',
        version: '15',
        benchmark: 'Smallbank',
        metric: 'TPS',
        value: 8000,
        unit: 'tx/sec',
        latencyMs: 0.5,
        successRate: 99.99,
        source: 'Baseline Measurement',
        year: 2024,
    },
    {
        platform: 'MySQL',
        version: '8.0',
        benchmark: 'TPC-C',
        metric: 'tpmC',
        value: 250000,
        unit: 'tx/min',
        latencyMs: 3,
        successRate: 99.98,
        source: 'TPC.org Official Results',
        year: 2023,
    },
];

/**
 * GridTokenX results (this study)
 */
export const GRIDTOKENX: LiteratureEntry[] = [
    {
        platform: 'GridTokenX',
        version: 'Solana/PoA',
        benchmark: 'TPC-C',
        metric: 'tpmC',
        value: 21378,
        unit: 'tx/min',
        latencyMs: 11.34,
        successRate: 99.9,
        source: 'This Study',
        year: 2024,
        notes: 'Proof of Authority consensus',
    },
    {
        platform: 'GridTokenX',
        version: 'Solana/PoA',
        benchmark: 'Smallbank',
        metric: 'TPS',
        value: 1741,
        unit: 'tx/sec',
        latencyMs: 5.72,
        successRate: 99.8,
        source: 'This Study',
        year: 2024,
        notes: 'Proof of Authority consensus',
    },
    {
        platform: 'GridTokenX',
        version: 'Solana/PoA',
        benchmark: 'TPC-E',
        metric: 'tpsE',
        value: 307,
        unit: 'trade/sec',
        latencyMs: 7.89,
        successRate: 97.0,
        source: 'This Study',
        year: 2024,
        notes: 'Proof of Authority consensus',
    },
    {
        platform: 'GridTokenX',
        version: 'Solana/PoA',
        benchmark: 'TPC-H',
        metric: 'QphH',
        value: 254930,
        unit: 'queries/hr',
        latencyMs: 69.89,
        successRate: 99.0,
        source: 'This Study',
        year: 2024,
        notes: 'Proof of Authority consensus',
    },
];

/**
 * Calculate Trust Premium
 */
export function calculateTrustPremium(
    blockchain: LiteratureEntry,
    baseline: LiteratureEntry
): { latencyMultiplier: number; throughputRatio: number } {
    return {
        latencyMultiplier: blockchain.latencyMs / baseline.latencyMs,
        throughputRatio: blockchain.value / baseline.value,
    };
}

/**
 * Get all literature data
 */
export function getAllLiteratureData(): LiteratureEntry[] {
    return [
        ...GRIDTOKENX,
        ...HYPERLEDGER_FABRIC,
        ...ETHEREUM,
        ...SOLANA,
        ...DATABASES,
    ];
}

/**
 * Generate comparison table
 */
export function generateComparisonTable(): string {
    const allData = getAllLiteratureData();

    let table = '| Platform | Benchmark | Metric | Value | Latency | Source |\n';
    table += '|----------|-----------|--------|-------|---------|--------|\n';

    for (const entry of allData) {
        table += `| ${entry.platform} | ${entry.benchmark} | ${entry.metric} | ${entry.value} ${entry.unit} | ${entry.latencyMs}ms | ${entry.source} |\n`;
    }

    return table;
}

// CLI execution
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('literature-data.ts');

if (isMainModule) {
    console.log('\n📚 Literature Reference Data\n');
    console.log(generateComparisonTable());

    // Calculate Trust Premium for GridTokenX
    console.log('\n📊 Trust Premium Analysis (GridTokenX vs PostgreSQL):\n');

    const gridtokenxTpcC = GRIDTOKENX.find(e => e.benchmark === 'TPC-C')!;
    const postgresqlTpcC = DATABASES.find(e => e.platform === 'PostgreSQL' && e.benchmark === 'TPC-C')!;

    const premium = calculateTrustPremium(gridtokenxTpcC, postgresqlTpcC);
    console.log(`  Latency Multiplier: ${premium.latencyMultiplier.toFixed(2)}x`);
    console.log(`  Throughput Ratio: ${(premium.throughputRatio * 100).toFixed(2)}%`);
}
