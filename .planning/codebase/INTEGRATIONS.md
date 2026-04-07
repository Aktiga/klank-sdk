# External Integrations

**Analysis Date:** 2026-04-07

The SDK integrates with exactly one external system: a **Klank server** (formerly "rust-slack"). It speaks REST + WebSocket to that server. There are no other third-party integrations (no Stripe, no Sentry, no analytics, no cloud SDKs).

## Target server

- Repo: `/Users/stevemeisner/Sites/rust-slack` (Rust workspace)
- Base URL: user-provided `serverUrl`; SDK appends `/api/v1` (`packages/sdk-typescript/src/client.ts:9`)
- README pins compatibility to commit `d7c956c` — **stale**, predates server phases 6–11.

## Auth model

**Bearer token (only):**
- Constructor takes a raw `bot_*`-prefixed token. Sent on every REST request as `Authorization: Bearer <token>` (`packages/sdk-typescript/src/client.ts:14-16`).
- Server stores only `sha256(token)` (Phase 6 H-3, server commit `36ca613`). Token is shown exactly once at bot creation. The SDK has no recovery / rotation path; on revocation it dies silently.
- **No refresh handling.** No re-auth on 401. `client.ts` does not special-case 401 anywhere.
- **No token rotation API.** Server has none today either.

## REST endpoints consumed

All hardcoded in `packages/sdk-typescript/src/client.ts`. Base path is `${serverUrl}/api/v1`.

| Method | Path | SDK call site | Purpose |
|---|---|---|---|
| GET    | `/auth/bot-info` | `KlankClient.getBotInfo()` — `client.ts:46-48` | Returns `BotInfo` (id, name, scopes, workspace). Called once at `bot.start()`. |
| POST   | `/auth/bot-ws-ticket` | `KlankClient.getWsTicket()` — `client.ts:50-53` | Returns `{ ticket }`. Used to authenticate the WS upgrade. |
| POST   | `/channels/:channelId/messages` | `KlankClient.sendMessage()` — `client.ts:57-67` | Body: `{ plaintext, content_type: 'plaintext', sender_type: 'bot', thread_id? }`. **`sender_type` is ignored server-side** (auth context determines it). **Will 4xx against E2EE channels** post-Phase 9 H-1 (`b9cb1da`). |
| GET    | `/channels/:channelId/messages?limit=N` | `KlankClient.getMessages()` — `client.ts:69-71` | Returns `{ items, next_cursor }`. |
| POST   | `/messages/:messageId/reactions` | `KlankClient.addReaction()` — `client.ts:75-80` | Body: `{ emoji }`. |
| DELETE | `/messages/:messageId/reactions/:emoji` | `KlankClient.removeReaction()` — `client.ts:82-86` | Emoji URL-encoded. |
| GET    | `/workspaces/:workspaceId/channels` | `KlankClient.listChannels()` — `client.ts:90-92` | Returns `Channel[]`. |
| GET    | `/channels/:channelId` | `KlankClient.getChannel()` — `client.ts:94-96` | Returns `Channel`. |
| POST   | `/webhooks/:webhookId/incoming` | `WebhookBot.send()` — `webhook.ts:13-24` | **See "Webhook wire format" — currently broken.** |

**Endpoints conspicuously absent** (server has them, SDK does not):
- File upload / download (Phase 8)
- Message edit (`PATCH /messages/:id`) and delete
- Channel join / add-bot-to-channel (membership self-service)
- Member list, user lookup, presence, search
- DM open, thread fetch
- Pinned messages
- Ephemeral message send
- Workspace listing
- Token refresh / rotate

## WebSocket protocol

**Connection (`packages/sdk-typescript/src/ws.ts:26-63`):**
1. Client calls `ticketFn()` → hits `POST /api/v1/auth/bot-ws-ticket`, gets `{ ticket }`.
2. Rewrites scheme: `http://` → `ws://`, `https://` → `wss://` (`ws.ts:29`).
3. Opens `${ws-scheme}://host/api/v1/ws?ticket=<ticket>` (`ws.ts:30`).
4. On `'message'`, JSON-parses to `ServerEvent` and fans out to listeners (`ws.ts:40-47`). Parse errors are **silently swallowed** (`ws.ts:46`).

**Reconnect (`ws.ts:49-55`):**
- On `'close'`, if `reconnect && !stopped`, schedules `connect()` after `reconnectDelay` ms.
- Backoff: `reconnectDelay = min(reconnectDelay * 2, 30_000)`. Starts at 1000ms.
- **No jitter.** **No max attempts** — reconnects forever.
- **No heartbeat / ping handling.** Does not respond to server pings, does not send its own.
- **Listeners cannot be removed** — `onEvent()` only appends to `listeners[]` (`ws.ts:22-24`).

**Event envelope (`packages/sdk-typescript/src/types.ts`):**
- Hand-written discriminated union `ServerEvent`: Message / Reaction / Typing / Channel / Member / Presence / Command sub-events. Type names use dotted notation (e.g. `message.new`, `message.updated`, `typing.start`).
- Hand-written, **not generated** from server schemas — drift risk is high. No `utoipa`/OpenAPI pipeline.
- `Message.content_type: 'encrypted' | 'plaintext'`. SDK has **zero handling for `encrypted`**: in an E2EE channel, `plaintext` is `null` and the bot silently no-ops.

## Webhook wire format (incoming webhooks — broken)

**Endpoint:** `POST /api/v1/webhooks/:webhookId/incoming`

**What the SDK currently sends** (`packages/sdk-typescript/src/webhook.ts:13-24`):
```http
POST /api/v1/webhooks/<id>/incoming
Content-Type: application/json

{ "text": "...", "username": "...", "secret": "<RAW SECRET IN BODY>" }
```

**What the server now requires** (post Phase 11 C-2, server commit `3032236`; defined in `crates/rs-bots/src/webhooks.rs:75-130` and `crates/rs-api/src/handlers/bots.rs:99-141`):
```http
POST /api/v1/webhooks/<id>/incoming
Content-Type: application/json
X-Klank-Webhook-Key: <raw-secret>
X-Klank-Signature: sha256=<hex(HMAC_SHA256(raw_secret, raw_body_bytes))>

{ "text": "...", "username": "..." }
```

**Verification (server side):**
- `sha256(provided_raw_secret) == stored secret_hash` (constant-time, `subtle::ConstantTimeEq`).
- `HMAC-SHA256(raw_secret, raw_body) == header signature` (constant-time, `mac.verify_slice`).

**Status:** **BROKEN.** SDK sends `secret` in body (server no longer reads that field) and sends **no signature header at all**. Every `WebhookBot.send()` will get a `401` against current server `main`. This is the SDK refresh's #1 fix (Migration M-1 in `SDK-REFRESH-ROADMAP.md`).

**Implementation note for the fix:** serialize body to bytes **once**, sign those exact bytes, send those exact bytes — no re-stringify between signing and POST. Use `crypto.createHmac('sha256', rawSecret).update(bodyBuffer).digest('hex')`.

## Slash command HMAC format (server → bot HTTP receiver)

**Source of truth:** `/Users/stevemeisner/Sites/rust-slack/crates/rs-bots/src/slash_commands.rs:32-65` (server commit `a603a09`, Phase 11 H-5).

**Direction:** server POSTs **to the bot's `webhook_url`** when a user invokes a slash command. The SDK is the receiver, not the sender, in this flow.

**Request shape:**
```http
POST <bot-webhook-url>
Content-Type: application/json
X-Klank-Signature: sha256=<hex(HMAC_SHA256(signing_secret, raw_body))>

{
  "command": "/deploy",
  "text": "staging",
  "user_id": "<uuid>",
  "channel_id": "<uuid>",
  "workspace_id": "<uuid>"
}
```

- **Key:** the per-command `signing_secret` issued at command creation. **Not** the bot's API token.
- **Timeout:** server waits 5s for a response.
- **Expected response body:** `{ "response_type": "ephemeral" | "in_channel", "text": "<markdown>" }`.

**SDK status:**
- The SDK has **no HTTP receiver** at all. `bot.command()` (`packages/sdk-typescript/src/bot.ts`) only handles `command.invoked` events delivered over the WebSocket.
- **No `verifySlashCommandSignature` helper exists** for users running an HTTP receiver on Lambda / Vercel / Express. This is Migration M-3 in the roadmap.
- **`ctx.respond({ responseType: 'ephemeral' })`** is documented in README but is a **silent no-op** (`bot.ts:202` admits "Ephemeral responses are more complex — would need server support" and falls through).

## Bot creation / token model (cross-reference)

From server `crates/rs-bots/src/bots.rs:30-72`:

- `POST /api/v1/workspaces/:id/bots` → `BotResponse { id, name, avatar_url, api_token: Some("bot_..."), scopes }`.
- `api_token` is returned **exactly once** at creation. Subsequent fetches set it to `None`.
- Stored as `sha256(token)` in `bots.api_token_hash`.
- `bot_` prefix is enforced both at generation and at authentication.

The SDK consumes the resulting token via the `KlankBot`/`KlankClient` constructor — there is no recovery / rotation path.

## Rate limiting

- `KlankClient.fetch()` (`client.ts:24-29`) handles `429` by reading `Retry-After`, sleeping, and **recursing**.
- **No max retry count.** **No jitter.** Pathological server-side throttling will hang the bot indefinitely.
- Roadmap M-6 plans: max 5 retries, jitter `Retry-After * (0.8 + random*0.4)`, typed `RateLimitedError`.

## Environment configuration

The SDK itself reads **no env vars**. All config is constructor-injected:

- `KlankBot({ token, serverUrl, reconnect? })` (`bot.ts`)
- `KlankClient(serverUrl, token)` (`client.ts:8`)
- `WebhookBot({ serverUrl, webhookId, webhookSecret })` (`webhook.ts:7-9`)

Examples (`examples/*/index.ts`) expect users to plumb `process.env.KLANK_TOKEN` etc. themselves; there is no canonical env-var contract.

## CORS / browser

- N/A — Node-only SDK (uses the `ws` package). CORS tightening in server Phase 6 H-4 (`221d0dd`) does not apply.

## Monitoring / observability / logging

- **None.** SDK throws raw `Error` instances with stringly-typed messages (`client.ts:38`, `webhook.ts:28`). No error taxonomy, no logger interface, no Sentry / OpenTelemetry hook.

## CI / deployment

- **None.** No `.github/`, no other CI config. No release pipeline. Examples have no `package.json` and cannot be deployed as-is.

---

*Integration audit: 2026-04-07*
