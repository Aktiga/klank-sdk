---
phase: quick/260407-ssg
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/sdk/src/bot.ts
  - packages/sdk/src/client.ts
  - packages/sdk/src/index.ts
  - packages/sdk/src/types.ts
  - packages/sdk/src/webhook.ts
  - packages/sdk/src/ws.ts
  - packages/sdk/tsconfig.json
  - packages/sdk/.tarball-snapshot.txt
autonomous: true
requirements: [HOUSE-04, HOUSE-06, HOUSE-07]
must_haves:
  truths:
    - "pnpm -w lint exits 0 on a clean checkout"
    - "pnpm --filter @klank/sdk exec attw --pack . exits 0"
    - "pnpm --filter @klank/sdk run tarball:check exits 0"
  artifacts:
    - path: "packages/sdk/src/*.ts"
      provides: "Lint-clean source with .js relative imports"
    - path: "packages/sdk/tsconfig.json"
      provides: "tsBuildInfoFile written outside dist/"
    - path: "packages/sdk/.tarball-snapshot.txt"
      provides: "Accurate snapshot of pnpm pack contents"
  key_links:
    - from: "packages/sdk/src/index.ts"
      to: "packages/sdk/src/{bot,client,webhook,ws,types}"
      via: "explicit .js suffix relative imports"
      pattern: "from '\\./.*\\.js'"
---

<objective>
Close the three Phase 01 CI gate gaps from VERIFICATION.md so `pnpm -w lint`, `attw --pack`, and `tarball:check` are green on main.

Purpose: Phase 01 declared a "working CI gate to land into" but three of six gates (lint, attw, tarball) are red on the committed tree. Phase 02 cannot land a single PR until these are fixed.
Output: Lint-clean SDK source with NodeNext-compatible imports, tsconfig that doesn't pollute dist/, regenerated tarball snapshot.
</objective>

<context>
@.planning/STATE.md
@.planning/phases/01-workspace-bootstrap/VERIFICATION.md
@packages/sdk/tsconfig.json
@packages/sdk/.tarball-snapshot.txt
@packages/sdk/src/index.ts
@packages/sdk/src/bot.ts
@packages/sdk/src/client.ts
@packages/sdk/src/webhook.ts
@packages/sdk/src/ws.ts
@packages/sdk/src/types.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix biome lint errors in packages/sdk/src</name>
  <files>packages/sdk/src/bot.ts, packages/sdk/src/client.ts, packages/sdk/src/index.ts, packages/sdk/src/types.ts, packages/sdk/src/webhook.ts, packages/sdk/src/ws.ts</files>
  <action>
Run `pnpm -w lint` first to enumerate the 24 errors. Then:
1. Run `pnpm -w lint:fix` to auto-resolve formatting/template-literal/parseInt-vs-Number.parseInt drift.
2. Hand-fix the remaining rule violations:
   - `noExplicitAny` (2 sites): replace `any` with the narrowest correct type. If a payload is genuinely unknown, use `unknown` and narrow at the use site. Do NOT use `// biome-ignore`.
   - Non-null assertions `!` (6 sites): replace with explicit guards (`if (!x) throw new Error(...)`) or correct typing so the value is provably non-null. Do NOT silence with ignores.
   - Unused import (1 site): remove the import.
   - Any remaining formatting / template-literal / Number.parseInt / unused-var findings: fix at the source.
3. Re-run `pnpm -w lint` until it exits 0 on a clean tree.
Constraint: no new dependencies, no behavior changes — these are type/lint cleanups only.
  </action>
  <verify>
    <automated>pnpm -w lint</automated>
  </verify>
  <done>`pnpm -w lint` exits 0 with zero errors and zero warnings on a clean checkout.</done>
</task>

<task type="auto">
  <name>Task 2: Add .js extensions to relative imports for NodeNext attw compatibility</name>
  <files>packages/sdk/src/bot.ts, packages/sdk/src/client.ts, packages/sdk/src/index.ts, packages/sdk/src/types.ts, packages/sdk/src/webhook.ts, packages/sdk/src/ws.ts</files>
  <action>
Audit every relative import in packages/sdk/src/ and append `.js` to the specifier. Examples:
- `from './bot'` → `from './bot.js'`
- `from './types'` → `from './types.js'`
- `from './client'` → `from './client.js'`
This applies to both `import` statements and any `export ... from './…'` re-exports in index.ts.
Do NOT touch bare-specifier imports (e.g. `from 'ws'`). Do NOT change tsconfig.build.json moduleResolution — the source-level fix is what attw needs because tsc emits .d.ts as written.
After editing, run `pnpm -w build` to confirm tsc + tsup still emit cleanly, then run attw against the freshly packed tarball.
  </action>
  <verify>
    <automated>pnpm -w build && pnpm --filter @klank/sdk exec attw --pack .</automated>
  </verify>
  <done>`pnpm -w build` exits 0 and `attw --pack .` exits 0 with no CJSResolvesToESM and no InternalResolutionError findings.</done>
</task>

<task type="auto">
  <name>Task 3: Move tsBuildInfoFile out of dist/ and regenerate tarball snapshot</name>
  <files>packages/sdk/tsconfig.json, packages/sdk/.tarball-snapshot.txt</files>
  <action>
1. Edit `packages/sdk/tsconfig.json`: change `tsBuildInfoFile` from `dist/.tsbuildinfo-check` to `node_modules/.cache/tsc/.tsbuildinfo-check` (outside the publishable tree, gitignored by default via node_modules).
2. Clean and rebuild to ensure no stale files remain in dist/: `rm -rf packages/sdk/dist && pnpm -w build`.
3. Regenerate the tarball snapshot from the real packed contents:
   - Run `pnpm --filter @klank/sdk pack` to produce a .tgz.
   - Extract its file list (`tar -tzf <tgz> | sort`) and write the result to `packages/sdk/.tarball-snapshot.txt`, matching the existing snapshot format (one path per line, sorted, package/ prefix).
   - Confirm `.tsbuildinfo-check` does NOT appear in the new snapshot.
4. Run `pnpm --filter @klank/sdk run tarball:check` and confirm it exits 0.
  </action>
  <verify>
    <automated>pnpm -w build && pnpm --filter @klank/sdk run tarball:check</automated>
  </verify>
  <done>`tarball:check` exits 0; `.tarball-snapshot.txt` contains no `.tsbuildinfo-check` entry; tsconfig.json points buildinfo outside dist/.</done>
</task>

</tasks>

<verification>
Final full-gate sweep, must all exit 0:
- `pnpm -w lint`
- `pnpm -w build && pnpm --filter @klank/sdk exec attw --pack .`
- `pnpm --filter @klank/sdk run tarball:check`
</verification>

<success_criteria>
All three previously-failing CI gates (lint, attw, tarball) exit 0 on a clean checkout. No new dependencies. No behavioral changes to SDK runtime code. VERIFICATION.md gaps for HOUSE-04, HOUSE-06, HOUSE-07 are resolved.
</success_criteria>

<output>
After completion, create `.planning/quick/260407-ssg-close-phase-01-ci-gate-gaps-fix-biome-li/260407-ssg-SUMMARY.md` documenting the fixes applied and the final green gate output.
</output>
