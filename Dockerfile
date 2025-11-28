FROM solanafoundation/anchor:v0.32.1

WORKDIR /app

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
