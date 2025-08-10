FROM node:20-alpine

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY src/ ./src/

# Создадим директории для конфига и .env файлов одной командой
RUN mkdir -p /app/config /app/envs

# Монтируем директории для конфига и .env файлов
VOLUME ["/app/config", "/app/envs", "/var/run/docker.sock"]

CMD ["node", "src/index.js"] 