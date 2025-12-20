# GridTokenX Documentation Site

This directory contains the VitePress documentation site for GridTokenX.

## Quick Start

```bash
# Install VitePress
npm install -D vitepress

# Start dev server
npx vitepress dev docs

# Build for production
npx vitepress build docs
```

## Deploy to GitHub Pages

### Option 1: GitHub Actions (Recommended)

Create `.github/workflows/docs.yml`:

```yaml
name: Deploy Docs

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx vitepress build docs
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: docs/.vitepress/dist
```

### Option 2: Manual

```bash
npx vitepress build docs
# Push docs/.vitepress/dist to gh-pages branch
```

## Structure

```
docs/
├── .vitepress/
│   └── config.ts       # VitePress config
├── index.md            # Homepage
├── guide/
│   ├── getting-started.md
│   └── architecture.md
├── api/
│   └── programs.md
└── benchmarks/
    └── methodology.md
```
