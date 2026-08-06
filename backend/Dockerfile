FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# postinstall runs `prisma generate`, which only reads prisma/schema.prisma
# — it needs DATABASE_URL to be set (schema validation), not reachable.
COPY prisma ./prisma
ENV DATABASE_URL="postgresql://user:password@localhost:5432/dashboard"
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Note: do NOT install openssl here — the generated Prisma client targets
# openssl-1.1.x, and a 3.0.x openssl at runtime makes the engine mismatch.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

EXPOSE 4001
# No migration history exists yet — db push keeps the dashboard schema in
# sync with prisma/schema.prisma on every boot (idempotent).
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
