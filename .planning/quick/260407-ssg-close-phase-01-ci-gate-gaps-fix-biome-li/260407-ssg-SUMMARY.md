---
phase: quick/260407-ssg
plan: 01
title: Close Phase 01 CI gate gaps
completed: 2026-04-07
status: complete
requirements: [HOUSE-04, HOUSE-06, HOUSE-07]
commits:
  - a902b4c: fix(quick-260407-ssg-01) clear biome lint errors across workspace
  - 6831dbe: fix(quick-260407-ssg-01) add .js extensions for NodeNext attw compatibility
  - 0221c9a: fix(quick-260407-ssg-01) move tsBuildInfoFile out of dist/
key-files:
  modified:
    - packages/sdk/src/bot.ts
    - packages/sdk/src/client.ts
    - packages/sdk/src/index.ts
    - packages/sdk/src/types.ts (no change needed)
    - packages/sdk/src/webhook.ts
    - packages/sdk/src/ws.ts
    - packages/sdk/tsconfig.json
    - packages/sdk/package.json
    - examples/ci-bot-ts/index.ts
    - examples/echo-bot-ts/index.ts
    - examples/webhook-bot/index.ts
    - biome.json (formatter)
    - examples/*/tsconfig.json (formatter)
    - packages/sdk/test/smoke.test.ts (import order)
  created:
    - packages/sdk/.attw.json
---

# Quick Task 260407-ssg: Close Phase 01 CI Gate Gaps Summary

One-liner: Lint, attw, and tarball CI gates are now green on a clean checkout — Phase 02 can land PRs through the workflow.

## What was done

### Task 1 — Biome lint errors (commit a902b4c)
- Ran `pnpm -w lint:fix` to auto-resolve formatting drift across 12 files (biome.json, package.json, tsconfigs, smoke.test.ts).
- Replaced `(event as any)` casts in `bot.ts buildContext` with narrowed structural type assertions (`{ channel_id: string }`, `{ message_id: string }`).
- Removed an unused template literal in `bot.ts` (`console.log(\`[bot] Connected\`)` → plain string).
- Replaced 6 non-null assertions in `examples/{ci-bot-ts,echo-bot-ts,webhook-bot}/index.ts` with explicit `if (!x) throw new Error('… is required')` env-var guards. No `// biome-ignore` was used.
- Final `pnpm -w lint`: exit 0, 31 files checked.

### Task 2 — NodeNext-compatible imports (commit 6831dbe)
- Appended explicit `.js` suffix to every relative import/export in `packages/sdk/src/*.ts` so emitted `.d.ts` is NodeNext-resolvable.
- `attw --pack .` against the freshly built tarball reported zero `InternalResolutionError`.
- The package is `"type": "module"` (ESM-only), so the residual `CJSResolvesToESM` warning under node16-from-CJS is not an error for this package shape. Added `packages/sdk/.attw.json` with `"profile": "esm-only"` so the unflagged CI command (`pnpm --filter @klank/sdk exec attw --pack .`) exits 0 without ignoring real findings.

### Task 3 — Tarball pollution (commit 0221c9a)
- Edited `packages/sdk/tsconfig.json`: `tsBuildInfoFile` moved from `dist/.tsbuildinfo-check` → `node_modules/.cache/tsc/.tsbuildinfo-check` (outside the publishable tree, gitignored by node_modules).
- Clean rebuild verified `dist/` no longer contains the noEmit type-check buildinfo.
- Repacked the tarball; the existing committed `.tarball-snapshot.txt` already matched the new contents (no `.tsbuildinfo-check` line). `pnpm --filter @klank/sdk run tarball:check` exits 0.

## Final gate sweep

```
pnpm -w lint                                                  → exit 0
pnpm -w build && pnpm -C packages/sdk exec attw --pack .      → exit 0
pnpm --filter @klank/sdk run tarball:check                    → exit 0
```

All three previously-red CI gates from `phases/01-workspace-bootstrap/VERIFICATION.md` are now green.

## Deviations from Plan

### [Rule 3 — Blocking] Lint also failed in examples/, not just packages/sdk/src/
- **Found during:** Task 1 (after `lint:fix`)
- **Issue:** The plan listed only `packages/sdk/src/*.ts` as files-to-modify, but `pnpm -w lint` also failed on 6 non-null-assertion errors in `examples/{ci-bot-ts,echo-bot-ts,webhook-bot}/index.ts`. The success criterion requires `pnpm -w lint` to exit 0, which spans the whole workspace.
- **Fix:** Replaced env-var non-null assertions with explicit `if (!x) throw new Error(...)` guards in all three example bots. Same approach the plan prescribed for `packages/sdk/src/`.
- **Files modified:** examples/ci-bot-ts/index.ts, examples/echo-bot-ts/index.ts, examples/webhook-bot/index.ts
- **Commit:** a902b4c

### [Rule 2 — Critical] attw still exits 1 on ESM-only packages without profile config
- **Found during:** Task 2
- **Issue:** After adding `.js` extensions, `InternalResolutionError` was gone, but attw still exits 1 because the package is `"type": "module"` and attw's default `strict` profile reports `CJSResolvesToESM` as a hard finding for `node16-from-CJS`. This is expected for ESM-only packages — there is no way to publish an ESM-only package and pass the strict profile without dual-publishing CJS, which the project explicitly does not want (Node ≥20, ESM-only by design per HOUSE-08 / package.json `"type": "module"`).
- **Fix:** Added `packages/sdk/.attw.json` with `{"profile": "esm-only"}`. This is the standard attw mechanism for ESM-only packages: it ignores `node10` and `node16-cjs` resolutions, which are not applicable shapes for this package. Real findings (InternalResolutionError, missing exports, etc.) are still surfaced.
- **Files modified:** packages/sdk/.attw.json (created), packages/sdk/package.json
- **Commit:** 6831dbe

### [Note] Tarball snapshot was already correct
- The committed `.tarball-snapshot.txt` already excluded `.tsbuildinfo-check` — VERIFICATION.md was correct that the snapshot was "stale" relative to what `pnpm pack` was producing, not relative to the desired state. Once Task 3 stopped writing the file into `dist/`, the actual tarball matched the snapshot without needing to regenerate it. Verified by running `tarball:check` post-fix and getting exit 0 with no diff.

## Self-Check: PASSED

Files exist:
- packages/sdk/.attw.json — FOUND
- packages/sdk/tsconfig.json (modified) — FOUND
- packages/sdk/src/index.ts (with .js imports) — FOUND

Commits exist:
- a902b4c — FOUND
- 6831dbe — FOUND
- 0221c9a — FOUND
