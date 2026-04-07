# Architecture Research — Klank SDK Refresh

**Date:** 2026-04-07
**Scope:** Integration architecture for the v0.2 → v0.4 SDK refresh.
**Confidence:** HIGH (grounded in existing codebase docs + locked decisions in PROJECT.md)

This document answers the seven integration questions posed by the milestone. It is opinionated — the roadmapper should treat recommendations as the default path unless a phase planner surfaces a blocker.

---

## 1. Repo Layout — Monorepo Decision

**Recommendation: pnpm workspaces + changesets. No turborepo yet. Cargo workspace nested for Rust.**

### Why a workspace (not flat `packages/`)

The repo already has `packages/sdk-typescript/` and `packages/create-bot/` side-by-side with no root `package.json`, no lockfile, and examples that import `'@klank/sdk'` without any resolution (CONVENTIONS.md §10). That is the worst of both worlds: the directory looks like a monorepo but nothing links the packages. As soon as Phase C (state backends), Phase D (CLI), Phase E (test kit), Phase G (scaffolder), and Phase I (MCP server) each become their own publishable artifact, the `@klank/sdk-redis` test in `@klank/sdk`'s CI needs to `import { KlankBot } from '@klank/sdk'` and resolve to the local source — not a published tarball. Workspaces are the only clean way to do that.

### Why pnpm specifically

- Native `workspace:*` protocol — `@klank/sdk-redis` declares `"@klank/sdk": "workspace:*"` and publishes with the real version auto-substituted.
- Strict hoisting — keeps the dep-light promise in PROJECT.md Constraints. A bot user who installs `@klank/sdk` won't accidentally get `ioredis` just because `@klank/sdk-redis` exists next door.
- Small, fast, and the default choice in the 2025+ Node ecosystem for SDK monorepos (LangChain JS, tRPC, Hono all use it).

### Why not turborepo

Turborepo pays off at ~10+ packages with expensive task graphs. The refresh tops out at ~8 packages and the build is `tsup` (fast). Add turborepo only if `pnpm -r build` starts hurting — it won't for a while. Keep the dep graph inspectable; don't introduce a remote cache layer before there's pain.

### Why changesets

Versions will diverge: `@klank/sdk@0.3.0` can ship while `@klank/sdk-redis@0.1.0` is still alpha. Changesets gives per-package semver + auto-generated changelogs + a single PR workflow. Lerna is deprecated; nx is overkill.

### Proposed tree

```
rust-slack-sdk/
├── package.json                 # root, private, workspaces declared
├── pnpm-workspace.yaml
├── .changeset/
├── tsconfig.base.json           # shared strict compiler options
├── Cargo.toml                   # workspace for the Rust crate (Phase F-build)
├── packages/
│   ├── sdk/                     # @klank/sdk       (renamed from sdk-typescript)
│   ├── sdk-redis/               # @klank/sdk-redis (Phase C)
│   ├── sdk-sqlite/              # @klank/sdk-sqlite (Phase C)
│   ├── sdk-testing/             # @klank/sdk-testing (Phase E — MockKlank)
│   ├── cli/                     # @klank/cli       (Phase D — `klank-bot dev`)
│   ├── create-klank-bot/        # create-klank-bot (Phase G)
│   ├── mcp-klank/               # mcp-klank        (Phase I)
│   ├── schemas/                 # @klank/schemas   (generated OpenAPI types — see §3)
│   └── sdk-rust/                # crate klank-sdk  (Phase F-build, Cargo member)
├── templates/
│   └── typescript/<name>/       # filled in Phase G
└── examples/<name>/             # each gets its own package.json
```

**Rename decision:** `packages/sdk-typescript/` → `packages/sdk/`. The repo is multi-language post-Phase-F; the `-typescript` suffix becomes a lie. The package name `@klank/sdk` stays the same.

**Delete:** `packages/create-bot/` (empty, replaced by `packages/create-klank-bot/` with the proper npm-init name).

---

## 2. MLS Crypto Layer — Where Does It Live?

**Recommendation: separate `@klank/crypto` package, consumed by `@klank/sdk`. Core stays dep-light.**

### The constraint

MLS is heavy. The realistic JS options are `@wireapp/core-crypto` (WASM, ~2MB, OpenMLS-backed) or `mls-rs` via wasm-bindgen. Either way, the crypto layer brings a WASM blob, a sizable init cost, and a worker-friendly API surface. Bundling that into `@klank/sdk` core:
- Violates the "core dep-light" constraint in PROJECT.md.
- Forces every webhook-only user to ship a WASM blob they never call.
- Couples WS transport to a library whose release cadence we don't control.

### The shape

```
@klank/crypto                              # new package, Phase F-E2EE
  ├── exports CryptoProvider interface
  ├── exports MlsProvider implementation (WASM-backed)
  └── exports NullProvider (throws on encrypt/decrypt — the 0.2/0.3 default)

@klank/sdk
  └── KlankBot constructor accepts `crypto?: CryptoProvider`
     - undefined → NullProvider → today's behavior + typed E2EEChannelError
     - MlsProvider → Phase F-E2EE bots in E2EE channels
```

This is the same seam used by Phase C state backends (injection via constructor). It keeps the integration contract identical across optional capabilities.

### Future-proofing for a browser client

A hypothetical `@klank/web` (browser client, not scoped in this milestone) would also consume `@klank/crypto`. Keeping it separate means the WASM blob is loaded once and the key-management code is written once. If we ever unify server+browser crypto, this is where it lives.

### What `@klank/crypto` owns

- MLS group state per channel (`GroupId → MlsGroup`)
- KeyPackage generation and publication to the server
- Welcome message processing
- `encrypt(groupId, plaintext) → ciphertext`, `decrypt(groupId, ciphertext) → plaintext`
- Key state persistence delegated back to `@klank/sdk` state backend (see §4) — crypto provider does NOT own disk/redis, it owns the algorithm.

**Confidence:** MEDIUM — this is architectural sketch; Phase F-E2EE will need its own deep research pass on MLS library choice (core-crypto vs mls-rs vs rolling via the Rust crate and exposing via NAPI).

---

## 3. Rust ↔ TypeScript Type Sharing

**Recommendation: Single source of truth = server's `utoipa`-generated OpenAPI. Both SDKs consume it.**

Decision already locked in PROJECT.md Key Decisions: utoipa + openapi-typescript. This answers "how for TS". For Rust, extend the pipeline:

```
rust-slack (server)
  ↓ utoipa derive on handlers
  ↓ cargo run --bin dump-openapi  →  openapi.json (committed to rust-slack-sdk)
  ↓
  ├── openapi-typescript →  packages/sdk/src/generated/types.ts
  └── progenitor / openapi-generator → packages/sdk-rust/src/generated/
```

### Why not a separate `@klank/schemas` package that both consume

Tempting, but adds a publish step without removing drift risk. The server is the source of truth; adding an intermediate npm+crate pair means every type change touches three repos instead of two. Keep it simple: **the server's OpenAPI file is the contract**, checked into `rust-slack-sdk/schemas/openapi.json`, regenerated in CI when the server commit pin updates.

### What about `@klank/schemas` for SDK-authored types?

SDK has its own types that aren't server-derived: `BotConfig`, `BotContext`, `Middleware`, handler signatures. Those stay in `packages/sdk/src/types.ts` (hand-written). The split is clean: **wire types generated, framework types hand-written**. This mirrors the existing snake_case/camelCase split documented in CONVENTIONS.md §4.

### Rust crate strategy

For Phase F-build, the Rust crate consumes the same `openapi.json` via `progenitor` (Oxide Computer's generator — best-in-class for Rust). This way TS and Rust can never drift on wire format. Framework types in Rust are hand-written to match idiomatic Rust patterns (builders, not classes).

---

## 4. E2EE Data Flow & Key State

### Receive path (WS → handler)

```
ws.ts onMessage(raw)
  → JSON.parse → ServerEvent
  → if event.type === 'message.new' && event.ciphertext:
       plaintext = await crypto.decrypt(event.channel_id, event.ciphertext)
       event.plaintext = plaintext        // mutate the event in place
  → bot.handleEvent(event)                // handlers see plaintext transparently
```

The decrypt step happens in a **new `CryptoMiddleware`** inserted at the top of the middleware chain by the bot constructor when a crypto provider is configured. This means:
- Handlers are unchanged — they still get `event.plaintext`.
- User middleware runs AFTER decrypt, so user middleware can read plaintext.
- If decrypt fails, the middleware emits a typed `E2EEDecryptError` routed through `errorHandler`. The event is not dispatched further.

### Send path (`ctx.say` → server)

```
ctx.say(text)
  → client.sendMessage(channelId, text)
  → client.fetch intercepts:
       if channel is E2EE (cached from listChannels / first send attempt):
         ciphertext = await crypto.encrypt(channelId, text)
         body = { ciphertext, content_type: 'mls', ... }
       else:
         body = { plaintext: text, content_type: 'plaintext', ... }
  → POST /channels/:id/messages
```

**The "is channel E2EE?" check** is cached in `KlankClient` after the first 403-with-E2EE-reason or after an explicit channel-metadata fetch. In 0.2.0 (pre-E2EE), the same cache drives the `E2EEChannelError` from M-2. Phase F-E2EE just upgrades the "throw" branch to "encrypt and retry".

### Where key state lives

`@klank/crypto` owns the *algorithm*, not the *persistence*. MLS group state is serializable; it gets stored via the **Phase C state backend**:

```
bot.state.get('mls:group:<channelId>', 'state') → serialized MLS group
bot.state.set('mls:group:<channelId>', 'state', serialized, { ttl: none })
```

This is why Phase C must land before Phase F-E2EE can realistically ship. For the in-memory default, state is lost on restart and the bot re-syncs via Welcome messages. For Redis/SQLite, state survives restarts — which is the only way a long-lived bot stays in an E2EE channel without being re-added every deploy.

**Key material encryption at rest:** `@klank/crypto` wraps serialized group state with an AEAD using a key derived from the bot token (HKDF). The state backend sees only ciphertext. This is non-negotiable — a Redis dump of raw MLS state would be catastrophic.

### Cross-cutting: self-message suppression with E2EE

The existing self-filter (`bot.ts:101`, `sender_id === botInfo.bot_id`) runs BEFORE decrypt — correct, because sender id is on the envelope, not the ciphertext. The Phase A webhook-id fix adds a second id to the suppression set; still pre-decrypt.

---

## 5. Plugin / Middleware Architecture

**Recommendation: extend the existing `use()` middleware. Do NOT introduce a separate "listener plugin" system.**

### Reasoning

The current middleware chain (`bot.ts:108-117`) is index-based, composable, and already supports the "decorate ctx then call next" pattern. Every new capability fits cleanly:

| Capability | Mechanism |
|---|---|
| Logging | `bot.use(loggingMiddleware)` |
| Metrics | `bot.use(metricsMiddleware)` |
| Decrypt (Phase F-E2EE) | auto-inserted `cryptoMiddleware` at chain head |
| State injection | auto-inserted `stateMiddleware` that adds `ctx.state` |
| Custom auth checks | user `bot.use(...)` |

A second "listener plugin" API would fragment the mental model. "Why does logging use `use()` but crypto use `addPlugin()`?" has no good answer. Instead:

- **User-facing extension point:** `bot.use(middleware)` — unchanged.
- **Internal/core extension point:** constructor-injected providers (`crypto`, `state`, `logger`, `cryptoProvider`). These auto-install themselves as middleware at known positions in the chain.

### Middleware ordering contract

```
chain = [
  cryptoMiddleware?,        // decrypt incoming
  stateMiddleware?,         // inject ctx.state
  ...userMiddleware,        // bot.use() in registration order
  // then: handleEvent dispatches to on/command/message handlers
]
```

Document this order in `@klank/sdk` README. The order is a public contract — reordering breaks user expectations.

### What about `@klank/sdk-testing`'s `MockKlank`?

It's not a plugin. It's a *replacement transport*: `new KlankBot({ ..., transport: mock })`. Phase E introduces a `Transport` interface that `WsManager` implements and `MockKlank` also implements. This keeps MockKlank honest (real routing, real middleware, fake wire) per the testing integrity rules.

---

## 6. Backwards Compatibility — 0.1.0 → 0.2.0 → 0.3.0

**Non-negotiable: no breaking changes to the `KlankBot` / `KlankClient` / `WebhookBot` public API through 0.3.x.** Breaking changes wait for 0.4.0 with a migration codemod.

### Surface area to preserve verbatim

From ARCHITECTURE.md §Public API Surface:
- `new KlankBot({ token, serverUrl, reconnect? })` — constructor shape
- `bot.on()`, `bot.command()`, `bot.message()`, `bot.use()`, `bot.onError()`, `bot.start()`, `bot.stop()`, `bot.getClient()`, `bot.getBotInfo()`
- `BotContext`: `say`, `reply`, `react`, `sendMessage` (exact signatures)
- `CommandContext`: `respond`, `say`
- `KlankClient` method names and return types
- `WebhookBot.send(text, { username? })`

### Strategies for adding without breaking

1. **Phase A typed overloads via `on()`:** TypeScript overload signatures are purely additive at runtime. Add
   ```ts
   on(type: 'message.new', handler: EventHandler<MessageEvent>): this
   on(type: 'reaction.added', handler: EventHandler<ReactionEvent>): this
   // ...
   on(type: string, handler: EventHandler): this   // existing fallback
   ```
   Existing code that registers handlers with the untyped form continues to compile. The `ServerEvent` union is a widening of `MessageEvent`, so existing handlers that did `as MessageEvent` still typecheck.

2. **Phase A new `ctx` methods (`thread`, `update`, `delete`, `upload`, `dm`, `unreact`):** additive on `BotContext`. No existing code references methods that don't exist yet.
   - **Trap:** `ctx.reply()` currently means "post in thread". Slack's `reply` means "post in thread"; `ctx.thread()` is a synonym. **Keep `ctx.reply()` with its current meaning**; add `ctx.thread()` as an alias; don't repurpose `reply` to mean "post in channel" (that would silently change every existing bot's behavior). The roadmap note at SDK-REFRESH-ROADMAP.md §Phase A hints at wanting to rename — reject that. Document clearly, do not rename.

3. **Phase B HTTP receiver:** new exported factory `createSlashCommandReceiver()`. Zero impact on existing surface.

4. **Phase C state backends:** `bot.state` is a new property. Existing bots that never reference it are unaffected. The in-memory default is always available — no import required, `bot.state.get('global', 'foo')` works out of the box.

5. **Phase E `@klank/sdk-testing`:** separate package. Zero impact.

6. **Phase F-E2EE crypto provider:** constructor gains optional `crypto?: CryptoProvider`. Absent = today's behavior (throw `E2EEChannelError`). Present = bot can participate in E2EE. Default behavior for existing bots is unchanged.

7. **Generated types from OpenAPI:** this is the riskiest change. Hand-written `types.ts` today may have fields with slightly different names or optional-ness than the server emits. Mitigation:
   - Generate into `packages/sdk/src/generated/` (new path).
   - Hand-written `types.ts` becomes a compatibility layer that re-exports generated types under the existing names. Where shapes differ, the hand-written file is an explicit bridge with FIXME comments.
   - Only flip the main entry to re-export directly from `generated/` in 0.4.0 after a deprecation cycle.

### Deprecation mechanics

- Use `@deprecated` JSDoc tags for anything we'd like to remove. Nothing is actually removed until 0.4.0.
- `CHANGELOG.md` per package via changesets — document every addition even if non-breaking.
- Migration guide in `docs/migration/0.1-to-0.2.md` (M-7) sets the template; `0.2-to-0.3.md` and `0.3-to-0.4.md` follow.

### Process cleanup that LOOKS like a break but isn't

`bot.ts:75-77` registers `SIGINT`/`SIGTERM` handlers on the global `process`. This is buggy for multi-bot processes. **Fix:** change the default to NOT register signal handlers. Add `{ registerSignalHandlers: false }` default in `BotConfig`. Existing single-bot users relying on auto-shutdown will notice — document prominently in 0.2.0 release notes. If that's considered breaking, flip the default in 0.3.0 instead and log a one-time deprecation warning in 0.2.0 when the handlers fire.

---

## 7. Build Order Respecting Cross-Package Dependencies

The roadmap already proposes an order (SDK-REFRESH-ROADMAP.md §5). This refines it with the monorepo + package dependency graph in mind.

### Dependency graph

```
@klank/schemas (generated types)
    ↑
@klank/sdk  ←──── @klank/sdk-testing
    ↑    ↑
    │    └── @klank/sdk-redis, @klank/sdk-sqlite
    │
    ├── @klank/cli
    ├── create-klank-bot + templates/
    ├── mcp-klank
    └── @klank/crypto ←── (consumed by sdk when Phase F-E2EE lands)

@klank/sdk-rust (parallel universe, consumes @klank/schemas' openapi.json directly)
```

### Revised execution order

1. **Workspace bootstrap (prerequisite phase, call it Phase 0):**
   - Add root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`.
   - Rename `packages/sdk-typescript` → `packages/sdk`.
   - Add changesets, Prettier, ESLint configs (close the CONVENTIONS.md §10 gap about "no enforcement").
   - Delete empty `packages/create-bot/`.
   - CI: lint + build + typecheck on every PR.
   - **Why first:** everything downstream assumes workspace resolution. Doing this after Phase A means redoing imports. No new feature code; minimum churn.

2. **Migration phase (M-1 → M-7):** unchanged from roadmap. Ships 0.2.0. All work inside `packages/sdk/`.

3. **utoipa + openapi-typescript pipeline:** create `packages/schemas/` stub; wire the generator. Land BEFORE Phase A because Phase A's typed overloads benefit from generated event types. Coordinated commit with `rust-slack` server for the `utoipa` annotations.

4. **Phase A (typed events + ctx helpers):** first real feature phase. All inside `packages/sdk/`. Ships incrementally toward 0.3.0.

5. **Phase B (HTTP receivers):** small; can overlap Phase A. Still inside `packages/sdk/`.

6. **Phase E (`@klank/sdk-testing`):** NEW PACKAGE. Requires the `Transport` interface extraction from `packages/sdk/`. Do this before Phase C so Phase C backends can be tested with MockKlank.

7. **Phase C (state backends split):** extract `StateStore` interface in `@klank/sdk`, ship in-memory impl in core, create `@klank/sdk-redis` and `@klank/sdk-sqlite` as new workspace packages. Each backend has a test suite using `@klank/sdk-testing`.

8. **Phase G (`create-klank-bot` + templates):** new `packages/create-klank-bot/` + filled `templates/typescript/<name>/`. Depends on stable Phase A surface.

9. **Phase H (docs split + typedoc):** mostly docs; touches all packages. After Phase G so templates are linkable.

10. **Phase D (`@klank/cli`):** new package. Benefits from Phase B (receiver) existing so the tunnel story is useful.

11. **Phase I (`mcp-klank`):** new package, depends on a stable Phase A `KlankClient` surface (upload, edit, search, DM). Last because it's a downstream consumer.

12. **Phase F-E2EE:** new `@klank/crypto` package, auto-middleware hook in `@klank/sdk`. Depends on Phase C (persistence) and Phase E (testing). This is the 0.4.0 milestone.

13. **Phase F-build (Rust crate):** new `packages/sdk-rust/` as a Cargo workspace member + a Rust workspace root `Cargo.toml`. Consumes the same `openapi.json` as `@klank/schemas`. Parallelizable with everything above once the schema pipeline is stable.

### Critical path

**0 → Migration → schema pipeline → A → E → C → F-E2EE** is the longest dependency chain. Anything off this chain (B, G, H, D, I, F-build) can be scheduled opportunistically or parallelized.

### Parallelization opportunities for roadmapper

- After Migration: Phase A and Phase B can run in parallel (different files).
- After Phase E exists: Phase C, G, D, I can all be independent packages developed in parallel — they only need the stable `@klank/sdk` surface.
- Phase F-build (Rust) can start the moment the schema pipeline is stable, independent of Phase A/B/C. It's a separate subagent orchestration per the PROJECT.md decision.

---

## Integration Contracts Summary (for phase planners)

| Integration Point | Contract | Phase that establishes it |
|---|---|---|
| Workspace resolution | `workspace:*` protocol, pnpm hoisting rules | Phase 0 |
| OpenAPI schema location | `schemas/openapi.json` at repo root | Schema pipeline phase |
| Generated TS types path | `packages/sdk/src/generated/` | Schema pipeline phase |
| `Transport` interface | Abstract WS + REST behind an interface in `packages/sdk/src/transport.ts` | Phase E prep |
| `StateStore` interface | `get/set/delete/scan` with scope+key+ttl | Phase C |
| `CryptoProvider` interface | `encrypt/decrypt/processWelcome/generateKeyPackage` | Phase F-E2EE |
| Middleware ordering | crypto → state → user → dispatch | Phase F-E2EE (documented earlier) |
| Error taxonomy | `KlankError` base class, subclasses per category | Migration (seed), extended per phase |
| Public API freeze | No breaking changes through 0.3.x | Every phase |

---

## Open Architectural Questions (flag for later research)

1. **MLS library choice** — `@wireapp/core-crypto` vs `mls-rs` via wasm-bindgen vs rolling our own from the Rust crate (NAPI). Phase F-E2EE needs its own research pass. LOW confidence on this until evaluated.
2. **Browser target** — we've designed `@klank/crypto` as browser-capable, but `@klank/sdk` imports `ws` directly. If/when a browser client is in scope, `@klank/sdk` needs a conditional `exports` split (node: ws, browser: WebSocket global). Out of scope for this milestone; don't paint ourselves into a corner — keep transport behind the `Transport` interface so the browser story is "swap the transport".
3. **`@klank/schemas` as a separate package vs inline generated/**: I've recommended inline. If the Rust crate wants to consume generated TS types (unlikely) or a third language joins, revisit.
4. **Changesets vs semantic-release** — changesets chosen for multi-package support. If the team already uses semantic-release elsewhere, reconsider.

---

*Architecture research: 2026-04-07*
