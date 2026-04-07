# Technology Stack

**Analysis Date:** 2026-04-07
**Package:** `@klank/sdk@0.1.0` (`packages/sdk-typescript/package.json`)

## Languages

**Primary:**
- TypeScript ^5.0.0 — entire SDK source under `packages/sdk-typescript/src/`
- Target: `ES2022`, module `ESNext`, `moduleResolution: "bundler"`, `strict: true` (`packages/sdk-typescript/tsconfig.json:3-7`)

**Secondary:**
- Rust — only `examples/echo-bot-rust/src/main.rs` (single hand-rolled file using reqwest + tokio-tungstenite). Not a published crate. The README's "TypeScript or Rust" headline is unbacked: there is no `packages/sdk-rust/`.

## Runtime

**Environment:**
- Node.js (server-side). No `engines` field in `package.json`. No `.nvmrc`. Implied by `ws` dep + `import WebSocket from 'ws'` in `packages/sdk-typescript/src/ws.ts:1`.
- Uses global `fetch` (Node ≥ 18 required, undeclared) — `packages/sdk-typescript/src/client.ts:22`, `packages/sdk-typescript/src/webhook.ts:13`.

**Package Manager:**
- Not declared. **No lockfile committed** (no `package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock` at repo root or in `packages/sdk-typescript/`).
- Repo is shaped like a monorepo (`packages/`, `examples/`, `templates/`) but has **no root `package.json`** and no workspace declaration (no pnpm-workspace.yaml, no `workspaces` field).

## Frameworks

**Core:**
- None. The SDK is dependency-light: a thin REST wrapper + `ws` client + event router.

**Testing:**
- `vitest ^3.0.0` declared in `devDependencies` (`package.json:27`).
- **Zero test files exist** anywhere in the repo. `npm test` runs `vitest` against nothing.

**Build/Dev:**
- `tsup ^8.0.0` — bundler. Invoked inline as `tsup src/index.ts --format cjs,esm --dts` (`package.json:16`). **No `tsup.config.ts`** — all build config is the CLI flag string.
- `dev` script: `tsup ... --watch`.
- No `prepublishOnly`, no `clean`, no version-bump tooling, no `release` script.

## Key Dependencies

**Runtime (`dependencies`):**
- `ws ^8.0.0` — WebSocket client used by `WsManager` (`packages/sdk-typescript/src/ws.ts`). Only runtime dep.

**Dev (`devDependencies`):**
- `tsup ^8.0.0` — bundler
- `typescript ^5.0.0`
- `@types/ws ^8.0.0`
- `vitest ^3.0.0`

That is the entire dep tree. No HTTP client (uses native `fetch`), no logger, no validator, no crypto helper (will need `node:crypto` for upcoming HMAC work in webhook + slash command verification).

## Configuration

**Package outputs (`package.json:5-15`):**
- `main`: `dist/index.js` (CJS)
- `module`: `dist/index.mjs` (ESM)
- `types`: `dist/index.d.ts`
- `exports."."`: dual import/require/types

**TS config (`packages/sdk-typescript/tsconfig.json`):**
- `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`
- `strict: true`, `esModuleInterop: true`, `declaration: true`
- `include: ["src"]`
- No `lib` array, no `types` array, no path aliases.

**Build:**
- Single entry: `src/index.ts` → `dist/{index.js, index.mjs, index.d.ts}` via tsup.

## Platform Requirements

**Development:**
- Node ≥ 18 (implicit — global `fetch`)
- TypeScript 5.x
- A package manager of the user's choice (no lockfile to enforce one)

**Production:**
- Node server-side runtime. Not browser-targeted (uses `ws` package, which is Node-only).

## Repository shape (monorepo claim vs reality)

```
rust-slack-sdk/
├── packages/sdk-typescript/   # the only real package
├── examples/
│   ├── ci-bot-ts/
│   ├── echo-bot-ts/
│   ├── webhook-bot/
│   └── echo-bot-rust/         # single-file, not a crate
└── templates/typescript/src/  # EMPTY directory
```

- No root `package.json` / workspace manifest.
- `examples/*` have **no `package.json`** of their own — they cannot be installed or run as standalone projects.
- `templates/typescript/src/` is an empty directory (`npx create-klank-bot` story is vapor).

## Missing pieces (deliberate gaps to flag)

| Concern | Status |
|---|---|
| Lint config | **None.** No `.eslintrc*`, no `eslint.config.*`, no `biome.json`. |
| Format config | **None.** No `.prettierrc*`. |
| Tests | **Zero `*.test.ts` files.** `vitest` is declared but unused. |
| CI | **None.** No `.github/` directory at all. |
| Lockfile | **None.** Package manager is undeclared. |
| Workspace manifest | **None.** Not a real monorepo despite the `packages/` layout. |
| Changelog | **None.** No `CHANGELOG.md`. |
| LICENSE file | **None.** README claims MIT; no `LICENSE` file at repo root. |
| `prepublishOnly` hook | **None.** Nothing prevents publishing without a build. |
| Typedoc / API ref generation | **None.** |
| `tsup.config.ts` | **None** — config is the CLI string in `package.json:16`. |
| `engines` field | **None** — Node version requirement is implicit. |

---

*Stack analysis: 2026-04-07*
