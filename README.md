# Infisical Docker Sync

Агент синхронизирует секреты из Infisical в `.env` на диске и пересоздаёт Docker-контейнеры, когда значения меняются. Один образ — два сервиса: агент без доступа к Docker-сокету и sidecar-proxy для пересоздания контейнеров.

## Пользовательский путь

```
Infisical (секреты)
       │
       ▼
  config.yaml ──► агент infisical-docker-sync
       │              │
       │              ├─► запись .env в envDir
       │              └─► POST /recreate ──► recreate-proxy ──► Docker API
       │
       ▼
  docker-compose приложения (env_file: ./.env)
```

| Этап | Что делаете | Результат |
|------|-------------|-----------|
| 1. Развёртывание | `docker compose up` с агентом и proxy | Оба контейнера работают |
| 2. Конфигурация | Заполняете `data/config.yaml` | Агент знает, откуда брать секреты и куда писать |
| 3. Монтирование | Пробрасываете каталоги приложений в compose агента | `envDir` в конфиге совпадает с путём на диске |
| 4. Приложение | Указываете `container_name` и `env_file` в compose приложения | Контейнер подхватывает `.env` после пересоздания |
| 5. Эксплуатация | Смотрите логи, при необходимости правите конфиг | Секреты обновляются по интервалу, контейнер пересоздаётся при изменениях |

## Перед установкой

**Кому подходит:** pet-проекты, staging, небольшие prod-среды, где вы контролируете Docker Compose и понимаете последствия пересоздания контейнеров.

**Кому не подходит:** regulated-среды (PCI, SOC2), кластеры Kubernetes, сценарии с zero-downtime без пересоздания.

### Требования

- Docker и Docker Compose v2
- Доступ к `/var/run/docker.sock` на хосте (монтируется **только** в `recreate-proxy`)
- Machine Identity в Infisical: Client ID и Client Secret с доступом к нужным проектам
- Файл `.env` рядом с compose агента: `PROXY_TOKEN`, при необходимости `DOCKER_GID`

### Ограничения и риски

- **Пересоздание, не restart.** При изменении секретов контейнер проходит stop → remove → create → start. Возможен даунтайм; зависимые сервисы останавливаются и запускаются заново.
- **Docker socket = root на хосте.** Proxy изолирует сокет от агента, но компрометация proxy даёт полный доступ к Docker.
- **Агент работает от root** (`user: "0:0"`) — иначе приложения с `chown` на `.env` (Laravel и др.) блокируют повторную запись.
- **Три связанных идентификатора:** `container` в config = `container_name` в compose приложения; `envDir` = mount point внутри агента = каталог с `.env` на хосте.
- **MIT, as is.** Без SLA и гарантий. Сначала проверяйте на staging.

## Быстрый старт

### Шаг 1. Разверните агент и proxy

Скопируйте пример compose и подготовьте каталог данных:

```bash
cp docker-compose.example.yml docker-compose.yml
mkdir -p data
```

Создайте `.env` рядом с compose:

```bash
PROXY_TOKEN=<вывод openssl rand -hex 32>  # минимум 32 символа, лучше 64 hex
DOCKER_GID=999                              # stat -c '%g' /var/run/docker.sock
```

Запустите:

```bash
docker compose up -d
```

При первом старте агент создаст `data/config.yaml` из примера, если файла ещё нет.

**Структура на хосте:**

```
./
├── docker-compose.yml
├── .env                         # PROXY_TOKEN, DOCKER_GID
├── data/
│   └── config.yaml              # конфиг агента
└── ~/projects/
    ├── my-app/.env              # envDir: /projects/my-app
    └── my-worker/.env
```

Готовый compose — в [`docker-compose.example.yml`](docker-compose.example.yml).

### Шаг 2. Настройте config.yaml

Файл: `./data/config.yaml` (внутри контейнера — `/app/data/config.yaml`).

```yaml
siteUrl: "https://app.infisical.com"
clientId: "client-id-из-infisical"
clientSecret: "client-secret-из-infisical"
syncInterval: 30   # интервал проверки, секунды (минимум 10)
logLevel: "info"   # debug | info | silent

services:
  - container: "my-app"              # = container_name в compose приложения
    envFileName: ".env"
    envDir: "/projects/my-app"       # = mount point в compose агента
    envFileOwner: "80:80"             # опционально: сохранить owner для Laravel/php-fpm и похожих случаев
    projectId: "project-id-из-infisical"
    environment: "prod"

  - container: "my-worker"
    envFileName: ".env"
    envDir: "/projects/my-worker"
    projectId: "project-id-из-infisical"
    environment: "prod"
```

Полный пример с комментариями — в [`config.example.yaml`](config.example.yaml).

### Шаг 3. Смонтируйте каталоги приложений

В `docker-compose.yml` агента пробросьте те же каталоги, где у приложений лежит `.env`:

```yaml
services:
  infisical-docker-sync:
    volumes:
      - ./data:/app/data
      - ${HOME}/projects/my-app:/projects/my-app
      - ${HOME}/projects/my-worker:/projects/my-worker
```

`envDir` в config — путь **внутри контейнера агента**. На хосте это тот же каталог, что указан в `env_file` compose приложения.

**Альтернатива:** общий каталог `./envs:/app/envs` и `envDir: "/app/envs/my-app"`, если не хотите монтировать весь проект.

### Шаг 4. Настройте compose приложения

В compose вашего приложения укажите имя контейнера, файл окружения и opt-in label для безопасного пересоздания через proxy:

```yaml
services:
  my-app:
    container_name: my-app
    image: my-app:latest
    env_file: ./.env    # агент создаст и обновит этот файл
    labels:
      infisical-docker-sync.enabled: "true"

  my-db:
    container_name: my-db
    image: postgres:15
    env_file: ./.env
    labels:
      infisical-docker-sync.enabled: "true"
```

Proxy откажется пересоздавать контейнер без label `infisical-docker-sync.enabled=true`. Это защита на случай утечки `PROXY_TOKEN`: token сам по себе не даёт управлять любым контейнером на Docker-хосте.

### Шаг 5. Проверьте работу

```bash
# Логи агента — синхронизация секретов и запись .env
docker logs -f infisical-docker-sync

# Логи proxy — пересоздание контейнеров
docker logs -f recreate-proxy

# Статус сервисов
docker ps | grep -E 'infisical-docker-sync|recreate-proxy'
```

**Ожидаемые сообщения при успешном цикле:**

```
[config] Загружено: 2 сервисов из /app/data/config.yaml
[sync] my-app: .env не найден — создаём из секретов Infisical
[sync] my-app: записано 42 переменных, запрос пересоздания контейнера
[docker] my-app: пересоздан (a1b2c3d4e5f6)
[proxy] proxy для пересоздания слушает порт 8080
```

При повторных проверках без изменений:

```
[sync] my-app: секреты актуальны (42 переменных), пересоздание не требуется
```

## Как это работает

1. Агент читает `config.yaml` и по интервалу опрашивает Infisical API.
2. Сравнивает секреты с текущим `.env` на диске.
3. При отличиях записывает `.env` (права `0600`) и отправляет proxy запрос `POST /recreate`.
4. Proxy читает spec контейнера через `inspect`, подставляет новые переменные окружения и пересоздаёт контейнер. Из запроса принимаются только имя контейнера и env — изменить `Privileged`, `Binds` или образ нельзя.
5. Зависимые контейнеры в том же compose-проекте временно останавливаются и запускаются после пересоздания целевого.

Агент определяет compose-проект по меткам контейнера (`com.docker.compose.project`, `com.docker.compose.service`).

## Устранение неполадок

Каждый раздел привязан к этапу настройки.

### Контейнер не найден

**Сообщение в логах:** `[docker] my-app: контейнер не найден` или `не найден в проекте my-project`

**На каком этапе:** шаг 4 — compose приложения.

**Что проверить:**

1. `container` в `config.yaml` совпадает с `container_name` в compose приложения (не с именем сервиса).
2. Контейнер уже создан и хотя бы раз запускался через Docker Compose.
3. Имя уникально на хосте: `docker ps -a --filter name=my-app`.

### Infisical не отвечает (`fetch failed`)

**На каком этапе:** шаг 2 — credentials и сеть.

**Что проверить:**

1. `siteUrl`, `clientId`, `clientSecret`, `projectId`, `environment` в config.
2. Сеть агента: proxy только в `proxynet` (`internal: true`), агент — в `proxynet` **и** `default` для HTTPS к Infisical:

```yaml
  infisical-docker-sync:
    networks:
      - proxynet
      - default
```

Проверка доступа:

```bash
docker exec infisical-docker-sync node -e "fetch('https://app.infisical.com').then(r=>console.log(r.status)).catch(e=>console.error(e.message))"
```

### Нет прав на запись `.env`

**Сообщение:** `Нет прав на запись в envDir (...)` или `EACCES: permission denied`

**На каком этапе:** шаг 3 — монтирование.

**Что проверить:**

1. Volume смонтирован в compose агента и путь совпадает с `envDir`.
2. Агент запущен с `user: "0:0"` (см. [`docker-compose.example.yml`](docker-compose.example.yml)).
3. Каталог на хосте существует и доступен для записи.

### Proxy не стартует (`PROXY_TOKEN не задан`)

**На каком этапе:** шаг 1 — `.env` рядом с compose.

Задайте `PROXY_TOKEN` в `.env` и убедитесь, что переменная проброшена в оба сервиса. Proxy и агент должны использовать одно значение.

### Ошибка доступа к Docker socket (`EACCES`)

**На каком этапе:** шаг 1 — настройка proxy.

Сокет монтируется **только** в `recreate-proxy`.

1. Узнайте GID группы docker:

```bash
stat -c '%g' /var/run/docker.sock
```

2. Укажите в `.env` и compose:

```yaml
services:
  recreate-proxy:
    group_add:
      - "${DOCKER_GID:-999}"
```

3. Проверьте логи: `[proxy] proxy для пересоздания слушает порт 8080`.

### Пустой ответ от Infisical

**Сообщение:** `[sync] my-app: Infisical вернул пустой список секретов`

**На каком этапе:** шаг 2 — projectId и environment.

Проверьте, что в указанном окружении проекта есть секреты и у Machine Identity есть к ним доступ.

### Ошибка валидации config.yaml

**Сообщение:** `Ошибка конфигурации: ...`

**На каком этапе:** шаг 2.

Типичные причины: пропущено обязательное поле, `syncInterval` меньше 10, в `envFileName` указан путь вместо имени файла.

После исправления config перезагружается автоматически (hot-reload). В логах: `[watch] config.yaml изменён, перезагружаем`.

## Безопасность

### Рекомендации

- `siteUrl` должен быть `https://...`. `http://...` разрешён только для локального Infisical (`localhost`, `127.0.0.1`, `::1`).
- Не коммитьте `config.yaml` с секретами в git.
- Ограничьте права Machine Identity в Infisical только нужными проектами.
- Защитите каталоги с `.env` на хосте (права файлов, доступ к серверу).
- В prod используйте фиксированный тег образа, не `latest`.

### Архитектура

```
infisical-docker-sync (root, без сокета)
    │  POST /recreate {container, env}  +  x-proxy-token
    ▼
recreate-proxy (nonroot 65532, сокет :ro)
    │  inspect / stop / remove / create / start
    ▼
/var/run/docker.sock
```

**Hardening proxy:** `cap_drop: [ALL]`, `no-new-privileges`, сеть `proxynet` с `internal: true` (proxy без выхода в интернет, порт на хост не публикуется), обязательный сильный `PROXY_TOKEN`, exact-match имени контейнера и opt-in label `infisical-docker-sync.enabled=true` на каждом управляемом контейнере.

**Остаточные риски:**

- Скомпрометированный агент может подменить env и вызвать пересоздание (DoS). До Docker API доступа нет.
- Скомпрометированный proxy = root на хосте; поверхность атаки — один endpoint `POST /recreate`.

**Почему не generic Docker proxy:** фильтры по endpoint/методу не проверяют тело запроса — `POST /containers/create` может передать `Privileged` или `Binds: ["/:/host"]`. Наш proxy не принимает `HostConfig` из запроса.

### Коды ответов recreate-proxy

Все ответы proxy возвращаются в JSON-формате `{ ok, code, error? }`, где `code` — стабильный машинный код результата.

| HTTP | `code` | Когда возвращается |
|------|--------|--------------------|
| `200` | `ok` | Контейнер успешно пересоздан |
| `400` | `invalid_json` / `request_body_read_failed` | Тело запроса нельзя разобрать как JSON или прочитать |
| `401` | `unauthorized` | Нет `x-proxy-token` или токен неверный |
| `404` | `route_not_found` | Запрошен endpoint не `/recreate` |
| `405` | `method_not_allowed` | `/recreate` вызван не через `POST`; ответ содержит `Allow: POST` |
| `413` | `payload_too_large` | Тело запроса больше 1 МБ |
| `422` | `validation_failed` | JSON валиден, но payload не соответствует схеме |
| `500` | `recreate_failed` / `internal_error` | Ошибка Docker-пересоздания или внутренняя ошибка proxy |

### Переменные окружения

| Переменная | Сервис | Назначение |
|------------|--------|------------|
| `PROXY_TOKEN` | оба | Общий секрет для `POST /recreate`. Обязателен, минимум 32 символа; рекомендуется `openssl rand -hex 32` |
| `PROXY_URL` | агент | URL proxy. По умолчанию `http://recreate-proxy:8080`; host должен быть внутренним и входить в allowlist |
| `PROXY_ALLOWED_HOSTS` | агент | Разрешённые hosts для `PROXY_URL`. По умолчанию `recreate-proxy,localhost,127.0.0.1,::1` |
| `PROXY_PORT` | proxy | Порт HTTP-сервера. По умолчанию `8080` |
| `CONFIG_PATH` | агент | Путь к config. По умолчанию `/app/data/config.yaml` |
| `CONTAINER_NAME` | оба | Префикс в логах |
| `DOCKER_GID` | proxy | GID группы docker для `group_add` |

## Для разработчиков

```bash
pnpm install
pnpm dev
pnpm build
pnpm check
pnpm lint:fix

docker build -t infisical-docker-sync:local .
```

Локальный запуск proxy (Linux, нужен `group_add` или `user: "0:0"`):

```bash
docker run --rm -p 8080:8080 \
  -e PROXY_TOKEN="$(openssl rand -hex 32)" \
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
├── state-manager.ts      # Состояние синхронизации
├── logger.ts
├── types.ts
└── proxy/
    ├── server.ts         # HTTP proxy (POST /recreate)
    └── docker-recreate.ts
```

## Лицензия

MIT — без гарантий, на ваш риск.

Утилита для автоматизации синхронизации секретов в Docker Compose. Не замена Vault Agent, External Secrets Operator или официальной интеграции Infisical.
