# Mathboard

Небольшая совместная веб-доска: пользователь создаёт страницу с id, делится ссылкой `/r/:id`, а участники рисуют на общих холстах в клетку.

## Стек

- `apps/backend`: NestJS, Socket.IO, in-memory комнаты и история действий.
- `apps/frontend`: React, Vite, TypeScript, CSS Modules, CSS variables, Radix Toolbar, clsx.
- `devenv`: Node.js и pnpm внутри окружения.

## Запуск

### Локальная разработка

```bash
devenv shell
pnpm install
pnpm dev
```

Для локальной админки backend читает `apps/backend/.env`. Минимальный пример:

```bash
cp apps/backend/.env.example apps/backend/.env
```

Или через процессы devenv:

```bash
devenv up
```

По умолчанию:

- frontend: http://localhost:5173
- backend: http://localhost:3001

### Docker

Production-сборка поднимает два контейнера: `frontend` на nginx и `backend` на NestJS. Nginx отдаёт React-приложение и проксирует `/api/*` и `/socket.io/*` в backend.

```bash
docker compose up --build -d
```

По умолчанию приложение будет доступно на http://localhost:8080.

Порт можно поменять через переменную:

```bash
APP_PORT=80 docker compose up --build -d
```

Для production обязательно задайте пароль администратора:

```bash
ADMIN_PASSWORD='long-random-password' docker compose up --build -d
```

Админка доступна на `/admin`. Она показывает страницы, которые сейчас есть в памяти backend, память/CPU процесса и позволяет открыть или удалить страницу из памяти.

Для больших импортов/экспортов конфигурации есть два лимита backend:

- `REQUEST_BODY_LIMIT`, по умолчанию `250mb`, лимит JSON HTTP-запросов.
- `SOCKET_MAX_HTTP_BUFFER_SIZE`, по умолчанию `262144000`, лимит Socket.IO сообщений.

Nginx в frontend-контейнере не ограничивает размер тела запроса (`client_max_body_size 0`), поэтому для очень больших конфигураций поднимайте эти backend-переменные под размер вашего сервера.

### Docker без сборки на сервере

GitHub Actions публикует готовые образы в GitHub Container Registry:

- `ghcr.io/proxcentb/mathboard-frontend`
- `ghcr.io/proxcentb/mathboard-backend`

На сервере можно запускать compose, который только скачивает готовые образы:

```bash
cp .env.prod.example .env
# обязательно отредактируйте ADMIN_PASSWORD перед запуском
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

По умолчанию используется тег `latest`. Для более предсказуемого деплоя лучше указывать конкретный тег, например `IMAGE_TAG=sha-...` из GitHub Actions.

## Что уже есть

- генерация id комнаты на backend;
- страница `/r/:id`;
- несколько холстов на одной странице;
- фон холста в клетку;
- кисть, ластик, цвет и размер;
- undo/redo для линий и операций с изображениями;
- вставка изображения из буфера через `Ctrl+V`;
- перемещение изображения и resize за нижний правый угол;
- совместная работа через WebSocket;
- хранение состояния в памяти backend без базы данных.
