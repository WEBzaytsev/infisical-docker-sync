# 🍺 Infisical Docker Sync

> *Когда надоело каждый раз руками обновлять .env файлы и перезапускать контейнеры*

Эта штука автоматически тянет секреты из Infisical и пересоздает твои Docker контейнеры когда что-то поменялось. Написано на TypeScript, потому что мы не варвары.

## ⚠️ Дисклеймер (прочитай, потом жалуйся)

**Это не enterprise-продукт.** Side project, собранный в режиме «надоело руками» и «vibe coding». Работает у автора на проде — но **ты сам отвечаешь за то, куда это ставишь**.

- **Нет гарантий.** Ни SLA, ни поддержки 24/7, ни «мы протестировали на вашем кластере». MIT лицензия = as is, без обещаний.
- **Контейнеры пересоздаются.** Не `restart`, а stop → remove → create → start. Даунтайм, зависимые сервисы, volume — всё на твоей совести. **Сначала staging.**
- **Docker socket = root на хосте.** Да, мы вынесли его в отдельный proxy и режем поверхность — но скомпрометированный proxy всё ещё может снести пол-сервера. Это осознанный trade-off, не «безопасно по умолчанию».
- **Агент под root (`user: "0:0"`).** Иначе Laravel и прочие `chown`-ят `.env` и sync ломается. Root без шела в distroless, но root на примонтированных каталогах — всё равно root.
- **Конфиг и монтирования — руками.** Неправильный `envDir`, забытый volume, `internal: true` без второй сети — получишь `fetch failed` и тихий ад. README не заменяет мозг.
- **Infisical, compose, пути на диске — три разных мира.** Агент не читает твои мысли: `container` в config = `container_name` в compose, `envDir` = mount point в агенте, на хосте = `env_file` приложения. Перепутал — синк в `/app/envs/...` в никуда.
- **Баги бывают.** Пустой `CACHE_PREFIX`, Joi ругался — уже было. Завтра будет что-то новое. Dependabot крутится, CI зелёный — не значит «в prod можно не смотреть».
- **Не для regulated / PCI / «аудитор спросит».** Для своих pet-проектов и когда понимаешь, что делаешь.

Если после этого всё ещё хочется — welcome. Если нет — тоже норм, ручной `docker compose up -d` никто не отменял.

## 🚀 Что умеет

- Берет секреты из Infisical через их API
- Создает .env файлы прямо там где нужно
- Следит за изменениями и автоматически перезапускает контейнеры через docker-compose *(пересоздаёт, см. дисклеймер)*
- Старается не падать на кривом конфиге — но prod всё равно проверяй сам
- Показывает нормальные логи (даже на Windows!)

## 🛠 Что нужно

- Docker + Docker Compose v2 (v1 уже в помойке)
- Доступ к `/var/run/docker.sock` на хосте (монтируется **только** в `recreate-proxy`, не в агент)
- Аккаунт в Infisical с Client ID и Client Secret
- `.env` рядом с compose: `PROXY_TOKEN` и при необходимости `DOCKER_GID`

## 🍻 Быстрый старт

### 1. Настрой конфиг

Конфиг живёт в `./data/config.yaml` (volume `/app/data`). При первом запуске агент создаст его из примера, если файла нет.

Создай `./data/config.yaml` (или отредактируй после первого старта):

```yaml
siteUrl: "https://app.infisical.com"
clientId: "твой-client-id-из-infisical"
clientSecret: "твой-secret-не-палить-никому"
syncInterval: 30  # как часто проверять (секунды)
logLevel: "info"  # debug если хочешь все подробности

services:
  - container: "my-app"
    envFileName: ".env"
    envDir: "/projects/my-app"   # = mount point в compose агента
    projectId: "project-id-из-infisical"
    environment: "prod"

  - container: "my-worker"
    envFileName: ".env"
    envDir: "/projects/my-worker"
    projectId: "project-id-из-infisical"
    environment: "prod"
```

### 2. Запусти агента

Один образ — два сервиса: агент (без сокета) + встроенный recreate-only proxy (с сокетом).

**Структура на хосте:**

```
./
├── docker-compose.yml      # из docker-compose.example.yml
├── .env                    # PROXY_TOKEN, DOCKER_GID
├── data/
│   └── config.yaml         # конфиг агента
└── ~/projects/
    ├── my-app/.env           # envDir: /projects/my-app
    └── my-worker/.env
```

`envDir` в config.yaml — **путь внутри контейнера агента** (куда смонтирован каталог приложения). На хосте это тот же каталог, что указан в `env_file` compose приложения.

**`.env` рядом с compose:**

```bash
PROXY_TOKEN=замени_на_случайную_строку   # openssl rand -hex 32
DOCKER_GID=999                            # stat -c '%g' /var/run/docker.sock
```

**`docker-compose.yml`** — готовый пример в репозитории: [`docker-compose.example.yml`](docker-compose.example.yml)

```bash
cp docker-compose.example.yml docker-compose.yml
docker compose up -d
```

Минимальный compose (если не хочешь копировать файл):

```yaml
services:
  recreate-proxy:
    image: ghcr.io/webzaytsev/infisical-docker-sync:latest
    container_name: recreate-proxy
    command: ["dist/proxy/server.js"]
    restart: unless-stopped
    environment:
      - PROXY_TOKEN=${PROXY_TOKEN}
      - CONTAINER_NAME=recreate-proxy
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    group_add:
      - "${DOCKER_GID:-999}"
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    mem_limit: 128m
    networks: [proxynet]

  infisical-docker-sync:
    image: ghcr.io/webzaytsev/infisical-docker-sync:latest
    container_name: infisical-docker-sync
    restart: unless-stopped
    user: "0:0"
    environment:
      - PROXY_URL=http://recreate-proxy:8080
      - PROXY_TOKEN=${PROXY_TOKEN}
      - TZ=Europe/Moscow
    volumes:
      - ./data:/app/data
      - ${HOME}/projects/my-app:/projects/my-app
      - ${HOME}/projects/my-worker:/projects/my-worker
    depends_on: [recreate-proxy]
    networks:
      - proxynet   # к recreate-proxy
      - default    # Infisical API (HTTPS)

networks:
  proxynet:
    internal: true
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
5. **Когда что-то поменялось** — обновляет `.env` и просит `recreate-proxy` пересоздать контейнер через Docker API (spec берётся из существующего контейнера, из запроса — только env)

### Магия с путями

Агент умный - он читает метаданные твоих контейнеров и понимает:
- Где лежит `docker-compose.yml` 
- В какой папке запускать команды
- Какие файлы конфигурации использовать

Поэтому просто монтируй папки правильно и все заработает.

## 🔧 Монтирование путей

Монтируй **каталоги приложений**, где лежит `.env` — те же, что видит `env_file` в compose приложения:

```yaml
# docker-compose.yml агента
volumes:
  - ./data:/app/data
  - ${HOME}/projects/my-app:/projects/my-app
  - ${HOME}/projects/my-worker:/projects/my-worker

# config.yaml — envDir = mount point внутри агента
services:
  - container: "my-app"
    envDir: "/projects/my-app"
    envFileName: ".env"
  - container: "my-worker"
    envDir: "/projects/my-worker"
    envFileName: ".env"
```

```yaml
# docker-compose.yml приложения (отдельный проект)
services:
  my-app:
    container_name: my-app
    env_file: ./.env   # ~/projects/my-app/.env на хосте
```

Агент пишет `/projects/my-app/.env` → на хосте `${HOME}/projects/my-app/.env` → приложение подхватывает после recreate.

**Альтернатива:** общая папка `./envs:/app/envs` и `envDir: "/app/envs/my-app"` — если не хочешь монтировать весь каталог проекта.

## 📊 Мониторинг

```bash
# Смотри что происходит
docker logs -f infisical-docker-sync
docker logs -f recreate-proxy

# Проверь что живы
docker ps | grep -E 'infisical-docker-sync|recreate-proxy'

# Если что-то сломалось
docker logs infisical-docker-sync --tail 100
docker logs recreate-proxy --tail 100
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

### `fetch failed` при синхронизации с Infisical

Агент не достучался до `siteUrl` из `config.yaml`. Частая причина после перехода на двухсервисный compose: агент **только** в `proxynet` с `internal: true` — интернета там нет.

**Решение:** proxy остаётся только в `proxynet`, агент — в `proxynet` + `default`:

```yaml
  infisical-docker-sync:
    networks:
      - proxynet
      - default
```

Проверка:

```bash
docker exec infisical-docker-sync node -e "fetch('https://app.infisical.com').then(r=>console.log(r.status)).catch(e=>console.error(e.message))"
```

### "Permission denied" / `connect EACCES /var/run/docker.sock`

Сокет монтируется **только** в `recreate-proxy`. На агенте его быть не должно.

**1. Узнай GID группы docker на хосте:**
```bash
stat -c '%g' /var/run/docker.sock
# обычно 999 или 998
```

**2. Добавь `group_add` сервису `recreate-proxy`:**
```yaml
services:
  recreate-proxy:
    group_add:
      - "${DOCKER_GID:-999}"
```

**3. Проверь логи proxy:**
```bash
docker logs recreate-proxy --tail 50
# должно быть: [proxy] recreate-only proxy слушает :8080
```

Если `group_add` не помогает (редко на Docker Desktop), временно для диагностики: `user: "0:0"` на `recreate-proxy`. На Linux prod обычно достаточно `group_add`.

### `EACCES: permission denied` при записи `.env`

Агент пишет `.env`, затем потребитель (например, Laravel с `www-data` uid 33) делает `chown -R` в своём entrypoint. После этого агент (uid 65532 / nonroot) не может перечитать файл для диффа и перезаписать его.

**Решение:** запусти агент от root (`user: "0:0"`) — distroless без шела, `/bin/sh` в образе нет, просто root-процесс Node.js:

```yaml
services:
  infisical-docker-sync:
    user: "0:0"
    # cap_drop НЕ ставить — root нужен DAC_OVERRIDE для записи чужих файлов
```

`fs.writeFile` сохраняет inode и владельца (33:33 останется 33:33) — потребитель продолжает читать свой файл, агент только обновляет содержимое.

> Сокета у агента нет (он у `recreate-proxy`), поэтому root здесь ограничен только примонтированными `./data` и каталогами приложений.

### Логи выглядят как иероглифы
Не должно быть - агент автоматически настраивает кодировку. Если все равно проблемы, попробуй другой терминал.

## 🔒 Безопасность

- **Не коммить config.yaml** с секретами в git
- **Ограничь права** Client ID в Infisical только нужными проектами  
- **Защити папку** с .env файлами от посторонних глаз
- **Используй конкретные теги** образов в проде, а не `latest`

### ⚠️ Архитектура безопасности

**Прямой доступ к `/var/run/docker.sock` = root доступ ко всей машине.**

Образ содержит встроенный recreate-only proxy. Агент ходит к нему по TCP и **не монтирует** сокет.

```
infisical-docker-sync (root, БЕЗ сокета)
    │  POST /recreate {container, env}  +  x-proxy-token
    ▼
recreate-proxy (nonroot 65532, сокет :ro)
    │  inspect / stop / remove / create / start
    ▼
/var/run/docker.sock
```

Ключевая гарантия: proxy читает spec контейнера из сокета (`inspect`), из запроса — только имя и env. Задать `Privileged`, `Binds` или образ через запрос невозможно.

Полный `docker-compose.yml` — в разделе [Быстрый старт](#-быстрый-старт).

**Hardening proxy:** `cap_drop: [ALL]`, `no-new-privileges`, `proxynet` с `internal: true` (proxy без выхода в интернет, порт на хост не публикуется). Агент дополнительно в `default` — только для HTTPS к Infisical.

**Остаточные риски:**
- Скомпрометированный агент может подменить env и дёргать recreate (DoS). До Docker API не дотянется.
- Скомпрометированный proxy = root на хосте; поверхность — один `POST /recreate`, без шела в образе.

**Почему не Tecnativa/wollomatic:** фильтруют только endpoint/метод, не тело запроса — `POST /containers/create` пропускает `Privileged`/`Binds: ["/:/host"]`. Наш proxy не принимает `HostConfig` вообще.

### Переменные окружения

| Переменная | Сервис | Описание |
|------------|--------|----------|
| `PROXY_TOKEN` | оба | Общий секрет для `POST /recreate`. Обязателен; proxy без него не стартует |
| `PROXY_URL` | агент | URL proxy. По умолчанию `http://recreate-proxy:8080` |
| `PROXY_PORT` | proxy | Порт HTTP-сервера proxy. По умолчанию `8080` |
| `CONFIG_PATH` | агент | Путь к конфигу. По умолчанию `/app/data/config.yaml` |
| `CONTAINER_NAME` | оба | Префикс в логах. Для proxy: `recreate-proxy` |
| `DOCKER_GID` | proxy (compose) | GID группы docker для `group_add` |

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

# Собери Docker-образ локально (Dockerfile в корне репозитория)
docker build -t infisical-docker-sync:local .

# Исправь что можно автоматически
pnpm lint:fix
```

Локальный smoke proxy (Linux, нужен `group_add` или `user: "0:0"` для доступа к сокету):

```bash
docker run --rm -p 8080:8080 \
  -e PROXY_TOKEN=test \
  -e CONTAINER_NAME=recreate-proxy \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  --group-add "$(stat -c '%g' /var/run/docker.sock)" \
  infisical-docker-sync:local dist/proxy/server.js
```

### Структура проекта

```
src/
├── index.ts              # Точка входа агента
├── config-loader.ts      # Загрузка и валидация config.yaml
├── infisical-client.ts   # API Infisical
├── docker-manager.ts     # HTTP-клиент к recreate-proxy
├── env-watcher.ts        # Сравнение и запись .env
├── config-watcher.ts     # Hot-reload конфига
├── state-manager.ts      # Персистентное состояние sync
├── logger.ts
├── types.ts
└── proxy/
    ├── server.ts         # recreate-only HTTP proxy (POST /recreate)
    └── docker-recreate.ts # dockerode: inspect/stop/remove/create/start
```

## 🎉 Фичи

- **Distroless runtime** — Node.js без shell в образе
- **Recreate-only proxy** — сокет изолирован, агент не видит Docker API
- **TypeScript** - потому что `any` это зло
- **ESLint 9** со строгими правилами - код должен быть красивым
- **Кастомные пути монтирования** - любые папки в любые места
- **Умное определение docker-compose** - не нужно указывать пути
- **Graceful обработка ошибок** - не падает при проблемах с конфигом
- **Подробные сообщения об ошибках** - говорит что именно сломалось и как починить

## 📝 Лицензия

MIT — делай что хочешь, только не говори что это ты написал 😄

**Ещё раз:** vibe-coded утилита для ленивых админов, не замена Vault Agent / External Secrets Operator / официальной интеграции Infisical. Используй на свой страх и риск.

---

*Сделано с ❤️ и кофеином для автоматизации рутины*