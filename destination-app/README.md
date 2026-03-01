# Destination App

Destination App is the Bun + TanStack Start + Elysia service used by Destination Bot.
It exposes API endpoints consumed by the LXMF bot and performs routing queries against
Postgres/PostGIS/pgRouting.

## Key Endpoints

- `GET /api` - API readiness probe
- `GET /api/health/db` - Database connectivity probe
- `POST /api/directions` - Directions request API used by `bot/destination_bot.py`

Example request:

```bash
curl -s -X POST "http://localhost:3000/api/directions" \
  -H "Content-Type: application/json" \
  -d '{"startInput":"26 Broadway, Brooklyn, NY 11249","destinationInput":"200 Bedford Ave, Brooklyn, NY 11249"}'
```

## Local Development

```bash
cp .env.example .env
bun install
bun --bun run dev --host 0.0.0.0 --port 3000
```

## Required Environment

Defined in `.env.example`:

- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `PGR_WAYS_TABLE`
- `PGR_VERTICES_TABLE`
- `GEOCODER_USER_AGENT`
- `DIRECTIONS_SPEED_KMH`

## Database Requirements

Directions require a routing graph in Postgres:

- `ways`
- `ways_vertices_pgr`

These are created from imported OSM data. Without them, `/api/directions` cannot compute routes.

## Validation

Required check command:

```bash
bun --bun run check
```

Optional:

```bash
bun --bun run lint
bun --bun run format
```

## Related Files

- API app: `src/server/api/app.ts`
- Directions service: `src/server/directions/service.ts`
- API route bridge: `src/routes/api.$.ts`
- DB connection: `src/server/db/connection.ts`
