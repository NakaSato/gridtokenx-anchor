# ============================================
# GridTokenX Anchor - Solana Validator Dockerfile
# ============================================
# Builds and deploys Anchor programs to a local validator

FROM rust:1.75-slim-bookworm AS builder

WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    pkg-config \
    libssl-dev \
    libudev-dev \
    clang \
    && rm -rf /var/lib/apt/lists/*

# Install Solana CLI
RUN sh -c "$(curl -sSfL https://release.solana.com/v1.18.4/install)" && \
    export PATH="/root/.local/share/solana/install/active_release/bin:$PATH"

ENV PATH="/root/.local/share/solana/install/active_release/bin:$PATH"

# Install Anchor
RUN cargo install --git https://github.com/coral-xyz/anchor avm --locked --force && \
    avm install 0.30.0 && \
    avm use 0.30.0

ENV PATH="/root/.avm/bin:$PATH"

# Copy Anchor project
COPY Anchor.toml Cargo.toml Cargo.lock ./
COPY programs ./programs
COPY tests ./tests
COPY scripts ./scripts 2>/dev/null || true

# Build programs
RUN anchor build

# ============================================
# Runtime image with validator
# ============================================
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Solana CLI
RUN sh -c "$(curl -sSfL https://release.solana.com/v1.18.4/install)"
ENV PATH="/root/.local/share/solana/install/active_release/bin:$PATH"

# Copy built programs
COPY --from=builder /app/target/deploy/*.so /app/programs/
COPY --from=builder /app/target/idl/*.json /app/idl/

# Copy startup script
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# Create ledger directory
RUN mkdir -p /data/ledger

# Expose ports
EXPOSE 8899 8900 9900

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
    CMD solana cluster-version --url http://localhost:8899 || exit 1

# Data volume
VOLUME /data/ledger

ENTRYPOINT ["/app/docker-entrypoint.sh"]
