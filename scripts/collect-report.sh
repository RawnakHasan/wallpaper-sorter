#!/usr/bin/env bash
# Runs every test suite and writes one report file in a fixed format.
#
#   scripts/collect-report.sh [report-file]        (default: test-report.txt in the project folder)
#
# Needs cargo. Node and npm are optional (without them the UI checks are skipped).
# The first run builds everything, which takes a few minutes on a small machine.
# Full logs are saved next to the report (build, Rust, npm, typecheck, Vitest, and integration logs).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
OUT="${1:-$ROOT/test-report.txt}"
TMP="$(mktemp -d)"
have() { command -v "$1" >/dev/null 2>&1; }
say() { printf '%s\n' "$*" >&2; }
fence() { printf '\n```\n'; cat; printf '```\n'; }

UI_DEPS_RC=0
if have node && have npm; then
  say "1/6 checking the UI dependencies..."
  (
    cd ui || exit 1
    { [ -x node_modules/.bin/vite ] && [ -x node_modules/.bin/tsc ] && [ -x node_modules/.bin/vitest ] || npm ci --silent; }
  ) >"$TMP/npm.log" 2>&1
  UI_DEPS_RC=$?
fi

say "2/6 building (the first build takes a few minutes)..."
cargo build --all-targets >"$TMP/build.log" 2>&1
BUILD_RC=$?
WARNINGS=$(grep -c '^warning' "$TMP/build.log" || true)

CARGO_RC=-1
RUST_PASS=0
RUST_FAIL=0
RUST_IGN=0
if [ "$BUILD_RC" -eq 0 ]; then
  say "3/6 running the Rust tests..."
  cargo test --workspace --no-fail-fast >"$TMP/cargo.log" 2>&1
  CARGO_RC=$?
  read -r RUST_PASS RUST_FAIL RUST_IGN < <(awk '/^test result:/{p+=$4; f+=$6; i+=$8} END{print p+0, f+0, i+0}' "$TMP/cargo.log")
fi

TYPECHECK_STATE="not run"
TYPECHECK_RC=-1
VITEST_PASS=0
VITEST_FAIL=0
VITEST_STATE="not run"
VITEST_RC=-1
UI_PASS=0
UI_FAIL=0
if [ "$BUILD_RC" -ne 0 ]; then
  TYPECHECK_STATE="skipped (the build failed)"
  VITEST_STATE="skipped (the build failed)"
  UI_STATE="skipped (the build failed)"
elif [ "$UI_DEPS_RC" -ne 0 ]; then
  TYPECHECK_STATE="skipped (npm dependency install failed)"
  VITEST_STATE="skipped (npm dependency install failed)"
  UI_STATE="skipped (npm dependency install failed)"
elif have node && have npm; then
  say "4/6 running the TypeScript check..."
  ( cd ui && npm run typecheck ) >"$TMP/typecheck.log" 2>&1
  TYPECHECK_RC=$?
  TYPECHECK_STATE="$([ "$TYPECHECK_RC" -eq 0 ] && echo passed || echo "FAILED, exit code $TYPECHECK_RC")"

  say "5/6 running Vitest..."
  ( cd ui && npm test ) >"$TMP/vitest.log" 2>&1
  VITEST_RC=$?
  read -r VITEST_PASS VITEST_FAIL < <(awk '
    /^[[:space:]]*Tests / {
      for (i = 1; i <= NF; i++) {
        if ($i == "passed") p = $(i - 1)
        if ($i == "failed") f = $(i - 1)
      }
    }
    END { print p + 0, f + 0 }
  ' "$TMP/vitest.log")
  VITEST_STATE="$([ "$VITEST_RC" -eq 0 ] && echo passed || echo "FAILED, exit code $VITEST_RC")"

  say "6/6 running the real-binary UI integrations..."
  ( cd ui/test && SORTER_BIN="$ROOT/target/debug/wallpaper-sorter" node --test --test-reporter=tap ) >"$TMP/ui.log" 2>&1
  UI_RC=$?
  UI_PASS=$(grep -c '^ok ' "$TMP/ui.log" || true)
  UI_FAIL=$(grep -c '^not ok ' "$TMP/ui.log" || true)
  UI_STATE="ran, exit code $UI_RC"
else
  TYPECHECK_STATE="skipped (node or npm is not installed)"
  VITEST_STATE="skipped (node or npm is not installed)"
  UI_STATE="skipped (node or npm is not installed)"
fi

{
  echo "# Wallpaper Sorter: test report"
  echo
  echo "| | |"
  echo "|---|---|"
  echo "| Date | $(date -u '+%Y-%m-%d %H:%M UTC') |"
  echo "| System | $(uname -srm) |"
  echo "| rustc | $(rustc --version 2>&1) |"
  echo "| cargo | $(cargo --version 2>&1) |"
  echo "| node | $(have node && node --version || echo 'not installed') |"
  if have git && git rev-parse --short HEAD >/dev/null 2>&1; then
    echo "| git | $(git rev-parse --short HEAD), $(git status --porcelain | wc -l | tr -d ' ') changed files |"
  fi
  echo
  echo "## Summary"
  echo
  echo "| Suite | Result |"
  echo "|---|---|"
  echo "| Build | $([ "$BUILD_RC" -eq 0 ] && echo ok || echo FAILED), $WARNINGS warnings |"
  echo "| Rust tests | $RUST_PASS passed, $RUST_FAIL failed, $RUST_IGN ignored |"
  echo "| UI typecheck | $TYPECHECK_STATE |"
  echo "| Vitest | $VITEST_PASS passed, $VITEST_FAIL failed ($VITEST_STATE) |"
  echo "| UI integrations | $UI_PASS passed, $UI_FAIL failed ($UI_STATE) |"

  if [ "$BUILD_RC" -ne 0 ]; then
    echo
    echo "## Build errors"
    grep -E -A14 '^error' "$TMP/build.log" | head -n 120 | fence
  fi
  if [ "$WARNINGS" -gt 0 ]; then
    echo
    echo "## Build warnings"
    grep -E -A8 '^warning' "$TMP/build.log" | head -n 80 | fence
  fi

  if [ -f "$TMP/cargo.log" ]; then
    echo
    echo "## Rust tests, per test binary"
    grep -E '^ +Running |^test result:|Doc-tests' "$TMP/cargo.log" | fence
    if [ "$RUST_FAIL" -gt 0 ] || { [ "$CARGO_RC" -gt 0 ] && [ "$RUST_PASS" -eq 0 ]; }; then
      echo
      echo "## Failing Rust tests"
      grep -E '^test .* FAILED$' "$TMP/cargo.log" | fence
      echo
      echo "### Their output"
      awk '/^failures:$/{p=1} p' "$TMP/cargo.log" | head -n 400 | fence
      if [ "$RUST_PASS" -eq 0 ]; then
        echo
        echo "### The end of the cargo output (no test results could be read)"
        tail -n 60 "$TMP/cargo.log" | fence
      fi
    fi
  fi

  if [ -f "$TMP/typecheck.log" ] && [ "$TYPECHECK_RC" -ne 0 ]; then
    echo
    echo "## UI typecheck errors"
    tail -n 120 "$TMP/typecheck.log" | fence
  fi

  if [ -f "$TMP/vitest.log" ]; then
    echo
    echo "## Vitest"
    grep -E '^[[:space:]]*Test Files|^[[:space:]]*Tests |^[[:space:]]*Duration ' "$TMP/vitest.log" | fence
    if [ "$VITEST_FAIL" -gt 0 ] || { [ "$VITEST_RC" -gt 0 ] && [ "$VITEST_PASS" -eq 0 ]; }; then
      echo
      echo "### Vitest failure details"
      tail -n 160 "$TMP/vitest.log" | fence
    fi
  fi

  if [ -f "$TMP/ui.log" ]; then
    echo
    echo "## UI tests"
    grep -E '^(not )?ok ' "$TMP/ui.log" | fence
    if [ "$UI_FAIL" -gt 0 ]; then
      echo
      echo "### Failing UI tests"
      awk '/^not ok/{p=1; print; next} /^ok /{p=0} p' "$TMP/ui.log" | head -n 400 | fence
    fi
    if [ $((UI_PASS + UI_FAIL)) -eq 0 ]; then
      echo
      echo "### The end of the UI test output (no results could be read)"
      tail -n 60 "$TMP/ui.log" | fence
    fi
  fi

  echo
  echo "## Notes (fill in by hand)"
  echo
  echo "- What I ran or changed before this report:"
  echo "- What I saw in the browser (pages tried, anything odd, browser console text):"
  echo "- Anything else:"
} >"$OUT"

BASE="${OUT%.*}"
cp "$TMP/build.log" "$BASE.build.log" 2>/dev/null
[ -f "$TMP/cargo.log" ] && cp "$TMP/cargo.log" "$BASE.cargo.log"
[ -f "$TMP/npm.log" ] && cp "$TMP/npm.log" "$BASE.npm.log"
[ -f "$TMP/typecheck.log" ] && cp "$TMP/typecheck.log" "$BASE.typecheck.log"
[ -f "$TMP/vitest.log" ] && cp "$TMP/vitest.log" "$BASE.vitest.log"
[ -f "$TMP/ui.log" ] && cp "$TMP/ui.log" "$BASE.ui.log"
rm -rf "$TMP"
say "Report written to $OUT"
