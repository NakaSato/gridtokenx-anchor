#!/usr/bin/env node

/**
 * Research Chart Generator for GridTokenX Benchmarks
 * 
 * Generates publication-ready charts (SVG) for master's thesis.
 * Charts include:
 * - Throughput comparison (bar chart)
 * - Latency distribution (box plot style)
 * - Scalability curve (line chart)
 * - Trust Premium comparison
 * 
 * Output: SVG files for LaTeX inclusion
 */

import * as fs from 'fs';
import * as path from 'path';

interface BenchmarkData {
    name: string;
    tps?: number;
    tpmC?: number;
    tpsE?: number;
    qphH?: number;
    latency: {
        avg: number;
        p50: number;
        p95: number;
        p99: number;
    };
    successRate?: number;
}

interface ScalabilityPoint {
    users: number;
    tps: number;
    latency: number;
}

const COLORS = {
    primary: '#6366f1',
    secondary: '#22c55e',
    accent: '#f59e0b',
    danger: '#ef4444',
    purple: '#8b5cf6',
    cyan: '#06b6d4',
};

export class ChartGenerator {
    private outputDir: string;

    constructor(outputDir?: string) {
        this.outputDir = outputDir || path.join(process.cwd(), 'test-results', 'charts');
        this.ensureDirectory();
    }

    private ensureDirectory() {
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    /**
     * Generate throughput comparison bar chart
     */
    generateThroughputChart(data: BenchmarkData[]): string {
        const width = 600;
        const height = 400;
        const margin = { top: 40, right: 30, bottom: 60, left: 70 };
        const chartWidth = width - margin.left - margin.right;
        const chartHeight = height - margin.top - margin.bottom;

        const maxTps = Math.max(...data.map(d => d.tps || d.tpmC || d.tpsE || 0));
        const barWidth = chartWidth / data.length * 0.6;
        const barGap = chartWidth / data.length * 0.2;

        let bars = '';
        let labels = '';
        const colors = [COLORS.primary, COLORS.secondary, COLORS.accent, COLORS.purple];

        data.forEach((d, i) => {
            const value = d.tps || d.tpmC || d.tpsE || 0;
            const barHeight = (value / maxTps) * chartHeight;
            const x = margin.left + i * (barWidth + barGap) + barGap;
            const y = margin.top + chartHeight - barHeight;

            bars += `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" 
              fill="${colors[i % colors.length]}" rx="4" />
        <text x="${x + barWidth / 2}" y="${y - 10}" text-anchor="middle" 
              font-size="12" fill="#374151">${value.toLocaleString()}</text>
      `;

            labels += `
        <text x="${x + barWidth / 2}" y="${height - 25}" text-anchor="middle" 
              font-size="11" fill="#6b7280">${d.name}</text>
      `;
        });

        // Y-axis
        const yAxis = Array.from({ length: 5 }, (_, i) => {
            const value = (maxTps / 4) * i;
            const y = margin.top + chartHeight - (value / maxTps) * chartHeight;
            return `
        <line x1="${margin.left - 5}" y1="${y}" x2="${margin.left}" y2="${y}" stroke="#9ca3af" />
        <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">
          ${Math.round(value).toLocaleString()}
        </text>
        <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" 
              stroke="#e5e7eb" stroke-dasharray="3,3" />
      `;
        }).join('');

        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  </style>
  
  <!-- Background -->
  <rect width="${width}" height="${height}" fill="white"/>
  
  <!-- Title -->
  <text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="600" fill="#111827">
    Throughput Comparison (TPS)
  </text>
  
  <!-- Y-axis -->
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}" stroke="#9ca3af"/>
  <text x="20" y="${height / 2}" text-anchor="middle" font-size="12" fill="#374151" 
        transform="rotate(-90, 20, ${height / 2})">Transactions per Second</text>
  ${yAxis}
  
  <!-- Bars -->
  ${bars}
  
  <!-- Labels -->
  ${labels}
</svg>`;

        const filePath = path.join(this.outputDir, 'throughput-comparison.svg');
        fs.writeFileSync(filePath, svg);
        console.log(`📊 Generated: ${filePath}`);
        return filePath;
    }

    /**
     * Generate latency distribution chart
     */
    generateLatencyChart(data: BenchmarkData[]): string {
        const width = 600;
        const height = 400;
        const margin = { top: 40, right: 30, bottom: 60, left: 70 };
        const chartWidth = width - margin.left - margin.right;
        const chartHeight = height - margin.top - margin.bottom;

        const maxLatency = Math.max(...data.flatMap(d => [d.latency.p99]));
        const boxWidth = 60;
        const gap = (chartWidth - data.length * boxWidth) / (data.length + 1);

        let boxes = '';
        const colors = [COLORS.primary, COLORS.secondary, COLORS.accent, COLORS.purple];

        data.forEach((d, i) => {
            const x = margin.left + gap + i * (boxWidth + gap);
            const scale = (v: number) => margin.top + chartHeight - (v / maxLatency) * chartHeight;

            const p50Y = scale(d.latency.p50);
            const p95Y = scale(d.latency.p95);
            const p99Y = scale(d.latency.p99);
            const avgY = scale(d.latency.avg);

            boxes += `
        <!-- ${d.name} Box -->
        <line x1="${x + boxWidth / 2}" y1="${p99Y}" x2="${x + boxWidth / 2}" y2="${p95Y}" 
              stroke="${colors[i % colors.length]}" stroke-width="2"/>
        <line x1="${x + 10}" y1="${p99Y}" x2="${x + boxWidth - 10}" y2="${p99Y}" 
              stroke="${colors[i % colors.length]}" stroke-width="2"/>
        <rect x="${x}" y="${p95Y}" width="${boxWidth}" height="${p50Y - p95Y}" 
              fill="${colors[i % colors.length]}" fill-opacity="0.3" stroke="${colors[i % colors.length]}" stroke-width="2" rx="4"/>
        <line x1="${x}" y1="${avgY}" x2="${x + boxWidth}" y2="${avgY}" 
              stroke="${colors[i % colors.length]}" stroke-width="3"/>
        <text x="${x + boxWidth / 2}" y="${height - 25}" text-anchor="middle" 
              font-size="11" fill="#6b7280">${d.name}</text>
        <text x="${x + boxWidth / 2}" y="${avgY - 8}" text-anchor="middle" 
              font-size="10" fill="#374151">${d.latency.avg.toFixed(1)}ms</text>
      `;
        });

        // Y-axis
        const yAxis = Array.from({ length: 5 }, (_, i) => {
            const value = (maxLatency / 4) * i;
            const y = margin.top + chartHeight - (value / maxLatency) * chartHeight;
            return `
        <line x1="${margin.left - 5}" y1="${y}" x2="${margin.left}" y2="${y}" stroke="#9ca3af"/>
        <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">
          ${value.toFixed(0)}ms
        </text>
      `;
        }).join('');

        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  </style>
  
  <rect width="${width}" height="${height}" fill="white"/>
  
  <text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="600" fill="#111827">
    Latency Distribution (ms)
  </text>
  
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}" stroke="#9ca3af"/>
  <text x="20" y="${height / 2}" text-anchor="middle" font-size="12" fill="#374151"
        transform="rotate(-90, 20, ${height / 2})">Latency (ms)</text>
  ${yAxis}
  
  ${boxes}
  
  <!-- Legend -->
  <text x="${width - 100}" y="${margin.top + 20}" font-size="10" fill="#6b7280">■ p50-p95 range</text>
  <text x="${width - 100}" y="${margin.top + 35}" font-size="10" fill="#6b7280">─ avg latency</text>
  <text x="${width - 100}" y="${margin.top + 50}" font-size="10" fill="#6b7280">┬ p99</text>
</svg>`;

        const filePath = path.join(this.outputDir, 'latency-distribution.svg');
        fs.writeFileSync(filePath, svg);
        console.log(`📊 Generated: ${filePath}`);
        return filePath;
    }

    /**
     * Generate scalability curve
     */
    generateScalabilityChart(data: ScalabilityPoint[]): string {
        const width = 600;
        const height = 400;
        const margin = { top: 40, right: 70, bottom: 60, left: 70 };
        const chartWidth = width - margin.left - margin.right;
        const chartHeight = height - margin.top - margin.bottom;

        const maxUsers = Math.max(...data.map(d => d.users));
        const maxTps = Math.max(...data.map(d => d.tps));
        const maxLatency = Math.max(...data.map(d => d.latency));

        // TPS line
        const tpsPoints = data.map((d, i) => {
            const x = margin.left + (d.users / maxUsers) * chartWidth;
            const y = margin.top + chartHeight - (d.tps / maxTps) * chartHeight;
            return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
        }).join(' ');

        // Latency line
        const latencyPoints = data.map((d, i) => {
            const x = margin.left + (d.users / maxUsers) * chartWidth;
            const y = margin.top + chartHeight - (d.latency / maxLatency) * chartHeight;
            return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
        }).join(' ');

        // Data points
        const tpsDots = data.map(d => {
            const x = margin.left + (d.users / maxUsers) * chartWidth;
            const y = margin.top + chartHeight - (d.tps / maxTps) * chartHeight;
            return `<circle cx="${x}" cy="${y}" r="4" fill="${COLORS.primary}"/>`;
        }).join('');

        const latencyDots = data.map(d => {
            const x = margin.left + (d.users / maxUsers) * chartWidth;
            const y = margin.top + chartHeight - (d.latency / maxLatency) * chartHeight;
            return `<circle cx="${x}" cy="${y}" r="4" fill="${COLORS.accent}"/>`;
        }).join('');

        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  </style>
  
  <rect width="${width}" height="${height}" fill="white"/>
  
  <text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="600" fill="#111827">
    Scalability Analysis
  </text>
  
  <!-- Grid -->
  <line x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${width - margin.right}" y2="${margin.top + chartHeight}" stroke="#9ca3af"/>
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}" stroke="#9ca3af"/>
  
  <!-- TPS line -->
  <path d="${tpsPoints}" fill="none" stroke="${COLORS.primary}" stroke-width="2"/>
  ${tpsDots}
  
  <!-- Latency line -->
  <path d="${latencyPoints}" fill="none" stroke="${COLORS.accent}" stroke-width="2" stroke-dasharray="5,5"/>
  ${latencyDots}
  
  <!-- X-axis label -->
  <text x="${margin.left + chartWidth / 2}" y="${height - 15}" text-anchor="middle" font-size="12" fill="#374151">
    Concurrent Users
  </text>
  
  <!-- Y-axis labels -->
  <text x="15" y="${height / 2}" text-anchor="middle" font-size="11" fill="${COLORS.primary}"
        transform="rotate(-90, 15, ${height / 2})">TPS</text>
  <text x="${width - 15}" y="${height / 2}" text-anchor="middle" font-size="11" fill="${COLORS.accent}"
        transform="rotate(90, ${width - 15}, ${height / 2})">Latency (ms)</text>
  
  <!-- Legend -->
  <rect x="${margin.left + 10}" y="${margin.top + 10}" width="12" height="12" fill="${COLORS.primary}"/>
  <text x="${margin.left + 28}" y="${margin.top + 20}" font-size="11" fill="#374151">TPS</text>
  <rect x="${margin.left + 70}" y="${margin.top + 10}" width="12" height="12" fill="${COLORS.accent}"/>
  <text x="${margin.left + 88}" y="${margin.top + 20}" font-size="11" fill="#374151">Latency</text>
</svg>`;

        const filePath = path.join(this.outputDir, 'scalability-curve.svg');
        fs.writeFileSync(filePath, svg);
        console.log(`📊 Generated: ${filePath}`);
        return filePath;
    }

    /**
     * Generate Trust Premium comparison chart
     */
    generateTrustPremiumChart(): string {
        const width = 600;
        const height = 400;
        const margin = { top: 40, right: 30, bottom: 80, left: 70 };

        const data = [
            { name: 'PostgreSQL\n(Baseline)', latency: 0.5, tps: 5000 },
            { name: 'GridTokenX\n(Solana)', latency: 1.83, tps: 545 },
            { name: 'Hyperledger\nFabric', latency: 150, tps: 300 },
            { name: 'Ethereum\n(PoS)', latency: 12000, tps: 30 },
        ];

        const maxLatency = 200; // Cap for visibility
        const barWidth = 80;
        const gap = 30;
        const chartWidth = width - margin.left - margin.right;
        const chartHeight = height - margin.top - margin.bottom;

        let bars = '';
        const colors = [COLORS.secondary, COLORS.primary, COLORS.accent, COLORS.danger];

        data.forEach((d, i) => {
            const x = margin.left + gap + i * (barWidth + gap);
            const displayLatency = Math.min(d.latency, maxLatency);
            const barHeight = (displayLatency / maxLatency) * chartHeight;
            const y = margin.top + chartHeight - barHeight;

            bars += `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" 
              fill="${colors[i]}" rx="4"/>
        <text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" 
              font-size="11" fill="#374151">${d.latency}ms</text>
        <text x="${x + barWidth / 2}" y="${height - 50}" text-anchor="middle" 
              font-size="10" fill="#6b7280" style="white-space: pre-line;">
          <tspan x="${x + barWidth / 2}" dy="0">${d.name.split('\n')[0]}</tspan>
          <tspan x="${x + barWidth / 2}" dy="12">${d.name.split('\n')[1] || ''}</tspan>
        </text>
        <text x="${x + barWidth / 2}" y="${height - 20}" text-anchor="middle" 
              font-size="9" fill="#9ca3af">${d.tps} TPS</text>
      `;
        });

        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  </style>
  
  <rect width="${width}" height="${height}" fill="white"/>
  
  <text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="600" fill="#111827">
    Trust Premium: Latency Comparison
  </text>
  
  <line x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${width - margin.right}" y2="${margin.top + chartHeight}" stroke="#9ca3af"/>
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}" stroke="#9ca3af"/>
  
  <text x="20" y="${height / 2 - 20}" text-anchor="middle" font-size="12" fill="#374151"
        transform="rotate(-90, 20, ${height / 2 - 20})">Latency (ms) - lower is better</text>
  
  ${bars}
  
  <!-- Note -->
  <text x="${width / 2}" y="${height - 5}" text-anchor="middle" font-size="9" fill="#9ca3af">
    Trust Premium = Blockchain Latency / Baseline Latency
  </text>
</svg>`;

        const filePath = path.join(this.outputDir, 'trust-premium.svg');
        fs.writeFileSync(filePath, svg);
        console.log(`📊 Generated: ${filePath}`);
        return filePath;
    }

    /**
     * Generate all charts with sample data
     */
    generateAll(): void {
        console.log('\n📊 Generating Research Charts...\n');

        // Sample benchmark data
        const benchmarkData: BenchmarkData[] = [
            { name: 'TPC-C', tpmC: 21378, latency: { avg: 11.34, p50: 11, p95: 18, p99: 20 } },
            { name: 'Smallbank', tps: 1741, latency: { avg: 5.72, p50: 6, p95: 9, p99: 10 } },
            { name: 'TPC-E', tpsE: 850, latency: { avg: 8.5, p50: 8, p95: 14, p99: 16 } },
            { name: 'TPC-H', tps: 120, latency: { avg: 75, p50: 65, p95: 120, p99: 150 } },
        ];

        const scalabilityData: ScalabilityPoint[] = [
            { users: 5, tps: 527, latency: 2.25 },
            { users: 10, tps: 543, latency: 1.89 },
            { users: 25, tps: 519, latency: 1.82 },
            { users: 50, tps: 541, latency: 1.85 },
            { users: 75, tps: 543, latency: 1.84 },
            { users: 100, tps: 544, latency: 1.84 },
            { users: 150, tps: 544, latency: 1.83 },
            { users: 200, tps: 545, latency: 1.83 },
        ];

        this.generateThroughputChart(benchmarkData);
        this.generateLatencyChart(benchmarkData);
        this.generateScalabilityChart(scalabilityData);
        this.generateTrustPremiumChart();

        console.log(`\n✅ All charts generated in: ${this.outputDir}`);
    }
}

// CLI execution
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('generate-charts.ts');

if (isMainModule) {
    const generator = new ChartGenerator();
    generator.generateAll();
}
