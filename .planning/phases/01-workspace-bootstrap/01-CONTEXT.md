# Phase 1: Workspace Bootstrap — Context

**Phase goal:** Monorepo infrastructure exists so every downstream phase has a working workspace, lint, type-check, test, and CI gate to land into.

**Requirements covered:** HOUSE-01 … HOUSE-08

## Domain

Bootstrapping the repo into a real pnpm workspace with biome, tsc project references, changesets, attw, and a GitHub Actions CI gate. This is the ground Phase 2+ lands on — nothing else can function correctly without it.

## Canonical refs

- `.planning/ROADMAP.md` — Phase 1 success criteria (lines 31–41)
- `.planning/REQUIREMENTS.md` — HOUSE-01 … HOUSE-08
- `.planning/PROJECT.md` — tech stack + constraints (Node/TS/tsup/ws, dependency-light core)
- `.planning/BASELINE-REPORT.md` — ground-truth scan of current repo state
- `.planning/SDK-REFRESH-ROADMAP.md` — 14-phase refresh plan (source of HOUSE scope)
- `~/.claude/CLAUDE.md` — testing integrity rules (no skip-on-missing-data, no mock-to-uselessness)

## Carried-forward decisions

- `@klank/sdk` is the published package name (`packages/sdk/`).
- Core dependency-light; adapters ship as separate packages.
- Every release declares a tested server commit in README `Server Compatibility`.
- Testing integrity: real behavior only. No skipping, no mock-to-uselessness, no force-clicks.
- utoipa → openapi-typescript is the type-generation pipeline (Phase 3 concern, not Phase 1, but CI layout should not make it harder).

## Decisions (locked this session)

### D1. Package rename: git mv, hard cutover
`packages/sdk-typescript/` → `packages/sdk/` in a single `git mv` commit. `@klank/sdk` is the new and only name. No deprecation shim.

**Why:** 0.2.0 is already a hard-break release (current users are broken against the live server per BASELINE — webhooks dead, E2EE sends rejected). A shim would add code to maintain with zero audience benefit. Clean history preserved by git mv.

**How to apply:** Planner should schedule the `git mv` as the first task in the phase so every subsequent edit lands at the new path. Update any internal imports, `tsconfig` references, and `examples/*` paths in the same commit. `packages/create-bot/` stays where it is (already correctly named).

### D2. Node target: Node 20 LTS only
`engines.node: ">=20"` across every package. CI runs on Node 20 only.

**Why:** Node 18 reached EOL April 2025; shipping a 2026-vintage SDK against an EOL runtime is dishonest. Node 20 is the current Active LTS. Single-target keeps the CI matrix one cell wide until there's a real reason to widen it. Overrides PROJECT.md's older "Node 18+" phrasing — update PROJECT.md in this phase.

**How to apply:** Planner must include a task to update PROJECT.md's "Tech stack" line from "Node 18+" to "Node 20+". Pin Node 20 in `.github/workflows/ci.yml` via `actions/setup-node@v4` with `node-version: 20`. Set `engines.node: ">=20"` in the root and every published `package.json`.

### D3. CI gates: strict from day 1
Every PR runs, and must pass, all of: `pnpm build` (tsc -b), `pnpm lint` (biome), `pnpm test`, `attw --pack` on every publishable package, tarball-contents check, and changeset-required (fail if a source change lacks a `.changeset/*.md`). No advisory tier.

**Why:** Repo is tiny today — starting strict is cheap, tightening later is expensive. Matches the "honest SDK" posture of the milestone. Phase 2+ REQs already assume these gates exist; deferring them just moves the pain.

**How to apply:** Planner's CI task must wire all six checks as required. Use official actions where possible (`pnpm/action-setup`, `actions/setup-node@v4`, `changesets/action`). For tarball-contents, snapshot the expected file list per package and diff — fail on any drift. `attw --pack` runs after `pnpm build` against the built tarball, not the source.

## Claude's Discretion

These are implementation details the planner/executor decides without re-asking:

- Exact biome config (which rules beyond `noExplicitAny` / unused imports) — use biome's `recommended` preset plus the two named rules from HOUSE-04.
- `tsconfig.base.json` vs per-package tsconfigs layout — planner picks idiomatic project-references structure.
- pnpm version pin (latest stable v9 at time of planning).
- changesets config defaults (fixed vs independent versioning — recommend independent since adapters will ship separately).
- `LICENSE` content — MIT, copyright holder matches git config user.
- Seed `CHANGELOG.md` with a single "0.1.0 — initial release" entry reconstructed from the existing tag, so changesets has a clean baseline.
- Whether `examples/` gets pulled into the workspace now — recommend YES (as a private workspace package) so examples type-check against the real sdk source.

## Deferred ideas

- **Dual ESM+CJS output via tsup** — not decided this session; deferred to when a concrete consumer complains. ESM-only is fine for Phase 1.
- **Node 22 CI cell** — revisit when Node 22 becomes Active LTS (Oct 2024 → already LTS; revisit at Phase 10/H for docs pass).
- **Publint in CI** — overlaps with attw; reconsider if attw misses a real issue.
- **Release automation via changesets/action publishing** — defer to Phase 2 ship; Phase 1 only needs the changeset-required gate, not the publish pipeline.
- **Sdk-typescript deprecation shim** — explicitly rejected (see D1).

## Open questions for research / planning

- Exact `attw --pack` invocation for a workspace package that isn't yet publishable standalone — researcher should verify the `pnpm pack` + `attw` dance works cleanly under project references.
- Whether `tsc -b` + `tsup` need coordination (tsup emits JS, tsc -b emits `.d.ts` only?) — researcher picks the idiomatic split.
- GitHub Actions caching strategy for pnpm store under project references (standard `pnpm/action-setup` recipe should suffice).

## Next step

Run `/gsd-plan-phase 1` to research and generate `PLAN.md` for this phase. Researcher should focus on:
1. Canonical `pnpm` + `tsc -b` + `tsup` project-references recipe for a library monorepo.
2. `attw` + tarball-contents CI pattern that actually catches export-map regressions.
3. changesets config for independent versioning across `@klank/sdk`, `@klank/sdk-redis` (future), `create-klank-bot` (future).
