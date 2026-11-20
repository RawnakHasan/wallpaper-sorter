#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  printf 'Usage: %s [wallpaper-sorter options]\n' "$0"
  printf 'Builds and starts the sorter, waits for its local web UI, then opens the browser.\n'
  printf 'Use --port N or WALLPAPER_SORTER_PORT=N for a non-default configured port.\n'
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

for command in cargo curl xdg-open; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$command" >&2
    exit 1
  fi
done

PORT="${WALLPAPER_SORTER_PORT:-8421}"
ARGS=("$@")
HAS_PORT_ARGUMENT=0
for ((index = 0; index < ${#ARGS[@]}; index++)); do
  case "${ARGS[index]}" in
    --no-web|--dry-run|--once|--resort-preview)
      printf 'This launcher requires the sorter web UI and its continuous run mode.\n' >&2
      exit 2
      ;;
  esac
  if [[ "${ARGS[index]}" == "--port" ]]; then
    if ((index + 1 >= ${#ARGS[@]})); then
      printf '%s\n' '--port needs a number' >&2
      exit 2
    fi
    PORT="${ARGS[index + 1]}"
    HAS_PORT_ARGUMENT=1
  fi
done

if [[ ! "$PORT" =~ ^[0-9]{1,5}$ ]]; then
  printf 'Invalid port: %s\n' "$PORT" >&2
  exit 2
fi
PORT_NUMBER=$((10#$PORT))
if ((PORT_NUMBER < 1 || PORT_NUMBER > 65535)); then
  printf 'Port must be between 1 and 65535: %s\n' "$PORT" >&2
  exit 2
fi
if [[ -n "${WALLPAPER_SORTER_PORT:-}" && "$HAS_PORT_ARGUMENT" -eq 0 ]]; then
  ARGS+=(--port "$PORT_NUMBER")
fi
URL="http://127.0.0.1:${PORT_NUMBER}/"

if curl --fail --silent --show-error --max-time 1 --output /dev/null "$URL" 2>/dev/null; then
  printf 'Sorter is already responding at %s; opening it.\n' "$URL"
  xdg-open "$URL"
  exit 0
fi

cd "$ROOT"
cargo build --release

SORTER_PID=
stop_sorter() {
  if [[ -n "$SORTER_PID" ]] && kill -0 "$SORTER_PID" 2>/dev/null; then
    kill -INT "$SORTER_PID" 2>/dev/null || true
    wait "$SORTER_PID" 2>/dev/null || true
  fi
}
trap stop_sorter EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Starting sorter; waiting for %s\n' "$URL"
"$ROOT/target/release/wallpaper-sorter" "${ARGS[@]}" &
SORTER_PID=$!

for ((attempt = 0; attempt < 120; attempt++)); do
  if ! kill -0 "$SORTER_PID" 2>/dev/null; then
    if wait "$SORTER_PID"; then
      printf 'Sorter exited before the web UI became available.\n' >&2
      exit 1
    else
      result=$?
      printf 'Sorter exited with status %s before the web UI became available.\n' "$result" >&2
      exit "$result"
    fi
  fi
  if curl --fail --silent --show-error --max-time 1 --output /dev/null "$URL" 2>/dev/null; then
    printf 'Opening %s\n' "$URL"
    xdg-open "$URL"
    printf 'Press Ctrl+C to stop the sorter.\n'
    wait "$SORTER_PID"
    exit $?
  fi
  sleep 0.5
done

printf 'Timed out waiting for the web UI at %s.\n' "$URL" >&2
exit 1
