# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Ускоряем и фиксируем deps
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ——— Runtime ———
FROM node:20-bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# Устанавливаем bash с pipefail для безопасности pipe команд
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Устанавливаем только необходимые пакеты для работы с сертификатами
RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Прод-зависимости только нужные рантайму
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# Артефакты сборки
COPY --from=builder /app/dist ./dist

# Директория для данных агента (конфиг + состояние)
RUN mkdir -p /app/data

# Docker CLI не нужен - используем только Docker API через socket

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
