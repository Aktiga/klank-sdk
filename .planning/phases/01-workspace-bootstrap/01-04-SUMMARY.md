---
phase: 01-workspace-bootstrap
plan: 04
subsystem: ci
tags: [ci, github-actions, attw, changesets]
requires: [01-01, 01-02, 01-03]
provides: [HOUSE-06, HOUSE-07]
affects: [.github/workflows/ci.yml]
tech-stack:
  added: [github-actions]
  patterns: [parallel-jobs, artifact-reuse, frozen-lockfile]
key-files:
  created:
    - .github/workflows/ci.yml
  modified: []
decisions:
  - All six gates blocking — no advisory tier (D3)
  - build job uploads sdk dist; test/attw/tarball reuse via artifact
  - changeset job runs only on pull_request
metrics:
  duration: ~2m
  completed: 2026-04-07
---

# Phase 01 Plan 04: CI Workflow Summary

Wired GitHub Actions CI with six parallel strict gates (build, lint, test, attw --pack, tarball-contents check, changeset-required), satisfying HOUSE-06 and HOUSE-07 and completing Phase 1.

## What Shipped

- `.github/workflows/ci.yml` — single workflow, six jobs
- Node 20 + pnpm 9.12.0 pinned via env vars
- `pnpm install --frozen-lockfile` on every job (T-1-01 mitigation)
- Third-party actions pinned to `@v4` major tags (T-1-02 mitigation)
- `build` uploads `packages/sdk/dist` artifact; `test`, `attw`, `tarball` consume it via `needs: build` + `download-artifact`
- `changeset` job gated to `pull_request` events only

## Deviations from Plan

None — plan executed exactly as written.

## Verification

Automated grep verification passed for all required tokens (NODE_VERSION='20', frozen-lockfile, attw --pack, tarball:check, changeset status --since=origin, six job names). Local `pnpm` sanity runs and remote PR observation are manual per VALIDATION.md.

## Self-Check: PASSED

- FOUND: .github/workflows/ci.yml
- FOUND commit: a4735b9
