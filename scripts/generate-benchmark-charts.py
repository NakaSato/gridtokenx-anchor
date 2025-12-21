#!/usr/bin/env python3
"""
TPC-C Benchmark Results Visualization
Generates charts for thesis and academic papers
"""

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
from pathlib import Path

# Set style
plt.style.use('seaborn-v0_8-whitegrid')
plt.rcParams['font.family'] = 'serif'
plt.rcParams['font.size'] = 11
plt.rcParams['axes.labelsize'] = 12
plt.rcParams['axes.titlesize'] = 14

# Benchmark Results
RESULTS = {
    'tpmC': 2076,
    'tps': 77.2,
    'success_rate': 99.89,
    'transactions': {
        'total': 4637,
        'successful': 4632,
        'failed': 5
    },
    'latency': {
        'mean': 116969,
        'std': 37117,
        'min': 33083,
        'max': 273706,
        'p50': 113287,
        'p75': 138999,
        'p90': 167425,
        'p95': 180869,
        'p99': 226657,
        'p999': 269370
    },
    'tx_mix': {
        'NEW_ORDER': {'count': 2078, 'pct': 44.8, 'success': 99.9},
        'PAYMENT': {'count': 2009, 'pct': 43.3, 'success': 99.9},
        'ORDER_STATUS': {'count': 191, 'pct': 4.1, 'success': 100.0},
        'DELIVERY': {'count': 175, 'pct': 3.8, 'success': 100.0},
        'STOCK_LEVEL': {'count': 184, 'pct': 4.0, 'success': 100.0}
    },
    'mvcc_conflict_rate': 1.81,
    'trust_premium': 58.48,
    'baseline_latency_ms': 2
}

# Comparison data
COMPARISON = {
    'GridTokenX': {'latency': 117, 'tps': 77, 'trust_premium': 58.5},
    'Hyperledger Fabric': {'latency': 350, 'tps': 200, 'trust_premium': 175},
    'Ethereum (PoS)': {'latency': 12000, 'tps': 30, 'trust_premium': 6000},
    'PostgreSQL': {'latency': 2, 'tps': 5000, 'trust_premium': 1}
}

OUTPUT_DIR = Path(__file__).parent.parent / 'docs' / 'thesis' / 'figures'


def create_output_dir():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def fig1_latency_distribution():
    """Figure 1: Latency Percentile Distribution"""
    fig, ax = plt.subplots(figsize=(10, 6))
    
    percentiles = ['Min', 'p50', 'p75', 'p90', 'p95', 'p99', 'p99.9', 'Max']
    values = [
        RESULTS['latency']['min'] / 1000,
        RESULTS['latency']['p50'] / 1000,
        RESULTS['latency']['p75'] / 1000,
        RESULTS['latency']['p90'] / 1000,
        RESULTS['latency']['p95'] / 1000,
        RESULTS['latency']['p99'] / 1000,
        RESULTS['latency']['p999'] / 1000,
        RESULTS['latency']['max'] / 1000
    ]
    
    colors = ['#2ecc71', '#3498db', '#3498db', '#f39c12', '#f39c12', '#e74c3c', '#e74c3c', '#c0392b']
    bars = ax.bar(percentiles, values, color=colors, edgecolor='black', linewidth=0.5)
    
    ax.set_ylabel('Latency (ms)')
    ax.set_xlabel('Percentile')
    ax.set_title('TPC-C Benchmark: Latency Distribution')
    
    # Add value labels
    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 5, 
                f'{val:.1f}', ha='center', va='bottom', fontsize=9)
    
    ax.set_ylim(0, max(values) * 1.15)
    
    plt.tight_layout()
    plt.savefig(OUTPUT_DIR / 'latency_distribution.pdf', dpi=300, bbox_inches='tight')
    plt.savefig(OUTPUT_DIR / 'latency_distribution.png', dpi=300, bbox_inches='tight')
    plt.close()
    print("✅ Generated: latency_distribution.pdf")


def fig2_transaction_mix():
    """Figure 2: TPC-C Transaction Mix"""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))
    
    # Pie chart - Transaction distribution
    labels = list(RESULTS['tx_mix'].keys())
    sizes = [v['pct'] for v in RESULTS['tx_mix'].values()]
    colors = ['#3498db', '#2ecc71', '#f39c12', '#e74c3c', '#9b59b6']
    explode = (0.05, 0, 0, 0, 0)
    
    ax1.pie(sizes, explode=explode, labels=labels, colors=colors, autopct='%1.1f%%',
            shadow=True, startangle=90)
    ax1.set_title('Transaction Type Distribution')
    
    # Bar chart - Success rates
    success_rates = [v['success'] for v in RESULTS['tx_mix'].values()]
    x_pos = np.arange(len(labels))
    bars = ax2.bar(x_pos, success_rates, color=colors, edgecolor='black', linewidth=0.5)
    
    ax2.set_ylabel('Success Rate (%)')
    ax2.set_xlabel('Transaction Type')
    ax2.set_title('Success Rate by Transaction Type')
    ax2.set_xticks(x_pos)
    ax2.set_xticklabels([l.replace('_', '\n') for l in labels], fontsize=9)
    ax2.set_ylim(99, 100.5)
    ax2.axhline(y=99.89, color='red', linestyle='--', label=f'Overall: {RESULTS["success_rate"]:.2f}%')
    ax2.legend()
    
    plt.tight_layout()
    plt.savefig(OUTPUT_DIR / 'transaction_mix.pdf', dpi=300, bbox_inches='tight')
    plt.savefig(OUTPUT_DIR / 'transaction_mix.png', dpi=300, bbox_inches='tight')
    plt.close()
    print("✅ Generated: transaction_mix.pdf")


def fig3_platform_comparison():
    """Figure 3: Platform Comparison - Trust Premium"""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))
    
    platforms = list(COMPARISON.keys())
    trust_premiums = [v['trust_premium'] for v in COMPARISON.values()]
    tps_values = [v['tps'] for v in COMPARISON.values()]
    
    colors = ['#3498db', '#e74c3c', '#f39c12', '#2ecc71']
    
    # Trust Premium (log scale)
    bars1 = ax1.bar(platforms, trust_premiums, color=colors, edgecolor='black', linewidth=0.5)
    ax1.set_ylabel('Trust Premium (x baseline)')
    ax1.set_yscale('log')
    ax1.set_title('Trust Premium Comparison\n(Lower is Better)')
    ax1.set_xticklabels(platforms, rotation=15, ha='right')
    
    for bar, val in zip(bars1, trust_premiums):
        ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() * 1.1, 
                f'{val:.1f}x', ha='center', va='bottom', fontsize=10)
    
    # TPS Comparison
    bars2 = ax2.bar(platforms, tps_values, color=colors, edgecolor='black', linewidth=0.5)
    ax2.set_ylabel('Transactions per Second (TPS)')
    ax2.set_yscale('log')
    ax2.set_title('Throughput Comparison\n(Higher is Better)')
    ax2.set_xticklabels(platforms, rotation=15, ha='right')
    
    for bar, val in zip(bars2, tps_values):
        ax2.text(bar.get_x() + bar.get_width()/2, bar.get_height() * 1.1, 
                f'{val}', ha='center', va='bottom', fontsize=10)
    
    plt.tight_layout()
    plt.savefig(OUTPUT_DIR / 'platform_comparison.pdf', dpi=300, bbox_inches='tight')
    plt.savefig(OUTPUT_DIR / 'platform_comparison.png', dpi=300, bbox_inches='tight')
    plt.close()
    print("✅ Generated: platform_comparison.pdf")


def fig4_summary_dashboard():
    """Figure 4: Summary Dashboard"""
    fig = plt.figure(figsize=(14, 8))
    
    # Create grid
    gs = fig.add_gridspec(2, 3, hspace=0.3, wspace=0.3)
    
    # 1. tpmC Gauge (top-left)
    ax1 = fig.add_subplot(gs[0, 0])
    ax1.text(0.5, 0.7, f'{RESULTS["tpmC"]:,}', fontsize=48, fontweight='bold',
             ha='center', va='center', color='#3498db')
    ax1.text(0.5, 0.3, 'tpmC', fontsize=20, ha='center', va='center', color='#666')
    ax1.set_xlim(0, 1)
    ax1.set_ylim(0, 1)
    ax1.axis('off')
    ax1.set_title('Primary Metric', fontsize=14, fontweight='bold')
    
    # 2. Success Rate (top-center)
    ax2 = fig.add_subplot(gs[0, 1])
    ax2.text(0.5, 0.7, f'{RESULTS["success_rate"]:.2f}%', fontsize=42, fontweight='bold',
             ha='center', va='center', color='#2ecc71')
    ax2.text(0.5, 0.3, 'Success Rate', fontsize=18, ha='center', va='center', color='#666')
    ax2.set_xlim(0, 1)
    ax2.set_ylim(0, 1)
    ax2.axis('off')
    ax2.set_title('Reliability', fontsize=14, fontweight='bold')
    
    # 3. Trust Premium (top-right)
    ax3 = fig.add_subplot(gs[0, 2])
    ax3.text(0.5, 0.7, f'{RESULTS["trust_premium"]:.1f}x', fontsize=42, fontweight='bold',
             ha='center', va='center', color='#e74c3c')
    ax3.text(0.5, 0.3, 'Trust Premium', fontsize=18, ha='center', va='center', color='#666')
    ax3.set_xlim(0, 1)
    ax3.set_ylim(0, 1)
    ax3.axis('off')
    ax3.set_title('vs PostgreSQL', fontsize=14, fontweight='bold')
    
    # 4. Latency Box (bottom-left)
    ax4 = fig.add_subplot(gs[1, 0])
    latency_data = [
        RESULTS['latency']['p50'] / 1000,
        RESULTS['latency']['p95'] / 1000,
        RESULTS['latency']['p99'] / 1000
    ]
    bars = ax4.bar(['p50', 'p95', 'p99'], latency_data, color=['#2ecc71', '#f39c12', '#e74c3c'])
    ax4.set_ylabel('Latency (ms)')
    ax4.set_title('Latency Percentiles', fontsize=14, fontweight='bold')
    for bar, val in zip(bars, latency_data):
        ax4.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 3, 
                f'{val:.0f}', ha='center', fontsize=11)
    
    # 5. Transaction counts (bottom-center)
    ax5 = fig.add_subplot(gs[1, 1])
    tx_labels = ['Total', 'Success', 'Failed']
    tx_values = [RESULTS['transactions']['total'], 
                 RESULTS['transactions']['successful'],
                 RESULTS['transactions']['failed']]
    colors = ['#3498db', '#2ecc71', '#e74c3c']
    bars = ax5.bar(tx_labels, tx_values, color=colors)
    ax5.set_ylabel('Count')
    ax5.set_title('Transaction Summary', fontsize=14, fontweight='bold')
    ax5.set_yscale('log')
    for bar, val in zip(bars, tx_values):
        ax5.text(bar.get_x() + bar.get_width()/2, bar.get_height() * 1.1, 
                f'{val:,}', ha='center', fontsize=11)
    
    # 6. Key metrics table (bottom-right)
    ax6 = fig.add_subplot(gs[1, 2])
    ax6.axis('off')
    table_data = [
        ['Metric', 'Value'],
        ['Total TPS', f'{RESULTS["tps"]:.1f}'],
        ['Mean Latency', f'{RESULTS["latency"]["mean"]/1000:.1f} ms'],
        ['MVCC Conflicts', f'{RESULTS["mvcc_conflict_rate"]:.2f}%'],
        ['Baseline', f'{RESULTS["baseline_latency_ms"]} ms']
    ]
    table = ax6.table(cellText=table_data, loc='center', cellLoc='center',
                      colWidths=[0.5, 0.4])
    table.auto_set_font_size(False)
    table.set_fontsize(11)
    table.scale(1.2, 1.8)
    
    # Style header row
    for j in range(2):
        table[(0, j)].set_facecolor('#3498db')
        table[(0, j)].set_text_props(color='white', fontweight='bold')
    
    ax6.set_title('Additional Metrics', fontsize=14, fontweight='bold')
    
    fig.suptitle('GridTokenX TPC-C Benchmark Results', fontsize=18, fontweight='bold', y=0.98)
    
    plt.savefig(OUTPUT_DIR / 'benchmark_summary.pdf', dpi=300, bbox_inches='tight')
    plt.savefig(OUTPUT_DIR / 'benchmark_summary.png', dpi=300, bbox_inches='tight')
    plt.close()
    print("✅ Generated: benchmark_summary.pdf")


def main():
    print("\n📊 Generating TPC-C Benchmark Visualizations\n")
    print(f"Output directory: {OUTPUT_DIR}\n")
    
    create_output_dir()
    
    fig1_latency_distribution()
    fig2_transaction_mix()
    fig3_platform_comparison()
    fig4_summary_dashboard()
    
    print(f"\n✅ All figures saved to: {OUTPUT_DIR}")
    print("\nGenerated files:")
    for f in OUTPUT_DIR.glob('*.pdf'):
        print(f"  - {f.name}")


if __name__ == '__main__':
    main()
