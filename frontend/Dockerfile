# Production image of the frontend (see deploy/). Building it downloads the npm
# packages once; running it needs no internet. Production mode also has none of
# the development server's checks (e.g. for a newer Next.js version).
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The browser reaches the API on the same address, under /backend (deploy/Caddyfile),
# so the image works on any host name without rebuilding.
ENV NEXT_PUBLIC_API_URL=/backend
RUN NEXT_STANDALONE=1 npx next build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3001
CMD ["node", "server.js"]
