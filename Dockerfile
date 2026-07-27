# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /src
RUN npm install --global pnpm@11.9.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/cli/package.json apps/cli/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/sessiond/package.json apps/sessiond/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/pi-rpc/package.json packages/pi-rpc/package.json
COPY packages/pi-session-reader/package.json packages/pi-session-reader/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/scheduler-extension/package.json packages/scheduler-extension/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN --mount=type=cache,id=pi-web-pnpm,target=/src/.runtime/pnpm-store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build \
    && pnpm --filter @pi-web/cli deploy --prod --legacy /opt/pi-web \
    && cp -R apps/web/dist /opt/pi-web/web

FROM node:22-bookworm-slim AS runtime

ARG PI_VERSION=0.82.0

ENV NODE_ENV=production \
    HOME=/home/node \
    PI_WEB_HOST=0.0.0.0 \
    PI_WEB_PORT=8787 \
    PI_WEB_CONFIG_DIR=/data/config \
    PI_WEB_DATA_DIR=/data/state \
    PI_WEB_CACHE_DIR=/data/cache \
    PI_WEB_ALLOWED_ROOTS=/home/pi \
    PI_WEB_PI_EXECUTABLE=/usr/local/bin/pi \
    PI_WEB_WEB_ROOT=/app/web

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git openssh-client tini \
    && npm install --global --ignore-scripts @earendil-works/pi-coding-agent@${PI_VERSION} \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app /data/config /data/state /data/cache /home/pi /home/node/.pi \
    && chown -R node:node /app /data /home/pi /home/node/.pi

WORKDIR /app
COPY --from=build --chown=node:node /opt/pi-web/ ./

USER node
EXPOSE 8787
VOLUME ["/data", "/home/node/.pi", "/home/pi"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js", "start"]
