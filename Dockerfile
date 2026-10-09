# Shared image for the worker and web app. Build once, run with different commands.
# NOTE: provided for `docker compose --profile apps up`; the tested local path is
# pnpm/PM2 (see OPERATIONS.md). This image has not been built in the dev sandbox.
FROM node:20-slim

RUN corepack enable
WORKDIR /app

# Install deps first for layer caching.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY db ./db
COPY scripts ./scripts
RUN corepack pnpm install --frozen-lockfile && corepack pnpm build:web || true

ENV NODE_ENV=production
# Default command runs the worker; the web service overrides it in compose.
CMD ["corepack", "pnpm", "worker:start"]
