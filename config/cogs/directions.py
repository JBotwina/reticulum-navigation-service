import os
import re
import time
import logging
from typing import Any

import psycopg2
from geopy.geocoders import Nominatim
from lxmfy import Command


DIRECTIONS_STARTS_KEY = "directions_starts"
COORDINATE_PATTERN = re.compile(
    r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$",
)
logger = logging.getLogger(__name__)


class DirectionsCommands:
    def __init__(self, bot):
        self.bot = bot
        self.geolocator = Nominatim(
            user_agent=os.getenv("GEOCODER_USER_AGENT", "destination_directions_bot"),
            timeout=10,
        )
        self.nominatim_min_interval = float(
            os.getenv("NOMINATIM_MIN_INTERVAL_SECONDS", "1.0"),
        )
        self.last_geocode_at = 0.0
        self.estimated_speed_kmh = float(
            os.getenv("DIRECTIONS_SPEED_KMH", "40"),
        )

    def _get_db_connection(self):
        db_url = os.getenv("DIRECTIONS_DB_URL")
        if db_url:
            return psycopg2.connect(db_url)

        return psycopg2.connect(
            host=os.getenv("POSTGRES_HOST", "localhost"),
            port=int(os.getenv("POSTGRES_PORT", "5432")),
            dbname=os.getenv("POSTGRES_DB", "spatial_db"),
            user=os.getenv("POSTGRES_USER", "pi"),
            password=os.getenv("POSTGRES_PASSWORD", "your_password_here"),
        )

    def _get_starts_map(self) -> dict[str, Any]:
        return self.bot.storage.get(DIRECTIONS_STARTS_KEY, {})


    def _set_sender_start(self, sender: str, point: dict[str, Any]) -> None:
        starts = self._get_starts_map()
        starts[sender] = point
        self.bot.storage.set(DIRECTIONS_STARTS_KEY, starts)

    def _clear_sender_start(self, sender: str) -> bool:
        starts = self._get_starts_map()
        if sender not in starts:
            return False
        starts.pop(sender, None)
        self.bot.storage.set(DIRECTIONS_STARTS_KEY, starts)
        return True

    def _get_sender_start(self, sender: str) -> dict[str, Any] | None:
        starts = self._get_starts_map()
        return starts.get(sender)

    def _parse_coordinates(self, raw: str) -> tuple[float, float] | None:
        match = COORDINATE_PATTERN.match(raw)
        if not match:
            return None

        lat = float(match.group(1))
        lon = float(match.group(2))
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return None
        return lat, lon

    def _geocode_address(self, address: str) -> tuple[float, float] | None:
        elapsed = time.time() - self.last_geocode_at
        if elapsed < self.nominatim_min_interval:
            time.sleep(self.nominatim_min_interval - elapsed)

        location = self.geolocator.geocode(address)
        self.last_geocode_at = time.time()

        if not location:
            return None
        return location.latitude, location.longitude

    def _resolve_input_location(self, raw: str) -> dict[str, Any] | None:
        coords = self._parse_coordinates(raw)
        if coords:
            lat, lon = coords
            return {"raw": raw, "lat": lat, "lon": lon, "source": "coords"}

        geocoded = self._geocode_address(raw)
        if geocoded:
            lat, lon = geocoded
            return {"raw": raw, "lat": lat, "lon": lon, "source": "geocoded"}

        return None

    def _find_nearest_vertex(
        self,
        cursor,
        lat: float,
        lon: float,
    ) -> int:
        vertices_table = os.getenv("PGR_VERTICES_TABLE", "ways_vertices_pgr")
        sql = f"""
            SELECT id
            FROM {vertices_table}
            ORDER BY the_geom <-> ST_SetSRID(ST_MakePoint(%s, %s), 4326)
            LIMIT 1
        """
        cursor.execute(sql, (lon, lat))
        row = cursor.fetchone()
        if not row:
            raise RuntimeError("No nearby vertex found for location")
        return int(row[0])

    def _distance_m_expr(self, ways_table: str) -> str:
        """Build SQL expression that resolves road segment length in meters."""
        return (
            f"COALESCE(NULLIF({ways_table}.length_m, 0), "
            f"NULLIF({ways_table}.length * 1000.0, 0), "
            f"NULLIF(ST_Length({ways_table}.the_geom::geography), 0), 0)"
        )

    def _fetch_route_steps(
        self,
        start_lat: float,
        start_lon: float,
        dest_lat: float,
        dest_lon: float,
    ) -> list[dict[str, Any]]:
        ways_table = os.getenv("PGR_WAYS_TABLE", "ways")
        distance_m_expr = self._distance_m_expr(ways_table)
        with self._get_db_connection() as conn:
            with conn.cursor() as cur:
                start_vertex = self._find_nearest_vertex(cur, start_lat, start_lon)
                dest_vertex = self._find_nearest_vertex(cur, dest_lat, dest_lon)
                route_sql = f"""
                    WITH route AS (
                        SELECT *
                        FROM pgr_dijkstra(
                            'SELECT gid AS id, source, target, {distance_m_expr} AS cost, {distance_m_expr} AS reverse_cost FROM {ways_table}',
                            %s,
                            %s,
                            directed := true
                        )
                    )
                    SELECT
                        route.seq,
                        COALESCE(
                            NULLIF({ways_table}.name, ''),
                            CASE
                                WHEN NULLIF(configuration.tag_value, '') IS NULL THEN NULL
                                ELSE INITCAP(REPLACE(configuration.tag_value, '_', ' '))
                            END,
                            'Unnamed road'
                        ) AS road_name,
                        COALESCE(route.cost, 0)::double precision AS length_m
                    FROM route
                    JOIN {ways_table} ON route.edge = {ways_table}.gid
                    LEFT JOIN configuration ON {ways_table}.tag_id = configuration.tag_id
                    WHERE route.edge <> -1
                    ORDER BY route.seq
                """
                cur.execute(route_sql, (start_vertex, dest_vertex))
                rows = cur.fetchall()
                logger.info(
                    "Computed route from vertex %s to %s with %s segments",
                    start_vertex,
                    dest_vertex,
                    len(rows),
                )

        steps: list[dict[str, Any]] = []
        for seq, road_name, length_m in rows:
            steps.append(
                {
                    "seq": int(seq),
                    "road_name": str(road_name),
                    "length_m": float(length_m),
                },
            )
        return steps

    def _compact_steps(self, steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Merge consecutive route segments with the same road label."""
        if not steps:
            return []

        compacted: list[dict[str, Any]] = []
        current = {
            "seq": int(steps[0]["seq"]),
            "road_name": str(steps[0]["road_name"]),
            "length_m": float(steps[0]["length_m"]),
        }

        for step in steps[1:]:
            road_name = str(step["road_name"])
            length_m = float(step["length_m"])
            if road_name == current["road_name"]:
                current["length_m"] += length_m
                continue

            compacted.append(current)
            current = {
                "seq": int(step["seq"]),
                "road_name": road_name,
                "length_m": length_m,
            }

        compacted.append(current)
        for index, step in enumerate(compacted, start=1):
            step["seq"] = index
        return compacted

    def _format_distance(self, length_m: float) -> str:
        """Render a human-readable distance string from meters."""
        if length_m >= 1000:
            return f"{length_m / 1000.0:.2f} km"
        if length_m >= 100:
            return f"{length_m:.0f} m"
        return f"{length_m:.1f} m"

    def _format_directions_reply(
        self,
        start_raw: str,
        dest_raw: str,
        steps: list[dict[str, Any]],
    ) -> str:
        compacted_steps = self._compact_steps(steps)
        if not compacted_steps:
            return "No route found between start and destination."

        total_m = sum(step["length_m"] for step in compacted_steps)
        total_km = total_m / 1000.0
        estimated_hours = total_km / self.estimated_speed_kmh if self.estimated_speed_kmh > 0 else 0
        estimated_minutes = max(1, round(estimated_hours * 60))

        lines = [
            "Directions",
            f"Start: {start_raw}",
            f"Destination: {dest_raw}",
            "",
            f"Total distance: {self._format_distance(total_m)}",
            f"Estimated time: ~{estimated_minutes} min",
            "",
            "Steps:",
        ]

        for index, step in enumerate(compacted_steps, start=1):
            step_distance_m = step["length_m"]
            distance_text = self._format_distance(step_distance_m)
            lines.append(
                f"{index}. Continue on {step['road_name']} for {distance_text}",
            )

        lines.append(f"{len(compacted_steps) + 1}. Arrive at destination")
        return "\n".join(lines)

    @Command(
        name="start",
        description="Set your route start location (address or lat,lon)",
        threaded=True,
    )
    def start(self, ctx):
        if not ctx.args:
            ctx.reply("Usage: /start <address or lat,lon>")
            return

        raw_input = " ".join(ctx.args).strip()
        try:
            point = self._resolve_input_location(raw_input)
        except Exception:
            ctx.reply("Could not resolve that start location right now.")
            return

        if not point:
            ctx.reply("Could not find that start location.")
            return

        self._set_sender_start(
            ctx.sender,
            {
                "raw": raw_input,
                "lat": point["lat"],
                "lon": point["lon"],
            },
        )
        ctx.reply(
            f"Start location saved: {raw_input}\n"
            f"Use /destination <address or lat,lon> to get directions.",
        )

    @Command(
        name="destination",
        description="Get directions to destination (address or lat,lon)",
        threaded=True,
    )
    def destination(self, ctx):
        if not ctx.args:
            ctx.reply("Usage: /destination <address or lat,lon>")
            return

        sender_start = self._get_sender_start(ctx.sender)
        if not sender_start:
            ctx.reply("No start location set. Use /start <address or lat,lon> first.")
            return

        destination_raw = " ".join(ctx.args).strip()
        try:
            destination_point = self._resolve_input_location(destination_raw)
        except Exception:
            ctx.reply("Could not resolve that destination right now.")
            return

        if not destination_point:
            ctx.reply("Could not find that destination.")
            return

        try:
            steps = self._fetch_route_steps(
                start_lat=float(sender_start["lat"]),
                start_lon=float(sender_start["lon"]),
                dest_lat=float(destination_point["lat"]),
                dest_lon=float(destination_point["lon"]),
            )
        except Exception:
            logger.exception("Failed to compute route")
            ctx.reply("Directions service is temporarily unavailable.")
            return

        try:
            reply = self._format_directions_reply(
                start_raw=sender_start["raw"],
                dest_raw=destination_raw,
                steps=steps,
            )
        except Exception:
            logger.exception("Failed to format directions reply")
            ctx.reply("Directions service is temporarily unavailable.")
            return

        ctx.reply(reply)

    @Command(
        name="directions_clear",
        description="Clear your saved start location",
    )
    def directions_clear(self, ctx):
        was_cleared = self._clear_sender_start(ctx.sender)
        if was_cleared:
            ctx.reply("Cleared your saved start location.")
        else:
            ctx.reply("No saved start location to clear.")


def setup(bot):
    bot.add_cog(DirectionsCommands(bot))
