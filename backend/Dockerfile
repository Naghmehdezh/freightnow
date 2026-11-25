# IFF Cargo API (Express).
# Build from the REPOSITORY ROOT (the seed script needs Carrier_Mapping.md from there):
#   docker build -f backend/Dockerfile -t iffcargo-api .
# Secrets are NOT baked into the image. Pass them at run time: docker compose reads
# backend/.env; in production use your host's secret store.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# bcrypt ships prebuilt binaries for glibc (Debian), so no compiler is needed.
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/src ./src
# Read by src/scripts/syncCarrierMapping.js (used by `npm run db:seed` and `carriers:sync`),
# which looks three folders above the script: /app/src/scripts -> /Carrier_Mapping.md
COPY Carrier_Mapping.md /Carrier_Mapping.md
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
