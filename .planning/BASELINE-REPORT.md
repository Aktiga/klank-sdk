# Klank Bot SDK — Baseline Report

Date: 2026-04-07
Scope: ground-truth scan of `/Users/stevemeisner/Sites/rust-slack-sdk` (2 commits, last touched 2026-03-18). No code modified.

This document is the evidence backing `SDK-REFRESH-ROADMAP.md`. Every claim cites a file path or a server commit.

---

## 1. Repository inventory

Top-level (`ls -la`):

```
README.md                 7,339 bytes
docs/                     getting-started.md, deploying-bots.md
examples/                 ci-bot-ts/, echo-bot-ts/, webhook-bot/, echo-bot-rust/
packages/sdk-typescript/  src/{bot,client,index,types,webhook,ws}.ts, package.json, tsconfig.json
templates/typescript/src/ EMPTY directory (no files)
```

Source files (full set):

- `packages/sdk-typescript/src/bot.ts` (207 lines)
- `packages/sdk-typescript/src/client.ts` (~100 lines)
- `packages/sdk-typescript/src/index.ts` (4 export lines)
- `packages/sdk-typescript/src/types.ts` (~155 lines)
- `packages/sdk-typescript/src/webhook.ts` (~30 lines)
- `packages/sdk-typescript/src/ws.ts` (~70 lines)
- `examples/echo-bot-ts/index.ts`
- `examples/ci-bot-ts/index.ts`
- `examples/webhook-bot/index.ts`
- `examples/echo-bot-rust/{Cargo.toml, src/main.rs}` — single hand-rolled file, NOT a crate the SDK ships
- `docs/getting-started.md`, `docs/deploying-bots.md`

There is **no test file anywhere**. `package.json` declares `"test": "vitest"` but no `*.test.ts` exist.

There is **no Rust crate**. The README markets "TypeScript or Rust" and `packages/` is plural, but only `packages/sdk-typescript/` exists. The "Rust" story is one example file (`examples/echo-bot-rust/src/main.rs`) that hand-codes reqwest + tokio-tungstenite — nothing reusable to import.

`templates/typescript/src/` exists but is **empty**, so any "create-klank-bot" scaffold story is vapor.

No `.github/` (no CI), no `CHANGELOG.md`, no `LICENSE` file (README claims MIT), no `tsup.config.ts`, no lockfile.

`package.json`: `name: "@klank/sdk"`, `version: 0.1.0`, dep `ws ^8.0.0`, devDeps `tsup`, `typescript`, `@types/ws`, `vitest`. `repository.url` → `https://github.com/Aktiga/klank-sdk` (not yet published per the 2-commit history).

---

## 2. Public API surface (what `import { ... } from '@klank/sdk'` actually gives)

From `src/index.ts`:

```ts
export { KlankBot } from './bot'
export { WebhookBot } from './webhook'
export { KlankClient } from './client'
export type * from './types'
```

### KlankBot (`src/bot.ts`)

Constructor: `new KlankBot({ token, serverUrl, reconnect? })`.

Methods:

- `on(eventType: string, handler)` — string-keyed, **not type-narrowed**. Handler is `EventHandler<E = ServerEvent>`, so `event.plaintext` requires manual narrowing.
- `command(name, handler)` — slash command router keyed by string name.
- `message(pattern: RegExp | string, handler)` — regex match over `event.plaintext`.
- `use(middleware)` — push-style middleware with `next()`.
- `onError(handler)` — single global error handler (replaceable, not additive).
- `start()` — `client.getBotInfo()` then `ws.connect()`. Registers process-level SIGINT/SIGTERM handlers (will misbehave if multiple bots run in one process).
- `stop()` — closes WS.
- `getClient()` / `getBotInfo()`.

`ctx` (`BotContext`): `say`, `reply`, `react`, `sendMessage`. **No** `update`, `delete`, `upload`, `thread`, `ephemeral`, `dm`, `openModal`, etc.

`buildCommandContext` (`bot.ts:195`) explicitly drops ephemeral responses with the comment `// Ephemeral responses are more complex — would need server support`. So `ctx.respond({ responseType: 'ephemeral' })` documented in README is a **silent no-op**.

Self-message filter only fires for `message.new` against `botInfo?.bot_id`, but `client.sendMessage` writes `sender_id: webhook_id` for webhook posts (server `bots.rs:152`), so a bot that both listens and writes via its own webhook will not loop-suppress.

Event routing has both a generic mapper (`message.new` → `message_new`) and a hardcoded shorthand table. The hardcoded list does **not** cover `message.updated`, `message.deleted`, or `typing.stop` — these only work via the generic dotted-to-underscore path.

### KlankClient (`src/client.ts`)

REST surface, hardcoded to `${serverUrl}/api/v1`:

- `getBotInfo()` → `GET /auth/bot-info`
- `getWsTicket()` → `POST /auth/bot-ws-ticket` returns `{ ticket }`
- `sendMessage(channelId, text, { threadId })` → `POST /channels/:id/messages` body `{plaintext, content_type:'plaintext', sender_type:'bot', thread_id}`
- `getMessages(channelId, limit)` → `GET /channels/:id/messages?limit=`
- `addReaction` / `removeReaction`
- `listChannels(workspaceId)`, `getChannel(channelId)`

There is **no**: file upload, message edit/delete, channel join/leave, member listing, user lookup, presence, search, DM open, thread fetch, pinned messages, ephemeral message, workspace listing.

Auth: bearer token only. **No refresh handling.** No re-auth on 401. The bot silently dies if its token is revoked.

Rate-limit handling: `client.ts:233` reads `Retry-After`, sleeps, recurses. **No max retry count** → infinite loop possible.

### WebhookBot (`src/webhook.ts`)

Single method: `send(text, { username? })`. Body sent:

```json
{ "text": "...", "username": "...", "secret": "<RAW SECRET IN BODY>" }
```

**Broken against current server.** Server `crates/rs-bots/src/webhooks.rs` (Phase 11 C-2, commit 3032236) removed the `secret` field from `IncomingWebhookPayload` and now requires:

```
X-Klank-Webhook-Key: <raw-secret>
X-Klank-Signature: sha256=<hex(hmac_sha256(raw_secret, body))>
```

(see `crates/rs-api/src/handlers/bots.rs:99-141` and `crates/rs-bots/src/webhooks.rs:75-130`).

Current `WebhookBot.send` will get a 401 — there is no signature header at all. **Every webhook bot breaks the moment Phase 11 deploys.**

### WsManager (`src/ws.ts`)

Pulls a ticket via `ticketFn`, opens `wss://.../api/v1/ws?ticket=`. Reconnect with exponential backoff capped at 30s. **No jitter, no heartbeat/ping handling, no give-up.** Parse errors silently swallowed. Listeners cannot be removed.

### Types (`src/types.ts`)

Hand-written `Message`, `Channel`, `User`, `BotInfo`, plus a discriminated `ServerEvent` union (Message/Reaction/Typing/Channel/Member/Presence/Command). Not generated from server schemas — drift risk is high.

`Message.content_type: 'encrypted' | 'plaintext'` is correct but the SDK has **no path that handles `encrypted`**. No decrypt step, no key state. If a bot is added to an E2EE channel, it receives events whose `plaintext` is `null` and silently does nothing.

---

## 3. Documentation review

`README.md` (235 lines) over-promises:

- "TypeScript or Rust" headline. There is no Rust crate.
- Slash command example shows `responseType: 'ephemeral'` which the SDK silently ignores.
- "Bot Messages & E2EE" says bot messages are plaintext. As of Phase 9 H-1 (commit b9cb1da) the server **rejects plaintext sends to E2EE channels**, so this section needs an explicit "bots cannot post to E2EE channels" warning.
- "Server Compatibility" pins to commit `d7c956c`, which predates phases 6–11.

`docs/getting-started.md` and `docs/deploying-bots.md` — adequate, but mention Rust as a peer to TS, setting a false expectation.

No docs for: webhook signing, slash command receivers, channel membership, rate limits, error taxonomy, WS protocol envelope, reconnect semantics, token rotation. No typedoc.

---

## 4. Test coverage and dev tooling

- Tests: zero. `vitest` in devDeps, no `*.test.ts`.
- Lint/format: none configured.
- CI: no `.github/`.
- Build: `tsup src/index.ts --format cjs,esm --dts` from `package.json`. No `prepublishOnly`, no version-bump tooling.
- No `examples/*/package.json` — examples cannot be installed/run as standalone projects.

---

## 5. Server changes (phases 6–11) cross-reference

Per `/Users/stevemeisner/Sites/rust-slack/.planning/reviews/AUTONOMOUS-RUN-REPORT.md`.

| # | Server change | Commit | SDK status | Breaking? |
|---|---|---|---|---|
| 1 | Bot tokens hashed at rest, shown once | 36ca613 (Phase 6 H-3) | Aligned — token is bearer, SDK never tries to recover. **Docs need note**: registration is one-shot. | No |
| 2 | Webhook secrets hashed; require `X-Klank-Webhook-Key` + `X-Klank-Signature` headers | 3032236 (Phase 11 C-2) | **Broken**. `WebhookBot.send` puts secret in body, no signature. | **Yes — every webhook bot dies** |
| 3 | Slash command outbound dispatch HMAC-signed (`X-Klank-Signature`) | a603a09 (Phase 11 H-5) | SDK does not run an HTTP receiver for slash commands at all — `bot.command()` only handles `command.invoked` over WS. Receivers (Lambda etc.) need verification helper. | Yes for HTTP-receiver users; no for WS-only |
| 4 | E2EE enforced server-side on send | b9cb1da (Phase 9 H-1) | `client.sendMessage` always sends `content_type: 'plaintext'`. Sends to E2EE channels will 4xx. SDK has no MLS/x25519 path. | **Yes — bots cannot post to E2EE channels** |
| 5 | Channel membership required for many endpoints | multiple | SDK has no `joinChannel`/`addBotToChannel` helper. Failures surface as opaque 403s. | Behavior change; user-facing |
| 6 | CORS tightened to enumerated origins | 221d0dd (Phase 6 H-4) | SDK is server-side Node — CORS does not apply. Doc note only. | No (Node) |
| 7 | Rate-limit on `/refresh` | 16f022c (Phase 6 H-2) | SDK has no refresh flow. Generic 429 handler in `client.ts:233` recurses without max retries — should add jitter and a cap. | No (but worth fixing) |
| 8 | OIDC nonce verify, exchange-code SSO | Phase 6 C-1/C-3 | Bot SDK does not touch OIDC. | No |

### Detail: webhook wire format the SDK must speak

From `crates/rs-bots/src/webhooks.rs` and `crates/rs-api/src/handlers/bots.rs:99-141`:

Endpoint: `POST /api/v1/webhooks/:id/incoming`

Required headers:
- `Content-Type: application/json`
- `X-Klank-Webhook-Key: <raw-secret>` — secret returned exactly once at creation
- `X-Klank-Signature: sha256=<hex>` — `hex(HMAC_SHA256(raw_secret, raw_body_bytes))`

Body (after C-2):
```json
{ "text": "string", "username": "optional string" }
```

Server verifies: `sha256(provided_raw_secret) == secret_hash`, AND `HMAC-SHA256(raw_secret, body) == header signature`. Both constant-time (`subtle::ConstantTimeEq` / `mac.verify_slice`).

### Detail: slash command dispatch (server → bot HTTP receiver)

From `crates/rs-bots/src/slash_commands.rs:32-65`:

Server POSTs to bot's `webhook_url` with:
- `Content-Type: application/json`
- `X-Klank-Signature: sha256=<hex>` keyed by per-command `signing_secret` (NOT the bot token)
- Body: `{ command, text, user_id, channel_id, workspace_id }` (UUIDs as strings)
- 5-second timeout

Expected response: `{ response_type: "ephemeral" | "in_channel", text: "markdown" }`.

The SDK has no helper for this verification path.

### Detail: bot creation response

From `crates/rs-bots/src/bots.rs:30-72`:

`POST /api/v1/workspaces/:id/bots` returns `BotResponse { id, name, avatar_url, api_token: Some("bot_..."), scopes }`. After creation, `api_token` is `None`. Token stored only as `sha256(token)` in `bots.api_token_hash`. The `bot_` prefix is enforced both at generation and at authentication.

---

## 6. Gaps summary

Functional:
1. Post to E2EE channels (no MLS path).
2. Sign incoming webhook requests (broken against current server).
3. Verify outbound slash command HMACs (no helper, no HTTP receiver).
4. Edit/delete messages.
5. Upload/download files.
6. Open/list DMs.
7. Add bot to channel (membership self-service).
8. Refresh/rotate bot token.
9. Per-conversation state.
10. Ephemeral slash command responses (claimed, dropped).
11. Typed event handlers.
12. Test kit / mock server.
13. Local dev loop (watch + tunnel).
14. Decent error taxonomy (everything throws raw `Error`).

Documentation:
1. README oversells "Rust" and "ephemeral".
2. No migration guide for phases 6–11.
3. No webhook signing recipe.
4. No slash command receiver recipe.
5. No "bot must be a channel member" warning.
6. No API reference (typedoc).
7. `Server Compatibility` pin is stale.

Tooling: no tests, no CI, no lint, no installable examples, no scaffolder, no changelog.

---

## 7. Top surprises

1. **`templates/typescript/src/` is an empty directory.** Repo is shaped for `npx create-klank-bot` but ships zero scaffold files.
2. **`WebhookBot` is already broken against `main`** because it puts the secret in the JSON body and sends no signature header — Phase 11 C-2 deletes that field server-side. Anyone running the SDK against current Klank gets a 401.
3. **`ctx.respond({ responseType: 'ephemeral' })` is silently a no-op.** README documents it; `bot.ts:202` admits it doesn't work and falls through. Ephemeral responses simply never happen.

Additional notes:
- `examples/echo-bot-rust` is the entire "Rust support" story.
- `client.sendMessage` writes `sender_type: 'bot'` from the SDK side, but the server determines `sender_type` from auth context — the field is ignored/redundant.
- 429 retry loop has no max.
- `start()` registers process-level SIGINT/SIGTERM handlers — multi-bot processes break.
- Self-message suppression compares to `bot_id`, not `webhook_id`, so a bot listening on a channel it also webhook-posts to will echo itself.
