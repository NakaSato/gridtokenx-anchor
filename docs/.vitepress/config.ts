import { defineConfig } from 'vitepress'

export default defineConfig({
    title: 'GridTokenX Research',
    description: 'Master\'s Thesis: Blockchain Performance Analysis for P2P Energy Trading',

    head: [
        ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
        ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
        ['link', { href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap', rel: 'stylesheet' }],
    ],

    appearance: false, // Enforce light mode for Paper theme

    themeConfig: {
        logo: '/logo.svg',
        siteTitle: 'GridTokenX Research',

        nav: [
            { text: 'Home', link: 'https://www.gridtokenx.com' },
            { text: 'Guide', link: '/guide/getting-started' },
            { text: 'Whitepaper', link: '/whitepaper.pdf', target: '_blank' },
            { text: 'Thesis', link: '/thesis.pdf', target: '_blank' },
            { text: 'IEEE Paper', link: '/performance_analysis.pdf', target: '_blank' },
            { text: 'API', link: '/api/programs' },
            { text: 'Benchmarks', link: '/benchmarks/results' }
        ],

        sidebar: {
            '/guide/': [
                {
                    text: 'Introduction',
                    items: [
                        { text: 'Getting Started', link: '/guide/getting-started' },
                        { text: 'Architecture', link: '/guide/architecture' },
                        { text: 'Installation', link: '/guide/installation' }
                    ]
                },
                {
                    text: 'Programs',
                    items: [
                        { text: 'Energy Token', link: '/guide/energy-token' },
                        { text: 'Trading', link: '/guide/trading' },
                        { text: 'Oracle', link: '/guide/oracle' },
                        { text: 'Registry', link: '/guide/registry' },
                        { text: 'Governance', link: '/guide/governance' }
                    ]
                }
            ],
            '/api/': [
                {
                    text: 'API Reference',
                    items: [
                        { text: 'Programs', link: '/api/programs' },
                        { text: 'Instructions', link: '/api/instructions' },
                        { text: 'Accounts', link: '/api/accounts' }
                    ]
                }
            ],
            '/benchmarks/': [
                {
                    text: 'Performance',
                    items: [
                        { text: 'Methodology', link: '/benchmarks/methodology' },
                        { text: 'Results', link: '/benchmarks/results' },
                        { text: 'Comparison', link: '/benchmarks/comparison' }
                    ]
                }
            ],
            '/academic/': [
                {
                    text: 'Thesis',
                    items: [
                        { text: '01. Executive Summary', link: '/academic/01-executive-summary' },
                        { text: '02. Business Model', link: '/academic/02-business-model' },
                        { text: '03. System Architecture', link: '/academic/03-system-architecture' },
                        { text: '04. Data Flow Diagrams', link: '/academic/04-data-flow-diagrams' },
                        { text: '05. Token Economics', link: '/academic/05-token-economics' },
                        { text: '06. Process Flows', link: '/academic/06-process-flows' },
                        { text: '07. Security Analysis', link: '/academic/07-security-analysis' },
                        { text: '08. Research Methodology', link: '/academic/08-research-methodology' },
                        { text: '09. Comparative Analysis', link: '/academic/09-comparative-analysis' },
                        { text: '10. Future Roadmap', link: '/academic/10-future-roadmap' },
                        { text: '11. Software Testing', link: '/academic/11-software-testing' },
                    ]
                },
                {
                    text: 'Programs',
                    items: [
                        { text: 'Overview', link: '/academic/programs/README' },
                        { text: 'Registry', link: '/academic/programs/registry' },
                        { text: 'Oracle', link: '/academic/programs/oracle' },
                        { text: 'Energy Token', link: '/academic/programs/energy-token' },
                        { text: 'Trading', link: '/academic/programs/trading' },
                        { text: 'Governance', link: '/academic/programs/governance' }
                    ]
                }
            ]
        },

        socialLinks: [
            { icon: 'github', link: 'https://github.com/chanthawat/gridtokenx-anchor' },
            { icon: 'twitter', link: 'https://twitter.com/gridtokenx' },
            { icon: 'discord', link: 'https://discord.gg/gridtokenx' }
        ],

        footer: {
            message: 'Department of Computer Science • Master\'s Thesis Research',
            copyright: '© 2024 GridTokenX. Academic Use.'
        },

        search: {
            provider: 'local'
        },

        outline: {
            level: [2, 3],
            label: 'On this page'
        },

        lastUpdated: {
            text: 'Updated at',
            formatOptions: {
                dateStyle: 'short',
                timeStyle: 'short'
            }
        }
    }
})
