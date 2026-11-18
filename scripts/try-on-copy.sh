#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  printf 'Usage: %s LIBRARY [CONFIG [PORT]]\n' "$0"
  printf 'CONFIG defaults to the user config, or the starter tags if no user config exists.\n'
  printf 'PORT defaults to 8422.\n'
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi
if [[ $# -lt 1 || $# -gt 3 ]]; then
  usage >&2
  exit 2
fi

LIBRARY="$(realpath -e -- "$1")"
if [[ ! -d "$LIBRARY" ]]; then
  printf 'Not a library directory: %s\n' "$LIBRARY" >&2
  exit 2
fi
if [[ "$LIBRARY" == "/" ]]; then
  printf 'Refusing to copy the filesystem root.\n' >&2
  exit 2
fi

if [[ -n "${2:-}" ]]; then
  CONFIG_SOURCE=$2
  if [[ ! -f "$CONFIG_SOURCE" ]]; then
    printf 'Config file not found: %s\n' "$CONFIG_SOURCE" >&2
    exit 2
  fi
  CONFIG_SOURCE="$(realpath -e -- "$CONFIG_SOURCE")"
else
  USER_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/wallpaper-sorter/config.toml"
  if [[ -f "$USER_CONFIG" ]]; then
    CONFIG_SOURCE="$(realpath -e -- "$USER_CONFIG")"
  else
    CONFIG_SOURCE="$ROOT/spec/tags.starter.toml"
  fi
fi

PORT="${3:-8422}"
if [[ ! "$PORT" =~ ^[0-9]{1,5}$ ]]; then
  printf 'Invalid port: %s\n' "$PORT" >&2
  exit 2
fi
PORT_NUMBER=$((10#$PORT))
if ((PORT_NUMBER < 1 || PORT_NUMBER > 65535)); then
  printf 'Port must be between 1 and 65535: %s\n' "$PORT" >&2
  exit 2
fi

BIN="${SORTER_BIN:-$ROOT/target/debug/wallpaper-sorter}"
if [[ ! -x "$BIN" ]]; then
  if [[ -n "${SORTER_BIN:-}" ]]; then
    printf 'Sorter binary is not executable: %s\n' "$BIN" >&2
    exit 1
  fi
  cargo build --manifest-path "$ROOT/Cargo.toml"
fi

LIBRARY_PARENT="$(dirname -- "$LIBRARY")"
LIBRARY_NAME="$(basename -- "$LIBRARY")"
WORK_DIR="$(mktemp -d "$LIBRARY_PARENT/.${LIBRARY_NAME}.try.XXXXXX")"
COPY_DIR="$WORK_DIR/library"
TEMP_CONFIG="$WORK_DIR/config.toml"
trap 'rm -rf -- "$WORK_DIR"' EXIT
mkdir -- "$COPY_DIR"

copy_entries() {
  local mode=$1
  local entry
  while IFS= read -r -d '' entry; do
    [[ "${entry##*/}" == ".sorter" ]] && continue
    if [[ "$mode" == "links" ]]; then
      cp -al -- "$entry" "$COPY_DIR/" || return 1
    else
      cp -a -- "$entry" "$COPY_DIR/" || return 1
    fi
  done < <(find "$LIBRARY" -mindepth 1 -maxdepth 1 -print0)
}

if copy_entries links; then
  COPY_MODE='hard-linked files'
else
  rm -rf -- "$COPY_DIR"
  mkdir -- "$COPY_DIR"
  if ! copy_entries copy; then
    printf 'Could not copy library: %s\n' "$LIBRARY" >&2
    exit 1
  fi
  COPY_MODE='full copy'
fi

toml_escape() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  printf '%s' "$value"
}

export WS_TRY_COPY="$(toml_escape "$COPY_DIR")"
export WS_TRY_WORK="$(toml_escape "$WORK_DIR")"
INTAKE_COUNT="$(awk '/^[[:space:]]*\[\[intake\]\][[:space:]]*(#.*)?$/ { count++ } END { print count + 0 }' "$CONFIG_SOURCE")"
for ((i = 1; i <= INTAKE_COUNT; i++)); do
  mkdir -- "$WORK_DIR/intake-$i"
done

awk '
  BEGIN { section = "root"; intake = 0; rewritten = 0 }
  /^[[:space:]]*\[\[intake\]\][[:space:]]*(#.*)?$/ {
    section = "intake"
    intake++
    print
    next
  }
  /^[[:space:]]*\[/ { section = "other" }
  section == "root" && /^[[:space:]]*library[[:space:]]*=/ {
    printf "library = \"%s\"\n", ENVIRON["WS_TRY_COPY"]
    next
  }
  section == "intake" && /^[[:space:]]*path[[:space:]]*=/ {
    printf "path = \"%s/intake-%d\"\n", ENVIRON["WS_TRY_WORK"], intake
    rewritten++
    next
  }
  { print }
  END {
    if (rewritten != intake) {
      printf "Expected one path in each intake table; found %d intake tables and %d paths.\n", intake, rewritten > "/dev/stderr"
      exit 1
    }
  }
' "$CONFIG_SOURCE" > "$TEMP_CONFIG"

export XDG_CACHE_HOME="$WORK_DIR/cache"
printf 'Test copy: %s (%s)\n' "$COPY_DIR" "$COPY_MODE"
printf 'Temporary config: %s\n' "$TEMP_CONFIG"
printf 'Web page: http://127.0.0.1:%s/\n' "$PORT_NUMBER"
printf 'Press Ctrl+C to stop and remove the temporary copy.\n'
printf 'With hard-linked files, do not edit image contents through the test copy.\n'
"$BIN" --config "$TEMP_CONFIG" --library "$COPY_DIR" --port "$PORT_NUMBER"