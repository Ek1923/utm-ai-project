# ── Stage 1: Build React client ──────────────────────────────────────────────
FROM node:20-alpine AS client-build
WORKDIR /client
COPY client/package*.json ./
RUN npm ci
COPY client/ .
RUN npm run build

# ── Stage 2: Production server ────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Server dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Server source
COPY server/ ./server/
COPY tsconfig.json ./

# Built client (served as static files in production)
COPY --from=client-build /client/dist ./client/dist

# Data directories
RUN mkdir -p data/agents training

ENV NODE_ENV=production
ENV PORT=3001
ENV OLLAMA_URL=http://ollama:11434

EXPOSE 3001

CMD ["npx", "tsx", "server/src/index.ts"]
