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

# Создаём директорию данных с правами distroless nonroot (uid 65532) для COPY в runtime
RUN mkdir -p /app/data && chown 65532:65532 /app/data

# ——— Runtime ———
# distroless: нет shell, нет apt, нет утилит — минимальный attack surface.
# nonroot пользователь uid/gid 65532 и CA-сертификаты уже включены в образ.
FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:0345e4b3c7509ec058d3f6a2b38be1c4e6e487ce87883a0fd550c40df3f1d346 AS runtime
WORKDIR /app

# M4: копируем только prod node_modules из builder — pnpm/corepack в runtime не нужны
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Директория для данных агента (конфиг + состояние), создана в builder с uid 65532
COPY --from=builder --chown=65532:65532 /app/data ./data

# Пример конфига — копируется при первом запуске если нет config.yaml (логика в index.ts)
COPY --chown=65532:65532 config.example.yaml /app/config.example.yaml

VOLUME ["/app/data"]

USER 65532
ENV NODE_ENV=production
# distroless ENTRYPOINT уже ["node"], CMD добавляется как аргумент
CMD ["dist/index.js"]
