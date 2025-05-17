# Infisical Docker Sync

Корпоративная утилита для синхронизации переменных окружения из Infisical и автоматического перезапуска Docker-контейнеров при их изменении.

## Возможности

- Получение секретов из Infisical с помощью SDK
- Автоматическое сохранение в .env файлы
- Отслеживание изменений переменных окружения
- Перезапуск Docker-контейнеров при обновлении .env
- Поддержка глобальных и индивидуальных настроек для каждого сервиса

## Требования

- Docker и Docker Compose
- Доступ к Docker socket (/var/run/docker.sock)
- Учетная запись Infisical с настроенными Client ID и Client Secret

## Быстрый старт

1. Создайте директорию проекта:
```bash
mkdir -p infisical-docker-sync/envs
cd infisical-docker-sync
```

2. Создайте файл `docker-compose.yml`:
```yaml
version: '3.8'

services:
  infisical-docker-sync:
    image: ghcr.io/webzaytsev/infisical-docker-sync:latest
    container_name: infisical-docker-sync
    volumes:
      - ./config.yaml:/app/config.yaml
      - ./envs:/app/envs
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - TZ=Europe/Moscow
      - CONFIG_PATH=/app/config.yaml
    restart: unless-stopped
```

3. Создайте файл `config.yaml`:
```yaml
siteUrl: "https://app.infisical.com"
clientId: "ваш-client-id"
clientSecret: "ваш-client-secret"
syncInterval: 60  # интервал проверки в секундах
logLevel: "info"  # уровень логирования: debug, info, none
defaultReloadPolicy: "recreate"  # политика перезагрузки по умолчанию: restart или recreate

services:
  - name: "сервис1"
    container: "имя_контейнера_1"
    envFile: "сервис1.env"
    projectId: "проект-для-сервиса-1"
    environment: "dev"
    reloadPolicy: "restart"  # можно указать индивидуальную политику
  - name: "сервис2"
    container: "имя_контейнера_2"
    envFile: "сервис2.env"
    projectId: "проект-для-сервиса-2"
    environment: "prod"
    overrides:
      clientId: "индивидуальный-client-id" # опционально
```

4. Запустите сервис:
```bash
docker-compose up -d
```

## Детальная конфигурация

### Параметры config.yaml

| Параметр | Описание | Обязательный | По умолчанию |
|----------|----------|--------------|--------------|
| siteUrl | URL Infisical | Да | - |
| clientId | Client ID для Infisical | Да | - |
| clientSecret | Client Secret для Infisical | Да | - |
| syncInterval | Интервал синхронизации (секунды) | Нет | 60 |
| logLevel | Уровень логирования (debug, info, none) | Нет | info |
| defaultReloadPolicy | Политика перезагрузки (restart, recreate) | Нет | recreate |
| services | Массив обслуживаемых сервисов | Да | - |

### Параметры сервиса

| Параметр | Описание | Обязательный |
|----------|----------|--------------|
| name | Имя сервиса | Да |
| container | Имя Docker-контейнера | Да |
| envFile | Имя файла .env (будет создан в директории envs) | Да |
| projectId | ID проекта в Infisical | Да |
| environment | Окружение в Infisical (dev, staging, prod) | Да |
| syncInterval | Индивидуальный интервал синхронизации | Нет |
| reloadPolicy | Политика перезагрузки для сервиса (restart, recreate) | Нет |
| overrides | Переопределение глобальных параметров | Нет |

## Мониторинг

### Просмотр логов

```bash
docker logs -f infisical-docker-sync
```

### Проверка статуса

```bash
docker ps | grep infisical-docker-sync
```

## Обновление

```bash
# Остановите контейнер
docker-compose down

# Обновите образ
docker pull ghcr.io/webzaytsev/infisical-docker-sync:latest

# Запустите снова
docker-compose up -d
```

## Архитектура

Infisical Docker Sync работает в фоновом режиме и выполняет следующие действия:

1. Загружает конфигурацию из config.yaml
2. Инициализирует подключение к Infisical для каждого сервиса
3. Периодически проверяет обновления секретов
4. При изменении секретов:
   - Обновляет соответствующий .env файл
   - Перезапускает связанный Docker-контейнер согласно указанной политике:
     - `restart`: Простой перезапуск контейнера без пересоздания
     - `recreate`: Полное пересоздание контейнера (удаление и создание заново)

## Решение проблем

### Нет доступа к Docker API

Убедитесь, что:
- Docker socket смонтирован корректно: `/var/run/docker.sock:/var/run/docker.sock`
- У пользователя есть права на доступ к Docker socket

### Секреты не синхронизируются

Проверьте:
- Правильность Client ID и Client Secret
- Доступность Infisical API
- Корректность Project ID и названия окружения
- Логи контейнера для получения подробной информации

### Контейнеры не перезапускаются

Проверьте:
- Правильность имен контейнеров в config.yaml
- Наличие доступа к Docker API
- Статус Docker демона

## Безопасность

- Храните config.yaml в безопасном месте с ограниченным доступом
- Используйте клиентские ключи Infisical с минимально необходимыми правами
- Ограничьте доступ к директории envs с .env файлами

## Производственное использование

Для производственной среды рекомендуется:

1. Использовать фиксированную версию образа вместо latest
2. Настроить мониторинг состояния контейнера
3. Настроить оповещения при сбоях
4. Использовать Docker secrets или другие способы защиты конфиденциальных данных

## Лицензия

MIT
