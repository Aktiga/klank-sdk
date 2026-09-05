# Klank Bot SDK — Refresh Roadmap

Date: 2026-04-07
Owner: Steve
Status: proposal — needs the open-decisions section resolved before execution

This roadmap is the action plan that follows from `BASELINE-REPORT.md`. Read that first if you want the evidence.

---

## 1. Baseline (the SDK as it exists today)

`/Users/stevemeisner/Sites/rust-slack-sdk` is a 2-commit TypeScript repo published locally as `@klank/sdk@0.1.0`. There is **no** Rust crate despite the README's "TypeScript or Rust" headline; the only Rust artifact is `examples/echo-bot-rust/src/main.rs`, a hand-rolled tokio-tungstenite example.

What the SDK actually exports (from `packages/sdk-typescript/src/index.ts`):

- `KlankBot` — WS-driven bot framework with `on()`, `command()`, `message()`, `use()`, `start()`. Context object exposes `say`, `reply`, `react`, `sendMessage`. Nothing else.
- `WebhookBot` — one method, `send(text, { username? })`. Currently posts the webhook secret in the JSON body.
- `KlankClient` — bearer-token REST client. Endpoints: bot-info, ws-ticket, send/get message, add/remove reaction, list/get channel. No file upload, edit, delete, member, DM, search.
- Hand-written types for `Message`, `Channel`, `User`, `BotInfo`, `ServerEvent` union.

Behavioural truth:

- Auth is pure bearer; no refresh handling, no re-auth on 401.
- 429 handling recurses forever with no cap.
- WS reconnect: exponential backoff to 30s, no jitter, no heartbeat, swallows parse errors, listeners cannot be removed.
- `start()` installs process-level SIGINT/SIGTERM (multi-bot processes break).
- E2EE: zero. Bot in an E2EE channel receives `plaintext: null` events and silently does nothing; sends will be rejected.
- Tests: zero. Lint: none. CI: none. `templates/typescript/src/` is an empty directory.
- `ctx.respond({ responseType: 'ephemeral' })` is documented in README but is a silent no-op (`bot.ts:202`).

Server compatibility today: README pins commit `d7c956c`, which predates phases 6–11. After those phases land, `WebhookBot` is **broken** (Phase 11 C-2), bots cannot post to E2EE channels at all (Phase 9 H-1), and HTTP slash command receivers must verify HMACs (Phase 11 H-5) with no SDK helper.

---

## 2. Migration phase (must-do before next deploy)

This phase exists to keep current SDK users alive after phases 6–11 reach the droplet. Everything here is mandatory; nothing in this phase is gold-plating.

### M-1. Fix `WebhookBot` to use header-based auth + HMAC

- Files: `packages/sdk-typescript/src/webhook.ts`
- Wire format (from `crates/rs-bots/src/webhooks.rs:75-130` and `crates/rs-api/src/handlers/bots.rs:99-141`):
  - Endpoint: `POST /api/v1/webhooks/:id/incoming`
  - Headers:
    - `Content-Type: application/json`
    - `X-Klank-Webhook-Key: <raw-secret>`
    - `X-Klank-Signature: sha256=<hex(hmac_sha256(raw_secret, raw_body))>`
  - Body: `{ "text": string, "username"?: string }` — no `secret` field.
- Implementation notes:
  - Serialize body to bytes ONCE; sign those exact bytes; send those exact bytes (no re-stringify between signing and POST).
  - Use Node `crypto.createHmac('sha256', rawSecret).update(bodyBuffer).digest('hex')`.
  - On 401, throw a typed `WebhookAuthError` that explicitly says "secret rejected; this likely means you upgraded the server to phase 11 — see migration guide".
- Acceptance:
  - Unit test signs a sample body and asserts the header equals the value the server's `verify_signature` accepts (port the test in `crates/rs-bots/src/slash_commands.rs:78-101` to TS).
  - Integration test against a local Klank: create webhook, send via SDK, observe message in channel.

### M-2. Document the E2EE-channel ban + add a friendly error

- Files: `packages/sdk-typescript/src/client.ts`, `README.md`, new `docs/security.md`.
- Behaviour: when `client.sendMessage` returns the server's "channel is E2EE" error (Phase 9 H-1, `b9cb1da`), wrap it in a typed `E2EEChannelError` with a message that says "this bot has no E2EE keys; either move it to a non-E2EE channel or wait for SDK Phase F".
- README: replace the current "Bot Messages & E2EE" section (which says "bots are plaintext, they appear next to encrypted messages") with "bots cannot currently post to E2EE channels at all". Link to Open Decision #1.

### M-3. Add slash command HMAC verification helper (export only — no transport)

- Files: new `packages/sdk-typescript/src/slash-command-verify.ts`, re-export from `index.ts`.
- API:
  ```ts
  export function verifySlashCommandSignature(opts: {
    rawBody: Buffer | Uint8Array
    signatureHeader: string  // "sha256=..."
    signingSecret: Buffer | string
  }): { ok: true } | { ok: false; reason: string }
  ```
- Wire format from `crates/rs-bots/src/slash_commands.rs:32-65`:
  - Header: `X-Klank-Signature: sha256=<hex>`
  - Key: per-command `signing_secret` (NOT the bot token)
  - Body: raw JSON bytes of `{ command, text, user_id, channel_id, workspace_id }`
- Acceptance: round-trip test using the same fixture as `slash_commands.rs:78-101`.
- Out of scope here: the actual HTTP receiver (that's Phase B).

### M-4. Bot token: clarify "shown once" in docs + remove any code path that suggests recovery

- Files: `README.md`, `docs/getting-started.md`. Server change: Phase 6 H-3 commit 36ca613.
- Code change: confirm the SDK does not call any `GET /bots/:id/token`-style endpoint (it does not — but document explicitly that the constructor token is the only token, store it in your secret manager).

### M-5. Channel-membership precondition warning

- Files: `README.md`, `docs/getting-started.md`. Add a "Before your bot can post or read, an admin must add it to the channel" callout. Server change: multiple phases enforce this; failures surface as 403.
- Optional code: in `KlankClient`, on 403 from `sendMessage`/`getMessages`, throw `ChannelMembershipError` with that exact wording.

### M-6. 429 retry hardening

- Files: `packages/sdk-typescript/src/client.ts`
- Add max retries (default 5), jitter (`Retry-After * (0.8 + random*0.4)`), and a typed `RateLimitedError` thrown after the cap.
- Acceptance: unit test with a mocked `fetch` that always returns 429 — assert the call throws after N retries instead of hanging forever.

### M-7. Migration guide

- New file: `docs/migration/0.1-to-0.2.md`. One page. Sections:
  1. Webhook bot: code-diff before/after, explain the `X-Klank-Webhook-Key` + `X-Klank-Signature` headers and where the raw secret comes from.
  2. E2EE channels: bots cannot post; how to tell which channels are E2EE.
  3. Channel membership: how an admin adds a bot to a channel.
  4. Token rotation: there is none yet — re-register if compromised.
  5. Slash command HTTP receivers: use `verifySlashCommandSignature` (M-3) — example.
- Link from README and from `docs/getting-started.md`.

### Migration phase exit criteria

- All M-items shipped, version bumped to `0.2.0`, `Server Compatibility` line in README updated to point at the phase-11 commit.
- Manual smoke test: webhook bot posts successfully against a freshly-deployed Klank; KlankBot connects, receives a `message.new`, posts a reply.

Effort: **M (1–2 days focused)**. Risk: low — wire format is documented in server source.

---

## 3. Feature phases (proposed, ordered by leverage)

Each phase is independent unless noted. Effort is S (≤ half day), M (1–2 days), L (3+ days).

### Phase A — Typed event payloads + reply helpers

Goal: make `bot.on('message', ...)` actually narrow `event` to `MessageEvent`, and grow `ctx`.

- Type-narrow `on` via overloaded signatures keyed off the event-name string-literal union.
- Extend `BotContext`:
  - `ctx.thread(text)` — post into the triggering message's thread (today `reply` already does this; rename and add `ctx.reply` as "post in same channel without thread" to match Slack semantics, or keep both — pick one in the design pass).
  - `ctx.update(messageId, text)` — needs `PATCH /messages/:id` server endpoint. Verify it exists; if not, file a server ticket.
  - `ctx.delete(messageId)` — same.
  - `ctx.upload({ filename, contentType, data })` — needs the upload endpoint from Phase 8. Verify wire format against `crates/rs-files/`.
  - `ctx.react`/`ctx.unreact` (we have `react`, add `unreact`).
  - `ctx.dm(userId, text)` — needs DM-open endpoint.
- Effort: **M** (TS only) + **S** verifying server endpoints exist. Open question: does `PATCH /messages/:id` exist post-phase-9? If not, this becomes a server-side dependency.

### Phase B — Webhook + slash command helpers (HTTP receiver)

Goal: ship a tiny HTTP-receiver that wraps the M-3 verifier.

- Export a `createSlashCommandReceiver({ signingSecret, handler })` that returns a Node `http`-compatible request handler (so it works in plain Node, Express, Fastify, Hono, Vercel, Lambda).
- Same shape for incoming webhook reception if we ever want bots to be webhook *receivers* (currently we're only senders — defer unless asked).
- Could merge with Migration M-3, but keeping it separate so M-3 stays minimal.
- Effort: **S–M**. Dependency: M-3.

### Phase C — Per-conversation state / KV store

Goal: stop forcing every bot to reinvent a `Map<channelId, State>`.

- API: `bot.state.get(scope, key)`, `bot.state.set(scope, key, value, { ttl? })` where scope is `'channel:<id>'` / `'thread:<id>'` / `'user:<id>'` / `'global'`.
- Backends: in-memory (default), Redis (optional), SQLite file (optional).
- Effort: **M**. Open question: do we ship the Redis/SQLite adapters in `@klank/sdk` core or as `@klank/sdk-redis`?

### Phase D — Local dev loop

Goal: `klank-bot dev` watches your file, restarts on change, optionally proxies a public tunnel for slash command receivers.

- Bin: `packages/klank-bot-cli/`.
- Watcher: `chokidar` + child-process restart.
- Tunnel: spawn `cloudflared tunnel` (optional, behind a flag) for slash command HTTP receivers during dev.
- Pretty-print incoming events to the terminal.
- Effort: **M**. Dependency: none, but more useful after Phase B.

### Phase E — Test kit (`MockKlank`)

Goal: tests should be real tests, per CLAUDE.md.

- `import { MockKlank } from '@klank/sdk/testing'`
- Spins up an in-process fake server that:
  - Accepts the SDK's REST calls and records them.
  - Lets the test push synthetic events into the bot's WS handler.
- Example: `await mock.deliver({ type: 'message.new', channel_id, plaintext: 'hello' }); expect(mock.sentMessages).toHaveLength(1)`.
- Effort: **M–L**. No mocking-to-uselessness — exercises real `KlankBot` routing/middleware/regex/command code.

### Phase F — Rust crate parity OR drop the marketing claim

This is an Open Decision (#2 below). Two paths:

- **F-drop**: Edit README, getting-started, deploying-bots to remove all "Rust" mentions. Move `examples/echo-bot-rust` to `examples/community/` with a "this is a hand-rolled example, not a supported SDK" header. Effort: **S**.
- **F-build**: New crate `packages/sdk-rust/` (Cargo workspace) mirroring `KlankBot`/`KlankClient`/`WebhookBot` API. Generates types from a shared schema (see Open Decision #3). Effort: **L** (multi-week). High risk because the server is the only consumer of those types today, so we'd be designing the schema-export pipeline as we go.

Recommendation: F-drop now, defer F-build until at least one user asks.

### Phase G — Templates expansion (`npx create-klank-bot`)

Goal: fill the empty `templates/typescript/src/`.

- `templates/typescript/echo/` — minimal echo bot, env file, README.
- `templates/typescript/slash-command-receiver/` — Lambda + verifier from Phase B.
- `templates/typescript/webhook-poster/` — CI notifier.
- `bin/create-klank-bot.ts` — `npm init`/`npx`-friendly scaffolder.
- Effort: **S–M**. Dependency: at least migration phase done (so the templates aren't shipping broken code).

### Phase H — Docs split + typedoc

- Split README into: Getting Started / Concepts / Recipes / API Reference / Migration / Security.
- Generate API reference with typedoc, publish to `docs/api/`.
- Replace the over-promising bits identified in baseline (Rust, ephemeral).
- Effort: **M**. Dependency: API surface stable, so do this AFTER Phase A.

### Phase I — MCP server built on the refreshed SDK

Goal: an MCP server that exposes Klank tools (`klank.send_message`, `klank.list_channels`, `klank.search_messages`, etc.) so Claude/agents can use Klank as a tool.

- Built as `packages/mcp-klank/` consuming `@klank/sdk`.
- Defines MCP tool schemas; each tool maps 1:1 to a `KlankClient` method.
- Effort: **M**. Dependency: Phase A (so the SDK actually exposes the operations the MCP tools need — upload, edit, search, DM).

---

## 4. Open decisions (resolve these before execution)

1. **E2EE bots: support, document-as-unsupported, or build a "bot identity" path?**
   - Option A (recommended): document bots as plaintext-channels-only forever; add a server-side admin UI flag "allow bots in this E2EE channel" that converts the channel to non-E2EE-for-bots-only. Cleanest, but requires a server change.
   - Option B: build full MLS for bots in the SDK. Months of work, expands attack surface significantly.
   - Option C: bot acts like a regular MLS member with its own keys. Requires the bot owner to manage key material; unclear UX.
   - **This is the single most important decision.** Phase A, the migration guide, and the README rewrite all depend on the answer.

2. **Rust SDK: drop the claim or build the crate?** See Phase F. Recommendation: drop now, revisit on user demand.

3. **Type generation: hand-written or derived from server?** Today `types.ts` is hand-written and will drift. Options:
   - Add `utoipa` to the server, generate OpenAPI, run `openapi-typescript` in SDK CI.
   - Define a shared schema in a third repo / crate.
   - Keep hand-writing and accept drift.
   - Recommendation: `utoipa` + `openapi-typescript`. Server work is small, payoff compounds.

4. **State backend in core?** Phase C — do we ship Redis/SQLite adapters in `@klank/sdk` or split them out? Recommendation: split — keep core dependency-light.

5. **Token rotation API.** Server has none today. Do we add `POST /bots/:id/rotate-token` (returns new token once) before SDK 0.3, or punt? Recommendation: add server-side soon — bot tokens leak and we have no recovery story.

6. **Bot self-message suppression.** Should the SDK track its own webhook IDs and suppress events whose `sender_id` matches them? Currently a bot that listens on a channel it also webhook-posts to will echo itself. Recommendation: yes, fix in Phase A.

---

## 5. Recommended execution order

1. **Migration phase** (M-1 through M-7) — non-negotiable, blocks the next server deploy. Effort: M (1–2 days).
2. **Open Decision #1 resolution** (E2EE bots) — gates Phase A's `ctx.upload` and the README rewrite, so resolve before starting Phase A.
3. **Phase F-drop** — 30 minutes of doc edits, removes the biggest credibility hit (README claims Rust support that doesn't exist). Do this immediately after Migration so 0.2.0 ships with honest marketing.
4. **Phase A** (typed events + ctx helpers) — biggest leverage for existing users. Effort: M.
5. **Phase B** (slash command receiver) — small, unblocks anyone running bots on Lambda/Vercel. Effort: S–M.
6. **Phase E** (test kit) — needed before we keep adding features without tests. Effort: M–L.
7. **Phase G** (templates) + **Phase H** (docs split + typedoc) — interleaved; both depend on a stable API surface from Phase A. Effort: M each.
8. **Phase D** (dev loop) — quality-of-life, do once we have at least one external user to feel the pain. Effort: M.
9. **Phase C** (state store) — defer until a user asks; the in-memory `Map` workaround is fine for now. Effort: M.
10. **Phase I** (MCP server) — last; it's a downstream consumer and benefits from everything above being stable. Effort: M.
11. **Phase F-build** — only if a real Rust user shows up. Otherwise skip indefinitely.

Total effort estimate to reach a "honest, complete-feeling" 0.3.0 (Migration + F-drop + A + B + E + G + H): roughly **2–3 weeks of focused work**, plus whatever the open decisions cost.

---

## 6. Notes & references

- Server changes summary: `/Users/stevemeisner/Sites/rust-slack/.planning/reviews/AUTONOMOUS-RUN-REPORT.md`
- Webhook wire format: `/Users/stevemeisner/Sites/rust-slack/crates/rs-bots/src/webhooks.rs`, `/Users/stevemeisner/Sites/rust-slack/crates/rs-api/src/handlers/bots.rs:99-141`
- Slash command dispatch: `/Users/stevemeisner/Sites/rust-slack/crates/rs-bots/src/slash_commands.rs`
- Bot token model: `/Users/stevemeisner/Sites/rust-slack/crates/rs-bots/src/bots.rs`
- E2EE-on-send enforcement: commit `b9cb1da` (Phase 9 H-1)
- Webhook secret hashing: commit `3032236` (Phase 11 C-2)
- Bot token hashing: commit `36ca613` (Phase 6 H-3)
- Slash command HMAC: commit `a603a09` (Phase 11 H-5)
