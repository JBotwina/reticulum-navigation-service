import logging
import os
import sys
from urllib import error, request
import json
from typing import Any

from lxmfy import LXMFBot

DIRECTIONS_STARTS_KEY = "directions_starts"
DESTINATION_APP_BASE_URL = os.getenv("DESTINATION_APP_BASE_URL", "http://localhost:3000").rstrip("/")
DESTINATION_APP_TIMEOUT_SECONDS = float(
    os.getenv("DESTINATION_APP_TIMEOUT_SECONDS", "15"),
)


def configure_logging() -> None:
    """Configure stdout logging for reliable docker logs debugging."""
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stdout,
    )


def parse_admin_hashes() -> set[str]:
    """Parse comma-separated admin LXMF hashes from environment."""
    raw_admins = os.getenv("BOT_ADMINS", "")
    return {value.strip() for value in raw_admins.split(",") if value.strip()}


def build_bot() -> LXMFBot:
    """Build and return the LXMF bot configuration."""
    return LXMFBot(
        name="Destination Bot",
        announce=600,
        announce_immediately=True,
        admins=parse_admin_hashes(),
        hot_reloading=False,
        rate_limit=5,
        cooldown=60,
        max_warnings=3,
        warning_timeout=300,
        command_prefix="/",
        cogs_dir="cogs",
        cogs_enabled=True,
        permissions_enabled=False,
        storage_type="json",
        storage_path="data",
        first_message_enabled=True,
        event_logging_enabled=True,
        max_logged_events=1000,
        event_middleware_enabled=True,
        announce_enabled=True,
        propagation_fallback_enabled=True,
        autopeer_propagation=True,
        autopeer_maxdepth=4,
    )


def decode_message_content(raw_content: bytes | None) -> str:
    """Decode message content safely for logs."""
    if raw_content is None:
        return ""
    return raw_content.decode("utf-8", errors="replace")


def parse_command(content: str) -> tuple[str | None, str]:
    """Parse command name and raw argument payload from an inbound message."""
    normalized = content.strip()
    if not normalized.startswith("/"):
        return None, ""

    parts = normalized.split(maxsplit=1)
    command_name = parts[0][1:].lower()
    raw_args = parts[1].strip() if len(parts) > 1 else ""
    return command_name, raw_args


def get_starts_map() -> dict[str, Any]:
    """Return persisted start locations map keyed by sender hash."""
    stored = bot.storage.get(DIRECTIONS_STARTS_KEY, {})
    return stored if isinstance(stored, dict) else {}


def set_sender_start(sender: str, raw_input: str) -> None:
    """Persist sender start location text for later destination lookups."""
    starts = get_starts_map()
    starts[sender] = {"raw": raw_input}
    bot.storage.set(DIRECTIONS_STARTS_KEY, starts)


def get_sender_start(sender: str) -> dict[str, Any] | None:
    """Get persisted sender start location payload."""
    starts = get_starts_map()
    entry = starts.get(sender)
    return entry if isinstance(entry, dict) else None


def clear_sender_start(sender: str) -> bool:
    """Remove sender start location if it exists."""
    starts = get_starts_map()
    if sender not in starts:
        return False

    starts.pop(sender, None)
    bot.storage.set(DIRECTIONS_STARTS_KEY, starts)
    return True


def directions_api_url() -> str:
    """Build the Destination App directions endpoint URL."""
    return f"{DESTINATION_APP_BASE_URL}/api/directions"


def request_directions(
    start_input: str,
    destination_input: str,
) -> tuple[dict[str, Any] | None, str | None]:
    """Request route directions from Destination App API."""
    payload = json.dumps(
        {
            "startInput": start_input,
            "destinationInput": destination_input,
        },
    ).encode("utf-8")
    http_request = request.Request(
        directions_api_url(),
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(http_request, timeout=DESTINATION_APP_TIMEOUT_SECONDS) as response:
            raw_body = response.read().decode("utf-8")
        parsed = json.loads(raw_body) if raw_body else {}
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            payload_obj = json.loads(body)
            error_message = payload_obj.get("error", {}).get("message")
            if isinstance(error_message, str) and error_message.strip():
                return None, error_message
        except Exception:
            pass
        return None, "Directions service is temporarily unavailable."
    except error.URLError:
        return None, "Directions service is temporarily unavailable."
    except TimeoutError:
        return None, "Destination service timed out. Please try again."
    except Exception:
        logging.exception("Failed calling Destination App directions API")
        return None, "Directions service is temporarily unavailable."

    if isinstance(parsed, dict) and isinstance(parsed.get("error"), dict):
        error_message = parsed["error"].get("message")
        if isinstance(error_message, str) and error_message.strip():
            return None, error_message
        return None, "Directions service is temporarily unavailable."

    return parsed if isinstance(parsed, dict) else None, None


def format_distance(length_m: float) -> str:
    """Render a human-readable distance string from meters."""
    if length_m >= 1000:
        return f"{length_m / 1000.0:.2f} km"
    if length_m >= 100:
        return f"{length_m:.0f} m"
    return f"{length_m:.1f} m"


def format_directions_reply(response: dict[str, Any]) -> str:
    """Convert Destination App directions payload into LXMF reply text."""
    start = response.get("start") if isinstance(response.get("start"), dict) else {}
    destination = (
        response.get("destination")
        if isinstance(response.get("destination"), dict)
        else {}
    )
    steps = response.get("steps") if isinstance(response.get("steps"), list) else []
    total_distance_m = response.get("totalDistanceM")
    estimated_minutes = response.get("estimatedMinutes")

    distance_value = float(total_distance_m) if isinstance(total_distance_m, (int, float)) else 0.0
    estimated_value = int(estimated_minutes) if isinstance(estimated_minutes, (int, float)) else 0

    lines = [
        "Directions",
        f"Start: {start.get('raw', 'Unknown')}",
        f"Destination: {destination.get('raw', 'Unknown')}",
        "",
        f"Total distance: {format_distance(distance_value)}",
        f"Estimated time: ~{estimated_value} min",
        "",
        "Steps:",
    ]

    for index, step in enumerate(steps, start=1):
        if not isinstance(step, dict):
            continue
        length_m = step.get("lengthM")
        instruction = step.get("instruction")
        step_distance = float(length_m) if isinstance(length_m, (int, float)) else 0.0
        step_instruction = instruction if isinstance(instruction, str) else "Continue"
        lines.append(f"{index}. {step_instruction} for {format_distance(step_distance)}")

    lines.append(f"{len(steps) + 1}. Arrive at destination")
    return "\n".join(lines)


def handle_directions_command(sender: str, command_name: str, raw_args: str) -> str:
    """Handle proxied directions commands and return response text."""
    if command_name == "start":
        if not raw_args:
            return "Usage: /start <address or lat,lon>"
        set_sender_start(sender, raw_args)
        return (
            f"Start location saved: {raw_args}\n"
            "Use /destination <address or lat,lon> to get directions."
        )

    if command_name == "directions_clear":
        was_cleared = clear_sender_start(sender)
        return (
            "Cleared your saved start location."
            if was_cleared
            else "No saved start location to clear."
        )

    if command_name == "destination":
        if not raw_args:
            return "Usage: /destination <address or lat,lon>"

        sender_start = get_sender_start(sender)
        start_raw = sender_start.get("raw") if isinstance(sender_start, dict) else None
        if not isinstance(start_raw, str) or not start_raw.strip():
            return "No start location set. Use /start <address or lat,lon> first."

        response, request_error = request_directions(
            start_input=start_raw,
            destination_input=raw_args,
        )
        if request_error:
            return request_error
        if not response:
            return "Directions service is temporarily unavailable."

        try:
            return format_directions_reply(response)
        except Exception:
            logging.exception("Failed to format proxied directions reply")
            return "Directions service is temporarily unavailable."

    return ""


bot = build_bot()


@bot.on_message()
def log_message(sender, message) -> None:
    """Log inbound LXMF messages without crashing message handling."""
    try:
        content = decode_message_content(getattr(message, "content", None))
        logging.info("Message from %s: %s", sender, content)
        command_name, raw_args = parse_command(content)
        if command_name not in {"start", "destination", "directions_clear"}:
            return False

        reply_text = handle_directions_command(sender, command_name, raw_args)
        bot.send(sender, reply_text)
        return True
    except Exception:
        logging.exception("Failed to process inbound message")
        bot.send(sender, "Directions service is temporarily unavailable.")
        return True


def main() -> None:
    """Start the bot with defensive startup and runtime error handling."""
    configure_logging()
    logging.info("Starting %s", bot.config.name)
    logging.info("Bot LXMF Address: %s", bot.local.hash.hex())

    try:
        bot.run()
    except KeyboardInterrupt:
        logging.info("Shutdown requested by user")
    except Exception:
        logging.exception("Fatal bot runtime error")
        raise


if __name__ == "__main__":
    main()
