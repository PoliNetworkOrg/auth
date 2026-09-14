# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:22-bookworm-slim
ARG PNPM_VERSION=12.3.4

# Toolchain for the stages that produce platform-independent output. Pinned to
# the build host's platform so that, in a multi-platform build, dependency
# installation and the Vite/Nitro build run once natively instead of once per
# target platform (the arm64 target would otherwise run them under QEMU).
# Note: --platform must be on the image reference; BuildKit ignores it when
# applied to a FROM that points at another stage.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build-base
ARG PNPM_VERSION
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Install dependencies (including dev deps, needed to build) with pnpm's
# content-addressable store cached across builds.
FROM build-base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile

# Build the Nitro server output and derive the runtime manifest from the
# installed (lockfile-resolved) versions; see docker/write-runtime-package.mjs.
FROM build-base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build && node docker/write-runtime-package.mjs

# Toolchain for the target platform, used to install the runtime node_modules
# for the architecture the image will actually run on.
FROM ${NODE_IMAGE} AS target-base
ARG PNPM_VERSION
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# The instrumentation and migration bootstrap run outside Nitro's bundle, so
# their imports must be resolvable from production node_modules. Nitro traces
# and inlines everything else into .output/server, so only the packages those
# entry points import directly are installed here, instead of the full
# production dependency tree. Lifecycle scripts are skipped because the only
# one in this tree (@sentry/cli's binary download) is build-time tooling.
FROM target-base AS prod-deps
WORKDIR /app
COPY --from=build /app/runtime-package.json ./package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --no-frozen-lockfile --ignore-scripts

# Final runtime image: the built Nitro server output plus the minimal
# production node_modules above.
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build --chown=node:node /app/scripts/start.mjs ./scripts/start.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const s=require('node:net').createConnection({port:process.env.PORT||3000});s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))"
CMD ["node", "--import", "./.output/server/instrument.server.mjs", "scripts/start.mjs"]
