FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.3 --activate
WORKDIR /app

# ── deps: install all dependencies (including dev for build) ──────────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/voice-core/package.json packages/voice-core/
RUN pnpm install --frozen-lockfile

# ── build ─────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY apps/api/ apps/api/
COPY packages/ packages/
RUN pnpm -r build

# ── runtime: lean production image ────────────────────────────────────────────
FROM base AS runtime
# Copy the full monorepo node_modules (pnpm hoists everything here)
COPY --from=deps /app/node_modules ./node_modules
# Copy compiled output
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/voice-core/dist ./packages/voice-core/dist
# Copy package manifests so module resolution works
COPY pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/voice-core/package.json packages/voice-core/

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["node", "apps/api/dist/index.js"]
