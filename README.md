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

### Docker без сборки на сервере

GitHub Actions публикует готовые образы в GitHub Container Registry:

- `ghcr.io/proxcentb/mathboard-frontend`
- `ghcr.io/proxcentb/mathboard-backend`

На сервере можно запускать compose, который только скачивает готовые образы:

```bash
cp .env.prod.example .env
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
