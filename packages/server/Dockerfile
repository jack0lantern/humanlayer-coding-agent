FROM node:20-bookworm-slim AS base

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace config and all relevant package.json files
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/

# Install all dependencies (including devDependencies for build)
RUN npm install

# Copy source
COPY packages/shared/ ./packages/shared/
COPY packages/server/ ./packages/server/

# Build shared
RUN npm run build -w packages/shared

# Generate Prisma client
RUN npx prisma generate --schema=packages/server/prisma/schema.prisma

# Build server
RUN npm run build -w packages/server

# Start script: run migrations then start server
CMD ["sh", "-c", "npx prisma db push --schema=packages/server/prisma/schema.prisma --skip-generate && node packages/server/dist/index.js"]
