---
phase: 01-workspace-bootstrap
plan: 02
subsystem: build
tags: [rename, tsc, tsup, vitest, esm]
requires: [01-01]
provides:
  - "@klank/sdk package at packages/sdk"
  - "tsc -b + tsup build pipeline (split: tsc owns .d.ts, tsup owns .js)"
  - "Nyquist smoke test importing built dist"
affects: [packages/sdk, tsconfig.json]
tech_stack:
  added: []
  patterns: [project-references, tsc-tsup-split, nyquist-smoke-test]
key_files:
  created:
    - packages/sdk/tsconfig.build.json
    - packages/sdk/tsup.config.ts
    - packages/sdk/CHANGELOG.md
    - packages/sdk/.tarball-snapshot.txt
    - packages/sdk/vitest.config.ts
    - packages/sdk/test/smoke.test.ts
  modified:
    - packages/sdk/package.json
    - packages/sdk/tsconfig.json
    - packages/sdk/src/bot.ts
    - packages/sdk/src/client.ts
    - packages/sdk/src/webhook.ts
    - tsconfig.json
decisions:
  - "Root tsconfig references packages/sdk/tsconfig.build.json (not tsconfig.json) so tsc -b emits declarations during workspace build"
  - "Strict TS errors auto-fixed under tsconfig.base.json (noUncheckedIndexedAccess, unknown error narrowing)"
  - "attw resolution errors deferred to plan 01-04 (needs .js import extensions or NodeNext rework)"
metrics:
  duration: ~10m
  completed: 2026-04-07
---

# Phase 01 Plan 02: Workspace Bootstrap — Wave 2 (Rename + Build) Summary

Hard-cutover renamed `packages/sdk-typescript` → `packages/sdk` and wired the
`tsc -b` + `tsup` split so `@klank/sdk` produces buildable, type-checked,
smoke-tested ESM output under the Wave 1 monorepo.

## What Was Built

- **Task 1 (commit `222c799`):** `git mv` rename. No deprecation shim.
  Examples already imported from `@klank/sdk` so no rewrites were required.
  `pnpm install` re-linked the workspace.
- **Task 2 (commit `1e18c72`):** Replaced `packages/sdk/package.json` with
  ESM-only definition (`type: module`, `engines.node>=20`, dist exports
  pointing at `./dist/index.js` and `./dist/index.d.ts`). Added
  `tsconfig.build.json` (declaration-only emit, composite) and rewrote
  `tsconfig.json` (noEmit type-check). Added `tsup.config.ts` with
  `dts: false, clean: false` so tsup never deletes the `.d.ts` files
  emitted by tsc. Seeded `CHANGELOG.md` with the 0.1.0 baseline entry.
  Generated and committed `.tarball-snapshot.txt`. Updated root
  `tsconfig.json` to reference `./packages/sdk/tsconfig.build.json` so
  workspace `tsc -b` actually emits declarations.
- **Task 3 (commit `4352038`):** `vitest.config.ts` (node env) and
  `test/smoke.test.ts` importing from `@klank/sdk` (the package name, not
  a relative path) and asserting `KlankBot`, `KlankClient`, `WebhookBot`
  are constructors. 3/3 tests pass against built dist.

## Verification Results

- `pnpm install` — exits 0
- `pnpm -w build` — exits 0; emits both `dist/index.d.ts` and `dist/index.js`
- `pnpm --filter @klank/sdk test` — 3/3 smoke tests pass
- `test -f packages/sdk/dist/index.d.ts` — yes
- `test -f packages/sdk/dist/index.js` — yes
- `test -f packages/sdk/.tarball-snapshot.txt` — yes
- `! test -d packages/sdk-typescript` — yes
- `pnpm --filter @klank/sdk exec attw --pack .` — **fails** (see Deferred Issues)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Strict TypeScript errors in pre-existing source**
- **Found during:** Task 2, first `pnpm -w build`
- **Issue:** `tsconfig.base.json` (from plan 01-01) enables `strict`,
  `noUncheckedIndexedAccess`, and treats `unknown` errors strictly. The
  legacy `packages/sdk/src/{bot,client,webhook}.ts` had 4 type errors:
  - `bot.ts:112` — `this.middlewares[middlewareIndex++]` could be undefined.
  - `client.ts:38,41` — `err` was `unknown`; `body ? JSON.parse(body) : undefined`
    didn't satisfy generic `T`.
  - `webhook.ts:28` — same `err: unknown` issue.
- **Fix:** Added an `if (mw)` guard in `bot.ts`, narrowed `err` to
  `{ message?: string }` in both `client.ts` and `webhook.ts`, and added
  an `as T` on the empty-body branch in `client.ts`.
- **Files modified:** `packages/sdk/src/bot.ts`, `packages/sdk/src/client.ts`,
  `packages/sdk/src/webhook.ts`
- **Commit:** `1e18c72`

**2. [Rule 3 - Blocker] Root tsconfig referenced wrong project file**
- **Found during:** Task 2, `dist/` had `.js` but no `.d.ts`
- **Issue:** Plan 01-01 wrote root `tsconfig.json` with
  `{ "path": "./packages/sdk" }`, which resolves to `tsconfig.json`
  (noEmit). The workspace `tsc -b` therefore never emitted declarations.
- **Fix:** Changed root reference to
  `{ "path": "./packages/sdk/tsconfig.build.json" }`.
- **Files modified:** `tsconfig.json`
- **Commit:** `1e18c72`

## Deferred Issues

**attw resolution errors (deferred to plan 01-04)**
- `attw --pack .` reports "Internal resolution error" under node16
  (from CJS) and node16 (from ESM) channels.
- Root cause: source files use extension-less relative imports
  (e.g. `from './client'`). Under NodeNext/Node16 module resolution
  for ESM packages, `.d.ts` files must use explicit `.js` extensions.
  `tsc -b` emits the declarations as written, so the dist `.d.ts`
  files inherit the missing extensions.
- Why deferred: the plan explicitly notes "attw runs here as an early
  sanity check; full CI wiring lands in plan 01-04." Touching every
  source import is out of scope for the rename/build wiring plan.
- Next step (plan 01-04): either (a) add `.js` extensions to all
  relative source imports, or (b) post-process declarations, or
  (c) configure `moduleResolution` differently.

## Known Stubs

None.

## Self-Check: PASSED

- packages/sdk/package.json — FOUND
- packages/sdk/tsconfig.build.json — FOUND
- packages/sdk/tsup.config.ts — FOUND
- packages/sdk/CHANGELOG.md — FOUND
- packages/sdk/vitest.config.ts — FOUND
- packages/sdk/test/smoke.test.ts — FOUND
- packages/sdk/.tarball-snapshot.txt — FOUND
- packages/sdk/dist/index.d.ts — FOUND
- packages/sdk/dist/index.js — FOUND
- commit 222c799 — FOUND
- commit 1e18c72 — FOUND
- commit 4352038 — FOUND
