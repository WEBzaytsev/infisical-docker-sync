# 🍺 Infisical Docker Sync

> *Когда надоело каждый раз руками обновлять .env файлы и перезапускать контейнеры*

Эта штука автоматически тянет секреты из Infisical и пересоздает твои Docker контейнеры когда что-то поменялось. Написано на TypeScript, потому что мы не варвары.

## 🚀 Что умеет

- Берет секреты из Infisical через их API
- Создает .env файлы прямо там где нужно
- Следит за изменениями и автоматически перезапускает контейнеры через docker-compose
- Не падает если что-то пошло не так
- Показывает нормальные логи (даже на Windows!)

## 🛠 Что нужно

- Docker + Docker Compose v2 (v1 уже в помойке)
- Доступ к `/var/run/docker.sock` 
- Аккаунт в Infisical с Client ID и Client Secret
- Мозги чтобы настроить конфиг

## 🍻 Быстрый старт

### 1. Настрой конфиг

Создай `config.yaml`:

```yaml
siteUrl: "https://app.infisical.com"
clientId: "твой-client-id-из-infisical"
clientSecret: "твой-secret-не-палить-никому"
syncInterval: 30  # как часто проверять (секунды)
logLevel: "info"  # debug если хочешь все подробности

services:
  - container: "my-app"
    envFileName: ".env"
    envDir: "/my-app"  # где создать .env файл (смонтированная папка)
    projectId: "project-id-из-infisical"
    environment: "prod"  # или dev, staging
    
  - container: "my-db"
    envFileName: ".env"
    envDir: "/my-app"
    projectId: "другой-project-id"
    environment: "prod"
    syncInterval: 60  # можно переопределить для конкретного сервиса
```

### 2. Запусти агента

```yaml
# docker-compose.yml для агента
services:
  env-agent:
    image: ghcr.io/webzaytsev/infisical-docker-sync:latest
    container_name: env-agent
    volumes:
      - ./config.yaml:/app/config.yaml
      - /var/run/docker.sock:/var/run/docker.sock
      - ${HOME}/projects/my-app:/my-app  # монтируй папку проекта в кастомную папку
    environment:
      - CONFIG_PATH=/app/config.yaml
```

```bash
docker-compose up -d
```

### 3. Настрой свой проект

В твоем основном `docker-compose.yml`:

```yaml
services:
  my-app:
    container_name: my-app
    image: my-app:latest
    env_file: ./.env  # агент создаст этот файл
    
  my-db:
    container_name: my-db
    image: postgres:15
    env_file: ./.env  # или отдельный файл если нужно
```

## 🎯 Как это работает

1. **Агент стартует** и читает конфиг
2. **Подключается к Infisical** и тянет секреты
3. **Создает .env файлы** в указанных папках
4. **Следит за изменениями** в Infisical каждые N секунд
5. **Когда что-то поменялось** - обновляет .env и пересоздает контейнеры через `docker-compose`

### Магия с путями

Агент умный - он читает метаданные твоих контейнеров и понимает:
- Где лежит `docker-compose.yml` 
- В какой папке запускать команды
- Какие файлы конфигурации использовать

Поэтому просто монтируй папки правильно и все заработает.

## 🔧 Кастомные пути

Просто монтируй любые папки в агенте:

```yaml
# docker-compose.yml агента
volumes:
  - ${HOME}/my-project:/custom-app
  - ${HOME}/another-project:/another-app

# config.yaml
services:
  - container: "app1"
    envDir: "/custom-app"     # прямо указываешь смонтированную папку
  - container: "app2"  
    envDir: "/another-app"    # без всяких переменных
```

## 📊 Мониторинг

```bash
# Смотри что происходит
docker logs -f env-agent

# Проверь что живой
docker ps | grep env-agent

# Если что-то сломалось
docker logs env-agent --tail 100
```

## 🐛 Когда все сломалось

### "Container not found"
- Проверь что имя контейнера в конфиге совпадает с реальным
- Убедись что контейнер создан через docker-compose (агент работает только с ними)

### "env file not found"
Агент скажет что именно не так и как исправить:
```
[CONFIG ERROR] 🔧 Что нужно исправить:
[CONFIG ERROR] 1. Откройте файл: /home/user/project/docker-compose.yml
[CONFIG ERROR] 2. Найдите секцию сервиса my-app
[CONFIG ERROR] 3. Измените env_file с:
[CONFIG ERROR]    БЫЛО: env_file: /old/wrong/path/.env
[CONFIG ERROR]    СТАЛО: env_file: ./.env
```

### "Permission denied"
- Проверь что Docker socket смонтирован: `/var/run/docker.sock:/var/run/docker.sock`
- Убедись что пользователь в группе `docker`

### Логи выглядят как иероглифы
Не должно быть - агент автоматически настраивает кодировку. Если все равно проблемы, попробуй другой терминал.

## 🔒 Безопасность

- **Не коммить config.yaml** с секретами в git
- **Ограничь права** Client ID в Infisical только нужными проектами  
- **Защити папку** с .env файлами от посторонних глаз
- **Используй конкретные теги** образов в проде, а не `latest`

### ⚠️ Для прода - используй Docker Socket Proxy!

**Прямой доступ к `/var/run/docker.sock` = root доступ ко всей машине!**

Агенту нужен Docker socket, но в проде **НЕ МОНТИРУЙ** его напрямую, иначе вам порвут очко. Используй [Docker Socket Proxy](https://github.com/Tecnativa/docker-socket-proxy):

```yaml
# docker-compose.yml для прода
services:
  # Прокси для безопасного доступа к Docker API
  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy:latest
    environment:
      CONTAINERS: 1    # Разрешаем только работу с контейнерами
      SERVICES: 1      # И с сервисами
      NETWORKS: 0      # Остальное - нахуй
      VOLUMES: 0
      IMAGES: 0
      SYSTEM: 0
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro  # Только чтение
    restart: unless-stopped

  # Агент подключается к прокси, а не к сокету
  env-agent:
    image: ghcr.io/webzaytsev/infisical-docker-sync:latest
    environment:
      - DOCKER_HOST=tcp://docker-socket-proxy:2375  # Через прокси!
    depends_on:
      - docker-socket-proxy
    # НЕТ volumes с docker.sock - безопасно!
```

**Почему это важно:**
- Docker socket = root права на всю систему
- Компрометация контейнера = компрометация хоста  
- Socket Proxy ограничивает доступ только нужными операциями
- В случае взлома агента - злоумышленник не получит полный контроль (но это неточно)

## 🍕 Для разработчиков

```bash
# Поставь зависимости
pnpm install

# Запусти в dev режиме
pnpm dev

# Собери
pnpm build

# Проверь код (строго!)
pnpm check

# Исправь что можно автоматически
pnpm lint:fix
```

### Структура проекта

```
src/
├── index.ts           # Главный файл, точка входа
├── config-loader.ts   # Загружает и парсит конфиг YAML
├── infisical-client.ts # Работа с API Infisical
├── docker-manager.ts  # Управление контейнерами через docker-compose
├── env-watcher.ts     # Следит за изменениями .env файлов
├── config-watcher.ts  # Перезагружает конфиг на лету
├── logger.ts          # Логирование (работает везде одинаково)
└── types.ts           # TypeScript типы
```

## 🎉 Фичи

- **TypeScript** - потому что `any` это зло
- **ESLint 9** со строгими правилами - код должен быть красивым
- **Кастомные пути монтирования** - любые папки в любые места
- **Умное определение docker-compose** - не нужно указывать пути
- **Graceful обработка ошибок** - не падает при проблемах с конфигом
- **Подробные сообщения об ошибках** - говорит что именно сломалось и как починить

## 📝 Лицензия

MIT - делай что хочешь, только не говори что это ты написал 😄

---

*Сделано с ❤️ и кофеином для автоматизации рутины*