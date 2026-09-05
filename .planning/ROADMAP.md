# Klank SDK Refresh — Roadmap

**Milestone:** v0.2 → v0.4 (staged: 0.2.0 webhook-first → 0.3.0 full bot → 0.4.0 E2EE + Rust)
**Granularity:** standard
**Coverage:** 100% — all 93 v1 requirements mapped
**Created:** 2026-04-07
**Revised:** 2026-09-05 — see `STATE.md` "Ground truth". The 2026-04-07 plan assumed the server
already let bots read/post/receive events; it does not. The critical path is now
Phase 2 (this repo, server-independent) → server bot model (`docs/server-requirements.md`) →
Phases 3–6. Phase 2 no longer targets "unblock production users" (there are none — never
published); it targets the first honest npm release.

---

## Phases

- [x] **Phase 1: Workspace Bootstrap** — pnpm workspace, biome, tsc -b, CI gates, changesets, license
- [ ] **Phase 2: 0.2.0 webhook-first release** — HMAC webhook, error taxonomy, slash verifier, retry policy, WS hardening, typed events, honest docs, release workflow (ships 0.2.0)
- [ ] **Phase 2.5: Server bot model (Aktiga/klank)** — bot tokens on channel routes, bot channel membership + WS subscriptions, slash delivery. Blocks Phases 4, 6, 12, 13.
- [ ] **Phase 3: Schema Pipeline** — utoipa (server) + openapi-typescript (SDK) with discriminated unions
- [ ] **Phase 4: Phase A — Typed Context & Ergonomics** — Typed `on()`, ctx helpers, self-echo fix, WS hardening
- [ ] **Phase 5: Phase B — HTTP Slash Receivers** — Framework-agnostic slash command receiver
- [ ] **Phase 6: Phase E — MockKlank Test Kit** — Real-transport test kit + first regression suite
- [ ] **Phase 7: Token Rotation** — Server `/rotate-token` endpoint + SDK method
- [ ] **Phase 8: Phase C — State Backends Split** — Core in-memory, `@klank/sdk-redis`, `@klank/sdk-sqlite`
- [ ] **Phase 9: Phase G — Templates & Scaffolder** — `create-klank-bot` + starter templates
- [ ] **Phase 10: Phase H — Docs & Typedoc** — Docs split + API reference (ships 0.3.0)
- [ ] **Phase 11: Phase D — Dev CLI** — `klank-bot dev` watch loop
- [ ] **Phase 12: Phase I — MCP Server** — `mcp-klank` package
- [ ] **Phase 13: Phase F-E2EE — MLS for Bots** — First-class E2EE bot membership (ships 0.4.0)
- [ ] **Phase 14: Phase F-build — Rust Crate** — `@klank/sdk-rust` from shared OpenAPI

---

## Phase Details

### Phase 1: Workspace Bootstrap
**Goal**: Monorepo infrastructure exists so every downstream phase has a working workspace, lint, type-check, test, and CI gate to land into.
**Depends on**: Nothing (first phase)
**Requirements**: HOUSE-01, HOUSE-02, HOUSE-03, HOUSE-04, HOUSE-05, HOUSE-06, HOUSE-07, HOUSE-08
**Success Criteria** (what must be TRUE):
  1. `pnpm install` at repo root resolves the workspace from `pnpm-workspace.yaml` with a committed lockfile
  2. `pnpm build` runs `tsc -b` across all packages and produces type-correct output for `packages/sdk/`
  3. `pnpm lint` runs biome across the workspace and fails on `noExplicitAny` / unused imports
  4. CI (GitHub Actions) runs build, lint, test, `attw --pack`, and tarball-contents check on every PR
  5. Repo ships `LICENSE` (MIT), seeded `CHANGELOG.md`, and `.changeset/` configured
**Plans**: 4 plans
- [x] 01-01-PLAN.md — Wave 1: Root workspace scaffold (pnpm, tsconfig base, LICENSE, CHANGELOG, biome, changesets)
- [x] 01-02-PLAN.md — Wave 2: git mv sdk-typescript→sdk, tsc -b + tsup split, vitest smoke test
- [x] 01-03-PLAN.md — Wave 3: Register examples + create-bot as workspace members, update PROJECT.md Node 20
- [x] 01-04-PLAN.md — Wave 4: GitHub Actions CI with six strict parallel jobs

### Phase 2: Migration to 0.2.0
**Goal**: Every user currently broken against the live Klank server can upgrade to 0.2.0 and have webhooks, slash commands, E2EE errors, and rate-limit handling work honestly — and the README stops lying about Rust.
**Depends on**: Phase 1
**Requirements**: MIG-01, MIG-02, MIG-03, MIG-04, MIG-05, MIG-06, MIG-07, MIG-08, MIG-09, MIG-10, MIG-11, HONEST-01, HONEST-02, HONEST-03, HONEST-04
**Success Criteria** (what must be TRUE):
  1. `WebhookBot.send` posts successfully against the live Klank server using `X-Klank-Webhook-Key` + `X-Klank-Signature` HMAC headers (byte-identity test green)
  2. Sending plaintext to an E2EE channel throws a typed `E2EEChannelError` with forward-pointer documentation
  3. `verifySlashCommandSignature()` is exported and validates signatures constant-time against server-produced fixtures
  4. 429 responses are retried with jittered backoff and surface as `RateLimitedError` after cap; 403s surface as `ChannelMembershipError`
  5. README contains zero Rust-support claims, bot token one-shot model is documented, and `docs/migration/0.1-to-0.2.md` exists
  6. Manual smoke test confirms `WebhookBot` + `KlankBot` both work against a fresh Klank deploy, and 0.2.0 is tagged
**Release marker**: Cuts `@klank/sdk@0.2.0`
**Plans**: TBD

### Phase 3: Schema Pipeline
**Goal**: Wire types flow from server source of truth to SDK TypeScript automatically, so event narrowing in Phase A is grounded in generated types rather than hand-written drift.
**Depends on**: Phase 2
**Requirements**: SCHEMA-01, SCHEMA-02, SCHEMA-03, SCHEMA-04, SCHEMA-05
**Success Criteria** (what must be TRUE):
  1. `rust-slack` server emits an `openapi.json` via `utoipa` macros covering all bot-facing handlers and wire types
  2. `ServerEvent` uses OpenAPI `oneOf` + `discriminator: type` and `openapi-typescript` generates a proper TS discriminated union
  3. SDK CI fetches the pinned `openapi.json`, runs `openapi-typescript`, and fails when committed `src/generated/` differs
  4. A type-level test proves `on('message.new', handler)` narrows `event` to `MessageNewEvent`
  5. Server contract test round-trips every annotated response through JSON schema validation
**Plans**: TBD

### Phase 4: Phase A — Typed Context & Ergonomics
**Goal**: Bot authors get full event-name narrowing and a complete `ctx` toolkit (thread/update/delete/upload/dm/unreact) while routing bugs and self-echo are fixed — without breaking any 0.1.0 handler signature.
**Depends on**: Phase 3
**Requirements**: PA-01, PA-02, PA-03, PA-04, PA-05, PA-06, PA-07, PA-08, PA-09, PA-10, PA-11, PA-12, PA-13
**Success Criteria** (what must be TRUE):
  1. `bot.on('message.new', (ctx, event) => ...)` narrows `event` to `MessageNewEvent` with no explicit generics
  2. A bot can call `ctx.thread`, `ctx.update`, `ctx.delete`, `ctx.upload`, `ctx.dm`, and `ctx.unreact` and observe the resulting state on the server
  3. A bot that posts via its own `WebhookBot` no longer re-triggers its own `message.new` handler (H-4 fixed)
  4. `reaction.added` fires exactly once per reaction; `message.updated`/`message.deleted`/`typing.stop` route to their shorthand handlers
  5. WS manager survives a dropped connection with jittered backoff + heartbeat ping, and surfaces parse errors as typed events
  6. Existing 0.1.0 handler code compiles unchanged against 0.3.0-dev
**UI hint**: no
**Plans**: TBD

### Phase 5: Phase B — HTTP Slash Receivers
**Goal**: Developers on Lambda, Vercel, Express, Fastify, Hono, or Next.js can mount a Klank slash command handler in five lines without installing any Klank-specific framework shim.
**Depends on**: Phase 2 (can run in parallel with Phases 3–4)
**Requirements**: PB-01, PB-02, PB-03, PB-04
**Success Criteria** (what must be TRUE):
  1. `createSlashCommandReceiver({ signingSecret, handler })` returns a primitive `(rawBody, headers) => Promise<{status, body}>`
  2. A Node `http`-compatible convenience wrapper exists on top of the primitive
  3. Recipes document raw-body handling for Express, Next.js, Fastify, Lambda (base64), Vercel Edge, and Hono
  4. Integration tests exercise the receiver against each host's actual request shape (not synthetic Buffers)
**Plans**: TBD

### Phase 6: Phase E — MockKlank Test Kit
**Goal**: SDK consumers (and the SDK itself) can write tests that exercise real routing, real middleware, and real wire parsing — with the transport being the only fake — and the flagship test proves the kit would catch the H-4 self-echo bug.
**Depends on**: Phase 4 (needs stable Transport seam and finished ctx surface)
**Requirements**: PE-01, PE-02, PE-03, PE-04, PE-05, PE-06
**Success Criteria** (what must be TRUE):
  1. `import { MockKlank } from '@klank/sdk/testing'` resolves via subpath export and `attw --pack` passes
  2. `MockKlank` records outbound REST calls without stubbing `KlankBot`/`KlankClient` methods
  3. `mock.deliver(event)` pushes a synthetic WS event through the real handler chain
  4. The self-echo regression test fails on pre-PA-08 code and passes on post-PA-08 code
  5. The reconnect/backoff test uses real 10ms timers — not fake-timer math
  6. A `Transport` interface has been extracted from `ws.ts` + `client.ts`
**Plans**: TBD

### Phase 7: Token Rotation
**Goal**: Operators whose bot token leaks have a recovery procedure via a server-backed rotate endpoint and an SDK method, closing the one-shot-token trap before 0.3.0.
**Depends on**: Phase 2 (cross-repo; can run parallel with Phases 3–6)
**Requirements**: ROT-01, ROT-02, ROT-03
**Success Criteria** (what must be TRUE):
  1. `POST /bots/:id/rotate-token` exists on `rust-slack`, returns a new token once, and invalidates the old hashed-at-rest token
  2. `KlankClient.rotateToken()` calls the endpoint, returns the new token, and lets the caller store it
  3. Migration guide and bot token documentation describe the rotation procedure end-to-end
**Plans**: TBD

### Phase 8: Phase C — State Backends Split
**Goal**: A bot can persist its state to in-memory, Redis, or SQLite with identical DX via constructor injection, while `@klank/sdk` core keeps zero runtime adapter dependencies.
**Depends on**: Phase 6 (contract tests rely on MockKlank; also blocks Phase 13 MLS storage)
**Requirements**: PC-01, PC-02, PC-03, PC-04, PC-05, PC-06
**Success Criteria** (what must be TRUE):
  1. `StateBackend` interface is defined in `@klank/sdk` core with `get/set/delete/keys` and optional TTL
  2. In-memory implementation ships in core as the default; Redis and SQLite ship as `@klank/sdk-redis` and `@klank/sdk-sqlite`
  3. A single contract test suite runs green against all three adapters with identical assertions
  4. `@klank/sdk-redis` accepts a user-injected `ioredis` client and never instantiates its own
  5. `@klank/sdk-sqlite` uses `better-sqlite3` with `journal_mode=WAL` and a periodic TTL sweep
  6. CI enforces that `@klank/sdk` core never imports from any `@klank/sdk-*` adapter
**Plans**: TBD

### Phase 9: Phase G — Templates & Scaffolder
**Goal**: A new developer runs `npm create klank-bot` (or equivalent), picks a template, and is posting to Klank within minutes with working tests.
**Depends on**: Phase 4 (templates exercise the stable Phase A surface)
**Requirements**: PG-01, PG-02, PG-03, PG-04, PG-05
**Success Criteria** (what must be TRUE):
  1. `templates/typescript/echo/`, `slash-command-receiver/`, and `webhook-poster/` exist with `package.json`, `.env.example`, and `README.md`
  2. `packages/create-klank-bot/` is publishable and works via `npm create` / `npx`
  3. Each template ships runnable tests that pass in CI
  4. The slash-command template uses `verifySlashCommandSignature` correctly for Lambda
**UI hint**: no
**Plans**: TBD

### Phase 10: Phase H — Docs & Typedoc
**Goal**: A developer arriving at the repo can find getting-started, concepts, recipes, API reference, migration, and security docs — and the API reference is generated from source rather than hand-maintained.
**Depends on**: Phase 4, Phase 9 (best after API is stable and templates exist)
**Requirements**: PH-01, PH-02, PH-03, PH-04
**Success Criteria** (what must be TRUE):
  1. README is split into Getting Started, Concepts, Recipes, API Reference, Migration, and Security sections
  2. `typedoc` generates `docs/api/` from pinned source and the output is committed
  3. Recipes cover webhook signing, slash receivers, E2EE error handling, state persistence, and testing with MockKlank
  4. Security doc covers HMAC details, bot token one-shot model, channel membership, and constant-time comparison
**Release marker**: Candidate cut for `@klank/sdk@0.3.0` once Phases 3–10 land (may be deferred to post-Phase 12 depending on scope)
**UI hint**: no
**Plans**: TBD

### Phase 11: Phase D — Dev CLI
**Goal**: A bot author runs `klank-bot dev` and gets a live-reloading dev loop with pretty-printed WS events and an optional tunnel for local slash commands.
**Depends on**: Phase 5 (tunnel is most useful with HTTP receivers)
**Requirements**: PD-01, PD-02, PD-03, PD-04
**Success Criteria** (what must be TRUE):
  1. `packages/klank-bot-cli/` ships a `klank-bot` bin with a `dev` subcommand
  2. Editing a source file causes the child bot process to restart via `chokidar`
  3. Incoming WS events render as human-readable lines in the terminal
  4. `--tunnel` spawns `cloudflared` and exposes the local slash receiver
**Plans**: TBD

### Phase 12: Phase I — MCP Server
**Goal**: An LLM client with MCP support can send messages, list channels, search, upload files, and DM users on Klank via an off-the-shelf `mcp-klank` package.
**Depends on**: Phase 4 (needs `ctx.upload`, `ctx.dm`) and Phase 3 (tool schemas from generated types)
**Requirements**: PI-01, PI-02, PI-03, PI-04
**Success Criteria** (what must be TRUE):
  1. `packages/mcp-klank/` exposes an MCP server built on `@klank/sdk`
  2. MCP tools `klank.send_message`, `klank.list_channels`, `klank.search_messages`, `klank.upload_file`, `klank.dm_user` map 1:1 to `KlankClient` methods
  3. Tool input/output schemas are derived from SDK-generated types and stay in sync with the schema pipeline
  4. The server runs as stdio transport by default with optional HTTP transport
**Release marker**: With Phase 10 completion, cuts `@klank/sdk@0.3.0`
**Plans**: TBD

### Phase 13: Phase F-E2EE — MLS for Bots
**Goal**: A bot becomes a first-class MLS member of an E2EE Klank channel — receiving plaintext in handlers, sending encrypted messages, persisting key material securely — with the old `E2EEChannelError` degrading to a graceful fallback only when no crypto provider is configured.
**Depends on**: Phase 4, Phase 8 (StateStore for MLS group state)
**Requirements**: F2EE-01, F2EE-02, F2EE-03, F2EE-04, F2EE-05, F2EE-06, F2EE-07, F2EE-08, F2EE-09, F2EE-10
**Success Criteria** (what must be TRUE):
  1. Research spike pins the MLS ciphersuite, credential format, and library (`core-crypto` WASM) against the server
  2. `@klank/crypto` package exposes a `CryptoProvider` interface; `NullProvider` is the default and throws `E2EEChannelError`
  3. A bot configured with `MlsProvider` receives decrypted plaintext in handlers and successfully sends encrypted messages to an E2EE channel
  4. MLS key material is persisted via `MlsStorage` over Phase C state backends, AEAD-wrapped with HKDF from bot token
  5. Epoch/nonce tracking rejects replayed commits; `on('group.welcome')` and `on('group.removed')` fire on membership changes
  6. Docs warn about forward-secrecy implications for bot history logging
**Release marker**: Cuts `@klank/sdk@0.4.0` together with Phase 14
**Plans**: TBD

### Phase 14: Phase F-build — Rust Crate
**Goal**: A Rust developer can depend on `klank-sdk` and build a bot with the same public API shape as the TS SDK, grounded in the shared OpenAPI contract and tested against shared wire fixtures.
**Depends on**: Phase 3 (shared `schemas/openapi.json`). Can run in parallel with Phases 4–13.
**Requirements**: FBUILD-01, FBUILD-02, FBUILD-03, FBUILD-04, FBUILD-05, FBUILD-06
**Success Criteria** (what must be TRUE):
  1. `packages/sdk-rust/` is a nested Cargo workspace publishing crate `klank-sdk`
  2. Rust wire types are generated from `schemas/openapi.json` via `progenitor` and build cleanly
  3. Rust SDK exposes `KlankBot`, `KlankClient`, `WebhookBot` with async trait-based handlers mirroring the TS public API
  4. Both TS and Rust test suites load identical fixtures from `fixtures/wire/` and assert byte-identical HMAC behavior
  5. `COMPAT.md` at repo root declares the target server commit and CI lints consistency across both SDKs
  6. Rust crate is versioned in `0.0.x` and marked "tracks TS 0.4.x"
**Release marker**: Cuts `@klank/sdk@0.4.0` together with Phase 13
**Plans**: TBD

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Workspace Bootstrap | 0/0 | Not started | - |
| 2. Migration to 0.2.0 | 0/0 | Not started | - |
| 3. Schema Pipeline | 0/0 | Not started | - |
| 4. Phase A — Typed Context & Ergonomics | 0/0 | Not started | - |
| 5. Phase B — HTTP Slash Receivers | 0/0 | Not started | - |
| 6. Phase E — MockKlank Test Kit | 0/0 | Not started | - |
| 7. Token Rotation | 0/0 | Not started | - |
| 8. Phase C — State Backends Split | 0/0 | Not started | - |
| 9. Phase G — Templates & Scaffolder | 0/0 | Not started | - |
| 10. Phase H — Docs & Typedoc | 0/0 | Not started | - |
| 11. Phase D — Dev CLI | 0/0 | Not started | - |
| 12. Phase I — MCP Server | 0/0 | Not started | - |
| 13. Phase F-E2EE — MLS for Bots | 0/0 | Not started | - |
| 14. Phase F-build — Rust Crate | 0/0 | Not started | - |

---

## Release Markers

- **End of Phase 2** → `@klank/sdk@0.2.0` (migration, unblocks production)
- **End of Phase 12** (with Phase 10 complete) → `@klank/sdk@0.3.0` (honest complete SDK)
- **End of Phases 13 + 14** → `@klank/sdk@0.4.0` + `klank-sdk@0.0.x` (E2EE + Rust)

---

## Dependency Graph (critical path)

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 6 → Phase 8 → Phase 13
                                   ↓
                                Phase 12 → (0.3.0)
                                   ↓
                                Phase 10 → (0.3.0)

Parallel off spine (after Phase 2):
  Phase 5  (HTTP receiver) — parallel with 3–4
  Phase 7  (Token rotation) — parallel with 3–6
  Phase 9  (Templates) — after Phase 4
  Phase 11 (Dev CLI) — after Phase 5
  Phase 14 (Rust crate) — after Phase 3, parallel with 4–13
```

*Last updated: 2026-04-07 by roadmapper agent*
