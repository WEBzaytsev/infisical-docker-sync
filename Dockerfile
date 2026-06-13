# syntax=docker/dockerfile:1.7
# D1: базовый образ запинен по digest для воспроизводимых и безопасных сборок
FROM node:22-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS builder
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
# D1: тот же digest — оба стейджа используют одну и ту же проверенную версию
FROM node:22-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS runtime
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# Устанавливаем bash с pipefail для безопасности pipe команд
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Устанавливаем только необходимые пакеты для работы с сертификатами
RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# D3: явное создание группы и пользователя без shell и home-директории —
# сервис-аккаунту они не нужны; убирает кривой || фолбэк.
# Для прямого docker.sock добавь --group-add $(stat -c '%g' /var/run/docker.sock)
# или используй docker-socket-proxy (рекомендуется, см. README).
RUN groupadd --gid 1001 appuser \
 && useradd --uid 1001 --gid 1001 --no-create-home --shell /usr/sbin/nologin appuser

# M4: копируем только prod node_modules из builder — pnpm/corepack в runtime не нужны
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Директория для данных агента (конфиг + состояние)
RUN mkdir -p /app/data && chown -R appuser:appuser /app/data

# Пример конфига — копируется при первом запуске если нет config.yaml
COPY --chown=appuser:appuser config.example.yaml /app/config.example.yaml

VOLUME ["/app/data"]

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD kill -0 1 2>/dev/null || exit 1

USER appuser
ENV NODE_ENV=production
# D2: chmod 600 для config.yaml при первом запуске — секреты не должны быть world-readable
CMD ["bash", "-c", "[ -f /app/data/config.yaml ] || { cp /app/config.example.yaml /app/data/config.yaml; chmod 600 /app/data/config.yaml; echo 'Создан config.yaml из примера'; }; exec node dist/index.js"]
