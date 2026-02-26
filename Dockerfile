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

# Пример конфига — копируется при первом запуске если нет config.yaml
COPY config.example.yaml /app/config.example.yaml

VOLUME ["/app/data"]

ENV NODE_ENV=production
CMD ["bash", "-c", "[ -f /app/data/config.yaml ] || { cp /app/config.example.yaml /app/data/config.yaml; echo 'Создан config.yaml из примера'; }; exec node dist/index.js"]
