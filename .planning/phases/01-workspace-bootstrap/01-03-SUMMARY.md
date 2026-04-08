---
phase: 01-workspace-bootstrap
plan: 03
subsystem: workspace
tags: [workspace, tsconfig, examples, create-bot]
requires: [01-01, 01-02]
provides: [full-project-reference-graph, examples-as-workspace-members, create-bot-skeleton]
affects: [tsconfig.json, .planning/PROJECT.md]
tech-stack:
  added: ["@types/node ^20"]
  patterns: ["pnpm workspace examples", "tsc -b composite references via tsconfig.build.json"]
key-files:
  created:
    - examples/echo-bot-ts/package.json
    - examples/echo-bot-ts/tsconfig.json
    - examples/ci-bot-ts/package.json
    - examples/ci-bot-ts/tsconfig.json
    - examples/webhook-bot/package.json
    - examples/webhook-bot/tsconfig.json
    - packages/create-bot/package.json
    - packages/create-bot/tsconfig.json
    - packages/create-bot/src/index.ts
  modified:
    - tsconfig.json
    - examples/echo-bot-ts/index.ts
    - .planning/PROJECT.md
    - pnpm-lock.yaml
decisions:
  - "Examples reference packages/sdk/tsconfig.build.json (composite emit project), not tsconfig.json (noEmit) — composite refs require an emitting target."
  - "Examples gain @types/node devDep so they can use process/console under tsc strict mode."
metrics:
  duration: "~10m"
  completed: "2026-04-07"
---

# Phase 01 Plan 03: Examples + create-bot Workspace Registration Summary

Registered the three TypeScript examples and `packages/create-bot` as first-class private workspace packages with `@klank/sdk: workspace:*` and `tsc -b` project references, then declared Node 20 as the supported runtime in PROJECT.md.

## What Shipped

- **TS examples (echo-bot-ts, ci-bot-ts, webhook-bot)** — each is now a private `@klank-examples/*` package with `engines.node>=20`, `type=module`, `@klank/sdk: workspace:*`, `@types/node`, and a `tsconfig.json` referencing `packages/sdk/tsconfig.build.json`.
- **`packages/create-bot`** — new private skeleton package with placeholder `src/index.ts` (`// Placeholder — full scaffolder lands in Phase 9 (PG-04).`) and `tsc -b` typecheck script.
- **Root `tsconfig.json`** — solution file now references all five TS projects: `packages/sdk/tsconfig.build.json`, `packages/create-bot`, and the three examples.
- **`PROJECT.md`** — Constraints line updated from `Node 18+` to `Node 20+` (D2).
- **Rust example** — `examples/echo-bot-rust` left untouched and excluded from the pnpm workspace (per `pnpm-workspace.yaml`).

## Verification

- `pnpm install` — clean, 6 workspace projects.
- `pnpm -w build` — `tsc -b` walks all five references with zero errors; `tsup` emits sdk dist.
- `pnpm --filter @klank/sdk test` — 3/3 smoke tests pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Project references must point at emit-enabled tsconfig**
- **Found during:** Task 2 build verification.
- **Issue:** Plan said references should be `packages/sdk` (the noEmit `tsconfig.json`). TS6310: "Referenced project may not disable emit." Composite project references require the target to emit declarations.
- **Fix:** Examples and root solution now reference `packages/sdk/tsconfig.build.json` (the existing composite emit config from plan 01-01).
- **Files modified:** `tsconfig.json`, `examples/*/tsconfig.json`
- **Commit:** `46dd9b2`

**2. [Rule 2 - Missing critical dep] Examples lacked @types/node**
- **Found during:** Task 2 build.
- **Issue:** Once examples were type-checked, every reference to `process` and `console` failed (TS2580/TS2584). The plan's example `package.json` template only listed `typescript`.
- **Fix:** Added `@types/node ^20.0.0` to each example's devDependencies.
- **Commit:** `46dd9b2`

**3. [Rule 1 - Bug] echo-bot-ts accessed `plaintext` on a union type without narrowing**
- **Found during:** Task 2 build.
- **Issue:** `bot.on('message', ...)` is typed as `EventHandler<ServerEvent>`, not narrowed to `MessageEvent`. `event.plaintext` only exists on `MessageEvent` (event type `'message.new'`). Pre-existing latent bug only surfaced once examples started type-checking.
- **Fix:** Narrow on `event.type === 'message.new'` before accessing `plaintext`.
- **Files modified:** `examples/echo-bot-ts/index.ts`
- **Commit:** `46dd9b2`

## Commits

- `5a761b3` feat(01-03): register TS examples as private workspace packages
- `46dd9b2` feat(01-03): add create-bot package, full project-reference graph, Node 20
- `80658b6` docs(01-03): PROJECT.md tech stack to Node 20+

## Self-Check: PASSED

- examples/{echo-bot-ts,ci-bot-ts,webhook-bot}/{package,tsconfig}.json — present
- packages/create-bot/{package.json,tsconfig.json,src/index.ts} — present
- tsconfig.json references all 5 TS projects — verified
- examples/echo-bot-rust/package.json — does not exist
- `Node 18` no longer in PROJECT.md — verified
- `pnpm -w build` exits 0 — verified
- `pnpm --filter @klank/sdk test` exits 0 — verified
- Commits 5a761b3, 46dd9b2, 80658b6 — present in `git log`
