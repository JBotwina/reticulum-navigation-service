# Contributing

Thanks for contributing to Destination Bot.

## Prerequisites

- Docker + Docker Compose
- Python 3.11+ and `uv`
- Bun (for local `destination-app` development)
- Reticulum + an LXMF client for end-to-end message testing

## Quickstart

```bash
cp .env.example .env
cp destination-app/.env.example destination-app/.env
docker compose up -d --build
```

Then verify:

```bash
docker compose ps
curl -s http://localhost:3000/api
curl -s http://localhost:3000/api/health/db
docker compose logs --tail=120 bot
```

## Validation

Required check command:

```bash
cd destination-app
bun --bun run check
```

Optional:

```bash
bun --bun run lint
bun --bun run format
```

## Development Notes

- Bot entrypoint is `destination_bot.py`.
- Directions are proxied to `destination-app` via `POST /api/directions`.
- Keep command UX stable for LXMF users (`/start`, `/destination`, `/directions_clear`).
- Prefer modular functions and keep responsibilities narrowly scoped.

## Pull Requests

- Keep PRs focused and small when possible.
- Update docs when behavior or setup changes.
- Include a short test plan in your PR description.
- Avoid committing secrets or local-only environment files.

## Troubleshooting

- If `/hello` fails from another device, fix Reticulum transport/path first.
- If bot receives messages but `/destination` fails, verify:
  - `DESTINATION_APP_BASE_URL` in bot env
  - `destination-app` service health
  - pgRouting tables exist (`ways`, `ways_vertices_pgr`)
