# Production image of the backend (see deploy/). Building it downloads the npm
# packages once; running it needs no internet.
FROM node:22-bookworm-slim AS build
# Prisma's query engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV CHECKPOINT_DISABLE=1 NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate && npm run build && npm prune --omit=dev && npx prisma generate

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# No telemetry, no update checks: nothing leaves the machine at run time.
ENV NODE_ENV=production CHECKPOINT_DISABLE=1 NPM_CONFIG_UPDATE_NOTIFIER=false
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
# OCR language models: loaded from here, never downloaded.
COPY package.json por.traineddata eng.traineddata ./
RUN mkdir -p uploads && chown node:node uploads
USER node
EXPOSE 3000
# Pending migrations are applied on every start, so an update is just a restart.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && exec node dist/main"]
