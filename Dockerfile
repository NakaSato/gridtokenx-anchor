# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM solanafoundation/anchor:v0.32.1

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10.23.0

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Copy source code
COPY . .

# Fix Solana toolchain corruption
RUN cargo-build-sbf --version || cargo-build-sbf --force-tools-install || true

# Expose ports for Solana test validator
EXPOSE 8899 8900

# Keep container running (use docker exec to run tests)
CMD ["tail", "-f", "/dev/null"]
