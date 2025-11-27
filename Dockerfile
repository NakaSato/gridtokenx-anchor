# Multi-stage build for GridTokenX Anchor
FROM node:20-slim AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    pkg-config \
    libssl-dev \
    libudev-dev \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

# Install Solana CLI
RUN sh -c "$(curl -sSfL https://release.solana.com/v1.18.18/install)" && \
    echo 'export PATH="/root/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc

ENV PATH="/root/.local/share/solana/install/active_release/bin:$PATH"

# Install Anchor CLI
RUN cargo install --git https://github.com/coral-xyz/anchor avm --locked --force && \
    avm install 0.32.1 && \
    avm use 0.32.1

# Dependencies stage
FROM base AS dependencies

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build stage
FROM dependencies AS builder

WORKDIR /app

# Copy source code
COPY . .

# Build Anchor programs
RUN anchor build

# Runtime stage
FROM base AS runtime

WORKDIR /app

# Copy built artifacts and dependencies
COPY --from=builder /app /app

# Expose any necessary ports (if running a local validator)
EXPOSE 8899 8900

# Default command
CMD ["anchor", "test", "--skip-local-validator"]
