# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS builder
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Устанавливаем все зависимости и собираем
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# Оставляем только prod-зависимости для копирования в runtime
RUN --mount=type=cache,target=/pnpm/store pnpm prune --prod

# ——— Runtime ———
FROM node:22-bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# Устанавливаем bash с pipefail для безопасности pipe команд
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Устанавливаем только необходимые пакеты для работы с сертификатами
RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# M1: non-root пользователь (UID 1001).
# Для прямого монтирования docker.sock добавь --group-add $(stat -c '%g' /var/run/docker.sock)
# или используй docker-socket-proxy (рекомендуется, см. README).
RUN useradd --uid 1001 --gid 1001 --create-home --shell /bin/bash appuser 2>/dev/null \
    || useradd --uid 1001 --create-home --shell /bin/bash appuser

# M4: копируем только prod node_modules из builder — pnpm/corepack в runtime не нужны
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Директория для данных агента (конфиг + состояние)
RUN mkdir -p /app/data && chown -R appuser:appuser /app/data

# Пример конфига — копируется при первом запуске если нет config.yaml
COPY --chown=appuser:appuser config.example.yaml /app/config.example.yaml

VOLUME ["/app/data"]

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD [ -f /app/data/agent-state.json ] || exit 1

USER appuser
ENV NODE_ENV=production
CMD ["bash", "-c", "[ -f /app/data/config.yaml ] || { cp /app/config.example.yaml /app/data/config.yaml; echo 'Создан config.yaml из примера'; }; exec node dist/index.js"]
