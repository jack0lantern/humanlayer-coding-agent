FROM node:20-bookworm-slim AS build
WORKDIR /app

# Copy workspace config and all relevant package.json files
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/web/package.json ./packages/web/

# Install all dependencies
RUN npm install

# Copy source
COPY packages/shared/ ./packages/shared/
COPY packages/web/ ./packages/web/

# Build shared then web
RUN npm run build -w packages/shared
RUN npm run build -w packages/web

# Serve with nginx
FROM nginx:alpine
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
