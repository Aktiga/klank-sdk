---
phase: 01-workspace-bootstrap
verified: 2026-04-07T20:11:00Z
status: gaps_found
score: 5/8 must-haves verified
gaps:
  - truth: "pnpm lint runs biome across the workspace and fails on noExplicitAny / unused imports"
    status: failed
    reason: "biome IS configured and DOES run, but the workspace currently fails lint with 24 errors. The CI lint gate would block every PR until these are fixed. The phase goal is 'a working ... lint ... gate to land into' — a gate that is red on main is not a working gate."
    artifacts:
      - path: "packages/sdk/src/*.ts"
        issue: "24 biome errors: formatting drift, noExplicitAny violations (2), unused import (1), non-null assertions (6), template-literal misuse, parseInt-vs-Number.parseInt, etc."
    missing:
      - "Run `pnpm lint:fix` and hand-fix the noExplicitAny / non-null-assertion / unused-import findings in packages/sdk/src/{bot,client,webhook,ws,types}.ts so `pnpm -w lint` exits 0 on a clean checkout"
  - truth: "attw --pack passes for @klank/sdk (HOUSE-06)"
    status: failed
    reason: "attw reports two real problems against the built tarball: (1) CJSResolvesToESM under node16-from-CJS, (2) Internal resolution error under both node16 channels because emitted .d.ts files use extension-less relative imports (`from './client'`) which NodeNext rejects for ESM packages. The CI `attw` job will fail on every PR. 01-02-SUMMARY explicitly deferred this to plan 01-04, but plan 01-04 only wired the CI job — it never fixed the underlying resolution errors."
    artifacts:
      - path: "packages/sdk/dist/*.d.ts"
        issue: "Relative imports lack explicit .js extensions; under moduleResolution=Bundler tsc emits as written, so dist .d.ts inherits the extension-less form."
      - path: "packages/sdk/src/index.ts (and others)"
        issue: "Source uses `from './bot'` style imports; needs `.js` suffixes for NodeNext compatibility, OR the package needs a different module-resolution stance."
    missing:
      - "Add `.js` extensions to every relative import in packages/sdk/src/, OR switch tsconfig.build.json to NodeNext + adjust accordingly, until `pnpm --filter @klank/sdk exec attw --pack .` exits 0"
  - truth: "tarball-contents check passes (HOUSE-06 / D3)"
    status: failed
    reason: "`pnpm --filter @klank/sdk run tarball:check` fails: the committed `.tarball-snapshot.txt` does not list `package/dist/.tsbuildinfo-check`, but the noEmit type-check tsconfig writes that file into dist/, so `pnpm pack` includes it. Snapshot is stale, OR the type-check buildinfo should not be landing in dist/. Either way the CI tarball gate is red on a clean checkout."
    artifacts:
      - path: "packages/sdk/.tarball-snapshot.txt"
        issue: "Missing `package/dist/.tsbuildinfo-check` line — the file produced by tsconfig.json (noEmit) `tsBuildInfoFile: dist/.tsbuildinfo-check` ends up packed."
      - path: "packages/sdk/tsconfig.json"
        issue: "Writes its tsBuildInfoFile into dist/, polluting the publishable tarball. Belongs outside dist/ (e.g. .tsbuildcache/ or node_modules/.cache/)."
    missing:
      - "Either move `tsBuildInfoFile` for the noEmit check out of `dist/`, or regenerate `.tarball-snapshot.txt` to reflect the real packed contents — and ensure the resulting check exits 0 on a clean checkout"
---

# Phase 1: Workspace Bootstrap — Verification Report

**Phase Goal:** Monorepo infrastructure exists so every downstream phase has a working workspace, lint, type-check, test, and CI gate to land into.
**Verified:** 2026-04-07
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Roadmap Success Criteria

| #   | Success Criterion | Status     | Evidence       |
| --- | ----------------- | ---------- | -------------- |
| 1   | `pnpm install` resolves the workspace from `pnpm-workspace.yaml` with a committed lockfile | VERIFIED | `pnpm install --frozen-lockfile` exits 0; lockfile present; `packages/*` + `examples/*` (minus echo-bot-rust) globs in pnpm-workspace.yaml |
| 2   | `pnpm build` runs `tsc -b` across all packages and produces type-correct output for `packages/sdk/` | VERIFIED | `pnpm -w build` exits 0; emits `packages/sdk/dist/index.{js,d.ts}` and 6 other `.d.ts` files; tsup ESM bundle 9.81 KB |
| 3   | `pnpm lint` runs biome across the workspace and fails on `noExplicitAny` / unused imports | FAILED | biome IS configured (`biome.json` has both rules as errors). However `pnpm -w lint` currently exits 1 with 24 errors on a clean checkout — including the noExplicitAny rule firing on legacy source. The CI gate would block every PR. |
| 4   | CI runs build, lint, test, `attw --pack`, and tarball-contents check on every PR | PARTIAL | `.github/workflows/ci.yml` exists with all six jobs wired correctly. But two of those gates (attw, tarball) currently fail locally on the committed tree, so the workflow as written would be red on the next PR. |
| 5   | Repo ships LICENSE (MIT), seeded `CHANGELOG.md`, and `.changeset/` configured | VERIFIED | LICENSE present (contains "MIT"); CHANGELOG.md present (contains "0.1.0"); `.changeset/config.json` present with `baseBranch: main`, `access: public`, independent versioning |

**Score:** 3 verified, 1 partial, 1 failed (out of 5 success criteria)

### Requirements Coverage (HOUSE-01..HOUSE-08)

| Req | Description | Status | Evidence |
| --- | ----------- | ------ | -------- |
| HOUSE-01 | pnpm workspace + committed lockfile | SATISFIED | `pnpm-workspace.yaml`, `pnpm-lock.yaml` committed; `pnpm install --frozen-lockfile` green |
| HOUSE-02 | `sdk-typescript` → `sdk` rename, published as `@klank/sdk` | SATISFIED | `packages/sdk/` exists; `packages/sdk-typescript/` does not; `package.json` name = `@klank/sdk`; no source still references the old path |
| HOUSE-03 | TS project references (`tsc -b`) wired across workspace | SATISFIED | Root `tsconfig.json` references sdk + create-bot + 3 examples; `tsc -b` walks the graph cleanly during `pnpm -w build` |
| HOUSE-04 | biome installed for lint+format with required rules | PARTIAL | biome installed and `biome.json` declares `noExplicitAny` + `noUnusedImports` as errors, BUT the workspace fails 24 biome errors on a clean checkout — the rule is configured but the codebase is non-conformant, so the gate cannot enforce on PRs without first being fixed |
| HOUSE-05 | changesets installed and configured | SATISFIED | `@changesets/cli` in root devDeps; `.changeset/config.json` valid; CI changeset job wired |
| HOUSE-06 | `@arethetypeswrong/cli` wired into CI; exports map validity checked | BLOCKED | attw is in devDeps and the CI job exists, but `attw --pack .` currently fails locally with CJSResolvesToESM + InternalResolutionError. The CI gate will block PRs until source imports get explicit `.js` extensions. 01-02 SUMMARY explicitly deferred this; 01-04 wired the CI job without resolving the deferral. |
| HOUSE-07 | `.github/workflows/ci.yml` running build, lint, test, attw, tarball | PARTIAL | Workflow file exists with all six jobs. Pinned to Node 20 + pnpm 9.12.0; uses `--frozen-lockfile`; needs:build artifact reuse for test/attw/tarball; changeset job gated to PRs. But three of the six jobs (lint, attw, tarball) fail on the committed tree as of this verification. |
| HOUSE-08 | LICENSE + CHANGELOG seeded | SATISFIED | LICENSE (MIT) + root CHANGELOG.md (0.1.0 entry) + per-package `packages/sdk/CHANGELOG.md` all present |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| `package.json scripts.build` | `tsc -b` + `tsup` | root script chain | WIRED — exits 0, both `.d.ts` and `.js` land in dist/ |
| `packages/sdk/tsconfig.build.json` | dist `.d.ts` | composite emit | WIRED — `tsc -b` emits 7 declaration files |
| tsup config | `dts: false`, `clean: false` | preserves tsc output | WIRED — verified in `packages/sdk/tsup.config.ts` |
| Smoke test → built dist | `import from '@klank/sdk'` | workspace exports map | WIRED — 3/3 tests pass |
| CI build job → attw/tarball/test jobs | `actions/upload-artifact` + `download-artifact` (`needs: build`) | shared `sdk-dist` artifact | WIRED in YAML |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Frozen lockfile install | `pnpm install --frozen-lockfile` | exit 0 | PASS |
| Workspace build | `pnpm -w build` | exit 0; dist populated | PASS |
| Smoke test | `pnpm --filter @klank/sdk test` | 3/3 pass | PASS |
| Workspace lint | `pnpm -w lint` | 24 errors, exit 1 | FAIL |
| attw pack check | `pnpm --filter @klank/sdk exec attw --pack .` | CJSResolvesToESM + InternalResolutionError, exit 1 | FAIL |
| Tarball contents | `pnpm --filter @klank/sdk run tarball:check` | snapshot drift on `dist/.tsbuildinfo-check`, exit 1 | FAIL |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
| ---- | ------- | -------- | ------ |
| `packages/sdk/src/*.ts` | `any`, non-null `!`, unused import, formatting drift | Blocker | Lint gate red |
| `packages/sdk/src/*.ts` | extension-less relative imports | Blocker | attw gate red |
| `packages/sdk/tsconfig.json` | `tsBuildInfoFile: dist/.tsbuildinfo-check` writes into the published tree | Warning | Tarball drift / pollution |
| `packages/create-bot/src/index.ts` | `// Placeholder — full scaffolder lands in Phase 9 (PG-04).` | Info | Intentional placeholder, scoped out of Phase 1 |

### Gaps Summary

The Phase 1 PLAN/SUMMARY artifacts are accurate about what files were created — every config file, tsconfig, biome.json, ci.yml, and tarball snapshot exists exactly as documented. The phase succeeds at the structural level: workspace, build, project references, smoke test, and CI workflow file are all in place.

It fails at the **gate-is-actually-green** level. The phase goal is "a working workspace, lint, type-check, test, and CI gate to land into." Three of the six gates (lint, attw, tarball) are red on the committed tree as of verification:

1. **Lint** — biome correctly configured, but legacy `packages/sdk/src/` source has 24 violations including the very rules HOUSE-04 calls out (`noExplicitAny`).
2. **attw** — known issue, explicitly deferred from 01-02 to 01-04, then never actually addressed in 01-04 (which only wired the CI job).
3. **Tarball** — `tsconfig.json`'s noEmit `tsBuildInfoFile` lands inside `dist/`, so it gets packed and breaks the snapshot diff.

These are not theoretical CI risks — every one of them was confirmed by running the exact command the CI job runs. Phase 2 cannot land a single PR through this workflow without immediately tripping these gates. The structural work is sound; the cleanup pass to make the gates green was skipped.

---

_Verified: 2026-04-07T20:11:00Z_
_Verifier: Claude (gsd-verifier)_
