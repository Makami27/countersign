FROM node:26.13.0-bookworm-slim
WORKDIR /app
RUN npm install -g pnpm@10.34.9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages packages
COPY apps apps
COPY spikes/package.json spikes/package.json
COPY scripts scripts
COPY CLAIMS.md CLAIMS.md
RUN pnpm install --frozen-lockfile
RUN node scripts/build-web.mjs
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
ENV DATABASE_PATH=/data/countersign.sqlite
EXPOSE 8080
CMD ["node", "apps/agent/src/main.ts"]
