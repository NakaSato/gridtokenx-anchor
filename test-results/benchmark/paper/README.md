# GridTokenX Performance Analysis - Research Paper Materials

This folder contains all materials for the research paper on GridTokenX blockchain-based energy trading platform performance evaluation.

## 📁 File Structure

```
paper/
├── main.tex                    # Main LaTeX paper (IEEE conference format)
├── references.bib              # BibTeX bibliography (30+ references)
├── tables.tex                  # LaTeX tables (9 tables)
├── figures.tex                 # TikZ/PGFPlots figures (6 figures)
├── PERFORMANCE_ANALYSIS.md     # Markdown analysis document
├── benchmark_results.json      # Raw benchmark results
├── Makefile                    # Build automation
├── README.md                   # This file
└── data/
    ├── throughput_results.csv
    ├── latency_distribution.csv
    ├── scalability_analysis.csv
    └── operation_performance.csv
```

## 🔧 Building the Paper

### Prerequisites

- LaTeX distribution (TeX Live, MiKTeX, or MacTeX)
- Required packages: `pgfplots`, `tikz`, `booktabs`, `siunitx`, `hyperref`

### Quick Build

```bash
# Using Make (recommended)
make

# Or manually
pdflatex main.tex
bibtex main
pdflatex main.tex
pdflatex main.tex
```

### Build Commands

| Command | Description |
|---------|-------------|
| `make` | Build PDF |
| `make clean` | Remove auxiliary files |
| `make cleanall` | Remove all generated files |
| `make view` | Open PDF viewer |

## 📊 Key Results Summary

| Metric | Value | Assessment |
|--------|-------|------------|
| Peak Throughput | 207.6 TPS | Exceeds requirements |
| Average Latency | 2.66-3.48 ms | Excellent |
| p99 Latency | 4.56-8.60 ms | Production-ready |
| Success Rate | 92.6-98.4% | High reliability |
| Max Concurrent Users | 200+ | Scalable |

## 📚 Reference Standards

### Performance Testing
- **TPC-C v5.11.45 (2023)** - Transaction Processing Performance Council
- **Blockbench (SIGMOD 2017)** - Blockchain Benchmarking Framework
- **Hyperledger Caliper v0.6.0 (2024)** - Blockchain Performance Testing
- **ISO/IEC 25010:2023** - Software Quality Model

### Blockchain-Specific
- **Chainhammer** - Ethereum Stress Testing
- **FastFabric** - Hyperledger Fabric Optimization

### Energy Sector Compliance
- **IEC 62351:2023** - Power systems data security
- **IEEE 2030-2011** - Smart Grid Interoperability
- **IEC 61850:2024** - Power utility automation
- **IEEE 1547-2018** - DER interconnection

## 📈 Test Scenarios

| Scenario | Description | Target TPS | Achieved TPS |
|----------|-------------|------------|--------------|
| Evening Peak | Max consumer demand (5-8 PM) | 75 | 90.3 |
| Flash Sale | Promotional event surge | 150 | 207.6 |
| Market Volatility | High-frequency trading | 100 | 134.3 |

## 🔄 Regenerating Results

To regenerate benchmark results:

```bash
# From project root
cd ../..

# Run real-world benchmark
pnpm benchmark:realworld

# Aggregate results for paper
pnpm benchmark:aggregate
```

## 📝 Citation

If using these results, please cite:

```bibtex
@inproceedings{gridtokenx2025,
  title     = {Performance Analysis of GridTokenX: A Blockchain-Based 
               Decentralized Energy Trading Platform on Solana},
  author    = {Author Name},
  booktitle = {Conference Name},
  year      = {2025}
}
```

## 📄 License

Research materials for academic purposes. Contact authors for commercial use.

---

*Generated: December 16, 2025*
*Test Framework: LiteSVM v0.4.0*
*Platform: GridTokenX Anchor v0.1.1*
