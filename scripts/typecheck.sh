#!/bin/sh
# Typecheck the app. When many processes typecheck at once (e.g. parallel agents),
# at most two run concurrently (each tsc can use ~1GB); the rest wait their turn.
set -e
cd "$(dirname "$0")/.."
run() { exec npx tsc --noEmit -p tsconfig.app.json --singleThreaded "$@"; }
for slot in 1 2; do
  exec 9>"/tmp/atrium-typecheck-$slot.lock"
  if flock -n 9; then run "$@"; fi
done
exec 9>/tmp/atrium-typecheck-1.lock
flock 9
run "$@"
