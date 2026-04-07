# Research Synthesis — Klank SDK Refresh (v0.2 → v0.4)

**Date:** 2026-04-07
**Inputs synthesized:** STACK.md, FEATURES.md, ARCHITECTURE.md, PROJECT.md, SDK-REFRESH-ROADMAP.md
**Note:** PITFALLS.md was not produced by the research pass; pitfalls surfaced by the other three researchers are folded in inline below and flagged in "Gaps".
**Audience:** roadmapper + per-phase planners.

---

## Executive Summary

The Klank SDK refresh is a staged rewrite of a 2-commit, broken-against-production, over-promising `@klank/sdk@0.1.0` into an honest, E2EE-capable bot SDK shipped across 0.2.0 (migration) → 0.3.0 (features) → 0.4.0 (E2EE + Rust). Research across stack, feature landscape, and architecture converges on a clear opinionated path: a pnpm+changesets monorepo, a dep-light core with adapters as separate packages, and a single source of truth for wire types via `utoipa` → `openapi-typescript`. The core package gains ZERO new runtime dependencies across the entire refresh; every new capability lands as a sibling workspace package or a built-in-Node primitive.

The dominant risk is sequencing rather than technology: the existing repo looks like a monorepo but has no workspace manifest, lockfile, lint config, or lockable test setup, so any feature phase that assumes workspace resolution, cross-package tests, or CI gates will fail. Research therefore prescribes an unbudgeted Phase 0 pre-migration housekeeping step that the original roadmap does not contain — workspace bootstrap, rename, biome, changesets, tsc project references, and CI gates — which must land before M-1 touches product code.

The other risk is the Phase F-E2EE MLS work, which is the only phase where the stack researcher deliberately declines to pin versions: `core-crypto` WASM is the only responsible choice, but ciphersuite and server contract must be negotiated at phase kickoff with a dedicated spike, not inferred from today's information.

---

## Key Findings

### From STACK.md — Technology Locks

| Decision | Pick | Confidence |
|---|---|---|
| HMAC (webhook + slash verify) | `node:crypto` built-in; NOT `@noble/hashes` | HIGH |
| HTTP receiver (Phase B) | Framework-agnostic `(req,res)` + primitive `(rawBody,headers)→{status,body}`; NOT h3/itty/express/hono | HIGH |
| Redis adapter | `ioredis` ^5.5 in `@klank/sdk-redis`, inject existing client | HIGH |
| SQLite adapter | `better-sqlite3` ^12 in `@klank/sdk-sqlite`; NOT `node:sqlite` (experimental) | HIGH |
| TS type generation | `openapi-typescript` ^7.13 (types only, NOT `hey-api/openapi-ts`) | HIGH |
| Server OpenAPI source | `utoipa` ^5 + `utoipa-axum` ^0.2 + `dump-openapi` bin | HIGH |
| Lint + format | `biome` ^2.3 (single tool, greenfield pick) | HIGH |
| HTTP mocking in tests | `undici` `MockAgent` built-in; NOT `msw` or `nock` | HIGH |
| WS test harness | real in-process `ws.Server` on ephemeral port | HIGH |
| API docs | `typedoc` ^0.28 default theme | HIGH |
| CLI watcher (Phase D) | `chokidar` ^4 | MEDIUM |
| MCP (Phase I) | `@modelcontextprotocol/sdk` ^1.29, pin `^1.29` pending v2 | HIGH |
| MLS (Phase F-E2EE) | `@wireapp/core-crypto` WASM in `@klank/sdk-e2ee`; versions deferred | LOW (deliberate) |

Runtime deps added to `@klank/sdk` core: ZERO. Every addition is built-in, dev-only, or in a separate workspace package.

Anti-list (reject on sight): axios/node-fetch/got, zod in core, pino/winston, dotenv, eslint+prettier+husky+lint-staged, nodemon, express/fastify/hono/h3 as a dep, `@matrix-org/olm`, any pure-JS MLS.

### From FEATURES.md — Competitor Reference Map

| Phase | Copy from | What exactly |
|---|---|---|
| Phase A (typed events) | discord.js v14 | `ClientEvents` tuple-map pattern for event-name → payload narrowing. Best-in-class typing; better than bolt's generic overloads. |
| Phase A (ctx helpers) | @slack/bolt | Single arg-object shape with `say`/`respond`/`client`/`logger` — but keep `ctx` separate per current KlankBot convention. |
| Phase B (HTTP receiver) | @slack/bolt receiver abstraction | Pluggable receiver interface so Lambda/Vercel/Express all wire in ~5 lines. Bolt went too framework-specific and regretted it — avoid that half. |
| Phase E (MockKlank) | @octokit/webhooks primitive style | `(rawBody, headers) → result` is the honest testing seam; real routing, fake wire. |
| Phase F-E2EE | matrix-bot-sdk MLS architecture | Key storage, group-state persistence seam, welcome-message flow. Matrix is the only mature JS-side reference for MLS-shaped bot identity. |
| Phase I (mcp-klank) | @modelcontextprotocol/sdk TS quickstart | Map 1:1 `KlankClient` methods → MCP tools. |

`ctx.reply` trap (unanimous): today `ctx.reply()` posts in thread. The roadmap hints at renaming. Reject the rename. Add `ctx.thread()` as a synonym; leave `reply` meaning thread-post; never silently flip semantics on existing bots.

### From ARCHITECTURE.md — Shape Decisions

1. Monorepo via pnpm workspaces + changesets. No turborepo yet (≤8 packages). Cargo workspace nested for the Rust crate phase.
2. Rename `packages/sdk-typescript/` → `packages/sdk/`. Package name `@klank/sdk` unchanged. Delete empty `packages/create-bot/`.
3. Crypto lives in `@klank/sdk-e2ee` / `@klank/crypto`, not core. Exposes a `CryptoProvider` interface; `NullProvider` is the default and throws `E2EEChannelError`; `MlsProvider` arrives in Phase F-E2EE.
4. Wire types generated into `packages/sdk/src/generated/`; hand-written `types.ts` becomes a compatibility bridge with FIXMEs where shapes differ. Do not flip the public entry to the generated path until 0.4.0.
5. `Transport` interface extracted before Phase E so `MockKlank` is a replacement transport, not a mock — keeping tests real per CLAUDE.md testing integrity.
6. MLS group state persistence delegates to the Phase C `StateStore`. This is why Phase C MUST precede Phase F-E2EE. Key material is wrapped with an AEAD keyed from the bot token (HKDF) before touching any backend.
7. Middleware ordering contract (public): `crypto → state → user-middleware → dispatch`.
8. Backwards compat is non-negotiable through 0.3.x. Everything additive. The only "looks breaking" cleanup is the global SIGINT/SIGTERM handler — default to NOT registering, document loudly.

### Pitfalls folded in from all three researchers

(PITFALLS.md was not produced. These are the cross-cutting traps each researcher flagged.)

1. Webhook signing bytes. Serialize body to bytes ONCE; sign those exact bytes; POST those exact bytes. Any re-`JSON.stringify` between sign and POST silently breaks verification. This is the M-1 bug today.
2. Raw body for slash command verification. Any upstream `express.json()` / `bodyParser` middleware destroys the signature. Export a `getRawBody(req)` helper.
3. `openapi-typescript` ordering. `types.gen.ts` must be generated before `tsup` runs. Add a `prebuild` script.
4. `better-sqlite3` prebuilt-binary gaps on Alpine/musl. Document; keep adapter optional.
5. `ioredis` instance injection is a hard rule. The adapter must NOT instantiate its own client.
6. MCP SDK v1→v2 churn. Pin `^1.29`.
7. Global process signal handlers break multi-bot processes. Default-off.
8. Self-message suppression must run pre-decrypt. Sender id is on the envelope, not the ciphertext.
9. Crypto provider owns the algorithm, not persistence. Phase F-E2EE must go through `StateStore`.
10. Generated wire types will not match hand-written `types.ts` exactly. The compatibility bridge is unavoidable.

---

## Implications for Roadmap

### Phase 0 — Pre-Migration Housekeeping (NEW — not in the original roadmap)

Phase 0 must land before M-1. Scope:

- Root `package.json` (private), `pnpm-workspace.yaml`, lockfile committed.
- Rename `packages/sdk-typescript/` → `packages/sdk/` (package name `@klank/sdk` unchanged). Delete empty `packages/create-bot/`.
- `tsconfig.base.json` with strict options; per-package `tsconfig.json` using project references (`tsc -b`).
- `.changeset/` initialized with `config.json` and baseline changelog.
- `biome.json` extending `recommended`, with `noExplicitAny: error`, `useImportType`, `noUnusedImports`; `lint` + `format` scripts.
- CI gates added immediately (see "Top 5 CI Gates" below), including `attw --pack` exports validation.

Rationale: every downstream phase assumes workspace resolution, changesets, biome, and `tsc -b`. Doing it after M-1 means redoing imports and CI wiring. Zero product code in Phase 0 — minimum churn, maximum leverage.

### Critical Path (longest dependency chain)

```
Phase 0 → Migration (M-1..M-7) → utoipa/openapi-typescript pipeline →
  Phase A → Phase E → Phase C → Phase F-E2EE
```

Phase C MUST precede F-E2EE because MLS group state persistence goes through the `StateStore` abstraction. Phase E MUST precede C because the `Transport` interface + `MockKlank` are how C's backends are honestly tested.

### Parallelizable off the spine

After Phase 0 + Migration + schema pipeline are in place:

- Phase B (HTTP receiver) — parallel with Phase A.
- Phase G (create-klank-bot + templates) — depends on stable Phase A surface.
- Phase H (docs split + typedoc) — after Phase A/G.
- Phase D (CLI dev loop) — more useful after Phase B.
- Phase I (mcp-klank) — downstream consumer; last before F-E2EE.
- Phase F-build (Rust crate) — can start the moment the schema pipeline is stable; fully independent of A/B/C/E/I.

### Suggested phase order (refinement of SDK-REFRESH-ROADMAP.md §5)

1. Phase 0 — Housekeeping [NEW]
2. Migration M-1..M-7 → ship 0.2.0
3. Schema pipeline (`utoipa` server-side + `openapi-typescript` SDK-side + cross-repo CI wiring)
4. Phase A (typed events + ctx helpers)
5. Phase B (HTTP receiver) — parallel with A
6. Phase E (MockKlank + Transport interface extraction)
7. Phase C (state backends split into sibling packages)
8. Phase G (templates + scaffolder) — parallel with C
9. Phase H (docs split + typedoc)
10. Phase D (CLI dev loop)
11. Phase I (mcp-klank)
12. Phase F-E2EE → ship 0.4.0
13. Phase F-build (Rust crate) — parallel with any of 7–12 once schema pipeline is stable

---

## Top 5 CI Gates to Add in Phase 0

Non-negotiable; must land with the workspace bootstrap, not later:

1. HMAC byte-identity test. Given a fixture body, the signature produced by `WebhookBot` must equal the hex the server's `verify_signature` accepts. Port the fixture from `crates/rs-bots/src/slash_commands.rs:78-101`. This is the single most load-bearing test in the whole migration.
2. `openapi-typescript` drift check. CI regenerates `types.gen.ts` from the pinned `openapi.json` and fails if the working tree differs. This is how we detect unannounced server changes.
3. `attw --pack` exports validation. `@arethetypeswrong/cli` asserts the package's `exports` map, types condition, ESM/CJS duals, and subpath exports (`@klank/sdk/testing`) all resolve cleanly across node16/bundler/nodenext.
4. Tarball contents assertion. `npm pack --dry-run` diffed against a checked-in `expected-files.txt` — blocks accidental shipping of `.planning/`, `src/`, `tests/`, coverage, or secrets.
5. MockKlank H-4 regression. Once Phase E lands, a smoke test that drives `MockKlank` through: register → deliver synthetic `message.new` → assert handler ran → assert `sentMessages` recorded.

---

## Open Questions for Phase-Time Research Spikes

1. Server MLS ciphersuite + credential format — Phase F-E2EE kickoff. Which ciphersuite does `rust-slack` accept? Basic vs X.509 credentials? Is there a server-side bot-keypackage registration endpoint, or do bots upload via the human-client flow? The SDK cannot pick an MLS version until this is pinned with the server team.
2. Does `PATCH /messages/:id` exist post-phase-9? — Phase A blocker. Needed for `ctx.update` and `ctx.delete`. If missing, Phase A turns into a cross-repo server-dependency.
3. Cross-repo OpenAPI CI secret flow — Schema pipeline phase. How does `rust-slack-sdk` CI authenticate to fetch the latest `openapi.json` artifact from `rust-slack`? GitHub token scope, PAT vs app-token, PR auto-open identity.
4. MLS library choice refinement — Phase F-E2EE kickoff. `core-crypto` WASM is the default; `mls-rs` via wasm-bindgen and NAPI from the Rust crate are fallbacks.

---

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Stack (non-MLS) | HIGH | Every non-MLS pick backed by multiple 2026 sources + existing server source inspection. |
| Stack (MLS) | LOW — deliberate | Research explicitly defers until Phase F-E2EE kickoff spike. |
| Features (Phase A/B/E/I) | HIGH | Three strong reference SDKs with clear table-stakes/differentiator split. |
| Architecture (monorepo + packages) | HIGH | Grounded in PROJECT.md locked decisions + existing file layout. |
| Architecture (E2EE data flow) | MEDIUM | Sketch is sound; concrete contracts depend on open question #1. |
| Backwards compatibility strategy | HIGH | Additive-only path is fully enumerated per phase. |
| Pitfalls coverage | MEDIUM | Folded in from other researchers; a dedicated PITFALLS.md pass would raise this. |

### Gaps to Address

1. PITFALLS.md not produced. A later dedicated pitfalls pass should specifically audit: native-module cross-platform story for `better-sqlite3`; `undici` `MockAgent` interaction with fetch-polyfill shims; `exports` map traps for the `@klank/sdk/testing` subpath; `tsc -b` incremental cache invalidation on CI.
2. Exact Phase 0 CI runtime budget is unknown; will discover on first green build. Not blocking.
3. `@klank/schemas` as a separate package vs inline `packages/sdk/src/generated/`. Architecture recommends inline; revisitable if the Rust crate's generator wants a pnpm-visible consumer.
4. Changesets vs semantic-release. Changesets chosen; revisit if another team preference emerges.

---

## Sources (aggregated)

### External
- openapi-typescript, openapi-ts.dev
- utoipa (github.com/juhaku/utoipa, docs.rs)
- Biome migration guides (PkgPulse, dev.to, biomejs.dev)
- @modelcontextprotocol/sdk (npm, github)
- better-sqlite3 + SQLite driver benchmark 2026 (sqg.dev)
- TypeDoc 0.28 changelog + themes docs
- undici MockAgent docs + Stateful blog
- OpenMLS (github, openmls.tech)
- Wire core-crypto (wireapp.github.io/core-crypto)
- @slack/bolt, discord.js v14, matrix-bot-sdk docs

### Internal
- .planning/PROJECT.md
- .planning/BASELINE-REPORT.md
- .planning/SDK-REFRESH-ROADMAP.md
- .planning/codebase/STACK.md
- .planning/codebase/INTEGRATIONS.md
- .planning/research/STACK.md
- .planning/research/FEATURES.md
- .planning/research/ARCHITECTURE.md

---

*Synthesis: 2026-04-07*
