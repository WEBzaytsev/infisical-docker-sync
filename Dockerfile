FROM node:20-alpine

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY src/ ./src/

# Создадим пустую директорию для конфига
RUN mkdir -p /app/config
# Создадим директорию для .env файлов
RUN mkdir -p envs

# Монтируем директории для конфига и .env файлов
VOLUME ["/app/config", "/app/envs", "/var/run/docker.sock"]

CMD ["node", "src/index.js"] 