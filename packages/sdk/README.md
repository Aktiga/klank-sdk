# @klank/sdk

Bot SDK for [Klank](https://github.com/Aktiga/klank), the self-hosted end-to-end-encrypted team chat. Typed wire models, an incoming-webhook poster, slash command signature verification, a REST client, and a WebSocket event bot. The wire formats mirror the server source; what the server does not yet do for bots is marked pending below rather than papered over.

## Install

```bash
npm i @klank/sdk
```

Node 20+. ESM only (`import`, no `require`). No runtime dependencies beyond `ws`.

## Status

Against Klank `53d464a` (2026-04-30). The server accepts bot tokens on two routes and has no channel-membership model for bots, so most of the interactive surface cannot do anything yet. Details in [server-requirements.md](https://github.com/Aktiga/klank-sdk/blob/main/docs/server-requirements.md).

| Surface | Status |
|---|---|
| `WebhookBot.send` | Works. Non-E2EE channels only; a channel with an active key epoch rejects with `E2EEChannelError`. |
| `verifySlashCommandSignature`, `parseSlashCommandPayload` | Works. They implement the server's dispatch contract, which exists in the server but has no caller yet: there is no command registration route or UI, so nothing invokes your endpoint until that lands. |
| `KlankClient.getBotInfo`, `KlankClient.getWsTicket` | Works. |
| `KlankClient` channel / message / reaction methods | **Pending server.** Bot tokens are not yet accepted on those routes (401). [Details](https://github.com/Aktiga/klank-sdk/blob/main/docs/server-requirements.md#1-bot-tokens-are-rejected-by-every-channelmessagereaction-route) |
| `KlankBot` events and `ctx` helpers | **Pending server.** The socket connects; bots have no channel subscriptions, so no events arrive. [Details](https://github.com/Aktiga/klank-sdk/blob/main/docs/server-requirements.md#2-bots-have-no-channel-membership-so-they-receive-zero-websocket-events-and-cannot-pass-is_member) |
| `bot.command()` | **Pending server.** `command.invoked` is not emitted over the WebSocket. Use the HTTP slash recipe below. [Details](https://github.com/Aktiga/klank-sdk/blob/main/docs/server-requirements.md#3-no-slash-command-delivery-path) |

## Quick start

The thing that works today: post into a channel through an incoming webhook.

```ts
import { WebhookBot } from '@klank/sdk'

const bot = new WebhookBot({
  serverUrl: 'https://chat.example.com',
  webhookId: process.env.WEBHOOK_ID!,
  webhookSecret: process.env.WEBHOOK_SECRET!,
})

const message = await bot.send('Build #42 passed ✅', { username: 'CI' })
console.log(message.id, message.channel_id)
```

Create the webhook with a user JWT (workspace owner/admin): `POST /api/v1/channels/{channelId}/webhooks` with `{"name":"CI","kind":"incoming"}`. The response's `secret` is returned exactly once; the server stores only its SHA-256.

## WebhookBot

```ts
new WebhookBot(config: WebhookConfig)
```

| Field | Notes |
|---|---|
| `serverUrl` | Server origin, e.g. `https://chat.example.com`. |
| `webhookId` | UUID from the create response. |
| `webhookSecret` | Raw secret from the create response (48 hex chars). |
| `fetch` | Optional `fetch` override. |

`send(text, options?: { username?: string }): Promise<Message>` posts `POST /api/v1/webhooks/{webhookId}/incoming` with body `{"text": string, "username"?: string}` and resolves with the created `Message` row (201). The server stamps the row with `sender_type: "bot"` and `sender_id = webhookId`. `username` is parsed but not persisted by the current server.

Two headers authenticate the request: `X-Klank-Webhook-Key` carries the raw secret and `X-Klank-Signature` carries `sha256=<lowercase hex hmac_sha256(secret, body)>` over the exact bytes sent, so the SDK serializes once and signs those bytes. There is no timestamp or nonce; see [Security](#security).

`signWebhookBody(secret: string | Uint8Array, body: string | Uint8Array): string` returns the `sha256=<hex>` value if you need to sign outside `WebhookBot`. Known vector: secret `s3cr3t`, body `{"hello":"world"}` → `sha256=c5ea6542cb731d59005472d10164434c5b64ae51f6372f72447e46d1536492ee`.

## Slash commands (HTTP)

Klank dispatches a slash command by `POST`ing to the URL configured for the command:

```
POST <your url>
content-type: application/json
x-klank-signature: sha256=<hex hmac_sha256(signing_secret, raw_body)>

{"command":"/echo","text":"hi","user_id":"…","channel_id":"…","workspace_id":"…"}
```

You must answer 2xx JSON `{ "response_type": "ephemeral" | "in_channel", "text": "…" }` within 5 seconds. `in_channel` is the only value with a delivery path on `53d464a`; the server has no per-user channel for ephemeral replies. Verify against the raw bytes received: the server signs compact serde JSON, and any re-encoding breaks the match.

```ts
import { createServer } from 'node:http'
import { parseSlashCommandPayload, verifySlashCommandSignature } from '@klank/sdk'
import type { SlashCommandResponse } from '@klank/sdk'

const signingSecret = process.env.SLASH_SIGNING_SECRET!

createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks)
    const header = req.headers['x-klank-signature']
    const ok = verifySlashCommandSignature({
      rawBody,
      signatureHeader: Array.isArray(header) ? header[0] : header,
      signingSecret,
    })
    if (!ok) {
      res.writeHead(401).end()
      return
    }
    const cmd = parseSlashCommandPayload(rawBody)
    const body: SlashCommandResponse = { response_type: 'in_channel', text: `echo: ${cmd.text}` }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
  })
}).listen(8080)
```

`verifySlashCommandSignature` returns `false` for a missing or malformed header and compares in constant time. `parseSlashCommandPayload` throws `BadRequestError` when a field is missing or not a string.

With Express, mount `express.raw({ type: 'application/json' })` on the route so `req.body` is the untouched `Buffer`. Never verify against `JSON.stringify(req.body)`.

Klank `53d464a` will not call this endpoint yet: the dispatch code exists server-side but has no caller and no command registration route, so the receiver sits idle until that lands.

## KlankBot

Long-running bot: connects a WebSocket, routes events to handlers, and exposes the REST client. Pending server support for event delivery; see [Status](#status).

```ts
import { KlankBot } from '@klank/sdk'

const bot = new KlankBot({ token: process.env.BOT_TOKEN!, serverUrl: 'https://chat.example.com' })

bot.on('message.new', async (event, ctx) => {
  if (event.plaintext?.startsWith('!ping')) await ctx.reply('pong')
})

bot.onError((err, event) => console.error(err, event?.type))
await bot.start()
```

### Config

| Field | Default | Notes |
|---|---|---|
| `token` | required | `bot_` + 64 hex chars. |
| `serverUrl` | required | Server origin. |
| `reconnect` | `true` | Reconnect after an unexpected close with exponential backoff. |
| `webhookIds` | `[]` | Incoming-webhook IDs this bot also posts through. Their `message.new` events (`sender_id = webhook_id`) are treated as self and not routed, which prevents echo loops. |
| `handleSignals` | `false` | Install `SIGINT`/`SIGTERM` handlers that call `stop()`. Leave off when the host process manages shutdown. |
| `ws` | see below | `WsOptions`. |
| `client` | see below | `ClientOptions` for the embedded `KlankClient`. |

`WsOptions`: `baseDelayMs` (1000) first reconnect delay; `maxDelayMs` (30000) ceiling; `maxAttempts` (`Infinity`) consecutive failed reconnects before `ConnectionError` is reported to `onError`; `heartbeatMs` (30000) interval for the application `{"type":"ping"}` plus a protocol ping, `0` disables (the server drops presence after 5 minutes without a heartbeat); `pongTimeoutMs` (10000) closes the socket when no pong arrives.

Every connect, including reconnects, fetches a fresh single-use ticket from `POST /api/v1/auth/bot-ws-ticket` (30 s TTL) and opens `GET /api/v1/ws?ticket=<ticket>`.

### Handlers

`on(name, handler): this` accepts every wire `type` from the [Events](#events) table plus these aliases:

| Alias | Wire name |
|---|---|
| `message` | `message.new` |
| `message_updated` | `message.updated` |
| `message_deleted` | `message.deleted` |
| `reaction_added` | `reaction.added` |
| `reaction_removed` | `reaction.removed` |
| `typing` | `typing.start` |
| `typing_stop` | `typing.stop` |
| `channel_created` | `channel.created` |
| `channel_deleted` | `channel.deleted` |
| `member_joined` | `channel.member_joined` |
| `member_left` | `channel.member_left` |
| `presence` | `presence.update` |

The `event` parameter is narrowed to that variant. `off(name, handler): this` removes a handler registered with the same reference.

`message(pattern: RegExp | string, handler): this` runs on `message.new` when the message's `plaintext` matches, and the handler receives `(event, ctx, matches)`. A string is compiled with `new RegExp(pattern)` — an unanchored pattern, not a literal substring: pass a `RegExp` when you want flags, and escape metacharacters if you mean them literally. Messages whose `sender_id` is the bot or one of `webhookIds` are skipped.

`command(name, handler): this` registers a handler for the reserved `command.invoked` event. `ctx.respond({ responseType: 'in_channel', text })` posts to the channel; `responseType: 'ephemeral'` throws `UnsupportedError` because the server has no per-user delivery. No released server emits this event; use the HTTP recipe above.

`use(mw): this` adds middleware `(event, ctx, next)` that runs before handlers for every event; call `next()` to continue.

`onError(handler: (err: Error, event?: ServerEvent) => void): this` receives handler exceptions (with the triggering event), WebSocket errors, and `ConnectionError` when reconnects are exhausted. Without a handler, errors are written to `console.error`.

`start(): Promise<void>` calls `GET /api/v1/auth/bot-info`, then connects; it rejects with `AuthError` for a bad token and `ConnectionError` if the first connect fails. `stop(): void` closes the socket and disables reconnect. `getClient(): KlankClient` returns the embedded REST client. `getBotInfo(): BotInfo | null` returns the result of `start()`.

### Context

| Member | Does |
|---|---|
| `ctx.event` | The `ServerEvent` this context was built for. |
| `ctx.say(text)` | `POST /channels/{event.channel_id}/messages`. |
| `ctx.reply(text)` | Same, with `thread_id` = `event.thread_id ?? event.message_id`: replying to a threaded message posts into that same thread, replying to a top-level message starts a thread on it. |
| `ctx.react(emoji)` | `POST /messages/{event.message_id}/reactions`. |
| `ctx.unreact(emoji)` | `DELETE /messages/{event.message_id}/reactions/{emoji}`. |
| `ctx.sendMessage(channelId, text, options?)` | Post to any channel; `options.threadId` for threads. |

Helpers throw `ContextError` when the event has no `channel_id` or `message_id` to act on (e.g. `presence.update`).

## KlankClient

```ts
import { KlankClient } from '@klank/sdk'

const client = new KlankClient('https://chat.example.com', process.env.BOT_TOKEN!)
const info = await client.getBotInfo()
```

`new KlankClient(serverUrl: string, token: string, options?: ClientOptions)`. Every call sends `Authorization: Bearer <token>` to `{serverUrl}/api/v1`. `KlankBot` builds one internally; reach it with `bot.getClient()`.

| Method | Route |
|---|---|
| `getBotInfo(): Promise<BotInfo>` | `GET /auth/bot-info` |
| `getWsTicket(): Promise<string>` | `POST /auth/bot-ws-ticket` → `ticket` |
| `sendMessage(channelId, text, options?: SendOptions): Promise<Message>` | `POST /channels/{id}/messages` `{ plaintext, content_type: "plaintext", sender_type: "bot", thread_id? }` |
| `getMessages(channelId, params?: CursorParams): Promise<CursorPage<MessageListItem>>` | `GET /channels/{id}/messages?limit=&cursor=` (newest first) |
| `editMessage(messageId, text): Promise<Message>` | `PATCH /messages/{id}` `{ plaintext, content_type: "plaintext" }` |
| `deleteMessage(messageId): Promise<void>` | `DELETE /messages/{id}` |
| `getThread(messageId, params?: CursorParams): Promise<CursorPage<Message>>` | `GET /messages/{id}/thread?limit=&cursor=` (oldest first) |
| `addReaction(messageId, emoji): Promise<void>` | `POST /messages/{id}/reactions` `{ emoji }` |
| `removeReaction(messageId, emoji): Promise<void>` | `DELETE /messages/{id}/reactions/{encodeURIComponent(emoji)}` |
| `listChannels(workspaceId): Promise<ChannelWithMembers[]>` | `GET /workspaces/{wid}/channels` |
| `getChannel(channelId): Promise<Channel>` | `GET /channels/{id}` |

Only the first two rows accept bot tokens on Klank `53d464a`; the rest return `AuthError` until the server work lands.

Retries: a 429 is retried up to `maxRetries` attempts in total (default 5 — the first request plus four retries), honouring `Retry-After` as seconds or an HTTP-date, falling back to 1 s when it is missing or unparseable, each delay jittered 0.8–1.2x. On exhaustion it throws `RateLimitedError` carrying `retryAfterMs` (the last value seen) and `attempts`. A 5xx is retried only for `GET` and `DELETE` — at most 3 attempts, backoff `retryBaseMs * 2^(n-1)` jittered 0.8–1.2x — because a repeated `POST`/`PATCH` could duplicate a committed write; a 5xx on those methods throws `ServerError` immediately. A `fetch` rejection throws `NetworkError` on the first failure, never retried, with the original error as `cause`.

`ClientOptions`: `fetch` (global `fetch`), `maxRetries` (5), `retryBaseMs` (250).

## Errors

Everything thrown by the SDK extends `KlankError`, which carries `code`, and for server responses `status` and `body` (the parsed `{ error, message }` envelope, or raw text).

| Class | `code` | When |
|---|---|---|
| `AuthError` | `auth` | 401 from a bearer route: token missing, malformed, revoked, or its bot was deleted. |
| `WebhookAuthError` | `webhook_auth` | 401 from `POST /webhooks/{id}/incoming`: wrong secret, bad or missing signature. |
| `ForbiddenError` | `forbidden` | 403 that is not a membership failure. |
| `ChannelMembershipError` | `channel_membership` | 403 `Not a member of this channel`. |
| `E2EEChannelError` | `e2ee_channel` | 400 `Channel requires encrypted messages`. |
| `NotFoundError` | `not_found` | 404. |
| `BadRequestError` | `bad_request` | Any other 4xx, and malformed slash payloads. |
| `RateLimitedError` | `rate_limited` | 429 after the retry budget; `retryAfterMs`, `attempts`. |
| `ServerError` | `server` | 5xx (after retries where retryable). |
| `NetworkError` | `network` | `fetch` rejected: DNS, refused, TLS, aborted; `cause` set. |
| `ContextError` | `context` | A `ctx` helper was called on an event without a channel or message. |
| `UnsupportedError` | `unsupported` | The server has no implementation, e.g. ephemeral slash responses. |
| `ConnectionError` | `connection` | WebSocket could not connect or reconnects were exhausted; `attempts`, `cause`. |

```ts
import { E2EEChannelError, WebhookAuthError } from '@klank/sdk'

try {
  await bot.send('hello')
} catch (err) {
  if (err instanceof WebhookAuthError) console.error('check WEBHOOK_SECRET', err.status, err.body)
  else if (err instanceof E2EEChannelError) console.error('channel is E2EE; bots post plaintext')
  else throw err
}
```

## Events

Every frame is JSON text `{ "type": "<name>", ...fields }`. Field names are snake_case and match the server's `ServerEvent` enum. All `type` values in the `ServerEvent` union:

| Group | `type` |
|---|---|
| Messages | `message.new`, `message.updated`, `message.deleted` |
| Reactions | `reaction.added`, `reaction.removed` |
| Typing | `typing.start`, `typing.stop` (server emits `typing.stop` 5 s after the last typing signal) |
| Channels | `channel.created`, `channel.deleted`, `channel.member_joined`, `channel.member_left`, `channel.member_added` |
| Presence and users | `presence.update`, `user.updated` |
| E2EE keys and devices | `keys.request`, `keys.delivered`, `keys.rotate`, `keys.low`, `device.registered`, `device.deleted` |
| Canvas | `canvas.sync`, `canvas.awareness` |
| Tabs | `tab.added`, `tab.removed`, `tab.updated` |
| Emoji | `emoji.created`, `emoji.deleted` |
| Import | `import.progress` |
| Huddles | `huddle.started`, `huddle.participant_joined`, `huddle.participant_left`, `huddle.ended` |
| Sentinels | `events.missed` (`{ count }`: this socket fell behind the broadcast; treat cached state as stale and re-fetch over REST), `command.invoked` (reserved; not emitted by any released server) |

`message.new` carries `plaintext` for bot and plaintext messages and `ciphertext`/`nonce`/`key_epoch` for E2EE messages, which a bot cannot decrypt. Use `EventOf<'message.new'>` (or the named interfaces such as `MessageNewEvent`) to type handlers outside `bot.on`.

## Bot messages and E2EE

Bots send plaintext: `content_type: "plaintext"`, `sender_type: "bot"`. The server rejects plaintext into a channel that has an active key epoch with 400 `Channel requires encrypted messages`, surfaced as `E2EEChannelError`. Bots that hold channel keys and post encrypted messages are planned, not available.

## Bot tokens

Register with a user JWT: `POST /api/v1/workspaces/{workspaceId}/bots` `{"name":"…","scopes":["read","write"]}`. The response's `api_token` (`bot_` + 64 hex) is shown once; the server stores only its SHA-256. There is no rotation endpoint: `DELETE /api/v1/workspaces/{workspaceId}/bots/{botId}` and create a new bot. Scopes are stored but not enforced on `53d464a`.

## Channel membership

Every channel, message, and reaction route requires the caller to be a channel member; non-members get 403 `Not a member of this channel` (`ChannelMembershipError`). Adding a bot as a member is part of the pending server work, which is why `KlankClient` message methods and `KlankBot` events do not function yet.

## Security

See [docs/security.md](https://github.com/Aktiga/klank-sdk/blob/main/docs/security.md): HMAC details for both directions, the absence of replay protection, and what the SDK never logs.

## Server compatibility

Wire types and routes are verified against [Aktiga/klank](https://github.com/Aktiga/klank) commit `53d464a` (2026-04-30).

## License

MIT
