# Coding Conventions

**Analysis Date:** 2026-04-07
**Scope:** `packages/sdk-typescript/src/` (the only shipped package)

This document describes the conventions actually present in the Klank Bot SDK source. Where conventions are inconsistent, both forms are noted so future code can pick one and normalize.

## Language and Compiler Posture

**TypeScript:** `^5.0.0` (devDependency in `packages/sdk-typescript/package.json`)

**`tsconfig.json`** (`packages/sdk-typescript/tsconfig.json`):
- `target: ES2022`
- `module: ESNext`
- `moduleResolution: bundler`
- `strict: true`  ← strict mode IS on, but the code uses `as any` and string-keyed maps to escape it (see below)
- `esModuleInterop: true`
- `declaration: true`, `declarationDir: dist`
- `include: ["src"]`

There is no `noUncheckedIndexedAccess`, no `exactOptionalPropertyTypes`, no `noImplicitOverride`. Strictness is base-level only.

## File and Module Layout

Each public concept is one file under `packages/sdk-typescript/src/`:

- `bot.ts` — `KlankBot` class (the main entry)
- `client.ts` — `KlankClient` REST class
- `ws.ts` — `WsManager` class
- `webhook.ts` — `WebhookBot` class
- `types.ts` — all interfaces and type aliases (single shared file, no per-domain split)
- `index.ts` — barrel: re-exports the four classes plus `export type * from './types'`

**Convention:** lowercase single-word filenames, one primary export per file, types centralized in `types.ts`.

## Naming

**Files:** lowercase, no separators (`bot.ts`, `client.ts`, `ws.ts`, `webhook.ts`).

**Classes:** `PascalCase`, `Klank` prefix on the public surface (`KlankBot`, `KlankClient`). Internal/companion classes drop the prefix (`WsManager`, `WebhookBot` — note `WebhookBot` is public but does NOT carry the `Klank` prefix; this is inconsistent).

**Methods and local variables:** `camelCase` (`getBotInfo`, `sendMessage`, `reconnectDelay`, `ticketFn`).

**Type/interface names:** `PascalCase` (`BotConfig`, `ServerEvent`, `MessageEvent`, `EventHandler`).

**Wire-format fields (interface members that mirror server JSON):** `snake_case` (`channel_id`, `message_id`, `sender_type`, `content_type`, `bot_id`, `workspace_id`, `created_at`). See `types.ts:17-122`. The SDK never camelCases these — it accepts the server's snake_case verbatim.

**SDK-shaped option fields:** `camelCase` (`threadId` in `KlankClient.sendMessage`'s options bag, `responseType` in `CommandContext.respond`, `reconnect` in `BotConfig`). This produces a hard split: incoming server data is `snake_case`, but SDK-authored options/contexts are `camelCase`. There is no helper that translates between the two — each call site does it inline (`thread_id: options?.threadId` in `client.ts:64`).

**Event names:** dotted strings (`message.new`, `reaction.added`, `command.invoked`) on the wire, but the SDK exposes a parallel `underscore_form` to user code (`message_new`, `reaction_added`). See "Event routing" below.

## Class vs Function Style

**Everything public is a class.** `KlankBot`, `KlankClient`, `WsManager`, `WebhookBot`. No factory functions, no functional builders.

**State is stored on `private` fields**, not closures. Example: `bot.ts:15-19` keeps `eventHandlers`, `commandHandlers`, `messageMatchers`, `middlewares`, `errorHandler` as private instance fields.

**Method chaining (`return this`)** is used for the registration API: `on()`, `command()`, `message()`, `use()`, `onError()` all return `this`. See `bot.ts:34-64`. `start()` and `stop()` do not chain.

**Arrow functions are used inside object literals** (the context builders in `bot.ts:177-204`) and as callbacks (`this.ws.onEvent((event) => this.handleEvent(event))` at `bot.ts:30`). Top-level helpers do not exist — there are no exported standalone functions anywhere in `src/`.

## Imports and Exports

**Import style:** ESM, no extensions. Type-only imports use `import type`:

```ts
// bot.ts:1-6
import { KlankClient } from './client'
import { WsManager } from './ws'
import type {
  BotConfig, BotContext, BotInfo, CommandContext, CommandEvent, CommandHandler,
  EventHandler, Message, MessageEvent, MessageHandler, Middleware, ServerEvent,
} from './types'
```

**Quote style:** single quotes throughout. No semicolons at line ends in most places (e.g. `bot.ts`, `client.ts`, `webhook.ts`, `ws.ts`, `types.ts`). The codebase is consistently semicolon-free. There is no Prettier or ESLint config to enforce this — it is convention by hand.

**Re-exports:** `index.ts` uses named re-exports plus `export type * from './types'` to forward every type at once. No default exports anywhere.

**Path aliases:** none. All imports are relative (`./client`, `./types`).

**Import order observed (not enforced):** external packages first (`ws` in `ws.ts:1`), then internal value imports, then `import type` blocks.

## Error Handling

**Every error is a raw `Error`.** There is no error class hierarchy, no error codes, no `cause` chaining.

Examples:
- `client.ts:38` — `throw new Error(`API error ${res.status}: ${err.message}`)`
- `webhook.ts:28` — `throw new Error(`Webhook error ${res.status}: ${err.message}`)`
- `bot.ts:179` — `throw new Error('No channel context')`
- `bot.ts:183` — `throw new Error('No message context')`

A consumer cannot distinguish a 401 from a 404 from a 500 from a "no channel context" programmer error without parsing the message string. There is no `KlankApiError`, no `KlankAuthError`, no `KlankRateLimitError`.

**Single global error handler.** `bot.ts:19,61-64`: `errorHandler` is a single nullable field, replaced by each `onError()` call. It is not an array — registering twice silently drops the first handler.

**Default error path:** if no handler is registered, `bot.ts:168` does `console.error('[bot] Handler error:', err)` and swallows.

**Silent swallowing in `WsManager`:** `ws.ts:46` — `} catch { /* ignore parse errors */ }` discards malformed frames with no log, no callback.

**Rate-limit retry has no cap.** `client.ts:25-29` reads `Retry-After`, sleeps, then `return this.fetch(path, options)` — recurses. No max retry count, no jitter, no surfacing to caller.

**Auth failures are not handled.** No 401 detection, no token-revoked path. The bot will keep retrying or throw a generic `API error 401`.

## Type Narrowing

The discriminated union `ServerEvent` (`types.ts:124-133`) is keyed by `type` and could be narrowed via `if (event.type === 'message.new')`. The code uses this discriminator manually, but **also** falls back to `as` casts:

```ts
// bot.ts:101
if (event.type === 'message.new' && (event as MessageEvent).sender_id === ...)

// bot.ts:145
const msgEvent = event as MessageEvent

// bot.ts:157
const cmdEvent = event as CommandEvent

// bot.ts:174-175
const channelId = 'channel_id' in event ? (event as any).channel_id : undefined
const messageId = 'message_id' in event ? (event as any).message_id : undefined
```

The `(event as any).channel_id` pattern in `buildContext` is the worst offender — it defeats the discriminated union entirely. A proper narrowing helper (`hasChannelId(event): event is ChannelScopedEvent`) does not exist.

**Public handler signature is untyped by default.** `EventHandler<E = ServerEvent>` (`types.ts:155`) defaults to the union, so consumer code receives the union and must narrow itself. There is no overload of `on()` that maps event-name strings to specific event types (i.e. no `on('message.new', handler)` → `handler: EventHandler<MessageEvent>` inference). This means every consumer writes `event.plaintext` and gets a TypeScript error unless they cast.

## Event Routing (the inconsistency to be aware of)

`KlankBot.handleEvent` in `bot.ts:98-171` uses **two parallel routing mechanisms**:

1. **Generic dotted-to-underscore mapper** (`bot.ts:120`):
   ```ts
   const eventType = event.type.replace('.', '_') // message.new -> message_new
   const handlers = this.eventHandlers.get(eventType) || []
   ```
   This is regular: `message.new` → `message_new`, `reaction.added` → `reaction_added`, etc. It works for every event type in the union.

2. **Hardcoded shorthand table** (`bot.ts:124-133`):
   ```ts
   const shorthands: Record<string, string> = {
     'message.new': 'message',
     'reaction.added': 'reaction_added',
     'reaction.removed': 'reaction_removed',
     'channel.member_joined': 'member_joined',
     'channel.member_left': 'member_left',
     'channel.created': 'channel_created',
     'presence.update': 'presence',
     'typing.start': 'typing',
   }
   ```
   This is a curated alias list so that `bot.on('message', ...)` works (as the example bot in `examples/echo-bot-ts/index.ts:9` does).

**Inconsistency:** the shorthand table is incomplete. It does NOT include:
- `message.updated`
- `message.deleted`
- `typing.stop`

These three event types only reach handlers via the generic underscore form (`message_updated`, `message_deleted`, `typing_stop`). A consumer writing `bot.on('message.updated', ...)` (the natural dotted form) gets nothing — neither path matches, because the generic mapper rewrites to `message_updated` and the shorthand table does not include `'message.updated'` as a key.

**Worse:** the shorthand for `reaction.added` maps to `reaction_added`, which is **the same string the generic mapper produces**. So `bot.on('reaction_added', ...)` gets the handler called twice — once via the generic path, once via the shorthand path appending to the same `handlers` array (`bot.ts:136`).

This is a bug-shaped convention. The consistent fix is to pick ONE routing scheme and document it.

## Async Style

**`async`/`await` everywhere.** No raw `.then()` chains except in `examples/echo-bot-ts/index.ts:36` (`bot.start().then(...)`).

**Handlers may be sync or async.** All handler types in `types.ts:155-158` are typed `=> Promise<void> | void`, and `bot.ts:140` always `await`s — so a sync handler is fine.

**Middleware chain is index-based** (`bot.ts:108-117`), not array-shifted. Each middleware receives `next` and is responsible for calling it.

## Logging

**`console.log` and `console.error` directly.** No logger abstraction, no log level, no structured logging.

- `bot.ts:69` — `console.log(`[bot] ${this.botInfo.name} starting ...`)`
- `bot.ts:72` — `console.log(`[bot] Connected to WebSocket`)`
- `bot.ts:82` — `console.log('[bot] Shutting down...')`
- `bot.ts:168` — `console.error('[bot] Handler error:', err)`

**Convention:** prefix `[bot]`. There is no `[client]` or `[ws]` prefix — only `bot.ts` logs.

## Comments and Documentation

**Single-line `/** ... */` JSDoc on every public method.** Examples in `bot.ts:33,41,47,54,60,66,80,86,91`. The JSDoc is one sentence, no `@param`/`@returns`, no examples.

**Section dividers** use `// ── Name ──` (em-dash style). See `bot.ts:96`, `client.ts:44,55,73,88`, `types.ts:1,15,54,135`. This is consistent across all files.

**Inline `// comment` for the awkward bits.** Notable:
- `bot.ts:120` — `// message.new -> message_new`
- `bot.ts:201` — `// Ephemeral responses are more complex — would need server support` (admits the dropped feature)
- `ws.ts:46` — `/* ignore parse errors */`

There is no TypeDoc setup, no generated API docs.

## Process and Lifecycle

**Process-level signal handlers registered in an instance method.** `bot.ts:75-77`:
```ts
const shutdown = () => this.stop()
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
```

This is an inconsistency with the otherwise instance-scoped design — running two `KlankBot`s in one process registers two handlers and only the first call `stop()`s itself cleanly. Convention should be: bots do not touch `process` directly; the host application owns signal handling.

## Function Design

**Method size:** small. `handleEvent` is the longest at 73 lines (`bot.ts:98-171`); everything else is under 20 lines.

**Parameters:** positional for required, single options bag for optional. Example: `client.sendMessage(channelId, text, options?: { threadId?: string })` at `client.ts:57`. The options bag uses camelCase keys.

**Return values:** explicit Promise types on every async method. No implicit `Promise<void>` — returns are typed.

## Module Design

**Exports:** named only. `index.ts` is the single barrel. No sub-paths exported (no `@klank/sdk/types`, no `@klank/sdk/client`).

**No barrel within `src/`** — `src/index.ts` is the only barrel and it lives at the package root of `src/`. Sub-folders do not exist.

**`exports` field in `package.json`** (`packages/sdk-typescript/package.json:8-14`) supports both `import` and `require` plus `types`, but only the root entry. There is no conditional `node` vs `browser` export.

## Summary: What's Consistent

- One class per file, lowercase filenames, types centralized in `types.ts`
- `Klank` prefix on `KlankBot` and `KlankClient` (but not `WebhookBot` or `WsManager`)
- Wire fields are `snake_case`, SDK-authored fields are `camelCase`
- Single quotes, no semicolons, ESM imports, type-only imports for types
- `async`/`await` end-to-end, handlers may be sync-or-async
- JSDoc one-liners on public methods, `// ── Section ──` dividers
- Method chaining on the registration API (`on`, `command`, `message`, `use`, `onError`)
- `console.log`/`console.error` with `[bot]` prefix

## Summary: What's Inconsistent (Decisions Pending)

1. **`Klank` prefix is partial.** `KlankBot`/`KlankClient` have it; `WebhookBot`/`WsManager` do not. Pick one rule.
2. **Event routing has two mechanisms** (generic mapper + hardcoded shorthand table) and the shorthand table is incomplete + collides with the generic form for `reaction.added`/`reaction.removed`. Pick one routing scheme.
3. **Type narrowing is mostly manual `as` casts**, including `as any` in `buildContext` (`bot.ts:174-175`). The discriminated union is not exploited; `on()` does not infer event type from the event-name string.
4. **All errors are raw `Error`.** No taxonomy, no codes, no `cause`. Consumers cannot distinguish error classes without parsing message strings.
5. **`onError` is single-handler-replace**, not additive. Conflicts with the chainable, additive feel of `on()`/`use()`.
6. **`WsManager` swallows parse errors silently** (`ws.ts:46`) and has no heartbeat, no jitter, no max retry.
7. **`KlankClient.fetch` recurses on 429 with no cap** (`client.ts:28`). Combined with no jitter, this is an infinite-loop hazard.
8. **`process.on('SIGINT'|'SIGTERM')` registered from inside `KlankBot.start`** (`bot.ts:75-77`). Multi-bot processes break.
9. **Semicolons are off by hand convention only** — no Prettier/ESLint to enforce. New contributors will introduce drift.
10. **`example/echo-bot-ts/index.ts` imports `'@klank/sdk'`** but there is no `package.json` for the example, so this is aspirational, not runnable.

---

*Convention analysis: 2026-04-07*
