# Destination Bot (Docker-Only Setup)

Destination Bot is an LXMF/Reticulum bot that proxies directions requests to Destination App (`destination-app`) and returns responses over LXMF.

This guide is Docker-only: no local Python or Bun install is required.

## What Runs In Docker

- `postgres` (PostGIS + pgRouting)
- `destination-app` (Bun + Elysia API on port `3000`)
- `bot` (LXMF bot runtime)

## Prerequisites

- Docker + Docker Compose
- Reticulum available on the host (set `RETICULUM_CONFIG_PATH` in `infra/.env` to your host path, for example `/home/your-user/.reticulum`)
- An LXMF client (NomadNet/Sideband/etc.) for testing
- A transport node and a separate client device are recommended for realistic mesh testing

## 1) Environment Setup

Create infra env file:

```bash
cp infra/.env.example infra/.env
```

Create app env file:

```bash
cp destination-app/.env.example destination-app/.env
```

Set your DB password in `infra/.env` (example):

```bash
POSTGRES_PASSWORD=replace-me
```

## Environment Variable Mapping

For this Docker-only setup, there are two env files with different ownership:

- `infra/.env` is used by Docker Compose variable substitution and bot/runtime config values defined in `infra/docker-compose.yml`.
- `destination-app/.env` is loaded directly by the `destination-app` service through `env_file`.
- For normal setup, edit `infra/.env` and `destination-app/.env`; do not edit `infra/docker-compose.yml` unless you are intentionally changing infrastructure defaults.

| Variable | Where to set it | Used by | Notes/default |
| --- | --- | --- | --- |
| `RETICULUM_CONFIG_PATH` | `infra/.env` | `bot` volume mount for host Reticulum config | Default placeholder: `/home/your-user/.reticulum`; update this per machine. |
| `POSTGRES_PASSWORD` | Both `infra/.env` and `destination-app/.env` (keep identical) | Compose substitution for `postgres`, `destination-app`, and `bot` DB auth | Required secret; default fallback in compose is `your_password_here` and should not be used. |
| `DESTINATION_APP_BASE_URL` | `infra/.env` | `bot` -> Destination App API base URL | Default: `http://localhost:3000`. |
| `DESTINATION_APP_TIMEOUT_SECONDS` | `infra/.env` | `bot` outbound HTTP timeout | Default: `15`. |
| `LOG_LEVEL` | `infra/.env` | `bot` logging level | Typical values: `DEBUG`, `INFO`, `WARNING`, `ERROR`; default in examples: `INFO`. |
| `BOT_ADMINS` | `infra/.env` | `bot` admin allowlist parsing | Comma-separated LXMF hashes; keep empty to disable admin-only users. |
| `DATABASE_URL` | `destination-app/.env` | `destination-app` DB client config | Should match your Postgres host/user/password/db values. |
| `POSTGRES_HOST` | `destination-app/.env` | `destination-app` and `bot` DB host config | Docker host-network default: `localhost`. |
| `POSTGRES_PORT` | `destination-app/.env` | `destination-app` and `bot` DB port config | Default: `5432`. |
| `POSTGRES_DB` | `destination-app/.env` | `destination-app` and `bot` database name | Default: `spatial_db`. |
| `POSTGRES_USER` | `destination-app/.env` | `destination-app` and `bot` database user | Default: `pi`. |
| `PGR_WAYS_TABLE` | `destination-app/.env` | `destination-app` and `bot` routing queries | Default: `ways`. |
| `PGR_VERTICES_TABLE` | `destination-app/.env` | `destination-app` and `bot` routing queries | Default: `ways_vertices_pgr`. |
| `GEOCODER_USER_AGENT` | `destination-app/.env` | `destination-app` and `bot` geocoder client | Default: `destination_directions_bot`. |
| `DIRECTIONS_SPEED_KMH` | `destination-app/.env` | `destination-app` and `bot` ETA calculations | Default: `40`. |

### Common pitfalls

- `POSTGRES_PASSWORD` mismatch between `infra/.env` and `destination-app/.env` causes authentication or connection failures.
- Changing values in `infra/docker-compose.yml` environment defaults without updating the env files leads to confusing drift between intended and actual runtime values.
- `DESTINATION_APP_BASE_URL` set to the wrong host/port causes bot direction calls to fail (for this stack, use the API exposed on `localhost:3000` unless you intentionally changed it).

## 2) Start The Stack

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml up -d --build
```

Check status:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml ps
```

Expected healthy services:

- `pgrouting-pi` (healthy)
- `destination-app` (healthy)
- `destination-bot` (started)

## 3) Verify API + Bot

API health:

```bash
curl -s http://localhost:3000/api
curl -s http://localhost:3000/api/health/db
```

Follow logs:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml logs -f --tail=120 destination-app
docker compose --env-file infra/.env -f infra/docker-compose.yml logs -f --tail=120 bot
```

In bot logs, look for:

- `LXMF Router ready to receive on:`
- `Initial announce sent`

## 4) One-Time OSM Import (Required Per Region Dataset)

Directions need routing graph tables (`ways`, `ways_vertices_pgr`).  
Container restarts do not create these automatically.

Download extract:

```bash
mkdir -p ./data/osm
curl --retry 5 --retry-delay 5 --fail -L "https://overpass-api.de/api/map?bbox=-74.0090,40.6950,-73.9350,40.7350" -o ./data/osm/region.osm
```

Validate file:

```bash
ls -lh ./data/osm/region.osm
tail -n 3 ./data/osm/region.osm
```

The file should end with `</osm>`.

Copy + import:

```bash
docker cp ./data/osm/region.osm pgrouting-pi:/tmp/region.osm
docker compose --env-file infra/.env -f infra/docker-compose.yml exec postgres bash -lc 'apt-get update && apt-get install -y osm2pgrouting && PGPASSWORD="$POSTGRES_PASS" osm2pgrouting -f /tmp/region.osm -h 127.0.0.1 -d "$POSTGRES_DB" -U "$POSTGRES_USER" -W "$POSTGRES_PASS"'
```

Verify routing tables:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml exec postgres bash -lc 'PGPASSWORD="$POSTGRES_PASS" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT to_regclass('\''public.ways'\''), to_regclass('\''public.ways_vertices_pgr'\'');"'
```

Both values must be non-null.

Quick row-count sanity check:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml exec postgres bash -lc 'PGPASSWORD="$POSTGRES_PASS" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT COUNT(*) AS ways_count FROM ways; SELECT COUNT(*) AS vertices_count FROM ways_vertices_pgr;"'
```

Both counts should be greater than zero.

## 5) LXMF Command Test

From your LXMF client, send:

```text
/hello
```

```text
/start 40.7145,-73.9630
```

```text
/destination 40.7081,-73.9571
```

```text
/directions_clear
```

## Troubleshooting

- Bot receives nothing:
  - Verify `RETICULUM_CONFIG_PATH` in `infra/.env` points to a valid host Reticulum directory
  - Check announce lines in bot logs
  - Verify transport pathing between devices
- `/hello` works but `/destination` fails:
  - Verify API health endpoints
  - Verify routing tables exist (`ways`, `ways_vertices_pgr`)
  - Verify bot env includes:
    - `DESTINATION_APP_BASE_URL`
    - `DESTINATION_APP_TIMEOUT_SECONDS`
- OSM download/import problems:
  - `curl: (23) Permission denied`: fix ownership (example: `sudo chown -R james:james ./data`)
  - timeout/download failures: retry with smaller bbox

## Useful Commands

Restart only bot:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml restart bot
```

Rebuild bot + app:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml up -d --build destination-app bot
```

Stop everything:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml down
```

## Related Docs

- Contributor guide: `CONTRIBUTING.md`
- Architecture: `docs/architecture.md`
- License: `LICENSE`
