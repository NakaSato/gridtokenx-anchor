#!/usr/bin/env node

/**
 * Academic Literature References for GridTokenX Research
 * 
 * Contains citations from:
 * - TPC Technology Conference (TPCTC) 2021-2024
 * - IEEE/ACM Blockchain conferences
 * - Energy trading blockchain papers
 */

export interface Citation {
    id: string;
    authors: string[];
    title: string;
    venue: string;
    year: number;
    doi?: string;
    url?: string;
    relevance: string;
}

/**
 * TPC Technology Conference Papers
 */
export const TPCTC_PAPERS: Citation[] = [
    {
        id: 'tpctc2023-fabric',
        authors: ['Ruan, P.', 'Chen, G.', 'Dinh, T.T.A.', 'Lin, Q.', 'Ooi, B.C.', 'Zhang, M.'],
        title: 'Porting a Benchmark with a Classic Workload to Blockchain: TPC-C on Hyperledger Fabric',
        venue: 'TPCTC 2023 - TPC Technology Conference',
        year: 2023,
        doi: '10.1007/978-3-031-29576-8_5',
        relevance: 'Primary methodology reference for TPC-C blockchainification',
    },
    {
        id: 'tpctc2022-benchmark',
        authors: ['Dinh, T.T.A.', 'Wang, J.', 'Chen, G.', 'Liu, R.', 'Ooi, B.C.', 'Tan, K.L.'],
        title: 'BLOCKBENCH: A Framework for Analyzing Private Blockchains',
        venue: 'SIGMOD 2017 / TPCTC Reference',
        year: 2017,
        doi: '10.1145/3035918.3064033',
        relevance: 'Foundational benchmark framework for blockchain evaluation',
    },
    {
        id: 'tpctc2021-fabric-v2',
        authors: ['Thakkar, P.', 'Nathan, S.', 'Viswanathan, B.'],
        title: 'Performance Benchmarking and Optimizing Hyperledger Fabric Blockchain Platform',
        venue: 'IEEE MASCOTS 2018',
        year: 2018,
        doi: '10.1109/MASCOTS.2018.00034',
        relevance: 'Fabric performance optimization techniques',
    },
];

/**
 * Blockchain Performance Papers
 */
export const BLOCKCHAIN_PERFORMANCE: Citation[] = [
    {
        id: 'solana-whitepaper',
        authors: ['Yakovenko, A.'],
        title: 'Solana: A new architecture for a high performance blockchain',
        venue: 'Solana Labs Whitepaper',
        year: 2018,
        url: 'https://solana.com/solana-whitepaper.pdf',
        relevance: 'Solana architecture and performance claims',
    },
    {
        id: 'ethereum-pos',
        authors: ['Buterin, V.', 'Griffith, V.'],
        title: 'Casper the Friendly Finality Gadget',
        venue: 'arXiv preprint',
        year: 2017,
        doi: '10.48550/arXiv.1710.09437',
        relevance: 'Ethereum PoS consensus mechanism',
    },
    {
        id: 'pbft-consensus',
        authors: ['Castro, M.', 'Liskov, B.'],
        title: 'Practical Byzantine Fault Tolerance',
        venue: 'OSDI 1999',
        year: 1999,
        doi: '10.5555/296806.296824',
        relevance: 'Foundational consensus algorithm for PoA variants',
    },
];

/**
 * Energy Trading and P2P Papers
 */
export const ENERGY_TRADING: Citation[] = [
    {
        id: 'p2p-energy-review',
        authors: ['Tushar, W.', 'Saha, T.K.', 'Yuen, C.', 'Smith, D.', 'Poor, H.V.'],
        title: 'Peer-to-peer trading in electricity networks: An overview',
        venue: 'IEEE Transactions on Smart Grid',
        year: 2020,
        doi: '10.1109/TSG.2020.2969657',
        relevance: 'Comprehensive P2P energy trading survey',
    },
    {
        id: 'brooklyn-microgrid',
        authors: ['Mengelkamp, E.', 'Gärttner, J.', 'Rock, K.', 'Kessler, S.', 'Orsini, L.', 'Weinhardt, C.'],
        title: 'Designing microgrid energy markets: A case study: The Brooklyn Microgrid',
        venue: 'Applied Energy',
        year: 2018,
        doi: '10.1016/j.apenergy.2017.06.054',
        relevance: 'Real-world blockchain energy trading implementation',
    },
    {
        id: 'blockchain-energy-survey',
        authors: ['Andoni, M.', 'Robu, V.', 'Flynn, D.', 'et al.'],
        title: 'Blockchain technology in the energy sector: A systematic review of challenges and opportunities',
        venue: 'Renewable and Sustainable Energy Reviews',
        year: 2019,
        doi: '10.1016/j.rser.2018.10.014',
        relevance: 'Blockchain applications in energy sector',
    },
];

/**
 * TPC Official Standards
 */
export const TPC_STANDARDS: Citation[] = [
    {
        id: 'tpc-c-spec',
        authors: ['Transaction Processing Performance Council'],
        title: 'TPC BENCHMARK C Standard Specification Revision 5.11',
        venue: 'TPC.org',
        year: 2010,
        url: 'https://www.tpc.org/tpc_documents_current_versions/pdf/tpc-c_v5.11.0.pdf',
        relevance: 'Official TPC-C benchmark specification',
    },
    {
        id: 'tpc-e-spec',
        authors: ['Transaction Processing Performance Council'],
        title: 'TPC BENCHMARK E Standard Specification',
        venue: 'TPC.org',
        year: 2007,
        url: 'https://www.tpc.org/tpc-e/',
        relevance: 'Official TPC-E benchmark specification',
    },
    {
        id: 'tpc-h-spec',
        authors: ['Transaction Processing Performance Council'],
        title: 'TPC BENCHMARK H Standard Specification Revision 3.0',
        venue: 'TPC.org',
        year: 2021,
        url: 'https://www.tpc.org/tpc_documents_current_versions/pdf/tpc-h_v3.0.0.pdf',
        relevance: 'Official TPC-H benchmark specification',
    },
];

/**
 * Get all citations
 */
export function getAllCitations(): Citation[] {
    return [
        ...TPCTC_PAPERS,
        ...BLOCKCHAIN_PERFORMANCE,
        ...ENERGY_TRADING,
        ...TPC_STANDARDS,
    ];
}

/**
 * Generate BibTeX format
 */
export function generateBibTeX(): string {
    const citations = getAllCitations();

    return citations.map(c => {
        const authorStr = c.authors.join(' and ');
        return `@article{${c.id},
  author = {${authorStr}},
  title = {${c.title}},
  journal = {${c.venue}},
  year = {${c.year}},${c.doi ? `\n  doi = {${c.doi}},` : ''}${c.url ? `\n  url = {${c.url}},` : ''}
}`;
    }).join('\n\n');
}

/**
 * Generate LaTeX bibliography
 */
export function generateLaTeXBib(): string {
    return `% GridTokenX Research Bibliography
% Generated: ${new Date().toISOString()}

${generateBibTeX()}
`;
}

// CLI execution
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('academic-references.ts');

if (isMainModule) {
    const fs = require('fs');
    const path = require('path');

    console.log('\n📚 Academic Literature References\n');

    const citations = getAllCitations();
    console.log(`Total citations: ${citations.length}\n`);

    console.log('Categories:');
    console.log(`  TPCTC Papers: ${TPCTC_PAPERS.length}`);
    console.log(`  Blockchain Performance: ${BLOCKCHAIN_PERFORMANCE.length}`);
    console.log(`  Energy Trading: ${ENERGY_TRADING.length}`);
    console.log(`  TPC Standards: ${TPC_STANDARDS.length}`);

    // Save BibTeX
    const outputDir = path.join(process.cwd(), 'test-results', 'thesis');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const bibPath = path.join(outputDir, 'references.bib');
    fs.writeFileSync(bibPath, generateLaTeXBib());
    console.log(`\n📄 Generated: ${bibPath}`);
}
