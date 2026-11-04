# Build context is the repository root (npm workspaces share one lockfile).
FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci -w backend

COPY backend backend
WORKDIR /app/backend
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
EXPOSE 4000

# Apply pending migrations, seed reference data (idempotent), then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/index.js"]
