# Bate-papo

A room-based chat app with a Brazilian Portuguese interface, built with React, Socket.io, and MongoDB.

## Development

Copy `.env.example` to `.env` before the first run. Install dependencies in the mounted host directories:

```sh
docker compose run --build --rm --no-deps backend npm install
docker compose run --build --rm --no-deps frontend npm install
```

Then run `docker compose up --build` and open http://localhost:8080. Bind mounts reload the backend and frontend when files change. `node_modules` stays in the local `backend/` and `frontend/` directories, which Git ignores; that is why dependencies are installed explicitly with `docker compose run`.

The admin conversation endpoint requires `Authorization: Bearer <ADMIN_API_TOKEN>`. The backend requires `ADMIN_API_TOKEN` to be at least 32 characters long.

## Production

Run `docker compose -f prod.docker-compose.yml up --build`. The images build the backend and frontend without bind mounts. Nginx forwards `/api` and `/socket.io` requests to the backend.

## Tests and coverage

With the development services running, execute:

```sh
docker compose exec backend npm test
docker compose exec backend npm run test:coverage
docker compose exec frontend npm test
docker compose exec frontend npm run test:coverage
```

Vitest covers server rules and UI states using the V8 coverage provider; HTML reports are written to `backend/coverage/` and `frontend/coverage/`. The Playwright end-to-end tests run in real Chromium. To run them inside the official Playwright image while Compose is active:

```sh
docker run --rm --network chat_default \
  -e PLAYWRIGHT_BASE_URL=http://frontend:5173 \
  -v "$PWD/frontend:/app" -w /app \
  mcr.microsoft.com/playwright:v1.63.0-noble npm run test:e2e
```

Playwright covers room entry, duplicate nicknames, sending with Enter, public and private messages, live presence, spy mode (including reload), returning to Everyone when a recipient leaves, and resuming a participant session without message history. Backend tests use real MongoDB and Socket.io instances to also verify server-side rules and rejections.

Run `npm run lint` and `npm run format:check` in each service to check linting and formatting.

## Server rules and operations

- Nicknames cannot contain control or invisible characters (such as zero-width spaces).
- Sending messages is limited to 5 per session every 5 seconds; beyond that the server replies with an error.
- If the same session is opened in another tab or window (for example, by duplicating the tab), the previous tab is disconnected, shows a notice and returns to the room list.
- The production compose file (`prod.docker-compose.yml`) does not publish the MongoDB or backend ports; all external access goes through the frontend's Nginx.
- `PORT` defaults to 3000 when unset. Synthetic leave events created at startup for abandoned sessions use the session's last known activity time.

## Architecture

Strict TypeScript monorepo. The Node.js 24 LTS backend is the authority for presence, validation, and private message delivery. MongoDB records sessions and messages; the UI does not read message history. The frontend uses Vite, React, Tailwind CSS v4 through the official Vite plugin, and Socket.io Client. A Vite proxy in development and Nginx in production forward API and WebSocket traffic; the browser uses the same origin, so the backend does not need CORS.
