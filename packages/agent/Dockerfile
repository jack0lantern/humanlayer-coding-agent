FROM node:20-bookworm AS base
WORKDIR /app

# Install common dev tools the agent might need
RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*

# Copy workspace config and all relevant package.json files
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/agent/package.json ./packages/agent/

# Install all dependencies
RUN npm install

# Copy source
COPY packages/shared/ ./packages/shared/
COPY packages/agent/ ./packages/agent/

# Build shared
RUN npm run build -w packages/shared

# Create a workspace for the agent to operate in
RUN mkdir -p /workspace

CMD ["npx", "tsx", "packages/agent/src/index.ts", "--working-dir", "/workspace"]
