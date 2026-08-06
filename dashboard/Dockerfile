FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# postinstall runs `prisma generate`, which only reads prisma/schema.prisma
# — it needs DATABASE_URL to be set (schema validation), not reachable.
# (Prisma warns that it can't detect the exact libssl version on this base
# image and falls back to openssl-1.1.x — confirmed working against this
# same node:22-slim image during the `prisma migrate dev` run.)
COPY prisma ./prisma
ENV DATABASE_URL="postgresql://user:password@localhost:5432/dashboard"
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
ENV DATABASE_URL="postgresql://user:password@localhost:5432/dashboard"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000
CMD ["npm", "run", "start"]
