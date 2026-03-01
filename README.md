# Destination Bot

An LXMF bot for the Reticulum Network, built with [LXMFy](https://lxmfy.quad4.io/). It responds to messages from Nomad Network, Sideband, and other LXMF clients.

## Prerequisites

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- Docker + Docker Compose (for Postgres/PostGIS/pgRouting)
- Reticulum installed and running on your network
- A reachable Reticulum transport node
- A separate LXMF client device (Nomad Network, Sideband, or other LXMF client) to send test messages to the bot

## Reticulum Network Requirements

This bot depends on a working Reticulum network path, not just local containers.

- Reticulum project: [reticulum.network](https://reticulum.network/)
- Reticulum manual: [reticulum.network/manual](https://reticulum.network/manual/)
- Nomad Network (example LXMF client): [NomadNet on GitHub](https://github.com/markqvist/NomadNet)

Recommended topology for reliable testing:

1) Device A: host the bot and Reticulum instance.
2) Transport node: a reachable node in your mesh that forwards traffic.
3) Device B: separate client device that sends LXMF commands to the bot.

Why separate devices matter:

- It validates real network propagation instead of same-device loopback behavior.
- It confirms announces and reply paths work across the mesh.
- It helps isolate issues (Reticulum pathing vs bot/API logic).

Quick Reticulum troubleshooting checklist:

1) Verify the bot announces on startup:
   - `docker compose logs --tail=120 bot`
   - Look for `LXMF Router ready to receive on:` and `Initial announce sent`.
2) Verify the transport node is reachable from both devices.
3) Send a simple command first from Device B:
   - `/hello`
   - If this fails, fix Reticulum pathing before debugging directions.
4) Check the bot receives incoming messages:
   - `docker compose logs -f bot`
   - Look for `Message from <hash>: <content>`.
5) Check Destination App API health independently:
   - `curl -s http://localhost:3000/api`
   - `curl -s http://localhost:3000/api/health/db`
6) If API is healthy but replies fail, verify bot environment:
   - `docker compose exec bot env | rg DESTINATION_APP`
   - Confirm `DESTINATION_APP_BASE_URL` points to your running Destination App instance.

## Setup

```bash
uv sync
```

## Run

```bash
uv run python destination_bot.py
```

Or with uv directly:

```bash
uv run destination_bot.py
```

The bot will print its LXMF address. Message it from Nomad Network or any LXMF client to interact.

## Commands

- `/hello` - Greeting
- `/about` - About the bot
- `/page` - Destination Nomad Network page info
- `/start <address_or_lat,lon>` - Save start location for directions
- `/destination <address_or_lat,lon>` - Get directions from saved start via Destination App API
- `/directions_clear` - Clear saved start location
- `/help` - List commands

Directions are proxied through the Destination App Elysia API. The bot stores your `/start`
location per sender, calls Destination App on `/destination`, then returns the formatted result over LXMF.

## For Developers

- Contributor guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- License: [LICENSE](LICENSE)
- Architecture: [docs/architecture.md](docs/architecture.md)

Quickstart:

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

## Directions Stack with Docker Compose

PostgreSQL, PostGIS, and pgRouting are managed by Docker Compose.

### Start, restart, and rebuild

```bash
docker compose up -d --build
```

```bash
docker compose down
```

```bash
docker compose restart
```

```bash
docker compose down && docker compose up -d
```

When code changes are made to the bot image, rebuild once:

```bash
docker compose down && docker compose up -d --build
```

### Verify bot is online on Reticulum

```bash
docker compose ps
docker compose logs --tail=120 bot
```

Look for:

- `Configuration loaded from /root/.reticulum/config`
- `LXMF Router ready to receive on: <hash>`
- `Initial announce sent`

### Message test from NomadNet

In NomadNet, send commands as separate messages to the bot LXMF address:

```text
/start 40.7145,-73.9630
```

```text
/destination 40.7081,-73.9571
```

If geocoding is unavailable, prefer `lat,lon` coordinates over street addresses.

### OSM import for pgRouting (required once per region dataset)

The `/destination` command requires road graph tables (`ways`, `ways_vertices_pgr`). Restarting containers does not create these tables. Import OSM data once for each map region you want to support.

Why this is required:

- pgRouting computes routes from a road graph in Postgres, not directly from raw addresses.
- The OSM import creates the graph tables used by directions (`ways`, `ways_vertices_pgr`).
- Without import, the API has no drivable network to route on.

Example behavior without OSM import:

```text
/start 26 Broadway, Brooklyn, NY 11249
/destination 200 Bedford Ave, Brooklyn, NY 11249
-> Directions service is temporarily unavailable.
```

Example behavior after OSM import:

```text
/start 26 Broadway, Brooklyn, NY 11249
/destination 200 Bedford Ave, Brooklyn, NY 11249
-> Directions
-> Steps:
-> 1. Head on ...
-> 2. Turn left/right ...
```

Quick DB check (confirms graph data exists):

```bash
docker compose exec postgres bash -lc 'PGPASSWORD="$POSTGRES_PASS" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT COUNT(*) AS ways_count FROM ways; SELECT COUNT(*) AS vertices_count FROM ways_vertices_pgr;"'
```

Both counts should be greater than zero.

1) Download an extract:

```bash
mkdir -p ./data/osm
curl --retry 5 --retry-delay 5 --fail -L "https://overpass-api.de/api/map?bbox=-74.0090,40.6950,-73.9350,40.7350" -o ./data/osm/region.osm
```

2) Validate file integrity:

```bash
ls -lh ./data/osm/region.osm
tail -n 3 ./data/osm/region.osm
```

The file should end with `</osm>`.

3) Copy into the Postgres container and import:

```bash
docker cp ./data/osm/region.osm pgrouting-pi:/tmp/region.osm
```

```bash
docker compose exec postgres bash -lc 'apt-get update && apt-get install -y osm2pgrouting && PGPASSWORD="$POSTGRES_PASS" osm2pgrouting -f /tmp/region.osm -h 127.0.0.1 -d "$POSTGRES_DB" -U "$POSTGRES_USER" -W "$POSTGRES_PASS"'
```

4) Verify routing tables:

```bash
docker compose exec postgres bash -lc 'PGPASSWORD="$POSTGRES_PASS" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT to_regclass('\''public.ways'\''), to_regclass('\''public.ways_vertices_pgr'\'');"'
```

Both values must be non-null.

### Troubleshooting

- `Could not find that start location.`: address geocoding failed; try coordinate input.
- `Directions service is temporarily unavailable.`: routing tables likely missing or DB query failed.
- `Peer authentication failed for user ...`: use `psql -h 127.0.0.1` with `PGPASSWORD` to force password auth.
- `curl: (23) Permission denied`: fix local ownership, for example `sudo chown -R james:james ./data`.
- `curl: (18)` or `504 Gateway Timeout`: retry download and use a smaller bbox.

### Do I need to import every time?

No. Import only when initializing or changing map data. Normal container restarts do not require re-importing.

### Environment

Set `POSTGRES_PASSWORD` in your shell before `docker compose up`, for example:

```bash
export POSTGRES_PASSWORD='replace-me'
```

The bot uses these environment variables:

- `DESTINATION_APP_BASE_URL` (default `http://localhost:3000`)
- `DESTINATION_APP_TIMEOUT_SECONDS` (default `15`)

Destination App (the API backend) uses these environment variables:

- `POSTGRES_HOST` (default `localhost` when running on host, `postgres` in compose)
- `POSTGRES_PORT` (default `5432`)
- `POSTGRES_DB` (default `spatial_db`)
- `POSTGRES_USER` (default `pi`)
- `POSTGRES_PASSWORD` (default `your_password_here`)
- `PGR_WAYS_TABLE` (default `ways`)
- `PGR_VERTICES_TABLE` (default `ways_vertices_pgr`)
- `GEOCODER_USER_AGENT` (default `destination_directions_bot`)
- `NOMINATIM_MIN_INTERVAL_SECONDS` (default `1.0`)
- `DIRECTIONS_SPEED_KMH` (default `40`)
