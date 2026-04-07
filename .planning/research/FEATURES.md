# Feature Landscape — Klank SDK Refresh

**Domain:** Chat/bot SDKs (Slack-alternative, E2EE-capable)
**Researched:** 2026-04-07
**Reference competitors:** `@slack/bolt` (bolt-js), `discord.js` v14, `matrix-bot-sdk` (turt2live)
**Scope:** For each in-flight roadmap phase (A, B, C, D, E, F-E2EE, F-build, I), benchmark what the three reference SDKs ship as table stakes, where they differentiate, and what we should explicitly NOT build.

This document does not re-list features already scoped in `SDK-REFRESH-ROADMAP.md`. It tells each phase's planner what "done right" looks like relative to the competition.

---

## 1. Typed Event Handlers + Context Helpers (Phase A)

### What the competition does

**@slack/bolt**
- Single `app.event('message', async ({ event, message, say, client, ack, context, logger }) => {...})`. The listener arg object is the context — there is no separate `ctx`. Type narrowing is by generic: `app.event<AppMentionEvent>('app_mention', ...)` or via string-literal keys that map to generated types in `@slack/types`.
- Core helpers in every listener's arg object:
  - `say(text|blocks)` — post to the triggering channel.
  - `respond(text|blocks)` — post via `response_url` (works for slash commands, block actions, view submissions).
  - `client: WebClient` — full REST client pre-auth'd with the right token (multi-workspace aware).
  - `ack()` — acknowledge within 3s (MUST call for actions/commands/shortcuts/views).
  - `context` — app-level state (botId, botUserId, custom middleware additions).
  - `logger` — per-request logger.
- `say` is only present when the event has a `channel` — the type system enforces this.

**discord.js v14**
- `client.on(Events.MessageCreate, (message) => ...)` where `Events` is an enum. Each event name maps to a strict tuple type in `ClientEvents` (TS interface), so the handler args are fully typed without generics.
- Context is not a separate object — it's methods on the domain entity: `message.reply()`, `message.channel.send()`, `message.react()`, `interaction.reply()`, `interaction.deferReply()`, `interaction.followUp()`, `interaction.editReply()`, `interaction.showModal()`.
- Interactions have a "deferred reply" concept: `deferReply({ ephemeral: true })` buys you 15 minutes to respond while showing a "thinking" state.

**matrix-bot-sdk**
- `client.on('room.message', (roomId, event) => ...)`. String-keyed, weakly typed (handler signature is `(...args: any[]) => void`). This is a weak point relative to bolt/discord.js.
- No rich context object — you use the `MatrixClient` directly: `client.sendText(roomId, text)`, `client.replyText(roomId, event, text)`, `client.sendEvent(roomId, type, content)`, `client.redactEvent(roomId, eventId, reason)`.

### Table stakes (we must have these)

| Capability | Bolt | discord.js | matrix-bot-sdk | Klank Phase A |
|---|---|---|---|---|
| Type-narrowed event handler by event name (no manual casts) | yes (generic) | yes (enum + `ClientEvents` map) | no | **required** |
| `say`/send-in-channel | yes | yes (`channel.send`) | yes | already have |
| `reply` distinct from `say` (thread vs channel) | yes (`say` is channel; threads via `thread_ts`) | yes (`message.reply`) | yes (`replyText`) | **must clarify** — today `reply` is thread-post |
| Edit/update own message | `client.chat.update` | `message.edit` | `sendEvent` + replace | **required** (`ctx.update`) |
| Delete own message | `client.chat.delete` | `message.delete` | `redactEvent` | **required** (`ctx.delete`) |
| React / unreact | `client.reactions.add/remove` | `message.react` / `reaction.remove` | `sendEvent` m.reaction | have `react`; **add `unreact`** |
| Upload file | `client.files.uploadV2` | `channel.send({ files })` | `uploadContent` + `sendEvent` | **required** (`ctx.upload`) |
| Open DM / send DM to user | `client.conversations.open` | `user.send` | `createDirectMessage` | **required** (`ctx.dm`) |
| Per-invocation logger | yes | no (global) | no | optional; differentiator |
| Pre-auth'd REST client on context | yes (`client`) | yes (via `message.client`) | yes (`client` itself) | already have (`ctx.client` — but not currently exposed; fix) |

### Differentiators (nice-to-have, ship if cheap)

- **Bolt's `ack()` 3-second contract enforcement** — if we ever add HTTP interaction receivers, a typed "you must ack within N seconds or this errors loudly" is a killer DX win. Discord.js does this implicitly with deferred replies.
- **Discord.js-style deferred responses** — `ctx.defer()` for slow slash commands, then `ctx.editResponse(text)` when ready. Slack bolt has this pattern via `response_url`; Matrix doesn't need it.
- **Fluent entity methods on events** — `event.message.reply(...)` in addition to `ctx.reply(...)`. Discord.js is the gold standard here. Arguably over-engineered for Klank; stick with a single `ctx` surface.
- **Per-event `logger`** with the event id bound — bolt does this, debugging is much easier. Low-effort win.

### Anti-features (do NOT build in Phase A)

| Anti-feature | Why avoid | Instead |
|---|---|---|
| Entity-method style (`message.reply()`, `message.react()`) | Doubles the API surface; forces us to return rich wrapper objects instead of plain data; conflicts with the generated-types plan (utoipa → openapi-typescript). | Keep a single `ctx` object. Events stay as plain data matching the server schema. |
| Global `Events` enum (discord.js style) | Another drift surface. Server already defines event names as string-literals; the `ServerEvent` union gives us narrowing for free once `on()` is overloaded. | Use TS string-literal overloads on `on()` — zero runtime cost, zero drift. |
| Implementing ephemeral before server supports it | Currently silently dropped at `bot.ts:194-205`. Pretending it works is worse than throwing. | Throw `NotImplementedError` OR wait until server lands the endpoint, per roadmap decision. |
| Mutable shared `context` with ad-hoc middleware additions (bolt-style `context.foo = bar`) | Untyped, surprises callers, hard to test. | If we add mutable context, type it explicitly via a generic parameter on `KlankBot<TContext>`. |
| Opening modals / Block Kit equivalents | No server support, no user demand. Would be a deep rabbit hole. | Out of scope; reassess post-0.4. |

### Competitor references
- [bolt-js listener args](https://docs.slack.dev/tools/bolt-js/concepts/actions/)
- [discord.js ClientEvents / Events enum](https://discord.js.org/docs/packages/discord.js/14.26.2)
- [matrix-bot-sdk MatrixClient](https://turt2live.github.io/matrix-bot-sdk/)

---

## 2. Slash Command HTTP Receivers (Phase B)

### What the competition does

**@slack/bolt — gold standard here.** Ships four receivers out of the box:
- `HTTPReceiver` (default, uses Node `http`)
- `ExpressReceiver` (Express middleware)
- `AwsLambdaReceiver` (Lambda handler shape: `(event, context, callback)`)
- `SocketModeReceiver` (WS-based, no HTTP receiver needed)

Each receiver:
1. Verifies the `x-slack-signature` + `x-slack-request-timestamp` HMAC.
2. Rejects requests older than 5 minutes (replay protection).
3. Parses the body (form-urlencoded for commands, JSON for events).
4. Normalizes to a common `ReceiverEvent` and dispatches into `App.processEvent`.
5. Implements `ack()` timing: if the listener hasn't called `ack()` within 3s, the receiver auto-acks.
6. Supports `processBeforeResponse: true` for Lambda (where you can't background work after returning).

**discord.js** — does NOT ship an HTTP receiver. It uses the Gateway (WS) by default. For HTTP interactions people use `discord-interactions` (a separate package) which exposes `verifyKeyMiddleware` for Express and a raw `verifyKey(body, sig, ts, publicKey)` function. Discord interactions are signed with ed25519, not HMAC.

**matrix-bot-sdk** — no HTTP receivers at all. Matrix is pure long-poll (`/sync`) or WS, so the concept doesn't apply.

### Table stakes

| Capability | Bolt | discord-interactions | Klank Phase B |
|---|---|---|---|
| HMAC verification helper (framework-agnostic, takes raw body) | yes | yes (ed25519 equivalent) | **yes — Migration M-3 already scoped** |
| Constant-time comparison | yes | yes | **required** |
| Replay protection via timestamp | yes (5 min window) | yes | **required — we currently don't have this**. Server must stamp or we need a `timestamp` header to verify. Flag for server coordination. |
| Raw-body access in Express/Fastify/Hono/Lambda | yes (documents `bodyParser.json({ verify })` pattern) | yes | **required — document per framework** |
| Node `http.IncomingMessage`-compatible handler | yes | no (Express-only middleware) | **required** — one handler, multiple adapters |
| Auto-dispatch into bot's command router | yes | no (they hand you the verified payload) | **required** — `createSlashCommandReceiver({ signingSecret, handler })` should route to the same `bot.command()` registry |

### Differentiators

- **Lambda-shaped helper** (`createLambdaSlashCommandHandler`) — bolt does this and it's the single most-cited reason people pick bolt over rolling their own. Low effort if the core Node-http handler is done first.
- **Framework-specific wrappers** in separate entry points: `@klank/sdk/express`, `@klank/sdk/fastify`, `@klank/sdk/hono`. Keeps the core dep-light (per constraint) while giving each ecosystem idiomatic glue.
- **Dev mode tunnel integration** (Phase D) — "klank-bot dev" spawns the receiver + a cloudflared tunnel and prints the URL to paste into Klank admin. Nothing else in the competitive set does this.

### Anti-features

| Anti-feature | Why avoid |
|---|---|
| Bundling Express/Fastify/Hono into `@klank/sdk` core | Kills dep-light constraint. Ship adapters as separate packages or subpath exports. |
| A "framework" (opinionated routing + middleware on top of HTTP) | Scope creep. Bolt made this choice and now has to maintain four receivers, OAuth flows, and a router. We are a library, not a framework. |
| Auto-ack with background work (bolt's `processBeforeResponse: false`) | Lambda-hostile, hidden state. Make the user explicitly return their response. |
| Replay protection with SDK-managed nonce storage | Don't be a database. Timestamp window is sufficient; if a user needs stronger replay protection they can layer it. |
| Hiding the raw body from the user | Many frameworks consume the stream; users need to opt into raw-body mode. Document it loudly. |

### Server coordination flags
- **Timestamp header for replay protection.** Server currently only sends `X-Klank-Signature: sha256=...` (per `crates/rs-bots/src/slash_commands.rs:32-65`). Without a timestamp, we cannot reject stale requests. **Flag this to the planner**: either add `X-Klank-Timestamp` server-side or ship Phase B without replay protection and document the limitation.

### Competitor references
- [bolt-js AwsLambdaReceiver source](https://github.com/slackapi/bolt-js/blob/main/src/receivers/AwsLambdaReceiver.ts)
- [bolt-js customizing a receiver](https://docs.slack.dev/tools/bolt-js/concepts/receiver/)
- [discord-interactions verifyKey](https://www.npmjs.com/package/discord-interactions)

---

## 3. Test Kits / Mock Servers (Phase E)

### What the competition does

**@slack/bolt** — no first-party test kit. Official docs punt on testing (issues #380, #383 open for years). The community answer is [`@slack-wrench/jest-bolt-receiver`](https://www.npmjs.com/package/@slack-wrench/jest-bolt-receiver): a Jest-integrated fake receiver that lets you push mock events into an `App` and assert on what listeners did + what `client` calls they made. There is a newer `@slack/test` package for mocking events/interactions but it is not widely adopted.

**discord.js** — no official test kit. Community uses plain Jest + manual mocking of `Client`, `Message`, `Interaction` objects. Widely regarded as painful. People either do integration tests against a real staging bot or skip testing entirely.

**matrix-bot-sdk** — ships an in-repo `testing/` helper with fake `MatrixClient` + HTTP mock (axios mock adapter). It's not exported as a public test kit; contributors copy it.

### Table stakes (per CLAUDE.md testing integrity: no useless mocks)

| Capability | Klank Phase E |
|---|---|
| Spin up an in-process fake Klank server that speaks the real wire format | **required** |
| Push synthetic `ServerEvent`s into the bot's WS handler and await dispatch | **required** |
| Record every REST call made by `KlankClient` (method, path, body, headers) | **required** |
| Assert on HMAC signatures actually computed on webhook posts (catches C-1 regressions) | **required** |
| Replayable fixtures — JSON files of real server events the SDK can load into the mock | **required** |
| Works with `vitest` (current devDep); no Jest assumption | **required** |

### Differentiators

- **Round-trip HMAC tests built into the test kit.** The server's `verify_signature` test in `crates/rs-bots/src/slash_commands.rs:78-101` should be portable to the SDK side. If our test kit ships with "here's a sample body, here's the signature the server accepts, assert your verifier agrees" — that's a real regression fence for C-1.
- **Time control** — `mock.advanceTime(ms)` so reconnect backoff tests don't actually wait 30s.
- **Failure injection** — `mock.failNext('POST /channels/:id/messages', 429, { retry_after: 1 })` to test 429 hardening.
- **Event fixture library** — ship `@klank/sdk/testing/fixtures` with canonical `message.new`, `reaction.added`, `command.invoked`, `message.updated`, etc. events. Users import them instead of hand-building.

### Anti-features

| Anti-feature | Why avoid |
|---|---|
| Mocking `KlankClient` itself (so tests don't hit the fake server) | Violates CLAUDE.md — "tests must exercise real behavior". A bot test that mocks the client isn't testing anything. |
| Auto-mocking via Jest manual mocks | Jest-specific, and hides what's mocked. Explicit `MockKlank` is discoverable. |
| A "snapshot testing" mode that serializes bot output to disk | Encourages tests that prove "we can make CI green" instead of "the system works". Per CLAUDE.md, snapshot-first tests are a smell. |
| Mock that silently accepts invalid signatures | Would mask real bugs. The mock server should verify exactly as the real server does. |
| Exposing `MockKlank` internals (database state, internal counters) | Encourages tests coupled to implementation. Expose an assertion API (`mock.sentMessages`, `mock.calls('POST', '/channels/:id/messages')`). |

### Competitor references
- [@slack-wrench/jest-bolt-receiver](https://www.npmjs.com/package/@slack-wrench/jest-bolt-receiver)
- [bolt-js testing issue #383](https://github.com/slackapi/bolt-js/issues/383)

---

## 4. State / Storage Abstractions (Phase C)

### What the competition does

**@slack/bolt** — has a `ConversationStore` interface with `get(conversationId)` and `set(conversationId, value, expiresAt?)`. Default is `MemoryStore` (in-process, single-instance only). Redis/SQLite are user-supplied — there's a small ecosystem (`@slack-wrench/bolt-storage-file`, various community Redis stores) but no first-party adapters. The store is exposed through `context.updateConversation()` and `context.conversation`.

**discord.js** — no state abstraction. People reach for `discord-akairo`, `@sapphire/framework`, or plain Redis/Postgres. This is widely seen as a gap.

**matrix-bot-sdk** — `IStorageProvider` with `storeValue/readValue` + specific methods for sync tokens (`setSyncToken`), filters (`setFilter`), etc. Implementations: `MemoryStorageProvider`, `SimpleFsStorageProvider` (JSON file), `NamespacingSqliteStorageProvider`. Crypto storage is separate (`ICryptoStorageProvider`, Rust-backed).

### Table stakes

| Capability | Bolt | Matrix | Klank Phase C |
|---|---|---|---|
| Pluggable store interface | yes (ConversationStore) | yes (IStorageProvider) | **required** |
| In-memory default | yes | yes | **required** |
| Scoping by channel / thread / user | no (only by conversationId — user must encode scope) | no (flat KV) | **differentiator** — roadmap scopes it (`channel:<id>`, `thread:<id>`, `user:<id>`, `global`) |
| TTL / expiry | yes (`expiresAt`) | no | **required** |
| Adapter packages outside core | no (first-party); yes (community) | first-party sqlite | **required (decided)** — `@klank/sdk-redis`, `@klank/sdk-sqlite` split |
| Atomic get-and-set / locks | no | no | **do not ship** |

### Differentiators

- **Typed scoped keys**: `bot.state.get<UserPrefs>('user:abc', 'prefs')` with a generic that narrows the return. Bolt doesn't do this.
- **Scope-aware helpers on `ctx`**: `ctx.channelState.get('counter')` implicitly scopes to the event's channel. Reduces boilerplate vs. bolt's "encode your own scope in the key".
- **Automatic cleanup on channel deletion**: when a `channel.deleted` event arrives, purge `channel:<id>:*` keys. Low-effort, high-payoff.

### Anti-features

| Anti-feature | Why avoid |
|---|---|
| Shipping Redis/SQLite in `@klank/sdk` core | Violates dep-light constraint (already resolved). |
| Transactions / optimistic concurrency across keys | Scope creep. Users who need this use Postgres directly. |
| Automatic JSON schema validation on get/set | Tempting, but cross-cuts against the generics approach and pulls in a validator dep. |
| Distributed locks | Not our job. Users who need locks use Redis directly. |
| Encrypting state at rest by default | Adds complexity, key management burden. Users who need this layer it. |

### Competitor references
- [bolt-js conversation-store.ts](https://github.com/slackapi/bolt-js/blob/main/src/conversation-store.ts)
- [matrix-bot-sdk IStorageProvider](https://turt2live.github.io/matrix-bot-sdk/)

---

## 5. Dev CLI with Hot Reload (Phase D)

### What the competition does

**@slack/bolt** — no official dev CLI. Slack has `slack-cli` which is a higher-level "deploy to Slack's hosting" tool; the watch-and-restart loop is left to the user (nodemon / tsx watch).

**discord.js** — no official dev CLI. Sapphire has `@sapphire/cli` for scaffolding, not for hot reload. The ecosystem norm is `nodemon --exec tsx src/index.ts` or `node --watch`.

**matrix-bot-sdk** — no dev CLI.

**None of the three competitors ship a first-class dev loop.** This is a genuine differentiator opportunity.

### Table stakes (what a good dev CLI must do)

| Capability | Notes |
|---|---|
| File watcher with debounced restart | `chokidar` is the standard choice |
| Child-process isolation | So a crash in the bot doesn't take down the CLI |
| Graceful restart (SIGTERM → wait → SIGKILL) | Avoids stale WS connections |
| Pretty-print incoming events | Color-coded by type, truncate long payloads, show handler matches |
| Env file loading | `.env` / `.env.local` layered |
| TypeScript execution without a build step | `tsx` or `esbuild-register` |
| Clear output during restart | "Restarting... Connected. Listening for events." |

### Differentiators (unique to Klank — none of the competitors do these)

- **Public tunnel integration for HTTP receivers.** `klank-bot dev --tunnel` spawns `cloudflared tunnel --url http://localhost:3000`, prints the public URL, and optionally auto-registers it with a local Klank dev server's slash command config. **Nobody else does this** — it would be the single most-cited reason to use the CLI.
- **Event replay from a recorded session.** `klank-bot dev --replay ./session.jsonl` — load events captured from an earlier run and pipe them into the bot. Makes reproducing "the bot crashed on this weird message" trivial.
- **Live mock mode.** `klank-bot dev --mock` starts the bot against `MockKlank` (Phase E) instead of a real server — build bots with zero server setup.
- **Inline docs lookup.** Type `?event message.new` into the CLI and it prints the event schema.

### Anti-features

| Anti-feature | Why avoid |
|---|---|
| Bundled hosting / deploy-to-cloud features | Scope creep; Slack tried this with `slack-cli` and the result is confusing. |
| Auto-tunnel without a flag | Surprise public URLs are a security footgun. Must be explicit. |
| Reimplementing `nodemon` from scratch | Use `chokidar` + `child_process`, don't build yet-another-file-watcher. |
| Deep editor integration (VS Code extension, debugger protocol) | Out of scope; a good stdout experience is enough. |
| Rewriting user code (e.g. auto-inserting `console.log`) | Never touch user source. |

### Competitor references
- [nodemon + tsx patterns](https://dev.to/0xkoji/hot-reload-for-nodejs-with-typescript-cel)
- [Sapphire CLI scope](https://www.sapphirejs.dev/)

---

## 6. MCP Server Wrapping a Chat SDK (Phase I)

### What the competition does

**Official Slack MCP server** (`docs.slack.dev/ai/slack-mcp-server`) — first-party, exposes tools for: search channels, get channel history, post message, reply in thread, add reaction, get user info, list channels, manage canvases. Authenticates via Slack app tokens. Runs as stdio or HTTP.

**Community Slack MCP servers** (tuannvm, korotovsky, piekstra, dennisonbertram) — wrap `@slack/web-api` (or direct REST), each with a slightly different tool surface. Korotovsky's is notable for "no permission requirements" (uses user tokens). Piekstra's adds Block Kit builder tools.

**Discord MCP servers** — `@barryyip/discord-mcp-server`, `v-3/discordmcp`, etc. Tools: send message, read channel, add reaction, list channels, CRUD forums. No official Discord MCP.

**No Matrix MCP server exists in modelcontextprotocol/servers** as of early 2026.

### Table stakes (what every chat-MCP ships)

| Tool | Bolt MCP | Discord MCPs | Klank Phase I |
|---|---|---|---|
| `send_message(channel, text)` | yes | yes | **required** |
| `list_channels(workspace?)` | yes | yes | **required** |
| `get_channel_history(channel, limit)` | yes | yes | **required** |
| `reply_in_thread(channel, thread_id, text)` | yes | n/a (threads differ) | **required** |
| `add_reaction(message_id, emoji)` | yes | yes | **required** |
| `search_messages(query)` | yes | no | **differentiator if server supports** |
| `get_user(user_id)` | yes | yes | **required** |
| `upload_file(channel, file)` | yes | yes | **required (depends on Phase A `ctx.upload`)** |

### Differentiators

- **First-class E2EE awareness in tool descriptions.** Each tool's description should say "will fail for E2EE channels until bot has MLS keys" so the model agent learns to check channel type first. No competitor has this concern.
- **Tool-level scoping** — expose `klank.workspace.X` vs `klank.channel.X` vs `klank.admin.X` so MCP clients can grant narrow permissions. Slack MCP has granularity; discord ones generally don't.
- **Streaming responses** — MCP supports streaming; if Klank ever adds long-poll search, expose it as a streaming tool.
- **Built on `@klank/sdk` directly** (not re-implemented against REST) — ensures the MCP server inherits every typed error, rate-limit handling, and future feature for free. This is the roadmap's stated approach and it's the right call.

### Anti-features

| Anti-feature | Why avoid |
|---|---|
| Exposing bot tokens via tool inputs | Agents will leak them. Config via env var only. |
| Write tools without explicit opt-in | Destructive tools (delete message, kick member) should require a `--allow-write` flag on server start. |
| Re-implementing REST calls instead of using `@klank/sdk` | Drift + duplicated bug fixes. |
| `execute_arbitrary_api_call` escape hatch | Kills the point of MCP's structured tools. |
| Admin tools (create channel, invite user) in the default tool set | Put them behind a separate `mcp-klank-admin` package. |
| Returning raw server errors to the model | Translate into actionable messages ("channel is E2EE; this bot cannot post there"). |

### Competitor references
- [Slack MCP overview](https://docs.slack.dev/ai/slack-mcp-server/)
- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)
- [Discord MCP tutorial](https://www.speakeasy.com/blog/build-a-mcp-server-tutorial)

---

## 7. E2EE Bots (Phase F-E2EE) — the hardest phase

**matrix-bot-sdk is the ONLY relevant reference.** Slack has no E2EE. Discord has no E2EE. Every other "secure chat" SDK (Signal, WhatsApp Business) is closed-source or not bot-focused. This phase has effectively one benchmark.

### How matrix-bot-sdk handles E2EE bots

**Architecture (from `turt2live/matrix-bot-sdk` + `matrix-org/matrix-rust-sdk-crypto-nodejs`):**

1. **Crypto is opt-in, not default.** You enable it by passing an `ICryptoStorageProvider` when constructing `MatrixClient`. If you don't, encrypted rooms arrive as `m.room.encrypted` events with no decrypted payload and the bot silently ignores them — exactly the Klank `plaintext: null` situation today.

2. **The crypto engine is not written in TypeScript.** It's `matrix-sdk-crypto` (Rust), compiled to a native Node addon via napi-rs, distributed as `@matrix-org/matrix-sdk-crypto-nodejs`. All Olm/Megolm/MLS-equivalent state machine logic lives in Rust. The TS SDK is a thin driver.

3. **Storage is the hardest part.** Crypto state (device keys, one-time keys, session keys, outbound Megolm sessions, verification state) is stored in a sled-backed directory via `RustSdkCryptoStorageProvider('./path/to/directory')`. **Critical constraint: the access token MUST remain stable across restarts.** If the token changes, the device ID changes, and all existing Megolm sessions become unreadable — the bot can't decrypt its own history.

4. **Setup pattern:**
   ```ts
   const storage = new SimpleFsStorageProvider('./bot.json');
   const crypto  = new RustSdkCryptoStorageProvider('./crypto');
   const client  = new MatrixClient(homeserver, token, storage, crypto);
   await client.crypto.prepare();  // uploads device keys, claims one-time keys
   client.start();
   ```

5. **Sending to an encrypted room** is automatic — `client.sendText(roomId, text)` detects the room is encrypted and routes through the Megolm outbound session. Same API call, transparent encryption.

6. **Receiving** is also automatic — the driver decrypts `m.room.encrypted` events inline and emits `room.message` with the decrypted content. Failed decryption emits `room.failed_decryption`.

7. **Device verification** — matrix-bot-sdk supports emoji/SAS verification but most bots don't bother (they auto-accept room keys from any device in the room). Klank's MLS model may not have this concept.

8. **Cross-signing / backup** — matrix-bot-sdk supports key backup via `client.crypto.exportRoomKeys()` / `importRoomKeys()`. Critical for "my bot's disk died, here's a backup" recovery.

### Table stakes for any E2EE bot SDK

| Capability | matrix-bot-sdk | Klank Phase F-E2EE (what we need) |
|---|---|---|
| Cryptographic state machine as a separate, audited component | Rust `matrix-sdk-crypto` | **required** — do NOT implement MLS in TypeScript. Use `@openmls/mls-rs` bindings or equivalent native addon. |
| Persistent crypto storage directory | `RustSdkCryptoStorageProvider` | **required** — filesystem default, pluggable for Redis/custom |
| Stable device identity tied to bot token | enforced by doc | **required** — bot token rotation (roadmap open decision #5) must preserve device ID, or have a clear "rotate means re-join all channels" story |
| Transparent encrypt-on-send | yes | **required** — `client.sendMessage` must detect E2EE channels and route through MLS |
| Transparent decrypt-on-receive | yes | **required** — `ServerEvent` with decrypted plaintext OR typed `DecryptionFailedEvent` |
| Upload device keys on startup | `crypto.prepare()` | **required** — analogous MLS KeyPackage publish |
| Handle new members → re-key outbound session | yes (automatic Megolm rotation) | **required** — MLS commit on member add |
| Failed-decryption handling (don't silently drop) | `room.failed_decryption` event | **required** — emit a typed event, not silent null |
| Backup / export crypto state | `exportRoomKeys` | **differentiator** — not day-1, but required before GA |

### Differentiators

- **First-class `ctx.isEncrypted` flag** on every event so bots can branch easily.
- **"Dry run" encryption mode** in the test kit — `MockKlank.encryptWith(publicKey)` lets you test encrypted-message flows without spinning up a real MLS group.
- **Typed `KeyPackageExpiredError`** with a recovery hint: "call `await bot.crypto.refreshKeyPackages()`".
- **Admin command: `klank-bot crypto status`** prints current device ID, key package count, outbound group epochs, decryption failure rate. matrix-bot-sdk doesn't have this and debugging crypto issues there is notoriously awful.

### Anti-features (critically important in E2EE)

| Anti-feature | Why avoid |
|---|---|
| **Implementing MLS from scratch in TypeScript** | Cryptographic code must be audited. Period. Use a wrapped Rust/C implementation (OpenMLS is the obvious candidate — `openmls` Rust crate compiled via napi-rs, mirroring matrix's approach). |
| **Letting the bot token rotate silently** | Breaks device identity, makes history undecryptable. Token rotation (open decision #5) must explicitly handle the crypto migration or refuse to rotate. |
| **Storing crypto state in memory by default** | Restart = lose all sessions = re-keying storm. File-backed must be the only supported default. |
| **Logging decrypted content** | Obvious but worth saying. The dev CLI pretty-printer (Phase D) must redact content from E2EE channels unless explicitly opted in via `--show-e2ee`. |
| **Auto-accepting unknown devices without a policy** | Matrix does this for bots and it's a known security smell. Klank should require the bot owner to set a policy: `trustOnFirstUse`, `verifiedOnly`, or `blocklist`. |
| **Exposing raw crypto primitives in the public API** | `bot.crypto.encrypt(plaintext)` is a trap. Keep the crypto engine behind `sendMessage` / `receive` and never let users call it directly. |
| **Supporting E2EE "partially"** — some operations encrypted, others not | matrix-bot-sdk has had bugs where reactions weren't encrypted in encrypted rooms. Either all operations in an E2EE channel are encrypted or none are. |
| **Browser target** | MLS + persistent crypto storage + stable device ID + audited Rust bindings don't map cleanly to the browser. Node-only is the right call. |
| **Building our own key server / directory** | Klank server already has identity; the SDK consumes it, doesn't reinvent it. |

### Key design questions this phase must answer BEFORE writing code

1. **Which MLS implementation?** `openmls` (Rust, RustCrypto maintained) is the leading candidate. Alternatives: `mls-rs` (AWS, Rust), `OpenMLS-JS` (TS port — would violate the "audited" rule). Strong recommendation: `openmls` via napi-rs, mirror the matrix-bot-sdk approach exactly.
2. **Who provisions the bot's KeyPackages to the Klank server?** Is it push (bot → server via REST) or pull (server fetches from bot)? Matrix is push (`/keys/upload`). Klank server work required.
3. **What happens when a bot is added to an existing E2EE channel?** MLS commit must happen server-side; the bot receives a Welcome message. Server endpoint needed: `POST /channels/:id/bots/:bot_id/welcome`.
4. **Token rotation + device identity.** Open decision #5 collides with this phase. Must be resolved together.
5. **Do we support multiple bot instances of the same bot** (horizontal scale)? MLS device identity is per-instance — two instances either share crypto state (hard, race conditions) or are two different MLS members. Recommend the latter and document it.
6. **Storage backend for crypto state.** Filesystem (simplest, matches matrix) vs Redis (horizontal scale) vs pluggable. Recommend filesystem-default + pluggable interface.

### Competitor references
- [matrix-bot-sdk encryption for bots tutorial](https://turt2live.github.io/matrix-bot-sdk/tutorial-encryption-bots.html)
- [matrix-rust-sdk-crypto-nodejs](https://github.com/matrix-org/matrix-rust-sdk-crypto-nodejs)
- [matrix-sdk-crypto (Rust crate)](https://docs.rs/matrix-sdk-crypto/)
- [OpenMLS Rust implementation](https://github.com/openmls/openmls)

---

## 8. Multi-Language SDKs (TS + Rust Parity) (Phase F-build)

### What the competition does

**@slack/bolt** — ships in JS/TS, Python, Java. **Parity is not enforced** — each SDK has its own maintainer, its own release cadence, and features land in bolt-js first. Python is ~6 months behind; Java is >1 year behind on new features. No shared schema; types are hand-written per language.

**discord.js / discordrs / serenity (Rust) / discord-py** — entirely separate projects with no shared codebase. discord.js is first-party; the others are community. Parity is non-existent — serenity/discord-py have different API shapes on purpose (idiomatic to their language).

**matrix-bot-sdk** — TypeScript only. There's a separate `matrix-rust-sdk` (matrix-org official) but it's a client SDK, not a bot SDK, with a different API shape. The crypto code is shared (matrix-bot-sdk wraps matrix-rust-sdk-crypto-nodejs), but nothing else.

**Observation: no major chat SDK maintains strict TS↔Rust API parity.** Everyone who tried (OpenAPI-generated multi-language clients) found it produced non-idiomatic code in at least one language.

### Table stakes for a "honest" Rust crate

| Capability | Phase F-build approach |
|---|---|
| Consume the same OpenAPI schema as TS (utoipa-generated, roadmap decision #3) | **required** |
| Idiomatic Rust types (not transliterated from TS) | **required** |
| Async via tokio (the de facto standard) | **required** |
| Cargo workspace alongside `packages/sdk-rust/` | **required** |
| Feature parity for REST client methods | **required for 0.4.0** |
| Feature parity for WS bot framework | **required for 0.4.0** |
| Shared HMAC/signing test vectors between TS and Rust crates | **differentiator** — catches drift instantly |

### Differentiators

- **Shared test vectors as a separate package**: `packages/test-vectors/` with JSON files of known-good HMAC signatures, encrypted message payloads, etc. Both TS and Rust test suites consume them. If the TS HMAC test passes but the Rust one fails, the test vectors are the ground truth. matrix-rust-sdk does this for crypto.
- **Rust-first crypto**: once Phase F-E2EE lands, the crypto engine is already Rust (`openmls` via napi-rs in TS). In Rust, you use it directly — Rust crate actually has LESS code than TS for the encrypted path.
- **Cross-language CI** — single GitHub Actions matrix runs TS tests, Rust tests, and a cross-language integration test (TS bot sends → Rust bot receives and decrypts).

### Anti-features

| Anti-feature | Why avoid |
|---|---|
| **Building Rust in parallel with TS on every feature** | Already rejected. Roadmap explicitly sequences Rust as a dedicated later phase. |
| **Transliterating TS API into Rust** (camelCase methods, `Promise`→`Future`) | Non-idiomatic. Rust users will hate it. Let each language be itself; only the wire format and test vectors are shared. |
| **OpenAPI-generated Rust client as the public API** | Generated Rust is notoriously ugly (`OpenAPITools/openapi-generator` output requires heavy post-processing). Use it for types only, hand-write the method surface. |
| **Claiming "parity" when there's drift** | The original sin that motivated this whole refresh. Version the Rust crate independently and document exactly which TS release it tracks. |
| **Rust crate before there's a Rust user asking for it** | Roadmap recommends Phase F-build only on demand. Don't build speculatively. |
| **Supporting Rust WASM target in the first release** | Scope explosion. Native Rust only; WASM later if asked. |
| **Polyglot monorepo tools (Bazel, Nx with Rust plugins)** | Overkill. Cargo workspace + pnpm workspace side-by-side is fine. |

### Competitor references
- [OpenAPI Generator Rust](https://openapi-generator.tech/docs/generators/rust/)
- [utoipa (Rust OpenAPI generation)](https://github.com/juhaku/utoipa)
- [matrix-rust-sdk](https://github.com/matrix-org/matrix-rust-sdk)
- [Fern multi-language SDK generation](https://buildwithfern.com/)

---

## Cross-cutting observations

1. **None of the three reference SDKs ship a first-class dev CLI with tunnel integration.** Phase D is a genuine differentiator, not a parity play.
2. **Only matrix-bot-sdk has any E2EE story, and it punts all crypto to a Rust engine.** Phase F-E2EE should copy this architecture exactly — don't reinvent MLS in TypeScript.
3. **Testing is a universal weak spot across chat SDKs.** Phase E shipping a real test kit (not a useless-mock wrapper) is worth marketing.
4. **`@slack/bolt` is the best overall reference for Phases A, B, and C.** Its listener-arg-object pattern, receiver abstraction, and conversation store are all well-designed. Copy the ideas, not the details.
5. **`discord.js` is the best reference for typed events (Phase A)** via its `ClientEvents` interface. Skip the entity-method style.
6. **`matrix-bot-sdk` is the best reference for E2EE (Phase F-E2EE) and state providers (Phase C).** Its crypto architecture is the only proven pattern.
7. **Nobody has TS↔Rust parity.** Phase F-build should aim for "honest Rust crate" not "mirror TS API verbatim".

## Sources

- [@slack/bolt listener args and context](https://docs.slack.dev/tools/bolt-js/concepts/actions/)
- [@slack/bolt receivers (customizing)](https://docs.slack.dev/tools/bolt-js/concepts/receiver/)
- [bolt-js AwsLambdaReceiver source](https://github.com/slackapi/bolt-js/blob/main/src/receivers/AwsLambdaReceiver.ts)
- [bolt-js conversation-store.ts](https://github.com/slackapi/bolt-js/blob/main/src/conversation-store.ts)
- [discord.js v14 ClientEvents](https://discord.js.org/docs/packages/discord.js/14.26.2)
- [discord.js event handling guide](https://discordjs.guide/creating-your-bot/event-handling.html)
- [matrix-bot-sdk encryption for bots](https://turt2live.github.io/matrix-bot-sdk/tutorial-encryption-bots.html)
- [matrix-bot-sdk RustSdkCryptoStorageProvider](https://turt2live.github.io/matrix-bot-sdk/RustSdkCryptoStorageProvider.html)
- [matrix-rust-sdk-crypto-nodejs](https://github.com/matrix-org/matrix-rust-sdk-crypto-nodejs)
- [@slack-wrench/jest-bolt-receiver](https://www.npmjs.com/package/@slack-wrench/jest-bolt-receiver)
- [Slack MCP overview](https://docs.slack.dev/ai/slack-mcp-server/)
- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)
- [Discord MCP tutorial (Speakeasy)](https://www.speakeasy.com/blog/build-a-mcp-server-tutorial)
- [OpenMLS (Rust)](https://github.com/openmls/openmls)
- [OpenAPI Generator Rust](https://openapi-generator.tech/docs/generators/rust/)
- [utoipa](https://github.com/juhaku/utoipa)

**Confidence:** MEDIUM–HIGH across all categories. Matrix E2EE architecture verified against turt2live docs and matrix-org repos. Bolt/discord.js patterns verified against official docs. MLS-specific Klank design questions (§7 "key design questions") are flagged as unresolved — the Phase F-E2EE planner must resolve them before coding begins.
