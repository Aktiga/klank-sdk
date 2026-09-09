#!/usr/bin/env bash
# Refresh packages/sdk/fixtures/wire/server-events.json from the Klank server repo,
# where a `cargo test` serializes one sample per wire event. Run it when
# test/wire-fixtures.test.ts reports drift, then reconcile src/types.ts with the
# new fixture.
#
#   bash scripts/sync-wire-fixtures.sh            # from main
#   bash scripts/sync-wire-fixtures.sh feat/x     # from a branch, tag or SHA
#
# Needs `gh` authenticated against a token with read access to Aktiga/klank.
set -euo pipefail

ref="${1:-main}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="$repo_root/packages/sdk/fixtures/wire/server-events.json"

gh api "repos/Aktiga/klank/contents/fixtures/wire/server-events.json?ref=${ref}" \
  -H "Accept: application/vnd.github.raw" >"$dest"

echo "synced $dest from Aktiga/klank@${ref}"
