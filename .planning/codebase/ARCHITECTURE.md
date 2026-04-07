# Architecture

**Analysis Date:** 2026-04-07

## Pattern Overview

**Overall:** Thin layered SDK — a stateless REST client (`KlankClient`), a WebSocket connection manager (`WsManager`), and a high-level event router (`KlankBot`) sit on top of them. A separate one-shot HTTP poster (`WebhookBot`) lives off to the side and shares no code with the WS bot path.

**Key Characteristics:**
- Single TypeScript package (`@klank/sdk`) at `packages/sdk-typescript/`. No Rust crate exists despite README marketing.
- Six source files, ~570 lines total. No abstractions for retries, errors, transport, or auth — each module owns its own concerns inline.
- Server-side Node only (depends on `ws` and global `fetch`). Browser is not a target.
- No DI, no plugin system; extension is via `bot.use(middleware)` and `bot.on(...)`.
- No tests, no error taxonomy — every failure throws raw `Error`.

## Layers

**Transport — REST (`KlankClient`):**
- Purpose: Bearer-auth REST calls to `${serverUrl}/api/v1`.
- Location: `packages/sdk-typescript/src/client.ts` (97 lines).
- Contains: `fetch()` private wrapper with 429 backoff, `json()` JSON helper, and the public method surface (see Public API below).
- Depends on: global `fetch`, `./types`.
- Used by: `KlankBot` (via constructor wiring), and exported directly to users via `index.ts`.

**Transport — WebSocket (`WsManager`):**
- Purpose: Authenticate via REST ticket then hold open a `wss://.../api/v1/ws?ticket=` connection. Auto-reconnect with exponential backoff.
- Location: `packages/sdk-typescript/src/ws.ts` (72 lines).
- Contains: `connect()` (`ws.ts:26`), `disconnect()` (`ws.ts:65`), `onEvent(cb)` listener registration (`ws.ts:22`).
- Depends on: `ws` npm package, a `ticketFn: () => Promise<string>` injected by the caller, `./types.ServerEvent`.
- Used by: `KlankBot` only.
- Notes: parse errors silently swallowed (`ws.ts:46`); listeners cannot be removed; reconnect backoff caps at 30 s with no jitter and no heartbeat.

**Framework — Bot (`KlankBot`):**
- Purpose: Top-level developer surface. Owns the client, the WS manager, the handler/middleware registries, and the lifecycle.
- Location: `packages/sdk-typescript/src/bot.ts` (206 lines).
- Contains: handler registries, `start`/`stop`, event dispatch (`handleEvent` `bot.ts:98`), context builders (`buildContext` `bot.ts:173`, `buildCommandContext` `bot.ts:194`).
- Depends on: `KlankClient`, `WsManager`, `./types`.
- Used by: end users.

**One-shot poster (`WebhookBot`):**
- Purpose: Post a single message to an incoming webhook URL. Shares nothing with `KlankBot`.
- Location: `packages/sdk-typescript/src/webhook.ts` (31 lines).
- Depends on: global `fetch`, `./types.WebhookConfig`.
- Notes: Currently puts the raw secret in the JSON body (`webhook.ts:21`) — broken against the post–phase-11 server, which requires `X-Klank-Webhook-Key` and `X-Klank-Signature` headers and rejects the body field.

**Type layer (`types.ts`):**
- Purpose: All public types — config, REST entities, the `ServerEvent` discriminated union, and handler/context interfaces.
- Location: `packages/sdk-typescript/src/types.ts` (158 lines).
- Hand-written; not generated from the server. Drift risk is high.

**Barrel (`index.ts`):**
- `packages/sdk-typescript/src/index.ts` (4 lines): re-exports `KlankBot`, `WebhookBot`, `KlankClient`, and `export type * from './types'`.

## Public API Surface

`import { KlankBot, KlankClient, WebhookBot } from '@klank/sdk'` plus `import type { ... } from '@klank/sdk'` for everything in `types.ts`.

### `KlankBot` (`bot.ts:9`)

Constructor: `new KlankBot({ token, serverUrl, reconnect? })` — `BotConfig` at `types.ts:3`. `reconnect` defaults to `true` (`bot.ts:22`).

Registration methods (all chainable, return `this`):
- `on(eventType: string, handler: EventHandler)` — `bot.ts:34`. String key, no type narrowing; handler is `(event: ServerEvent, ctx: BotContext) => …`.
- `command(name: string, handler: CommandHandler)` — `bot.ts:42`. Single handler per command name; later registrations overwrite.
- `message(pattern: RegExp | string, handler: MessageHandler)` — `bot.ts:48`. Strings are passed straight to `new RegExp(...)`.
- `use(middleware: Middleware)` — `bot.ts:55`. Middleware signature: `(event, ctx, next) => …`.
- `onError(handler: (err: Error) => void)` — `bot.ts:61`. Single global handler; replaces any prior one (not additive).

Lifecycle:
- `start(): Promise<void>` — `bot.ts:67`. Calls `client.getBotInfo()`, then `ws.connect()`, then registers `process.on('SIGINT'|'SIGTERM', stop)` (`bot.ts:75-77`). The signal-handler registration is process-global, so multiple `KlankBot` instances in one process step on each other.
- `stop(): void` — `bot.ts:81`. Closes the WS via `ws.disconnect()`.

Inspection:
- `getClient(): KlankClient` — `bot.ts:87`.
- `getBotInfo(): BotInfo | null` — `bot.ts:92`. Null until after `start()` resolves.

### `KlankClient` (`client.ts:4`)

Constructor: `new KlankClient(serverUrl, token)`. Stores `${serverUrl}/api/v1` as `baseUrl`.

REST surface:
- `getBotInfo(): Promise<BotInfo>` — `GET /auth/bot-info` (`client.ts:46`).
- `getWsTicket(): Promise<string>` — `POST /auth/bot-ws-ticket`, unwraps `{ ticket }` (`client.ts:50`).
- `sendMessage(channelId, text, { threadId? }): Promise<Message>` — `POST /channels/:id/messages` with body `{ plaintext, content_type:'plaintext', sender_type:'bot', thread_id }` (`client.ts:57`).
- `getMessages(channelId, limit=50)` — `GET /channels/:id/messages?limit=` (`client.ts:69`).
- `addReaction(messageId, emoji)` — `POST /messages/:id/reactions` (`client.ts:75`).
- `removeReaction(messageId, emoji)` — `DELETE /messages/:id/reactions/:emoji` (`client.ts:82`).
- `listChannels(workspaceId)` — `GET /workspaces/:id/channels` (`client.ts:90`).
- `getChannel(channelId)` — `GET /channels/:id` (`client.ts:94`).

Auth: bearer header set in `fetch()` private (`client.ts:14-16`). No 401 re-auth; bot dies silently on token revocation.

429 handling: `client.ts:25-29` reads `Retry-After`, sleeps, then **recurses into the same `fetch()`**. No max retries — infinite loop is reachable.

### `WebhookBot` (`webhook.ts:4`)

- Constructor: `new WebhookBot({ webhookId, webhookSecret, serverUrl })` (`WebhookConfig` at `types.ts:9`).
- `send(text, { username? }): Promise<void>` — `webhook.ts:12`. POSTs to `${serverUrl}/api/v1/webhooks/${webhookId}/incoming` with body `{ text, username, secret }`. Throws raw `Error` on non-2xx.

## Control Flow — Bot Startup

1. **Construct.** `new KlankBot(config)` (`bot.ts:21`) creates a `KlankClient` and a `WsManager`. The `WsManager` is given a `ticketFn` that closes over `client.getWsTicket()` (`bot.ts:25-27`). The bot wires `ws.onEvent(handleEvent)` immediately (`bot.ts:30`).
2. **`bot.start()`** (`bot.ts:67`):
   1. `await client.getBotInfo()` — `GET /api/v1/auth/bot-info` (`client.ts:46`). Caches the result on `this.botInfo`. Logs name and workspace.
   2. `await ws.connect()` (`ws.ts:26`):
      - Calls `ticketFn()` → `client.getWsTicket()` → `POST /api/v1/auth/bot-ws-ticket`.
      - Rewrites `serverUrl` from `http(s)://` to `ws(s)://` and opens `${wsUrl}/api/v1/ws?ticket=${ticket}` (`ws.ts:29-30`).
      - The Promise resolves on the WS `open` event (`ws.ts:35-38`); it rejects only if `error` fires before `open` (`ws.ts:57-61`).
   3. Registers `SIGINT`/`SIGTERM` → `stop()` on the global `process` (`bot.ts:75-77`).
3. **Receive.** Each WS `message` is `JSON.parse`d into a `ServerEvent` (`ws.ts:40-47`), then dispatched to every registered listener (currently just `bot.handleEvent`).
4. **`handleEvent(event)`** (`bot.ts:98`):
   1. Self-message filter: drops `message.new` whose `sender_id === botInfo.bot_id` (`bot.ts:101`). Note: this only catches WS-sent messages; webhook posts use a different sender id.
   2. Builds `BotContext` via `buildContext(event)` (`bot.ts:173`).
   3. Runs the middleware chain. Index-based, push-style: `next()` advances `middlewareIndex` and invokes the next middleware (`bot.ts:108-117`). If no middleware is registered, the chain is skipped entirely.
   4. Resolves handlers: maps `event.type` from dotted to underscored (`message.new` → `message_new`, `bot.ts:120`). Then merges in any handlers registered under a hardcoded shorthand alias (`bot.ts:124-137`). The shorthand table covers `message.new`, `reaction.added`, `reaction.removed`, `channel.member_joined`, `channel.member_left`, `channel.created`, `presence.update`, `typing.start` — but **not** `message.updated`, `message.deleted`, or `typing.stop`. Those types are reachable only via the generic dotted-to-underscored route (`message_updated`, etc.).
   5. Awaits each handler in order (`bot.ts:139-141`).
   6. If `event.type === 'message.new'`, runs the regex matchers over `event.plaintext || ''` (`bot.ts:144-153`). Each matching pattern's handler is awaited with the captured `RegExpMatchArray` as a third arg.
   7. If `event.type === 'command.invoked'`, looks up the registered command handler by name and invokes it with a `CommandContext` from `buildCommandContext` (`bot.ts:156-163`).
   8. Any thrown error is routed to `errorHandler` if set, else `console.error` (`bot.ts:164-170`).

## Data Flow — `ctx.say` / `ctx.reply` / `ctx.react`

`buildContext(event)` (`bot.ts:173`) extracts `channelId` and `messageId` from the event by literal property check (`'channel_id' in event`, `'message_id' in event`).

- `ctx.say(text)` (`bot.ts:178`): requires `channelId`; calls `client.sendMessage(channelId, text)` → `POST /api/v1/channels/:id/messages`.
- `ctx.reply(text)` (`bot.ts:182`): requires both `channelId` and `messageId`; calls `client.sendMessage(channelId, text, { threadId: messageId })`. Note this is **threaded reply**, not a same-channel post — there is no "post in channel without thread" helper distinct from `say`.
- `ctx.react(emoji)` (`bot.ts:186`): requires `messageId`; calls `client.addReaction(messageId, emoji)` → `POST /api/v1/messages/:id/reactions`.
- `ctx.sendMessage(chId, text)` (`bot.ts:190`): unconditional pass-through to `client.sendMessage`.

All four routes go through `KlankClient.fetch()` (`client.ts:13`) and inherit the bearer auth and the unbounded 429-retry behavior.

## Data Flow — Slash Command Response

`buildCommandContext(cmd)` (`bot.ts:194`):
- `respond({ responseType, text })` (`bot.ts:196`): only `'in_channel'` is implemented — it calls `client.sendMessage(cmd.channel_id, response.text)`. The `'ephemeral'` branch falls through with no action; `bot.ts:201` carries the comment `// Ephemeral responses are more complex — would need server support`. **The README's ephemeral example is a silent no-op.**
- `say(text)` (`bot.ts:203`): `client.sendMessage(cmd.channel_id, text)`.

## `BotContext` Shape

Defined at `types.ts:137-146`:

```ts
interface BotContext {
  say(text: string): Promise<Message>
  reply(text: string): Promise<Message>          // posts in thread of triggering message
  react(emoji: string): Promise<void>
  sendMessage(channelId: string, text: string): Promise<Message>
}
```

Not present (despite being plausible expectations from a Slack-style SDK): `update`, `delete`, `upload`, `thread`, `ephemeral`, `dm`, `openModal`, `unreact`, `typing`, `presence`.

`CommandContext` (`types.ts:148-153`):

```ts
interface CommandContext {
  respond(response: { responseType: 'ephemeral' | 'in_channel'; text: string }): Promise<void>
  say(text: string): Promise<Message>
}
```

## Entry Points

- **Library entry:** `packages/sdk-typescript/src/index.ts` (4 lines). Built by `tsup src/index.ts --format cjs,esm --dts` per `package.json`.
- **Bot lifecycle entry:** `KlankBot.start()` at `bot.ts:67`.
- **Event entry:** `WsManager` `message` callback at `ws.ts:40`, which fans out to `KlankBot.handleEvent` at `bot.ts:98`.
- **Webhook entry:** `WebhookBot.send` at `webhook.ts:12`.

## Error Handling

**Strategy:** Throw raw `Error` everywhere. No typed errors, no error hierarchy.

**Patterns:**
- `KlankClient.json()` (`client.ts:34-42`): on non-2xx, attempts to parse `{ message }` from the response body, then throws `Error("API error <status>: <message>")`.
- `WebhookBot.send()` (`webhook.ts:26-29`): same pattern, prefixed `Webhook error <status>:`.
- `KlankBot.handleEvent()` (`bot.ts:164-170`): try/catch wraps the entire dispatch. Errors route to the user's `onError` handler if set, otherwise `console.error`.
- `WsManager`: parse errors are swallowed (`ws.ts:46`); connection errors only reject the `connect()` Promise if they fire before `open` (`ws.ts:57-61`); post-`open` errors go to nowhere.

## Cross-Cutting Concerns

**Logging:** `console.log` directly in `bot.ts:69, 72, 82` (startup/shutdown). No logger abstraction, no levels.

**Validation:** None. Inbound WS payloads are `JSON.parse`d and cast to `ServerEvent`; nothing checks shape.

**Authentication:**
- REST: bearer token in the `Authorization` header (`client.ts:15`).
- WS: short-lived ticket via `POST /auth/bot-ws-ticket`, appended as `?ticket=` query (`ws.ts:30`).
- Webhook: raw secret in JSON body (`webhook.ts:21`) — **broken against current server**, which requires `X-Klank-Webhook-Key` + `X-Klank-Signature` headers per `BASELINE-REPORT.md` §5.

**Reconnect / heartbeat:** Exponential backoff in `WsManager` (`ws.ts:49-55`), capped at 30 s, no jitter, no give-up. No ping/pong.

**Rate limit:** Single `if (status === 429)` block in `KlankClient.fetch()` (`client.ts:25-29`). Recursive, unbounded.

**Self-message suppression:** Only `KlankBot.handleEvent` (`bot.ts:101`), only for `message.new`, only against `botInfo.bot_id`. Webhook-sourced messages (which carry a different sender id) are not suppressed.

---

*Architecture analysis: 2026-04-07*
