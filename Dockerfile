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

RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      gnupg \
      which \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg \
         | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) \
         signed-by=/etc/apt/keyrings/docker.gpg] \
         https://download.docker.com/linux/debian \
         $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
         > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y --no-install-recommends \
         docker-ce-cli \
         docker-compose-plugin \
    && apt-get purge -y curl gnupg \
    && rm -rf /var/lib/apt/lists/*
# which остается установленным для поиска docker в PATH

# Прод-зависимости только нужные рантайму
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# Артефакты сборки
COPY --from=builder /app/dist ./dist

# Директория для данных агента (конфиг + состояние)
RUN mkdir -p /app/data

# Если нужен alias "docker-compose": тонкая обёртка на плагин
RUN printf '#!/bin/sh\nexec docker compose "$@"\n' > /usr/local/bin/docker-compose \
    && chmod +x /usr/local/bin/docker-compose

# Проверяем что Docker установлен и доступен
RUN echo "PATH: $PATH" \
    && ls -la /usr/bin/docker* || true \
    && ls -la /usr/local/bin/docker* || true \
    && which docker \
    && docker --version \
    && docker compose version \
    && echo "Docker CLI готов к работе!"

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
