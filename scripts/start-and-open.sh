#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  printf 'Usage: %s [wallpaper-sorter options]\n' "$0"
  printf 'Builds and starts the sorter, waits for its local web UI, then opens the browser.\n'
  printf 'Use --port N or WALLPAPER_SORTER_PORT=N for a non-default configured port.\n'
  printf 'If no config exists, it initializes one with the starter tags and chosen library path.\n'
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
HAS_LIBRARY_ARGUMENT=0
if [[ ${XDG_CONFIG_HOME+x} ]]; then
  CONFIG_PATH="${XDG_CONFIG_HOME}/wallpaper-sorter/config.toml"
else
  CONFIG_PATH="$HOME/.config/wallpaper-sorter/config.toml"
fi

expand_home() {
  case "$1" in
    '~') printf '%s' "$HOME" ;;
    '~/'*) printf '%s%s' "$HOME" "${1:1}" ;;
    *) printf '%s' "$1" ;;
  esac
}

for ((index = 0; index < ${#ARGS[@]};)); do
  case "${ARGS[index]}" in
    --no-web|--dry-run|--once|--resort-preview)
      printf 'This launcher requires the sorter web UI and its continuous run mode.\n' >&2
      exit 2
      ;;
    --config|--library|--port|--folder)
      if ((index + 1 >= ${#ARGS[@]})); then
        printf '%s needs a value\n' "${ARGS[index]}" >&2
        exit 2
      fi
      value="${ARGS[index + 1]}"
      case "${ARGS[index]}" in
        --config)
          CONFIG_PATH="$(expand_home "$value")"
          ARGS[index + 1]="$CONFIG_PATH"
          ;;
        --library)
          LIBRARY_PATH="$(expand_home "$value")"
          ARGS[index + 1]="$LIBRARY_PATH"
          HAS_LIBRARY_ARGUMENT=1
          ;;
        --port)
          PORT="$value"
          HAS_PORT_ARGUMENT=1
          ;;
      esac
      index=$((index + 2))
      ;;
    *)
      index=$((index + 1))
      ;;
  esac
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

if [[ ! -f "$CONFIG_PATH" ]]; then
  if [[ "$HAS_LIBRARY_ARGUMENT" -eq 0 ]]; then
    LIBRARY_PATH="$HOME/Pictures/Wallpapers"
    if [[ ! -d "$LIBRARY_PATH" ]]; then
      printf 'No config exists at %s and the default library %s is missing.\n' "$CONFIG_PATH" "$LIBRARY_PATH" >&2
      printf 'Create the library folder or pass --library DIR.\n' >&2
      exit 1
    fi
    ARGS+=(--library "$LIBRARY_PATH")
  elif [[ ! -d "$LIBRARY_PATH" ]]; then
    printf 'No config exists at %s and the library folder %s is missing.\n' "$CONFIG_PATH" "$LIBRARY_PATH" >&2
    exit 1
  fi
  printf 'No config found; the sorter will create a starter config at %s.\n' "$CONFIG_PATH"
fi

cargo build --release --manifest-path "$ROOT/Cargo.toml"

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

printf 'Starting sorter; waiting up to 150 seconds for %s\n' "$URL"
"$ROOT/target/release/wallpaper-sorter" "${ARGS[@]}" &
SORTER_PID=$!

for ((attempt = 0; attempt < 300; attempt++)); do
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
