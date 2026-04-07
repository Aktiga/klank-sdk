# Codebase Structure

**Analysis Date:** 2026-04-07

## Directory Layout

```
rust-slack-sdk/
├── README.md                              # 291 lines — markets "TypeScript or Rust" (Rust is vapor)
├── .gitignore
├── .planning/                             # Out-of-band: BASELINE-REPORT, SDK-REFRESH-ROADMAP, codebase/, handoff/
├── docs/
│   ├── getting-started.md                 # 129 lines
│   └── deploying-bots.md                  # 193 lines
├── packages/
│   ├── sdk-typescript/                    # The only real package
│   │   ├── package.json                   # name "@klank/sdk", version 0.1.0
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                   # 4 lines  — barrel
│   │       ├── bot.ts                     # 206 lines — KlankBot class
│   │       ├── client.ts                  # 97 lines  — KlankClient REST
│   │       ├── ws.ts                      # 72 lines  — WsManager
│   │       ├── webhook.ts                 # 31 lines  — WebhookBot (currently broken)
│   │       └── types.ts                   # 158 lines — hand-written types
│   └── create-bot/                        # EMPTY scaffold dir
│       └── src/                           # EMPTY (no files)
├── templates/
│   └── typescript/
│       └── src/                           # EMPTY (no files) — README implies a `create-klank-bot` story
└── examples/
    ├── echo-bot-ts/
    │   └── index.ts                       # 38 lines — uses KlankBot
    ├── ci-bot-ts/
    │   └── index.ts                       # 51 lines — uses KlankBot/WebhookBot
    ├── webhook-bot/
    │   └── index.ts                       # 26 lines — uses WebhookBot
    └── echo-bot-rust/                     # NOT a crate the SDK ships; hand-rolled example
        ├── Cargo.toml
        └── src/
            └── main.rs                    # 105 lines — raw reqwest + tokio-tungstenite
```

Total source LOC (SDK + examples + docs + README): ~1,400 lines.

## Directory Purposes

**`packages/sdk-typescript/`:**
- Purpose: The published `@klank/sdk` npm package. The only real code home.
- Contains: `package.json`, `tsconfig.json`, `src/`. No `dist/`, no `tests/`, no `*.test.ts`, no lockfile, no `tsup.config.ts`.
- Key files: see `src/` table below.
- Build: `tsup src/index.ts --format cjs,esm --dts` declared in `package.json`.

**`packages/sdk-typescript/src/`:**
- All TypeScript source. Flat layout — no subdirectories.

**`packages/create-bot/`:**
- Purpose: Implied scaffolder for `npx create-klank-bot`. **Empty.** Only `src/` exists, with zero files.
- Status: vapor. Anything that wants to scaffold a bot has nothing to consume.

**`templates/typescript/src/`:**
- Purpose: Implied template body for the scaffolder. **Empty.** Directory exists; contains zero files.
- Status: vapor. Mirrors `packages/create-bot/`.

**`docs/`:**
- Purpose: Hand-written prose docs.
- Contains: `getting-started.md` (129 lines), `deploying-bots.md` (193 lines).
- Notes: Both reference Rust as a peer to TypeScript, which is misleading per `BASELINE-REPORT.md` §3. No API reference, no typedoc, no migration guide, no security/signing recipes.

**`examples/`:**
- Purpose: Standalone bot snippets demonstrating the SDK.
- Contains: four subdirs. **None has its own `package.json`** — they cannot be installed/run as standalone projects (`BASELINE-REPORT.md` §4).

**`examples/echo-bot-rust/`:**
- A `Cargo.toml` and a single `src/main.rs` (105 lines). It hand-codes `reqwest` + `tokio-tungstenite` against the Klank API. **It is the entire "Rust support" story** — there is no `packages/sdk-rust/`, no published crate, no library code. Despite the repo name `rust-slack-sdk` and README headlines, the SDK is TypeScript-only.

**`.planning/`:**
- Out-of-tree planning artefacts. Contains `BASELINE-REPORT.md`, `SDK-REFRESH-ROADMAP.md`, `codebase/` (this analysis), `handoff/`. Not part of the published package.

## Key File Locations

**Library entry:**
- `packages/sdk-typescript/src/index.ts` (4 lines): `export { KlankBot } from './bot'; export { WebhookBot } from './webhook'; export { KlankClient } from './client'; export type * from './types'`.

**Configuration:**
- `packages/sdk-typescript/package.json`: name `@klank/sdk`, version `0.1.0`, dep `ws ^8.0.0`, devDeps `tsup`, `typescript`, `@types/ws`, `vitest`.
- `packages/sdk-typescript/tsconfig.json`.
- No `.eslintrc*`, no `.prettierrc*`, no `tsup.config.ts`, no `vitest.config.ts`, no lockfile (`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`), no `.nvmrc`, no `.github/`, no `LICENSE` (despite README claiming MIT), no `CHANGELOG.md`.

**Core logic:**
- Bot framework: `packages/sdk-typescript/src/bot.ts` (206 lines).
- REST client: `packages/sdk-typescript/src/client.ts` (97 lines).
- WS transport: `packages/sdk-typescript/src/ws.ts` (72 lines).
- Webhook poster: `packages/sdk-typescript/src/webhook.ts` (31 lines).
- Types: `packages/sdk-typescript/src/types.ts` (158 lines).

**Testing:**
- None. `vitest` is in devDeps, and `package.json` declares `"test": "vitest"`, but there is no `*.test.ts` anywhere in the repo.

## Source File Sizes

| File | Lines | Role |
|---|---|---|
| `packages/sdk-typescript/src/bot.ts` | 206 | `KlankBot` framework class |
| `packages/sdk-typescript/src/types.ts` | 158 | All public types and event union |
| `packages/sdk-typescript/src/client.ts` | 97 | `KlankClient` REST surface |
| `packages/sdk-typescript/src/ws.ts` | 72 | `WsManager` WS transport |
| `packages/sdk-typescript/src/webhook.ts` | 31 | `WebhookBot` (broken vs current server) |
| `packages/sdk-typescript/src/index.ts` | 4 | Barrel re-exports |
| `examples/ci-bot-ts/index.ts` | 51 | Example |
| `examples/echo-bot-ts/index.ts` | 38 | Example |
| `examples/webhook-bot/index.ts` | 26 | Example |
| `examples/echo-bot-rust/src/main.rs` | 105 | Hand-rolled Rust example (NOT a crate the SDK ships) |
| `docs/deploying-bots.md` | 193 | Prose doc |
| `docs/getting-started.md` | 129 | Prose doc |
| `README.md` | 291 | Marketing + quickstart |

## Naming Conventions

**Files:** lowercase, no separators, one class per file (`bot.ts`, `client.ts`, `ws.ts`, `webhook.ts`, `types.ts`, `index.ts`).

**Directories:** lowercase kebab-case (`sdk-typescript`, `echo-bot-ts`, `webhook-bot`).

**Examples:** suffix `-ts` or `-rust` to mark language.

## Where to Add New Code

**New SDK module (e.g., slash-command verifier per roadmap M-3):**
- Implementation: `packages/sdk-typescript/src/<feature>.ts`
- Re-export: add a line to `packages/sdk-typescript/src/index.ts`
- Types: add to `packages/sdk-typescript/src/types.ts` (single shared type file — no per-module type files today)

**New example:**
- Directory: `examples/<name>-ts/index.ts`
- Currently no per-example `package.json`; if you add one, you'll be the first.

**New tests:**
- No convention exists. The path the toolchain implies (`vitest` in devDeps) is co-located `*.test.ts` next to source, e.g. `packages/sdk-typescript/src/webhook.test.ts`. There is currently zero test infrastructure to copy.

**New docs:**
- Prose: `docs/<topic>.md`.
- Migration guide path implied by roadmap: `docs/migration/0.1-to-0.2.md` — the `migration/` directory does not yet exist.

**New scaffolder code or templates:**
- The empty `packages/create-bot/src/` and `templates/typescript/src/` directories are pre-allocated for this; both are zero-file today.

## Special Directories

**`packages/create-bot/src/`:**
- Purpose: Intended `create-klank-bot` scaffolder.
- Contains: nothing.
- Generated: No.
- Committed: Yes (the empty dir is in git).

**`templates/typescript/src/`:**
- Purpose: Intended template body for the scaffolder.
- Contains: nothing.
- Generated: No.
- Committed: Yes.

**`examples/echo-bot-rust/`:**
- Purpose: A single hand-rolled Rust example. **Not a crate that the SDK ships, exports, or supports.** The entirety of the repo's "Rust" surface area is this one `src/main.rs` plus a `Cargo.toml`. There is no `packages/sdk-rust/`, no library, no published crate. The repo name `rust-slack-sdk` is a vestigial misnomer; the SDK is TypeScript-only.
- Generated: No.
- Committed: Yes.

**`.planning/`:**
- Purpose: Planning/analysis artefacts. Not part of the package.
- Generated: No (hand-authored).
- Committed: Yes.

---

*Structure analysis: 2026-04-07*
