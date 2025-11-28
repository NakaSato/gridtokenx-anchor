FROM backpackapp/build:v0.30.1

WORKDIR /app

# Update Rust to 1.81.0 to satisfy dependency requirements
RUN rustup install 1.81.0 && \
    rustup default 1.81.0

# Install pnpm
RUN npm install -g pnpm@10.23.0

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Copy source code
COPY . .

# Default command
CMD ["anchor", "test", "--skip-local-validator"]
