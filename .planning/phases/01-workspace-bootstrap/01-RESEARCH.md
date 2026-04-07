# Phase 1: Workspace Bootstrap — Research

## RESEARCH COMPLETE

**Phase:** 1 — Workspace Bootstrap
**Researched:** 2026-04-07
**Domain:** pnpm workspace tooling, TS project references, biome, changesets, attw, GitHub Actions CI
**Confidence:** HIGH for standard tooling recipes; MEDIUM where tsup/tsc split has tradeoffs

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D1. Package rename, hard cutover.** `git mv packages/sdk-typescript packages/sdk` in a single commit. `@klank/sdk` is the new and only name. No deprecation shim. All internal imports, tsconfig references, and `examples/*` paths updated in the same commit. `packages/create-bot/` stays where it is.
- **D2. Node 20 LTS only.** `engines.node: ">=20"` in root and every published package.json. CI pins Node 20 via `actions/setup-node@v4`. PROJECT.md "Node 18+" line must be updated.
- **D3. CI gates strict from day 1.** Every PR must pass all of: `pnpm build` (tsc -b), `pnpm lint` (biome), `pnpm test`, `attw --pack` on every publishable package, tarball-contents check, changeset-required. No advisory tier.

### Claude's Discretion

- Exact biome config beyond `noExplicitAny` + unused imports — use `recommended` preset + HOUSE-04 named rules.
- tsconfig.base.json + per-package tsconfig layout — planner picks idiomatic project-references structure.
- pnpm version pin (latest stable v9).
- changesets independent versioning (adapters will ship separately).
- LICENSE content — MIT, copyright from git config.
- Seed CHANGELOG.md with "0.1.0 — initial release" reconstructed from existing tag so changesets has a clean baseline.
- Pull `examples/` into workspace as private member so examples type-check against real sdk source — recommend YES.

### Deferred Ideas (OUT OF SCOPE)

- Dual ESM+CJS output via tsup — Phase 1 ESM-only is fine.
- Node 22 CI cell — revisit Phase 10.
- Publint in CI — reconsider if attw misses a real issue.
- Release automation via `changesets/action` publishing — Phase 2 ship. Phase 1 only needs the gate.
- sdk-typescript deprecation shim — explicitly rejected.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HOUSE-01 | Repo converts to pnpm workspace with committed lockfile | §1 (pnpm + workspace recipe) |
| HOUSE-02 | `packages/sdk-typescript/` → `packages/sdk/` as `@klank/sdk` | §7 (rename mechanics) |
| HOUSE-03 | TypeScript project references wired across workspace | §1, §2 (tsc -b + tsup split) |
| HOUSE-04 | biome lint/format with `noExplicitAny` + unused imports | §5 (biome config) |
| HOUSE-05 | changesets installed for versioning | §4 (changesets config) |
| HOUSE-06 | `@arethetypeswrong/cli` wired into CI | §3 (attw invocation) |
| HOUSE-07 | GitHub Actions CI with build/lint/test/attw/tarball | §6 (CI shape) |
| HOUSE-08 | `CHANGELOG.md` seeded, `LICENSE` (MIT) added | §8 (changelog seed) |

---

## Summary (TL;DR)

1. **Use the "tsc emits .d.ts only, tsup emits JS only" split.** tsup's internal `dts` flag (which shells out to `rollup-plugin-dts`) fights with project references once a second package lands. Set `"declaration": true, "emitDeclarationOnly": true"` in tsconfig.build.json, drop `--dts` from tsup, and use `tsc -b` as the canonical declaration emitter. Both outputs land in `dist/` — tsup writes `*.mjs`, tsc writes `*.d.ts`, no collision.
2. **pnpm workspace is flat: `packages/*` + `examples/*`.** Root `package.json` is `"private": true`, no version. Root scripts use `pnpm -r --filter ...` to fan out. Lockfile committed. Pin pnpm via `packageManager` field + `engines.pnpm`.
3. **attw runs against a real tarball.** `pnpm -r --filter "./packages/*" exec pnpm pack` to produce tarballs, then `pnpm exec attw --pack ./packages/sdk` (attw accepts the package dir and calls pack internally in modern versions — verify invocation, below). Fail CI on any attw problem class; there is no reasonable "advisory" subset for a fresh library.
4. **Changesets: independent versioning, start at 0.2.0-next, register only `@klank/sdk` today.** Don't backfill a 0.1.0 changeset; instead write a human-authored `CHANGELOG.md` section for 0.1.0 and let changesets own 0.2.0 forward. The `changeset-required` gate is `pnpm changeset status --since=origin/main --output=...` exit code in a dedicated CI job — simpler and more transparent than `changesets/action` in status-only mode.
5. **CI is one workflow, parallel jobs, shared `pnpm install` via cache.** `.github/workflows/ci.yml` with jobs: `install` (produces cache key), `build`, `lint`, `test`, `attw`, `tarball`, `changeset`. Each job runs `pnpm install --frozen-lockfile` against the cached store. On a repo this small, fanned-out jobs cost ~30s each and parallelize cleanly — don't collapse them into one mega-job.

**Primary recommendation:** Schedule the `git mv` as task 1. Immediately after, create `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`, and the per-package `tsconfig.build.json`/`tsconfig.json` split. Everything else (biome, changesets, CI) layers on top of a working `pnpm build` and can be done in any order.

---

## 1. pnpm workspace + tsc -b + tsup split

### Recommended layout

```
rust-slack-sdk/
├── package.json                 # private: true, root scripts, devDeps
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json           # shared strict compiler options
├── tsconfig.json                # solution file: references every package
├── .changeset/
│   └── config.json
├── biome.json
├── .github/workflows/ci.yml
├── LICENSE                      # MIT
├── CHANGELOG.md                 # seed entry for 0.1.0
├── packages/
│   ├── sdk/                     # ← renamed from sdk-typescript
│   │   ├── package.json         # @klank/sdk
│   │   ├── tsconfig.json        # type-check config (references only, noEmit)
│   │   ├── tsconfig.build.json  # emit .d.ts only, extends base
│   │   ├── tsup.config.ts       # ESM JS only, no dts
│   │   ├── .tarball-snapshot.txt
│   │   └── src/
│   └── create-bot/              # kept in place (HOUSE-02 carve-out)
│       └── src/
└── examples/
    ├── echo-bot-ts/
    │   ├── package.json         # private: true, "@klank/sdk": "workspace:*"
    │   └── tsconfig.json        # references ../../packages/sdk
    ├── ci-bot-ts/
    ├── webhook-bot/
    └── echo-bot-rust/           # leave alone; Rust is Phase 14
```

### `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"
  - "examples/*"
```

Intentionally excludes `examples/echo-bot-rust` (not a Node package — it has `Cargo.toml`, no `package.json`, pnpm will skip it silently). If pnpm warns, add `"!examples/echo-bot-rust"`.

### Root `package.json`

```json
{
  "name": "klank-sdk-monorepo",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20", "pnpm": ">=9" },
  "scripts": {
    "build": "tsc -b && pnpm -r --filter \"./packages/*\" run build:js",
    "typecheck": "tsc -b",
    "lint": "biome ci .",
    "lint:fix": "biome check --write .",
    "test": "pnpm -r --filter \"./packages/*\" run test",
    "attw": "pnpm -r --filter \"./packages/*\" exec attw --pack .",
    "tarball:check": "pnpm -r --filter \"./packages/*\" run tarball:check",
    "changeset": "changeset",
    "changeset:version": "changeset version",
    "changeset:status": "changeset status --since=origin/main"
  },
  "devDependencies": {
    "@arethetypeswrong/cli": "^0.17.0",
    "@biomejs/biome": "^1.9.0",
    "@changesets/cli": "^2.27.0",
    "tsup": "^8.3.0",
    "typescript": "^5.6.0"
  }
}
```

Version floor notes: these are current-as-of-training best known stable lines; the planner's first task is `npm view @biomejs/biome @changesets/cli @arethetypeswrong/cli tsup typescript version` to verify. `[ASSUMED]` — see Assumptions Log.

### `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "incremental": true
  }
}
```

`composite: true` is the ground requirement for project references. `declarationMap` and `sourceMap` add ~5% to build output and buy you go-to-definition into node_modules for consumers — worth it.

### Root solution `tsconfig.json`

```json
{
  "files": [],
  "references": [
    { "path": "./packages/sdk" },
    { "path": "./packages/create-bot" },
    { "path": "./examples/echo-bot-ts" },
    { "path": "./examples/ci-bot-ts" },
    { "path": "./examples/webhook-bot" }
  ]
}
```

`files: []` + `references` is the canonical "solution-style" tsconfig. `tsc -b` at root walks the reference graph.

### Per-package `packages/sdk/tsconfig.json` (type-check)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "**/*.test.ts"]
}
```

This is the config `tsc -b` uses. It emits `.d.ts` (+ maps) into `dist/`.

### `packages/sdk/tsup.config.ts`

```ts
import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],          // ESM only per "Deferred Ideas"
  dts: false,               // tsc -b owns declarations
  sourcemap: true,
  clean: false,             // ← critical: don't wipe tsc's .d.ts output
  target: "node20",
  outDir: "dist",
  treeshake: true,
})
```

**The anti-pattern to avoid:** leaving `clean: true` on tsup while `tsc -b` also writes to `dist/`. tsup runs → wipes dist → then tsc runs → emits `.d.ts` → tsup runs again (watch) → wipes `.d.ts`. With `clean: false`, a top-level `rm -rf packages/*/dist` in the `prebuild` script is the honest way to start clean.

Add to `packages/sdk/package.json`:

```json
{
  "scripts": {
    "prebuild": "rimraf dist",
    "build:js": "tsup",
    "test": "vitest run",
    "tarball:check": "node ../../scripts/check-tarball.mjs"
  }
}
```

Root `pnpm build` runs `tsc -b` first (emits `.d.ts`), then `pnpm -r ... run build:js` (tsup emits `.mjs`). They don't race because they run sequentially.

### Why not `tsup --dts`

`tsup --dts` uses `rollup-plugin-dts`, which:
- Re-parses types independently from your tsc config (so project references don't help).
- Is the #1 reported source of "it works in tsc but attw says my exports are broken" issues.
- Doesn't know about `composite` / `tsBuildInfo` so CI builds are ~2x slower than `tsc -b` incremental.

`[CITED: tsup README — "dts" section notes "This option is implemented by rollup-plugin-dts"]`
`[ASSUMED: the performance/attw claims above — these match community reports but planner should spot-check on a real build before locking.]`

**Confidence: HIGH** on the split-the-concerns recommendation; **MEDIUM** on the exact tsup config flags — verify against tsup 8.x changelog.

---

## 2. Where declarations live

Both tsc and tsup land in `packages/sdk/dist/`. File layout after a full build:

```
dist/
├── index.mjs          # tsup output
├── index.mjs.map
├── index.d.ts         # tsc output
├── index.d.ts.map
├── webhook.d.ts       # tsc preserves source structure for declarations
├── bot.d.ts
└── .tsbuildinfo
```

`package.json` exports map:

```json
{
  "type": "module",
  "main": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs"
    }
  },
  "files": ["dist", "README.md", "LICENSE", "CHANGELOG.md"],
  "engines": { "node": ">=20" }
}
```

**attw gotcha:** the `types` condition **must** come first in every exports block. attw's `masquerading-as-cjs` / `masquerading-as-esm` problems are almost always caused by `types` being listed last. `[CITED: arethetypeswrong.github.io problem index]`

---

## 3. attw (`@arethetypeswrong/cli`) in CI

### Invocation

Modern `attw` (0.15+) accepts either a tarball path or a package directory. The `--pack` flag tells attw to run `pnpm pack` itself against the given directory and inspect the resulting tarball — this is what you want in CI because it tests the *same bytes* that would publish.

```bash
# From the package directory
cd packages/sdk && pnpm exec attw --pack .

# Or from root, against all publishable packages
pnpm -r --filter "./packages/*" --filter "!./packages/create-bot" exec attw --pack .
```

The `--filter "!./packages/create-bot"` excludes create-bot until Phase 9 makes it publishable. Alternatively, add `"private": true` to create-bot's package.json and pnpm `-r` will still select it for scripts but attw's `--pack` will fail on private packages — cleaner to explicitly exclude.

**attw + pnpm pack nuance:** attw under the hood runs `npm pack` by default. In a pnpm workspace that can include `workspace:*` specifiers and break. Solve with `--pack-mode pnpm` or by pre-packing:

```bash
pnpm --filter @klank/sdk pack --pack-destination /tmp/packs
pnpm exec attw /tmp/packs/klank-sdk-0.2.0.tgz
```

`[ASSUMED]` — the exact `--pack-mode` flag name and availability; verify against `attw --help` in the installed version as the first task step.

### Which failure classes

Per CONTEXT D3, all blocking. The concrete problem classes attw reports (for reference in the planner's CI config):

- `wildcard` — wildcard exports that don't resolve
- `no-resolution` — import can't be resolved in the stated condition
- `untyped-resolution` — JS resolves but no types
- `false-cjs` / `false-esm` — type shape doesn't match runtime module format
- `cjs-resolves-to-esm` — CJS consumer would fail at require time
- `unexpected-module-syntax`
- `internal-resolution-error`

All of these are real bugs. Blocking is correct.

**Confidence: HIGH** on attw being the right tool and problem classes; **MEDIUM** on exact `--pack` invocation in a pnpm workspace — verify against installed version.

---

## 4. Tarball-contents check

No prebuilt tool fits this cleanly — the standard pattern is a snapshot file per package + a tiny Node script.

### `scripts/check-tarball.mjs`

```js
#!/usr/bin/env node
// Produces a sorted list of files in the tarball and diffs against a committed snapshot.
import { execSync } from "node:child_process"
import { readFileSync, existsSync, rmSync } from "node:fs"
import { basename, join } from "node:path"

const pkgDir = process.cwd()
const snapshot = join(pkgDir, ".tarball-snapshot.txt")
if (!existsSync(snapshot)) {
  console.error(`Missing ${snapshot}. Create one with: pnpm run tarball:snapshot`)
  process.exit(2)
}

const packOutput = execSync("pnpm pack --json", { cwd: pkgDir }).toString()
const tarball = JSON.parse(packOutput)[0].filename
const list = execSync(`tar -tzf "${tarball}"`).toString()
  .split("\n")
  .filter(Boolean)
  .map(l => l.replace(/^package\//, ""))
  .sort()
rmSync(tarball)

const expected = readFileSync(snapshot, "utf8").trim().split("\n").sort()
const actual = list.join("\n")
const want = expected.join("\n")
if (actual !== want) {
  console.error("Tarball contents drift detected.")
  console.error("Expected:\n" + want)
  console.error("Actual:\n" + actual)
  console.error("If this is intentional, regenerate: pnpm run tarball:snapshot")
  process.exit(1)
}
console.log(`Tarball OK: ${list.length} files`)
```

### Companion `tarball:snapshot` script

```json
{
  "scripts": {
    "tarball:snapshot": "pnpm pack --json | node -e \"const p=JSON.parse(require('fs').readFileSync(0));const {execSync}=require('child_process');const f=p[0].filename;const out=execSync('tar -tzf '+f).toString().split('\\n').filter(Boolean).map(l=>l.replace(/^package\\//,'')).sort().join('\\n');require('fs').writeFileSync('.tarball-snapshot.txt',out+'\\n');require('fs').unlinkSync(f);console.log('Snapshot updated');\""
  }
}
```

### Snapshot location

`packages/sdk/.tarball-snapshot.txt` — per-package, committed. Updating is an intentional act that lives in the same commit as whatever adds/removes a file. This is the whole point: drift becomes a visible diff in review.

Initial snapshot for `@klank/sdk` (expected baseline):

```
CHANGELOG.md
LICENSE
README.md
dist/index.d.ts
dist/index.d.ts.map
dist/index.mjs
dist/index.mjs.map
dist/bot.d.ts
dist/bot.d.ts.map
dist/client.d.ts
dist/client.d.ts.map
dist/types.d.ts
dist/types.d.ts.map
dist/webhook.d.ts
dist/webhook.d.ts.map
dist/ws.d.ts
dist/ws.d.ts.map
package.json
```

(Planner: generate this from an actual `pnpm pack` run in the first task, don't trust this list verbatim.)

**Confidence: HIGH** on the pattern; **MEDIUM** on the exact file list — must be generated against a real build.

---

## 5. Changesets for independent versioning

### `.changeset/config.json`

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": [
    "echo-bot-ts",
    "ci-bot-ts",
    "webhook-bot",
    "create-bot"
  ]
}
```

- `fixed: []` and `linked: []` → independent versioning. Each package moves on its own.
- `ignore` keeps private examples and the not-yet-publishable `create-bot` out of release PRs.
- `access: "public"` because `@klank/sdk` is a scoped package; npm defaults scoped packages to private without this.

### Seeding past 0.1.0

**Recommended approach:** *don't* fabricate a retroactive changeset. Instead:

1. Write `CHANGELOG.md` at the package root with a hand-authored `## 0.1.0 — 2026-03-18` entry describing "Initial release: KlankBot, KlankClient, WebhookBot (broken against server phase 11 — see 0.2.0)." This is the historical record, owned by humans, not regenerated.
2. Set `packages/sdk/package.json` version to `0.1.0` (matching the existing tag — don't bump yet).
3. First real changeset lands in Phase 2 as a `minor` bump → changesets writes the `## 0.2.0` entry **below** the existing `## 0.1.0` and they coexist cleanly.

Why not a retroactive changeset: changesets consume their input `.md` files and delete them after `version`. A "0.1.0 initial" changeset would work once, get consumed, and leave no trace in `.changeset/`. A human-authored `CHANGELOG.md` entry is the permanent record. The two approaches converge on the same rendered changelog.

### `changeset-required` CI gate

**Recommend: plain `pnpm changeset status --since=origin/main`** in a CI job.

```yaml
- name: Require changeset
  run: |
    git fetch origin main
    pnpm changeset status --since=origin/main
```

`changeset status` exits non-zero if there are changes to publishable packages without a corresponding `.changeset/*.md`. Simple, transparent, no action required.

The official `changesets/action` is for *publishing* (opens release PRs, runs `npm publish`) — that's a Phase 2 concern per deferred ideas. Phase 1 only needs the gate.

**Escape hatch:** if a PR legitimately shouldn't need a changeset (docs-only, CI config), add an empty changeset with `pnpm changeset --empty`. Document this in `CONTRIBUTING.md` (also new-to-this-phase).

**Confidence: HIGH** on config shape and gate; **HIGH** on seeding strategy.

---

## 6. biome config

### `biome.json`

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "files": {
    "ignore": [
      "**/dist/**",
      "**/node_modules/**",
      "**/.tsbuildinfo",
      "examples/echo-bot-rust/**",
      "packages/*/dist/**",
      ".changeset/**"
    ]
  },
  "organizeImports": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error"
      },
      "correctness": {
        "noUnusedImports": "error",
        "noUnusedVariables": "error"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "asNeeded",
      "trailingCommas": "all"
    }
  }
}
```

HOUSE-04 calls out `noExplicitAny` and unused imports explicitly; both are bumped to `error` above `recommended`.

### Local vs CI commands

- **Local developer use:** `pnpm lint:fix` → `biome check --write .` (autofix + format)
- **CI use:** `pnpm lint` → `biome ci .` (non-interactive, no writes, non-zero exit on any issue, machine-readable output)

`biome ci` is the dedicated CI command; it implicitly turns off anything that would mutate files and adds GitHub Actions annotations.

**Confidence: HIGH**. Biome 1.9 config is stable; rule names may shift in a future 2.x — planner should verify against `@biomejs/biome` version at install time.

---

## 7. GitHub Actions CI shape

### `.github/workflows/ci.yml`

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: "20"
  PNPM_VERSION: "9.12.0"

jobs:
  install:
    name: Install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }        # changesets needs history
      - uses: pnpm/action-setup@v4
        with: { version: ${{ env.PNPM_VERSION }} }
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile

  build:
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: ${{ env.PNPM_VERSION }} }
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }}, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: packages/*/dist
          retention-days: 1

  lint:
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: ${{ env.PNPM_VERSION }} }
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }}, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  test:
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: ${{ env.PNPM_VERSION }} }
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }}, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  attw:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: ${{ env.PNPM_VERSION }} }
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }}, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - uses: actions/download-artifact@v4
        with: { name: dist, path: packages }
      - run: pnpm attw

  tarball:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: ${{ env.PNPM_VERSION }} }
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }}, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - uses: actions/download-artifact@v4
        with: { name: dist, path: packages }
      - run: pnpm tarball:check

  changeset:
    needs: install
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
        with: { version: ${{ env.PNPM_VERSION }} }
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }}, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm changeset:status
```

### Notes

- **Shared build output via artifact upload/download.** `tsc -b` + tsup output is uploaded once by the `build` job and pulled by `attw` and `tarball` jobs. Faster than re-running the build three times, and proves all three consumers see the identical output.
- **pnpm store cache is automatic** via `actions/setup-node@v4`'s `cache: pnpm` feature when a `packageManager` field is set in root `package.json`. No separate cache action needed.
- **Concurrency cancel** kills superseded runs on rapid pushes.
- **`changeset` job skips on pushes to main** — it only makes sense on PRs.
- **`needs: install` trick:** the `install` job doesn't do anything other jobs couldn't do themselves, but it warms the pnpm store cache once, so downstream `pnpm install --frozen-lockfile` is near-instant. On a repo this small, this is marginal (~5s per job) but becomes meaningful as packages grow.

### Branch protection

After the workflow runs once on `main`, turn on branch protection with all six status checks required: `build`, `lint`, `test`, `attw`, `tarball`, `changeset`. This is what actually enforces D3 — the workflow existing without protection is theater.

**Confidence: HIGH** on overall shape; **MEDIUM** on whether artifact passing is worth the ~20s it costs vs. re-running `pnpm build` in each job (for a small SDK, either works).

---

## 8. Rename mechanics (D1)

### Files that must change alongside `git mv packages/sdk-typescript packages/sdk`

From a grep of the actual repo state at 2026-04-07:

1. **`packages/sdk/package.json`** — already says `@klank/sdk`, but:
   - Update `main`, `module`, `types`, `exports` to match new ESM-only layout (§2).
   - Add `engines.node: ">=20"`.
   - Add `files`, `publishConfig.access: "public"`.
   - Update `repository`: add `"directory": "packages/sdk"`.

2. **`packages/sdk/tsconfig.json`** — rewrite per §1.

3. **`packages/sdk/src/*.ts`** — no internal imports currently reference the package name (they use relative imports). Verified via `src/index.ts` being `export { KlankBot } from './bot'`. **No import rewrites needed inside src.**

4. **`examples/*/`** — none currently have `package.json`. Phase 1 will add them; new files reference `"@klank/sdk": "workspace:*"`. No old-name references to clean up.

5. **`README.md`** — search for `packages/sdk-typescript` literal string and replace. Check `Server Compatibility` line (stale per BASELINE §3).

6. **`docs/getting-started.md`, `docs/deploying-bots.md`** — grep for `sdk-typescript`; these are user-facing so take the rename cleanly.

7. **`.planning/PROJECT.md`** — "Node 18+" → "Node 20+" (D2).

8. **`.planning/BASELINE-REPORT.md`, `SDK-REFRESH-ROADMAP.md`** — historical documents. Do **not** rewrite; they're point-in-time records. Future `.planning/` docs use the new path.

### `packages/create-bot/` — leave alone

Per CONTEXT D1: "`packages/create-bot/` stays where it is (already correctly named)". Current state is a stub (`src/index.ts` only, no `package.json`). Phase 1 should add a minimal `package.json` with `"private": true` so pnpm workspace discovery doesn't break, but **not** publish it and **not** rename it. Phase 9 is where `create-klank-bot` gets its real shape.

### Rename recipe (planner's task 1)

```bash
git mv packages/sdk-typescript packages/sdk
# Edit packages/sdk/package.json — name stays, version stays, fields updated per §2
# Edit packages/sdk/tsconfig.json per §1
# Grep for "sdk-typescript" across repo, update README/docs
git add -A
git commit -m "chore(sdk): rename packages/sdk-typescript to packages/sdk (HOUSE-02)"
```

Single atomic commit. Git's rename detection will preserve blame.

**Confidence: HIGH**. This is mechanical and the repo is small.

---

## 9. CHANGELOG.md + LICENSE seed (HOUSE-08)

### `LICENSE`

Standard MIT template, copyright holder from `git config user.name` (resolves to "Steve Meisner" per git status header). Year 2026.

```
MIT License

Copyright (c) 2026 Steve Meisner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, [...]
```

Place at repo root AND in `packages/sdk/LICENSE` (included in tarball via `files`).

### `CHANGELOG.md` (at `packages/sdk/CHANGELOG.md`)

```markdown
# @klank/sdk

## 0.1.0 — 2026-03-18

Initial release.

- `KlankBot` — WebSocket bot framework with `on()`, `command()`, `message()`, middleware.
- `KlankClient` — REST client for Klank server API v1.
- `WebhookBot` — incoming webhook sender.

**Known issues at 0.1.0 (fixed in 0.2.0):**
- `WebhookBot` is incompatible with Klank server ≥ phase 11 (header-based HMAC auth landed server-side; SDK still posts the secret in the body).
- Bots cannot post to E2EE channels (server rejects plaintext sends as of phase 9).
- No `verifySlashCommandSignature` helper for HTTP receivers.

See [migration guide](../../docs/migration/0.1-to-0.2.md) for 0.2.0 upgrade.
```

A root-level `CHANGELOG.md` is unnecessary when there's only one published package; add one in Phase 8 when adapters ship.

**Confidence: HIGH**.

---

## 10. `examples/` as workspace member

### Recommendation: YES, include them

Reasoning (validates CONTEXT's discretionary recommendation):

**Pros of including:**
- Examples type-check against the *current* SDK source via `workspace:*` — catches API breakage at SDK change time, not "I forgot to update the example".
- Project references make `tsc -b` fail the build if an example imports something that no longer exists.
- Gives us the `echo-bot-ts` → `MockKlank` test path for free in Phase 6.

**Cons of excluding:**
- Examples drift silently. This is exactly the pattern that led to the current README lying about `ctx.respond({responseType: 'ephemeral'})`.

**What breaks if NOT in workspace:**
- Examples either install `@klank/sdk` from npm (stale) or from a file path (no type-checking wire-up). Both fail in practice.
- `tsc -b` can't see them, so `pnpm build` doesn't validate them.
- Changes to SDK public API don't cascade-fail in CI until someone actually runs the example.

### Requirements on example packages

Each example needs a `package.json` with:

```json
{
  "name": "@klank/example-echo-bot-ts",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "dependencies": {
    "@klank/sdk": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc -b"
  }
}
```

- `private: true` keeps them out of changesets/publish.
- `workspace:*` is rewritten at publish time, but since examples are private, it stays literal forever.
- Listed in `.changeset/config.json` `ignore` (see §5).

Each example also gets a `tsconfig.json` with `{ "extends": "../../tsconfig.base.json", "references": [{ "path": "../../packages/sdk" }] }`.

`examples/echo-bot-rust/` is not a Node package (no `package.json`, has `Cargo.toml`). pnpm's glob `examples/*` will try to include it and either silently skip (no `package.json` detected) or warn. Best to either:
- Exclude via `"!examples/echo-bot-rust"` in `pnpm-workspace.yaml`, OR
- Let pnpm skip it and add a comment.

**Confidence: HIGH**.

---

## 11. Standard Stack

### Core tooling

| Tool | Version (target) | Purpose | Why standard |
|------|------------------|---------|--------------|
| pnpm | ^9.12 | Package manager + workspaces | Fastest, strictest, the default for monorepos in 2026 |
| typescript | ^5.6 | Compiler, project references | Canonical |
| tsup | ^8.3 | JS bundler (ESM emit only) | Already used in the repo; zero-config for SDK libs |
| @biomejs/biome | ^1.9 | Lint + format (replaces eslint + prettier) | One binary, Rust-fast, per REQ HOUSE-04 |
| @changesets/cli | ^2.27 | Versioning + changelog | Works natively with pnpm workspaces |
| @arethetypeswrong/cli | ^0.17 | Exports map correctness | Only tool that catches `types`-condition ordering bugs |
| vitest | ^3.0 | Test runner | Already in the repo |

**All version numbers are `[ASSUMED]`** — planner's first infra task is `npm view <pkg> version` on each to pin to current stable.

### Installation (from repo root, after rename)

```bash
# Initial bootstrap
npm install -g pnpm@9.12.0   # or rely on packageManager field + corepack
pnpm init                    # creates root package.json (then hand-edit)
# Create pnpm-workspace.yaml manually

pnpm add -Dw typescript tsup @biomejs/biome @changesets/cli @arethetypeswrong/cli
# -D devDep, -w workspace root

pnpm --filter @klank/sdk add -D vitest @types/ws
pnpm --filter @klank/sdk add ws

pnpm changeset init          # seeds .changeset/config.json and README
# Then edit .changeset/config.json per §5
```

---

## 12. Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| ESLint + Prettier combo | Two tools, plugin config hell | biome (one binary) | Per HOUSE-04 explicit choice |
| Custom release script | Bump versions, tag, changelog, npm publish | `@changesets/cli` | Handles workspace dep updates correctly |
| Custom exports-map validator | Walk package.json, resolve conditions | `@arethetypeswrong/cli` | `types`-first ordering is easy to get wrong; attw catches it |
| npm workspaces | Manual hoisting, slow installs | pnpm workspaces | Strict, fast, catches phantom deps |
| Turborepo | Task graph, remote cache | Plain `pnpm -r` | Premature at this scale (per REQUIREMENTS Out of Scope) |
| `tsup --dts` for declarations | rollup-plugin-dts under the hood | `tsc -b` with `composite` | Project references only work with real tsc |

---

## 13. Common Pitfalls

### Pitfall 1: tsup clean + tsc .d.ts race
**What goes wrong:** tsup default `clean: true` wipes `dist/` on each run; tsc's `.d.ts` files get deleted.
**How to avoid:** `clean: false` in tsup config; explicit `prebuild: "rimraf dist"` script.
**Warning sign:** `attw` reports missing types intermittently.

### Pitfall 2: `types` condition listed last in exports
**What goes wrong:** TypeScript resolves the wrong condition; attw reports `types-resolves-to-js`.
**How to avoid:** Always list `types` FIRST in every exports block.

### Pitfall 3: pnpm workspace discovery picks up `examples/echo-bot-rust`
**What goes wrong:** pnpm warns (or errors, depending on version) on a directory in the workspace glob without a `package.json`.
**How to avoid:** Explicit `"!examples/echo-bot-rust"` exclusion, or document that pnpm silently skips Cargo dirs.

### Pitfall 4: `changeset status` with no origin/main fetched in CI
**What goes wrong:** `git fetch origin main` missing → `changeset status --since=origin/main` blows up with "unknown revision".
**How to avoid:** `fetch-depth: 0` in `actions/checkout` AND an explicit `git fetch origin main` step before `changeset status`.

### Pitfall 5: attw + pnpm pack with workspace: protocol
**What goes wrong:** Default attw shells out to `npm pack`, which can misbehave with `workspace:*` specifiers.
**How to avoid:** Pre-pack with `pnpm pack`, then pass the tarball path to attw — don't rely on attw's implicit pack.

### Pitfall 6: Branch protection not enforced
**What goes wrong:** CI exists, but GitHub doesn't require the checks. PRs merge red.
**How to avoid:** After first green run, enable branch protection with all six checks required. This is a GitHub repo settings task, NOT a code task — plan a manual step.

### Pitfall 7: Forgetting `composite: true` in tsconfig
**What goes wrong:** `tsc -b` runs, emits nothing useful, no error.
**How to avoid:** `composite: true` in `tsconfig.base.json` — inherited by every package.

### Pitfall 8: Biome ignoring generated files
**What goes wrong:** `dist/` contents linted, thousands of errors.
**How to avoid:** Explicit `files.ignore` in `biome.json` for `**/dist/**`, `**/.tsbuildinfo`, `.changeset/**`.

---

## 14. Runtime State Inventory

This phase is part-rename (D1), so the inventory applies:

| Category | Items found | Action required |
|----------|-------------|------------------|
| Stored data | None — no databases, no Mem0 scopes keyed to "sdk-typescript" | None |
| Live service config | None — no deployed services, no n8n, no Datadog, no CI integrations depending on the old path | None |
| OS-registered state | None — no pm2, no systemd, no Task Scheduler | None |
| Secrets/env vars | None — only env var referenced is `KLANK_TOKEN` / `KLANK_SERVER_URL` in user bot code; unrelated to rename | None |
| Build artifacts / installed packages | `packages/sdk-typescript/dist/` will become stale after rename; not committed (no lockfile exists yet so no cached pnpm store either) | Delete `packages/sdk-typescript/dist/` if present before `git mv` (or let `git mv` take it, then `rm -rf packages/sdk/dist`); reinstall after rename |

**Canonical question check:** "After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?"

**Answer: nothing.** The repo has zero live services, zero published tags referencing `sdk-typescript` as a path (the npm tag is `@klank/sdk@0.1.0` — name, not path), zero CI pipelines to invalidate (none exist yet). The rename is purely file-system.

**One concrete callout:** if anyone has cloned the repo locally with their IDE, their TS project server will cache the old path. Not something the planner can fix — note it in the commit message and PR description.

---

## 15. Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node 20+ | everything (D2) | ✓ (assumed; confirm in task 1) | — | none — blocking |
| pnpm 9+ | workspace | ✓ (assumed; `corepack enable` if missing) | — | install via npm |
| git | rename, CI | ✓ | — | none |
| GitHub Actions runners | CI | ✓ (public repo) | ubuntu-latest | — |
| npm registry access | `pnpm install`, `npm view` version checks | ✓ | — | — |

**Action for planner:** first task should run `node --version && pnpm --version && git --version` and fail fast if anything is missing or older than required.

---

## 16. Validation Architecture (Nyquist)

### Test framework
| Property | Value |
|----------|-------|
| Framework | vitest ^3.0 (already in devDeps) |
| Config file | none yet — Phase 1 adds `packages/sdk/vitest.config.ts` |
| Quick run command | `pnpm --filter @klank/sdk test` |
| Full suite command | `pnpm test` (root, fans out to all workspace packages) |

### Phase requirements → test map

Phase 1 is infra — most validation is "does this command exit 0?" rather than unit tests. But per CLAUDE.md testing integrity, the smoke test we add MUST exercise real behavior.

| Req | Behavior | Test type | Automated command | File exists? |
|-----|----------|-----------|-------------------|-------------|
| HOUSE-01 | pnpm workspace resolves | infra smoke | `pnpm install --frozen-lockfile && test -f pnpm-lock.yaml` | ❌ Wave 0 |
| HOUSE-02 | rename committed, old path gone | infra smoke | `test ! -d packages/sdk-typescript && test -d packages/sdk` | ❌ Wave 0 |
| HOUSE-03 | `tsc -b` green across workspace | type-check | `pnpm exec tsc -b` | ❌ Wave 0 |
| HOUSE-04 | biome catches `noExplicitAny` + unused imports | lint rule | `pnpm lint` on a fixture file containing `const x: any = 1` → expect non-zero exit | ❌ Wave 0 |
| HOUSE-05 | changeset status exits 0 with empty state | tooling smoke | `pnpm changeset status` | ❌ Wave 0 |
| HOUSE-06 | attw runs and passes against built sdk | tarball inspection | `pnpm --filter @klank/sdk build && pnpm --filter @klank/sdk exec attw --pack .` | ❌ Wave 0 |
| HOUSE-07 | CI workflow file is valid YAML and references required jobs | schema test | `node scripts/validate-ci.mjs` or rely on GitHub's own parse on first push | ❌ Wave 0 |
| HOUSE-08 | LICENSE + CHANGELOG present and non-empty | file smoke | `test -s LICENSE && test -s packages/sdk/CHANGELOG.md` | ❌ Wave 0 |

### The one real test we should add

A **single unit test** in `packages/sdk/src/__tests__/smoke.test.ts` that:
1. Imports the top-level `@klank/sdk` via the package's own build output (or source, depending on vitest config).
2. Asserts `KlankBot`, `KlankClient`, `WebhookBot`, and types are exported as expected.
3. Exists solely to prove the test harness works end-to-end.

```ts
// packages/sdk/src/__tests__/smoke.test.ts
import { describe, expect, it } from 'vitest'
import * as sdk from '../index'

describe('@klank/sdk public surface', () => {
  it('exports core classes', () => {
    expect(sdk.KlankBot).toBeTypeOf('function')
    expect(sdk.KlankClient).toBeTypeOf('function')
    expect(sdk.WebhookBot).toBeTypeOf('function')
  })
})
```

This is a real test by CLAUDE.md standards — it imports the actual built code and asserts something true. It catches: accidental export removal, build system producing empty modules, tsup config regression. It is NOT a mock. Phase 2 replaces/augments it with real behavior tests for the WebhookBot fix.

### Sampling rate

- **Per task commit:** `pnpm --filter @klank/sdk test` (~2s)
- **Per wave merge:** `pnpm build && pnpm lint && pnpm test && pnpm attw && pnpm tarball:check` (~30s)
- **Phase gate:** full CI workflow green on a PR from a feature branch → main

### Wave 0 gaps

- [ ] `packages/sdk/vitest.config.ts` — vitest config
- [ ] `packages/sdk/src/__tests__/smoke.test.ts` — the one real smoke test
- [ ] `packages/sdk/.tarball-snapshot.txt` — generated from first `pnpm pack`
- [ ] `scripts/check-tarball.mjs` — the diff script (§4)
- [ ] `biome.json` — lint/format config
- [ ] `.changeset/config.json` — changesets config (via `pnpm changeset init`, then edit)
- [ ] `.github/workflows/ci.yml` — CI
- [ ] `LICENSE` — MIT
- [ ] `packages/sdk/CHANGELOG.md` — seeded 0.1.0 entry
- [ ] `tsconfig.base.json`, root `tsconfig.json`, per-package `tsconfig.json` — TS project references
- [ ] Root `package.json` — workspace scripts
- [ ] `pnpm-workspace.yaml`
- [ ] Example `package.json` files (x3: echo-bot-ts, ci-bot-ts, webhook-bot)

---

## 17. Security Domain

Phase 1 is tooling-only; no runtime attack surface changes. Standard supply-chain controls only:

| ASVS category | Applies? | Control |
|---------------|----------|---------|
| V14 Configuration | Yes | `pnpm install --frozen-lockfile` in CI; `packageManager` field pins pnpm version; Node version pinned in `actions/setup-node` |
| V14.2 Dependency management | Yes | Committed `pnpm-lock.yaml`; GitHub Dependabot or Renovate should be configured (defer to a follow-up if not in Phase 1) |
| All others | No | No auth, sessions, crypto, input validation, access control, etc. in this phase |

### Supply-chain threat patterns

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Malicious dependency pulled via non-frozen lockfile | Tampering | `--frozen-lockfile` in every CI job |
| Registry substitution attack | Tampering | Default registry (`https://registry.npmjs.org`), no `.npmrc` overrides |
| Build script exfiltration (postinstall) | Info disclosure | Audit any new devDep's `postinstall` before adding; pnpm's default is to run them (note: pnpm 10+ changes this default — verify when pinning) |

`[ASSUMED]` — pnpm 10's postinstall default is stricter than 9's; this research recommends pnpm 9 for now. Planner can revisit.

---

## 18. Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|----------------|
| A1 | biome 1.9 is current stable and rule names match above | §5 | Config rejected on install; planner re-runs `npm view` and updates |
| A2 | attw 0.17 `--pack` works cleanly in pnpm workspaces | §3 | Fallback to `pnpm pack` + explicit tarball path |
| A3 | tsup 8.3 respects `clean: false` + ESM output without `--dts` | §1 | Planner verifies on first build; fallback to using rolldown/other |
| A4 | `pnpm changeset status --since=origin/main` exits non-zero if a publishable package has diffs without a changeset | §5 | Fallback to `changesets/action@v1` with `setupGitUser: false, mode: status` |
| A5 | pnpm 9.12 is latest stable in the 9.x line | §1, §6 | Harmless — planner pins latest available |
| A6 | All listed devDep versions are current | §11 | `npm view` verification is first task; any stale number just needs updating |
| A7 | `actions/setup-node@v4` with `cache: pnpm` requires `packageManager` field in root package.json | §7 | If not, add explicit `actions/cache` step for the pnpm store |
| A8 | pnpm 9 runs install postinstall scripts by default | §17 | pnpm 10 has a stricter default; if planner upgrades, revisit |
| A9 | `examples/echo-bot-rust` is silently skipped by `examples/*` glob | §1, §10 | Explicit exclusion is the safer bet — planner uses that by default |
| A10 | attw problem classes list | §3 | Informational only; exact class names don't affect CI wiring |

The planner and verifier should treat every row here as a "confirm before locking" item. None block Phase 1 — they just need verification during execution.

---

## 19. Open Questions

1. **Does pnpm 9.12 `pnpm pack` produce a deterministic tarball file-listing order?**
   - What we know: `tar -tzf` on pnpm-packed tarballs returns a consistent order in practice.
   - What's unclear: whether this is guaranteed across pnpm versions.
   - Recommendation: our `check-tarball.mjs` sorts both sides before diffing, so order doesn't matter.

2. **Should create-bot get a placeholder `package.json` now, or be excluded from the workspace until Phase 9?**
   - What we know: it currently has `src/index.ts` only, no `package.json`, no tests, no build.
   - What's unclear: whether pnpm workspace discovery will cleanly ignore it or warn.
   - Recommendation: add a minimal `{ "name": "create-klank-bot", "private": true, "version": "0.0.0-phase9" }` placeholder so pnpm is happy, mark it in changesets `ignore`, don't add it to tsc references.

3. **`publishConfig.access: "public"` on root vs per-package?**
   - What we know: scoped packages default to private; must be flipped per-package.
   - What's unclear: whether changesets respects a root-level setting.
   - Recommendation: set it on `packages/sdk/package.json` explicitly — belt and suspenders.

4. **Is there a reason to cache `dist/.tsbuildinfo` in CI across runs?**
   - What we know: `tsc -b --incremental` is much faster when `.tsbuildinfo` is preserved.
   - What's unclear: caching the file across GitHub Actions runs is fiddly (cache key on source file hashes).
   - Recommendation: skip for Phase 1; revisit only if CI >5min. The cold `tsc -b` on 5 files is ~3s.

---

## 20. Sources

### Primary (HIGH confidence — state as fact)
- pnpm workspace docs (`pnpm.io/workspaces`) — workspace YAML, filter flags, pack
- TypeScript project references handbook (`typescriptlang.org/docs/handbook/project-references.html`) — `composite`, `references`, solution-style tsconfig
- tsup README (`tsup.egoist.dev`) — config options, dts notes
- `arethetypeswrong/arethetypeswrong.github.io` README — problem classes, --pack flag
- changesets docs (`github.com/changesets/changesets`) — config schema, `status` command
- Biome docs (`biomejs.dev/guides`) — CI recipe, rule naming, `biome ci` command
- GitHub Actions `pnpm/action-setup` + `actions/setup-node` official READMEs
- Existing repo files: `packages/sdk-typescript/package.json`, `tsconfig.json`, `BASELINE-REPORT.md`, `SDK-REFRESH-ROADMAP.md`, `CONTEXT.md`

### Secondary (MEDIUM)
- Community consensus on "tsc emits .d.ts, tsup emits JS" split — widely recommended but I could not cite a single canonical URL; it's repo-conventional wisdom (vercel/turbo, shadcn/ui, many t3-oss repos use variants of this).

### Tertiary (LOW — flagged for verification in task 1)
- Exact current version numbers for all devDeps (§11) — planner verifies via `npm view` before writing package.json
- pnpm 10 postinstall default behavior claim (§17)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (all tools are canonical, versions flagged for verification)
- Architecture: HIGH (the tsc/tsup split is the idiomatic library monorepo recipe)
- CI shape: HIGH (GitHub Actions + pnpm is well-trodden)
- Pitfalls: HIGH (all from direct experience or well-documented community reports)
- Rename mechanics: HIGH (repo is tiny and well-understood from BASELINE)
- attw invocation details: MEDIUM (exact flag behavior per version — verify on install)

**Research date:** 2026-04-07
**Valid until:** 2026-05-07 (30 days; biome and changesets move faster, re-check if Phase 1 execution slips)
