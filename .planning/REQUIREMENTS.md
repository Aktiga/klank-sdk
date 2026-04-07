# Klank SDK Refresh — Requirements

Milestone: **v0.2 → v0.4** (staged: 0.2.0 migration → 0.3.0 features → 0.4.0 E2EE + Rust)
Date: 2026-04-07

REQ-IDs are stable. Each maps to exactly one phase in ROADMAP.md.

---

## Active Requirements

### HOUSE — Housekeeping & Workspace (NEW from research)

> Pre-migration bootstrap. Without this, the monorepo-dependent phases (C, I, G, F-build) cannot function.

- [ ] **HOUSE-01**: Repo converts to `pnpm` workspace with `pnpm-workspace.yaml` and committed `pnpm-lock.yaml`
- [ ] **HOUSE-02**: `packages/sdk-typescript/` renamed to `packages/sdk/` (published as `@klank/sdk`)
- [ ] **HOUSE-03**: TypeScript project references (`tsc -b`) wired across workspace
- [ ] **HOUSE-04**: `biome` installed for lint+format, replaces missing eslint/prettier
- [ ] **HOUSE-05**: `changesets` installed for versioning and changelog generation
- [ ] **HOUSE-06**: `@arethetypeswrong/cli` wired into CI — every package PR checks exports map validity
- [ ] **HOUSE-07**: GitHub Actions CI created (`.github/workflows/ci.yml`) running build, lint, test, attw, tarball-contents check
- [ ] **HOUSE-08**: `CHANGELOG.md` seeded; `LICENSE` file added (README claims MIT)

### MIG — Migration (ship 0.2.0, unblock production)

> Every user running current SDK against the live server is broken today. These are non-negotiable.

- [ ] **MIG-01**: `WebhookBot.send` signs and sends with `X-Klank-Webhook-Key` + `X-Klank-Signature: sha256=<hex>` HMAC headers; body no longer contains `secret`; bytes signed once, sent once (P-2 guard)
- [ ] **MIG-02**: Port server's `verify_signature` fixture to TS as a regression test — byte-identical assertion against known-good hex
- [ ] **MIG-03**: Typed `WebhookAuthError` thrown on 401 from webhook endpoint, message names migration guide + server commit
- [ ] **MIG-04**: Typed `E2EEChannelError` thrown when server rejects plaintext send to an E2EE channel; README "Bot Messages & E2EE" section rewritten with accurate current-state + forward pointer to Phase F-E2EE
- [ ] **MIG-05**: Export `verifySlashCommandSignature({ rawBody, signatureHeader, signingSecret })` helper using `crypto.timingSafeEqual`, normalized header lookup, `sha256=` prefix handling (P-3 guard)
- [ ] **MIG-06**: README + `docs/getting-started.md` document bot token one-shot model; any code path suggesting recovery removed
- [ ] **MIG-07**: Typed `ChannelMembershipError` wraps 403 responses from `sendMessage`/`getMessages`; docs add membership precondition callout
- [ ] **MIG-08**: 429 retry in `client.ts` hardened with max attempts (default 5), jitter (`retryAfter * (0.8 + random*0.4)`), typed `RateLimitedError` after cap
- [ ] **MIG-09**: Migration guide `docs/migration/0.1-to-0.2.md` written: webhook code diff, E2EE ban, channel membership, token rotation absence, slash command receiver example
- [ ] **MIG-10**: Version bumped to `0.2.0`; README `Server Compatibility` line updated to point at the phase-11 server commit
- [ ] **MIG-11**: Manual smoke test performed against a freshly deployed Klank — webhook bot posts, `KlankBot` connects and replies to a `message.new`

### HONEST — Honest Marketing (F-drop)

> Remove SDK's most glaring credibility hit before 0.2.0 ships.

- [ ] **HONEST-01**: All "Rust" claims removed from `README.md`, `docs/getting-started.md`, `docs/deploying-bots.md`
- [ ] **HONEST-02**: README gains a confident "Rust SDK planned" note pointing at Phase F-build
- [ ] **HONEST-03**: `examples/echo-bot-rust/` moved to `examples/community/echo-bot-rust/` with a `README.md` header stating "hand-rolled, not a supported SDK"
- [ ] **HONEST-04**: README's documented `ctx.respond({ responseType: 'ephemeral' })` either removed or marked as "not yet supported — see Phase A"

### SCHEMA — Type Generation Pipeline (decision #3)

> Server utoipa → OpenAPI → SDK `types.ts` regenerated in CI. Precedes Phase A because typed events depend on `discriminator` support.

- [ ] **SCHEMA-01**: Server (`rust-slack` repo) annotates wire types and handlers with `utoipa` macros; emits `openapi.json` at build or via an endpoint
- [ ] **SCHEMA-02**: `ServerEvent` discriminated union uses OpenAPI `oneOf` + `discriminator: { propertyName: 'type' }` so `openapi-typescript` generates a proper TS discriminated union
- [ ] **SCHEMA-03**: SDK CI fetches live `/openapi.json`, runs pinned `openapi-typescript`, commits output to `src/generated/`; diff against committed spec fails CI
- [ ] **SCHEMA-04**: Type-level test (`expectTypeOf`) proves `on('message.new', handler)` narrows handler parameter to `MessageNewEvent`
- [ ] **SCHEMA-05**: Server-side contract test round-trips every utoipa-declared response through `serde_json` + JSON schema validator (P-15 guard)

### PA — Phase A: Typed Context & Ergonomics

> Most of the leverage for existing users. Must follow SCHEMA so narrowing works.

- [ ] **PA-01**: `KlankBot.on()` has overloaded signatures keyed off event-name string literals; `event` parameter narrows automatically
- [ ] **PA-02**: `ctx.thread(text)` posts into the triggering message's thread
- [ ] **PA-03**: `ctx.update(messageId, text)` — requires verified `PATCH /messages/:id` server endpoint (research spike first)
- [ ] **PA-04**: `ctx.delete(messageId)` — requires verified `DELETE /messages/:id` server endpoint
- [ ] **PA-05**: `ctx.upload({ filename, contentType, data })` using file upload endpoint from server Phase 8
- [ ] **PA-06**: `ctx.unreact(emoji)` added alongside existing `ctx.react`
- [ ] **PA-07**: `ctx.dm(userId, text)` opens/reuses DM channel and sends
- [ ] **PA-08**: Self-message suppression tracks bot's own `webhook_id`(s) in addition to `bot_id`; bot no longer echoes itself via own webhook (decision #6, fixes H-4)
- [ ] **PA-09**: Event routing table includes `message.updated`, `message.deleted`, `typing.stop` shorthand entries (fixes mapping-found bug)
- [ ] **PA-10**: Event routing fixes `reaction.added`/`reaction.removed` double-fire collision (fixes mapping-found bug)
- [ ] **PA-11**: `start()` no longer installs process-level SIGINT/SIGTERM by default; opt-in flag preserves old behavior for single-bot processes (deprecation window)
- [ ] **PA-12**: WS manager adds heartbeat ping, jitter to reconnect backoff, listener removal, surfaces parse errors as typed events
- [ ] **PA-13**: 0.1.0 handler signatures continue to compile — typed overloads are additive, no breaking changes

### PB — Phase B: Slash Command HTTP Receiver

> Unblocks Lambda/Vercel/Express users. Parallel with PA.

- [ ] **PB-01**: `createSlashCommandReceiver({ signingSecret, handler })` returns a framework-agnostic request handler taking `(rawBody: Buffer, headers: Record<string,string>) => Promise<{status, body}>`
- [ ] **PB-02**: Node `http`-compatible convenience wrapper on top of the primitive
- [ ] **PB-03**: Receiver documents raw-body recipes for Express, Next.js, Fastify, Lambda (base64), Vercel Edge, Hono (P-4 guard)
- [ ] **PB-04**: Integration test runs receiver against each host's actual body shape — not a synthetic Buffer

### PE — Phase E: MockKlank Test Kit

> First real tests in the repo. Per CLAUDE.md: no mock-to-uselessness.

- [ ] **PE-01**: `@klank/sdk/testing` subpath export exposes `MockKlank` class
- [ ] **PE-02**: MockKlank provides a fake REST endpoint that records requests (does NOT stub any `KlankBot`/`KlankClient` method)
- [ ] **PE-03**: MockKlank provides `deliver(event)` to push synthetic WS events into the bot's handler chain
- [ ] **PE-04**: **Flagship regression test**: MockKlank proves it catches H-4 (self-echo via webhook) as a real failure (P-18 guard)
- [ ] **PE-05**: Reconnect/backoff test uses real timers with a short (10ms) interval — not just fake-timer math (P-19 guard)
- [ ] **PE-06**: `Transport` interface extracted from existing `ws.ts` + `client.ts` so tests inject a fake transport cleanly

### PG — Phase G: Templates & Scaffolder

- [ ] **PG-01**: `templates/typescript/echo/` — minimal echo bot with `package.json`, `.env.example`, `README.md`
- [ ] **PG-02**: `templates/typescript/slash-command-receiver/` — Lambda handler using `verifySlashCommandSignature`
- [ ] **PG-03**: `templates/typescript/webhook-poster/` — CI notifier using fixed `WebhookBot`
- [ ] **PG-04**: `packages/create-klank-bot/` — `npm init`/`npx`-friendly scaffolder that copies a chosen template
- [ ] **PG-05**: Each template includes runnable tests

### PH — Phase H: Docs & API Reference

- [ ] **PH-01**: README split into Getting Started / Concepts / Recipes / API Reference / Migration / Security
- [ ] **PH-02**: `typedoc` generates API reference to `docs/api/`; pinned version; committed output
- [ ] **PH-03**: Recipes cover: webhook signing, slash command receivers, E2EE channel handling, state persistence, testing with MockKlank
- [ ] **PH-04**: Security doc covers: HMAC details, bot token one-shot model, channel membership, constant-time comparison requirements

### ROT — Token Rotation (decision #5)

> Server-side change + SDK client method. Touches `rust-slack` repo.

- [ ] **ROT-01**: Server adds `POST /bots/:id/rotate-token` endpoint; returns new token once, invalidates old (hashed-at-rest)
- [ ] **ROT-02**: SDK `KlankClient.rotateToken()` method; returns new token; caller responsible for storing
- [ ] **ROT-03**: Docs update the migration guide and bot token section with rotation procedure

### PC — Phase C: State Backends (decision #4)

- [ ] **PC-01**: `StateBackend` interface in core: `get(scope, key)`, `set(scope, key, value, { ttl? })`, `delete`, `keys`
- [ ] **PC-02**: In-memory implementation ships in `@klank/sdk` core as default
- [ ] **PC-03**: `@klank/sdk-redis` package using `ioredis`, takes a user-owned client (P-25 guard)
- [ ] **PC-04**: `@klank/sdk-sqlite` package using `better-sqlite3` with `journal_mode=WAL`, periodic TTL sweep (P-26, P-24 guards)
- [ ] **PC-05**: Contract test suite runs against all three adapters; identical assertions (P-24 guard)
- [ ] **PC-06**: `@klank/sdk` core never imports from `@klank/sdk-*` adapters (P-11 guard, CI-enforced)

### PD — Phase D: Dev CLI

- [ ] **PD-01**: `packages/klank-bot-cli/` ships `klank-bot dev` bin
- [ ] **PD-02**: `klank-bot dev` watches files via `chokidar`, restarts child process on change
- [ ] **PD-03**: Pretty-prints incoming WS events to the terminal
- [ ] **PD-04**: Optional `--tunnel` flag spawns `cloudflared` for slash command receivers during dev

### PI — Phase I: MCP Server

- [ ] **PI-01**: `packages/mcp-klank/` exposes an MCP server consuming `@klank/sdk`
- [ ] **PI-02**: MCP tools map 1:1 to `KlankClient` methods: `klank.send_message`, `klank.list_channels`, `klank.search_messages`, `klank.upload_file`, `klank.dm_user`
- [ ] **PI-03**: Tool schemas generated from SDK types (stays in sync via SCHEMA pipeline)
- [ ] **PI-04**: MCP server runs as stdio transport by default; HTTP transport optional

### F2EE — Phase F-E2EE: MLS for Bots (decision #1 Option B)

> Multi-week. Requires kickoff research spike (ciphersuite, library) before planning.

- [ ] **F2EE-01**: Research spike: confirm `core-crypto` WASM (Wire's OpenMLS wrapper) choice against server's MLS ciphersuite and credential format
- [ ] **F2EE-02**: `@klank/crypto` package wraps `core-crypto`; exposes `CryptoProvider` interface
- [ ] **F2EE-03**: `KlankBot` constructor accepts `crypto: CryptoProvider`; default is `NullProvider` (throws `E2EEChannelError`) for backwards compat
- [ ] **F2EE-04**: `MlsStorage` interface implemented over Phase C state backends; MLS key material persisted, never in-memory-only
- [ ] **F2EE-05**: Decrypt middleware auto-inserted at head of middleware chain; handlers see plaintext
- [ ] **F2EE-06**: Encrypt on send when channel is E2EE; key material AEAD-wrapped with HKDF from bot token
- [ ] **F2EE-07**: Epoch tracking: reject commits with epoch <= last-processed; nonce dedup (P-6 guard)
- [ ] **F2EE-08**: `on('group.welcome')` and `on('group.removed')` first-class events; startup reconciles server membership with local MLS state (P-7 guard)
- [ ] **F2EE-09**: Docs warn about forward-secrecy implications for bot history logging (P-8 guard)
- [ ] **F2EE-10**: `E2EEChannelError` from MIG-04 becomes a soft fallback — real E2EE sends succeed when `crypto` is provided

### FBUILD — Phase F-build: Rust Crate

> Multi-week. Decoupled from TS spine via OpenAPI contract.

- [ ] **FBUILD-01**: `packages/sdk-rust/` nested Cargo workspace; crate name `klank-sdk`
- [ ] **FBUILD-02**: Rust types generated from shared `schemas/openapi.json` via `progenitor` (or `openapi-generator`)
- [ ] **FBUILD-03**: Rust SDK mirrors TS public API: `KlankBot`, `KlankClient`, `WebhookBot` with async trait-based handlers
- [ ] **FBUILD-04**: Shared `fixtures/wire/` directory at repo root; both language test suites load identical fixtures (P-13 guard)
- [ ] **FBUILD-05**: `COMPAT.md` declares target server commit; CI lints consistency across both SDKs (P-14 guard)
- [ ] **FBUILD-06**: Rust crate version policy: stays in `0.0.x` until stable, marked "tracks TS 0.4.x"

---

## Future Requirements (deferred)

- Ephemeral slash command responses in SDK (requires server support)
- HTTP-transport MCP server with auth (stdio-only for Phase I)
- Browser client reusing `@klank/crypto` (future milestone)
- `ctx.openModal` / interactive components (no server support yet)

---

## Out of Scope (explicit exclusions)

- **TS + Rust built in parallel every release** — rejected; Rust is a dedicated future phase, not co-equal parity per release
- **Bots banned from E2EE channels forever** — rejected; Option B (full MLS) is locked
- **Hand-written `types.ts` after SCHEMA ships** — forbidden; generated only
- **`msw` for HTTP mocking** — use `undici` MockAgent instead (STACK research finding)
- **`turborepo`** — premature for this scale; plain pnpm workspaces + changesets
- **`@matrix-org/olm`** — wrong protocol (not MLS)
- **`turborepo`-level build caching** — revisit if CI exceeds 10min
- **Auto-merging OpenAPI type changes** — drift is a learning signal, always opens a PR

---

## Traceability

*Populated by roadmapper agent.*
