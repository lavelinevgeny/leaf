# Official multi-platform Node release; update patch and digest together.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --strict-allow-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# Reviewed better-sqlite3 bundles Node-API prebuilds. Prove the actual binding
# works without installing build tools into the production image.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && node --input-type=module -e "import Database from 'better-sqlite3'; const db=new Database(':memory:'); if(db.prepare('SELECT 1 AS ok').get().ok!==1) process.exit(1); db.close();"

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime
ENV NODE_ENV=production LEAF_HOST=0.0.0.0 LEAF_PORT=3000 LEAF_DATA_DIR=/data LEAF_PUBLIC_ORIGIN=http://127.0.0.1:3000
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
RUN mkdir /data && chown node:node /data && chmod 700 /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.LEAF_PORT+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/server/main.js"]
