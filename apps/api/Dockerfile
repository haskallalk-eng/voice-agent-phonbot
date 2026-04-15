FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.3 --activate
WORKDIR /app

# ── build: install all deps + compile ────────────────────────────────────────
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/voice-core/package.json packages/voice-core/
# Install with --shamefully-hoist so node_modules are at /app/node_modules
RUN pnpm install --frozen-lockfile --shamefully-hoist
COPY apps/api/ apps/api/
COPY packages/ packages/
RUN pnpm -r build

# ── runtime: lean production image ────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
# Copy everything built (node_modules + dist)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/voice-core/dist ./packages/voice-core/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/voice-core/package.json ./packages/voice-core/
COPY --from=build /app/pnpm-workspace.yaml /app/package.json ./

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# Drop root — the `node` user (uid 1000) is built into node:*-alpine images.
# Prevents container-escape attacker from owning root on the host.
USER node

# Container-level health check so Docker/Compose restarts stuck processes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3001/health >/dev/null 2>&1 || exit 1

CMD ["node", "apps/api/dist/index.js"]
