# Technology Stack — SDK Refresh Additions

**Project:** `@klank/sdk` v0.2 → v0.4 refresh
**Researched:** 2026-04-07
**Scope:** Only NEW stack additions/changes for the refresh. Baseline stack (Node 18+, TS 5.x, tsup 8, ws 8, vitest 3) is intentionally preserved from `.planning/codebase/STACK.md` and NOT re-justified here.
**Overall confidence:** MEDIUM–HIGH

---

## TL;DR — Recommended Additions

| # | Concern | Pick | Version (Apr 2026) | Confidence |
|---|---------|------|--------------------|------------|
| 1 | HMAC for webhook + slash-cmd verify | **Node built-in `node:crypto`** | built-in | HIGH |
| 2 | HTTP receiver adapter (Phase B) | **Framework-agnostic: `(req,res)` Node http signature + `WebRequest`/`Response` helper** | n/a | HIGH |
| 3 | MLS for E2EE bots (Phase F-E2EE) | **Wire `core-crypto` WASM (wraps OpenMLS)** — defer concrete until phase start | core-crypto 4.x / openmls 0.7.x | LOW |
| 4 | Redis adapter package | **`ioredis` ^5.5** (in `@klank/sdk-redis`) | 5.5.x | HIGH |
| 5 | SQLite adapter package | **`better-sqlite3` ^12** (in `@klank/sdk-sqlite`) | 12.x | HIGH |
| 6 | TS type generation (SDK side) | **`openapi-typescript` ^7.13** | 7.13.0 | HIGH |
| 6b | OpenAPI generation (server side) | **`utoipa` ^5 + `utoipa-axum` ^0.2** | utoipa 5.x | HIGH |
| 6c | OpenAPI CI orchestration | GitHub Actions: server job publishes `openapi.json` artifact → SDK job runs `openapi-typescript` and commits `types.gen.ts` via PR | n/a | MEDIUM |
| 7 | API docs generator | **`typedoc` ^0.28** + default theme (DMT optional later) | 0.28.17 | HIGH |
| 8 | Lint + format | **`biome` ^2.3** (single tool replaces eslint+prettier) | 2.3.x | HIGH |
| 9 | HTTP mocking in tests | **`undici` `MockAgent`** (built into Node 18+) | built-in | HIGH |
| 10 | MCP package (Phase I) | **`@modelcontextprotocol/sdk` ^1.29** | 1.29.0 | HIGH |
| — | WS test harness | in-process fake via `ws` `Server` class | ws 8 (already) | HIGH |
| — | CLI watcher (Phase D) | `chokidar` ^4 | 4.x | MEDIUM |

**Total new runtime deps added to `@klank/sdk` core:** **ZERO.** All additions are (a) built-in, (b) dev-only, or (c) in *separate* packages (`@klank/sdk-redis`, `@klank/sdk-sqlite`, `@klank/sdk-cli`, `mcp-klank`).

This is intentional — the PROJECT constraint says *"keep core dep-light; adapters ship as separate packages"*.

---

## 1. HMAC helper — use `node:crypto`, do NOT add `@noble/hashes`

### Decision
Use the Node built-in `crypto.createHmac('sha256', rawSecret).update(bodyBuffer).digest('hex')` for both Migration M-1 (`WebhookBot` signing) and M-3 (`verifySlashCommandSignature`). Use `crypto.timingSafeEqual` for the comparison path in the verifier.

### Why not `@noble/hashes`?
- `node:crypto` is present in every target runtime (Node 18+), cryptographically audited, zero install cost, zero supply-chain exposure.
- `@noble/hashes` is excellent, but its value is (a) cross-runtime (browser/Deno/Bun) and (b) constant-time pure-JS. We are Node-only per existing constraint; adding it would be a pure regression on the "dep-light core" constraint.
- The server side verifier uses `hmac` + `subtle::ConstantTimeEq` (`crates/rs-bots/src/webhooks.rs`). Node's `crypto.timingSafeEqual` is the exact equivalent; parity is trivial.

### Implementation note (load-bearing)
Serialize body bytes ONCE. Sign those exact bytes. Send those exact bytes. Never re-`JSON.stringify` between sign and POST — the baseline report already flags this trap. For the verifier, accept `Buffer | Uint8Array` raw body and parse `sha256=` prefix explicitly; reject missing prefix.

**Confidence: HIGH** — Node docs, server source inspection.

---

## 2. HTTP receiver adapter pattern — Phase B

### Decision
Export **a plain `(req: IncomingMessage, res: ServerResponse) => Promise<void>` handler factory** (`createSlashCommandReceiver({ signingSecret, handler })`). Do **not** depend on h3, itty-router, Hono, Express, or any framework.

Additionally export a lower-level primitive that takes `(rawBody: Buffer, headers: Record<string,string>)` and returns `{ status, headers, body }` so users on Lambda / Vercel Edge / Cloudflare Workers / Hono / Fastify can wire it into whatever they already have in ~5 lines.

### Why framework-agnostic over h3 / itty-router
- **h3** is excellent but pulls in its own runtime abstractions (`H3Event`, router). If a user is on Express/Fastify/Hono/Lambda, h3 is dead weight.
- **itty-router** is router-oriented, not request-verification-oriented — wrong layer.
- **Plain Node `http` signature** is the universal substrate: every Node framework has a `(req,res)` adapter, and the primitive `(rawBody, headers) → {status,body}` form is trivially portable to Edge runtimes where `IncomingMessage` doesn't exist.
- Precedent: `@slack/bolt` went framework-specific and regretted it; `@octokit/webhooks` took the primitive approach and is cited as the clean path.

### Critical implementation detail
The handler MUST capture the **raw request body before JSON parsing** — any `express.json()` / `bodyParser` middleware upstream will break signature verification. Document this loudly in the recipe (Phase H) and export a `getRawBody(req)` helper for Node http users.

**Confidence: HIGH** — pattern is well-established; depends only on Node built-ins.

---

## 3. MLS library for E2EE bots — Phase F-E2EE (deferred, LOW confidence)

### Current state
- `openmls` (Rust crate, [github.com/openmls/openmls](https://github.com/openmls/openmls)) implements RFC 9420 MLS. Compiles to WASM.
- **`core-crypto`** ([wireapp/core-crypto](https://wireapp.github.io/core-crypto/core_crypto/)) is Wire's ergonomic wrapper over OpenMLS with **official WASM + TS bindings** and mobile FFI. This is what you actually consume from TS — you do NOT want to touch raw OpenMLS bindgen yourself.
- `@matrix-org/olm` is Double Ratchet (Olm/Megolm), **not MLS**. Matrix is migrating *away* from it toward MLS. Reject.

### Recommendation
When Phase F-E2EE starts: use **`core-crypto` WASM** as the TS-side MLS engine, living inside a dedicated `@klank/sdk-e2ee` package (NEVER core). The `rust-slack` server already has MLS-related crypto state; the SDK-side bot identity needs its own KeyPackage generation + group join flow, which core-crypto exposes.

### Why defer concrete version pinning
- Phase F-E2EE is multi-milestone away; versions will move.
- The server's MLS surface (`klank-crypto` crate if present, or wherever `b9cb1da` put E2EE enforcement) needs a paired audit at phase start — the SDK cannot pick an MLS version unilaterally; ciphersuite, credential type, and KeyPackage lifecycle must match what the server accepts.
- **Open question for the server team at phase start:** what ciphersuite does the server require? What credential format (basic vs X.509)? Is there a server-side bot-keypackage registration endpoint, or must bots upload via the same flow as human clients?

### Anti-choice
- Do NOT attempt to reimplement MLS in pure TS. The audited Rust→WASM path is the only responsible option.
- Do NOT ship MLS in `@klank/sdk` core — a 2MB+ WASM blob in a "send a slack message" SDK is user-hostile. Split package.

**Confidence: LOW** — deliberate; this phase needs its own dedicated research spike before execution.

---

## 4. Redis adapter — `@klank/sdk-redis`

### Decision
**`ioredis` ^5.5** in a new package `@klank/sdk-redis`.

### Why `ioredis` over `redis` (node-redis)
- Both are healthy. `redis` v5 is modernized but `ioredis` still leads on: cluster, sentinel, pipeline ergonomics, graceful reconnect, and — importantly for a bot SDK — a terser Promise API with sensible defaults.
- `ioredis`'s connection lifecycle is closer to what long-running bot processes need (auto-reconnect without re-queuing lost writes).
- API stability: the adapter surface is tiny (`get/set/del/expire`), so lock-in is effectively zero.

### Package shape
```
@klank/sdk-redis
  exports: { RedisStateStore }
  peer: @klank/sdk@^0.3
  dep: ioredis ^5.5
```
Constructor takes an existing `Redis` instance (injected) — do **not** instantiate inside the adapter. This is the one hard rule: users already have Redis clients, let them pass one in.

**Confidence: HIGH** for choice; API surface is tiny and well-understood.

---

## 5. SQLite adapter — `@klank/sdk-sqlite`

### Decision
**`better-sqlite3` ^12** in a new package `@klank/sdk-sqlite`.

### Why not `node:sqlite`
Node 22 ships an experimental `node:sqlite` module. As of early 2026 it is (a) still flagged experimental, (b) requires opt-in CLI flag in some configurations, and (c) Node's own docs recommend against production use. Once it's stable (likely Node 24 LTS) revisit.

### Why not `sql.js`
`sql.js` is SQLite compiled to WASM. Fine for browser; pointless in Node where `better-sqlite3` gives native speed with the same synchronous API.

### `better-sqlite3` fit
- Synchronous API is actually a feature here: state store `get/set` is called from event handlers where the user already awaits the handler; blocking on a local SQLite read is faster than a context switch.
- Mature, production-proven, tiny API surface.
- Native module — document the prebuilt-binary story and Node version compatibility in the package README.

**Confidence: HIGH.**

---

## 6. OpenAPI toolchain — utoipa + openapi-typescript

### Server side (rust-slack repo)
- **`utoipa` ^5** with `utoipa-axum` ^0.2 (axum is the server framework per `.planning/codebase/STACK.md`-adjacent server repo).
- Annotate every handler with `#[utoipa::path(...)]` and every DTO with `#[derive(ToSchema)]`.
- Add a `cargo run --bin dump-openapi > openapi.json` binary that serializes the `OpenApi` struct to a file. This is the pipeline seam.
- Do NOT ship `utoipa-swagger-ui` in production — dev only.

### SDK side (this repo)
- **`openapi-typescript` ^7.13** ([openapi-ts.dev](https://openapi-ts.dev/)) as a devDependency.
- Command: `npx openapi-typescript ./openapi.json -o packages/sdk-typescript/src/types.gen.ts`.
- Hand-written `types.ts` stays for domain-level aliases (`ServerEvent` discriminated union, `BotContext`, etc.) — the generated file covers REST request/response schemas only. Re-export from `types.ts` with explicit aliases so downstream code doesn't reach into `types.gen.ts` directly.
- **Do not pick `hey-api/openapi-ts`** for this use case. Hey-API is a client generator (produces SDK code); we already *have* a client. We only want types. openapi-typescript is the right layer.

### CI orchestration
Two repos, two jobs:

1. **rust-slack** CI: on every push to `main`, run `cargo run --bin dump-openapi` and upload `openapi.json` as a GitHub Actions artifact, and also commit it to a pinned path in `rust-slack` (`docs/openapi.json` or similar). Also publish as a release asset on tags.
2. **rust-slack-sdk** CI: on a `workflow_dispatch` + nightly schedule, fetch the latest `openapi.json` from the rust-slack main branch (or from the pinned tag matching the SDK's `Server Compatibility` README line), run `openapi-typescript`, and **open a PR** with the diff. Do NOT auto-merge — a human reviews the type drift (breaks are how we learn about server changes).

This pairs perfectly with the existing PROJECT decision: *"every SDK release must declare a tested server commit in README Server Compatibility"*.

**Confidence: HIGH** on tools, **MEDIUM** on the exact CI wiring (flexible).

---

## 7. TypeDoc — Phase H

### Decision
**`typedoc` ^0.28** with the default theme.

### Why default theme
The default theme in 0.28 has modern search, sidebar, and responsive layout — it's fine. Adding a custom theme (Neo, DMT) is a distraction pre-1.0 of the SDK and a future maintenance burden. If the docs site ends up embedded in a broader docs shell (e.g. VitePress landing → typedoc subtree for API ref), revisit then.

### Integration
- `typedoc` devDep only.
- Script: `"docs:api": "typedoc --out docs/api packages/sdk-typescript/src/index.ts"`.
- Exclude `types.gen.ts` from typedoc output (noisy, not part of the public API) via `--excludeInternal` + `@internal` tags.
- Commit `docs/api/` or publish to GitHub Pages via CI — pick in Phase H.

**Confidence: HIGH.**

---

## 8. Lint + format — Biome

### Decision
**`@biomejs/biome` ^2.3** replacing the (currently absent) eslint+prettier choice.

### Why Biome over eslint+prettier
The baseline has **no lint config at all**, so this is a greenfield pick — we're not migrating an ecosystem of custom rules. In a greenfield pick:
- One binary, one config file (`biome.json`), 10–25× faster, zero plugin-version hell.
- Biome 2.3 (Jan 2026) covers ~80% of common ESLint rules and has type-aware linting.
- The 20% gap is framework-specific plugins (React, Next) which are irrelevant to a Node-only SDK.
- Biome's formatter is a drop-in Prettier replacement for TS files.

### When Biome would be wrong
If this SDK needed framework plugins (react-hooks, next, etc.) or a specific custom-rule ecosystem (e.g. `eslint-plugin-boundaries`). It does not.

### Config
Start with `biome.json` extending `recommended`, enable `noExplicitAny: "error"` (we're a types-first SDK), enable `useImportType`, enable `noUnusedImports`. Wire `lint` and `format` scripts. Add CI check.

**Confidence: HIGH.**

---

## 9. Testing stack beyond vitest

### Decision
- Keep **`vitest` ^3** (already declared, finally gets used).
- Use **`undici`'s `MockAgent`** (a Node 18+ built-in via `import { MockAgent, setGlobalDispatcher } from 'undici'`) for intercepting `fetch` calls in unit tests.
- Use a real in-process `ws` `Server` from the `ws` package (already a dep) for WebSocket tests — spin up on an ephemeral port, point `KlankBot` at it, exercise the real WS handshake and ticket dance.
- **No `msw`.** **No `nock`.**

### Why undici `MockAgent` over `msw`
- The SDK's only HTTP transport is the global `fetch`, which in Node 18+ is `undici` under the hood. `MockAgent` intercepts at *exactly* the layer we need with zero new deps (undici is already shipped with Node).
- `msw` is great for full-stack app testing (intercepts at Service Worker / network level with handler composition). For a Node-only SDK testing a handful of REST endpoints, it's over-weight and has known friction intercepting native fetch in Node.
- `MockAgent` gives per-test `intercept().reply()`, `assertNoPendingInterceptors()`, and pending-interceptor enforcement out of the box — which is explicitly what the 2026 mocking comparison ([pkgpulse](https://www.pkgpulse.com/), [stateful blog](https://stateful.com/blog/undici-mocking)) calls out as MSW's gap.

### Phase E `MockKlank` test kit
The `MockKlank` from roadmap Phase E is a **higher-level** fake that wraps:
- undici `MockAgent` for REST
- A real in-process `ws.Server` for WS
- A public `deliver(event)` method and a `sentMessages` array

This is in-package (`@klank/sdk/testing` subpath export), not a new dep. Aligns with CLAUDE.md testing integrity: tests exercise real `KlankBot` routing code; mocks only cover the network boundary.

**Confidence: HIGH.**

---

## 10. MCP SDK — Phase I

### Decision
**`@modelcontextprotocol/sdk` ^1.29** ([npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk)) for `packages/mcp-klank/`.

### Notes
- Latest stable: **1.29.0** as of early April 2026. Actively maintained.
- A v2 is anticipated in Q1 2026 per the SDK release discussions; pin to `^1.29` and revisit when v2 ships. Document the compat story in the mcp-klank README.
- The MCP package is a *consumer* of `@klank/sdk`, not a dep of it — `@klank/sdk` core gains zero MCP bytes.

**Confidence: HIGH** on choice; **MEDIUM** on version stability across the phase window.

---

## Alternatives Considered (and rejected)

| Concern | Rejected | Why not |
|---------|----------|---------|
| HMAC | `@noble/hashes` | Adds runtime dep for no benefit on a Node-only SDK |
| HTTP receiver | `h3` | Pulls runtime abstractions; wrong for a library that must fit Express+Lambda+Hono+Vercel |
| HTTP receiver | `itty-router` | Router, not verifier — wrong layer |
| MLS | `@matrix-org/olm` | Olm/Megolm, not MLS; Matrix itself is migrating away |
| MLS | hand-rolled TS MLS | Reckless — audited Rust→WASM is the only responsible path |
| Redis | `redis` (node-redis) v5 | Fine, but `ioredis` has the edge on long-lived connection semantics |
| SQLite | `node:sqlite` | Still experimental, not prod-ready |
| SQLite | `sql.js` | WASM overhead pointless in Node |
| Type-gen | `hey-api/openapi-ts` | Client generator; we want types only |
| Type-gen | Hand-written types forever | Explicitly rejected in PROJECT.md Key Decisions |
| Lint | eslint + prettier | Greenfield pick; Biome is faster with less ceremony |
| Lint | Oxlint | Faster than Biome, but no formatter and narrower rule set — need both |
| HTTP mock | `msw` | Over-weight for SDK-level tests; fetch interception friction |
| HTTP mock | `nock` | Doesn't reliably intercept Node 18+ native fetch |
| Dev loop watcher | `tsx watch` | Fine but `chokidar` gives better control over restart semantics |

---

## Installation Summary

### `@klank/sdk` core (this package)
**Zero new runtime dependencies.** HMAC = built-in, HTTP receiver = built-in types.

Dev dependencies added:
```bash
npm install -D @biomejs/biome typedoc openapi-typescript
```
(vitest, tsup, typescript, @types/ws, ws already present)

### `@klank/sdk-redis` (new package, Phase C)
```bash
npm install ioredis
# peer: @klank/sdk ^0.3
```

### `@klank/sdk-sqlite` (new package, Phase C)
```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
# peer: @klank/sdk ^0.3
```

### `@klank/sdk-cli` (new package, Phase D)
```bash
npm install chokidar
```

### `mcp-klank` (new package, Phase I)
```bash
npm install @modelcontextprotocol/sdk @klank/sdk
```

### `@klank/sdk-e2ee` (new package, Phase F-E2EE — deferred)
Intentionally unspecified. Pick `core-crypto` WASM version at phase kickoff after a dedicated research spike.

### Server side (cross-repo, rust-slack)
```toml
# Cargo.toml
[dependencies]
utoipa = "5"
utoipa-axum = "0.2"

[dev-dependencies]
utoipa-swagger-ui = "9"
```

---

## Integration Conflicts & Flags

1. **Biome vs existing tsup config-in-CLI**: no conflict, but while adding `biome.json` consider also adding a `tsup.config.ts` file (baseline report flags its absence) — unrelated but cheap.
2. **openapi-typescript generation ordering**: `types.gen.ts` must be generated before `tsup` runs the build. Add a `prebuild` script. CI must fetch the server `openapi.json` before `npm run build`.
3. **`@klank/sdk-sqlite` native module**: `better-sqlite3` is a compiled addon. Users on Alpine/musl / unusual arches will hit prebuilt-binary gaps. Document in the package README + keep the adapter package optional (peer of core).
4. **`ioredis` and multi-tenant processes**: the `RedisStateStore` must NOT instantiate its own client — inject an existing one — otherwise users with per-tenant Redis databases can't share connections. Hard requirement.
5. **MCP SDK v1 → v2 churn risk**: v2 is anticipated; pin `^1.29` in `mcp-klank`, document migration in that package's own changelog.
6. **Workspace manifest missing** (baseline report): before Phase C/D/I ship new packages, the repo needs a real workspace (pnpm-workspace.yaml recommended). This is not a dep choice per se but is blocking Phase C onward. Flag for Roadmapper.
7. **Phase F-E2EE is NOT ready for version pinning.** Any roadmap phase that tries to lock MLS deps before a dedicated research spike should be rejected.

---

## What NOT to Add

Explicit anti-list — if a phase planner suggests any of these, push back:

- `axios` / `node-fetch` / `got` — we have native `fetch`
- `zod` in core — tempting but adds runtime weight; use TS types generated from OpenAPI; if runtime validation is needed for webhook bodies later, revisit then (and still consider `valibot` as lighter alternative)
- `pino` / `winston` — the SDK should accept an injected `logger?: { info, warn, error }` interface and let the user bring their own
- `dotenv` — library, not an app; it's the user's job
- `eslint`, `prettier`, `husky`, `lint-staged` — Biome covers lint+format; husky is gratuitous
- `nodemon` — `chokidar` + child-process restart is cleaner and already in-scope for Phase D
- `express`, `fastify`, `hono`, `h3` — anti-goal for the HTTP receiver
- `@matrix-org/olm` — wrong protocol (not MLS)
- Any pure-JS MLS implementation — security anti-pattern

---

## Sources

- [openapi-typescript on npm (v7.13.0)](https://www.npmjs.com/package/openapi-typescript)
- [OpenAPI TypeScript docs](https://openapi-ts.dev/introduction)
- [utoipa on GitHub](https://github.com/juhaku/utoipa)
- [utoipa on docs.rs](https://docs.rs/utoipa)
- [Biome vs ESLint+Prettier 2026 migration guide](https://dev.to/pockit_tools/biome-the-eslint-and-prettier-killer-complete-migration-guide-for-2026-27m)
- [Biome vs ESLint+Prettier (PkgPulse)](https://www.pkgpulse.com/blog/biome-vs-eslint-prettier-linting-2026)
- [Biome vs ESLint vs Oxlint 2026](https://www.pkgpulse.com/blog/biome-vs-eslint-vs-oxlint-2026)
- [Biome migrate-from-eslint-prettier guide](https://biomejs.dev/guides/migrate-eslint-prettier/)
- [@modelcontextprotocol/sdk on npm (v1.29.0)](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [MCP TypeScript SDK repo](https://github.com/modelcontextprotocol/typescript-sdk)
- [better-sqlite3 on npm](https://www.npmjs.com/package/better-sqlite3)
- [SQLite driver benchmark 2026 (better-sqlite3 vs node:sqlite vs libSQL)](https://sqg.dev/blog/sqlite-driver-benchmark/)
- [TypeDoc changelog (0.28.17, Feb 2026)](https://typedoc.org/documents/Changelog.html)
- [TypeDoc themes](https://typedoc.org/documents/Themes.html)
- [undici MockAgent docs](https://unpkg.com/browse/undici@4.0.0/docs/api/MockAgent.md)
- [Mocking with Undici (Stateful blog)](https://stateful.com/blog/undici-mocking)
- [Test native fetch in Node with undici (Hugo)](https://codewithhugo.com/node-test-native-fetch-intercept-undici/)
- [OpenMLS repo](https://github.com/openmls/openmls)
- [OpenMLS site](https://openmls.tech/)
- [Wire core-crypto (OpenMLS wrapper with WASM bindings)](https://wireapp.github.io/core-crypto/core_crypto/)

### Internal references (read as part of this research)
- `/Users/stevemeisner/Sites/rust-slack-sdk/.planning/PROJECT.md`
- `/Users/stevemeisner/Sites/rust-slack-sdk/.planning/BASELINE-REPORT.md`
- `/Users/stevemeisner/Sites/rust-slack-sdk/.planning/SDK-REFRESH-ROADMAP.md`
- `/Users/stevemeisner/Sites/rust-slack-sdk/.planning/codebase/STACK.md`
- `/Users/stevemeisner/Sites/rust-slack-sdk/.planning/codebase/INTEGRATIONS.md`
