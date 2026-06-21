#!/usr/bin/env bash
#
# Stage freshly-built program .so files into the root target/deploy directory.
#
# WHY: the in-process litesvm test suites load binaries via
#   svm.addProgramFromFile("target/deploy/<p>.so")
# but Anchor 1.0 / `cargo build-sbf` emit each program under
#   programs/<p>/target/deploy/<p>.so
# When the root copy lags (different build, never copied), the tests silently run
# against a STALE binary — account-count / guard / CU mismatches that look like test
# bugs. This script copies the per-program binaries into root target/deploy so the
# suites always load what was last built. The same staging runs in CI (anchor-tests.yml).
#
# Usage:
#   scripts/stage-programs.sh            # copy programs/*/target/deploy/*.so -> target/deploy
#   scripts/stage-programs.sh --build    # cargo build-sbf every program first, then copy
#   scripts/stage-programs.sh --check    # exit 1 if any root .so is older than its program build
#
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-stage}"

if [[ "$mode" == "--build" ]]; then
  for d in programs/*/; do
    [ -f "${d}Cargo.toml" ] || continue
    echo "building ${d%/} ..."
    ( cd "$d" && cargo build-sbf )
  done
  mode="stage"
fi

shopt -s nullglob

if [[ "$mode" == "--check" ]]; then
  stale=0
  for so in programs/*/target/deploy/*.so; do
    root="target/deploy/$(basename "$so")"
    if [[ ! -f "$root" || "$so" -nt "$root" ]]; then
      echo "STALE: $root is missing or older than $so"
      stale=1
    fi
  done
  if [[ "$stale" -ne 0 ]]; then
    echo "Run: scripts/stage-programs.sh   (or: npm run stage:programs)" >&2
    exit 1
  fi
  echo "target/deploy is up to date with the per-program builds"
  exit 0
fi

# default: stage — copy only when the per-program binary is newer than the root copy
# (or root is missing), so a fresher root build is never regressed to a staler one.
mkdir -p target/deploy
n=0
for so in programs/*/target/deploy/*.so; do
  root="target/deploy/$(basename "$so")"
  if [[ ! -f "$root" || "$so" -nt "$root" ]]; then
    cp -f "$so" target/deploy/
    n=$((n + 1))
  fi
done
echo "staged $n updated program binaries into target/deploy"
