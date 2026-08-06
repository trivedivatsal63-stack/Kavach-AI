FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
# Vite env vars are inlined into the static bundle at build time — a
# container's runtime environment can't change them afterward, so they
# must come in as build args here rather than docker-compose's
# `environment:` block.
ARG VITE_API_BASE_URL=http://localhost:4001
ARG VITE_LITELLM_BASE_URL=http://localhost:4000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_LITELLM_BASE_URL=$VITE_LITELLM_BASE_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/vite.config.ts ./vite.config.ts

EXPOSE 5173
CMD ["npm", "run", "preview"]
