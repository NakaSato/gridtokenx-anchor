import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "GridTokenX",
  description: "Official Protocol Documentation & Developer Guide",
  themeConfig: {
    logo: '/logo.svg', // Will default to text if missing
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Protocol', link: '/protocol/architecture' },
      { text: 'Developers', link: '/developers/getting-started' }
    ],

    sidebar: [
      {
        text: 'Protocol Whitepaper',
        items: [
          { text: 'System Architecture', link: '/protocol/architecture' },
          { text: 'Tokenomics Lifecycle', link: '/protocol/tokenomics' },
          { text: 'Security Audits', link: '/protocol/security-audits' }
        ]
      },
      {
        text: 'Developer Guide',
        items: [
          { text: 'Getting Started', link: '/developers/getting-started' },
          { text: 'Simulation Scripts', link: '/developers/simulation-scripts' },
          { text: 'Program Interfaces', link: '/developers/program-interfaces' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/GridTokenX' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 GridTokenX Foundation'
    }
  }
})
