FROM node:20-alpine

WORKDIR /app

# Copy only necessary files
COPY package.json pnpm-lock.yaml ./
COPY apps/web ./apps/web
COPY pnpm-workspace.yaml ./
COPY vercel.json ./

# Install dependencies
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# Build
RUN cd apps/web && pnpm run build

# Start
CMD ["pnpm", "run", "-r", "--filter", "@aureus/web", "start"]
