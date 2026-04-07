---
phase: 1
slug: workspace-bootstrap
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-07
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (to be installed in Wave 0) |
| **Config file** | `packages/sdk/vitest.config.ts` (Wave 0 creates) |
| **Quick run command** | `pnpm -w test` |
| **Full suite command** | `pnpm -w build && pnpm -w lint && pnpm -w test && pnpm -w attw && pnpm -w tarball` |
| **Estimated runtime** | ~60 seconds (cold), ~15s (warm) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm -w build` (type-check gate) — catches tsconfig/project-reference breakage immediately
- **After every plan wave:** Run the full suite command above
- **Before `/gsd-verify-work`:** Full suite + CI green on a pushed branch
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Phase 1 is pure infrastructure. Requirement-to-task mapping is delegated to PLAN.md frontmatter. Each HOUSE requirement has at least one automated check:

| Requirement | Automated Command | Proves |
|-------------|-------------------|--------|
| HOUSE-01 | `test -f pnpm-workspace.yaml && test -f pnpm-lock.yaml && pnpm install --frozen-lockfile` | pnpm workspace resolves with committed lockfile |
| HOUSE-02 | `test -d packages/sdk && ! test -d packages/sdk-typescript && grep -q '"name": "@klank/sdk"' packages/sdk/package.json` | Rename executed, new name wired |
| HOUSE-03 | `pnpm -w build` (wraps `tsc -b`) exits 0 and `packages/sdk/dist/index.d.ts` exists | Project references work end-to-end |
| HOUSE-04 | `pnpm -w lint` (biome ci) exits 0; biome.json present; `grep -q noExplicitAny biome.json` | Biome configured with required rules |
| HOUSE-05 | `test -d .changeset && test -f .changeset/config.json && pnpm changeset status --since=HEAD~1 \|\| true` | Changesets installed and valid |
| HOUSE-06 | `pnpm --filter @klank/sdk exec attw --pack .` exits 0 | attw runs cleanly against built tarball |
| HOUSE-07 | `test -f .github/workflows/ci.yml && grep -Eq 'build\|lint\|test\|attw\|tarball' .github/workflows/ci.yml` | CI workflow exists with required jobs |
| HOUSE-08 | `test -f LICENSE && grep -q MIT LICENSE && test -f CHANGELOG.md && grep -q '0.1.0' CHANGELOG.md` | LICENSE + seeded CHANGELOG present |

The smoke test also contributes: `pnpm --filter @klank/sdk test` runs a real import of the built `@klank/sdk` and asserts `KlankBot`, `KlankClient`, `WebhookBot` are exported (per RESEARCH.md §14).

---

## Wave 0 Requirements

- [ ] Install `vitest` as a dev dep in `packages/sdk/`
- [ ] Create `packages/sdk/vitest.config.ts`
- [ ] Create `packages/sdk/test/smoke.test.ts` (imports built dist and asserts top-level exports exist — per RESEARCH.md §14)
- [ ] Install root dev deps: `typescript`, `@biomejs/biome`, `@changesets/cli`, `@arethetypeswrong/cli`, `tsup`
- [ ] Root `package.json` with `packageManager: "pnpm@9.x"` and workspace scripts (`build`, `lint`, `test`, `attw`, `tarball`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Branch protection on `main` requires all CI jobs to pass | HOUSE-07 | GitHub UI setting — not representable in repo | After first green CI run: Settings → Branches → Add rule for `main` → require build, lint, test, attw, tarball, changeset-status status checks |
| First clean clone of repo runs `pnpm install && pnpm -w build && pnpm -w test` green | HOUSE-01, HOUSE-03 | Proves lockfile + workspace setup isn't reliant on local state | `git clone`, `pnpm install --frozen-lockfile`, run full suite. Must be green. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (vitest install, root package.json)
- [ ] No watch-mode flags (CI uses `biome ci`, `vitest run`, not `--watch`)
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter after planner + checker agree

**Approval:** pending
