# Getting started

Post your first message into Klank from Node.

## Prerequisites

- A running [Klank](https://github.com/Aktiga/klank) server. Examples below use `http://localhost:3000`.
- Node 20+ and a user account with workspace `owner` or `admin` role — bot and webhook creation both require it.

## 1. Get a user token

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}'
```

Use `POST /api/v1/auth/register` with `{"email","password","display_name"}` if you have no account yet. Either way, keep the `access_token` from the response; it is the `USER_JWT` below.

## 2. Register a bot

```bash
curl -X POST http://localhost:3000/api/v1/workspaces/WORKSPACE_ID/bots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_JWT" \
  -d '{"name":"My Bot","scopes":["read","write"]}'
```

The response's `api_token` starts with `bot_` and is **returned exactly once** — the server keeps only its SHA-256 hash, and there is no rotation endpoint. Store it now; to replace it, delete the bot (`DELETE /api/v1/workspaces/WORKSPACE_ID/bots/BOT_ID`) and create another.

## 3. Create an incoming webhook

```bash
curl -X POST http://localhost:3000/api/v1/channels/CHANNEL_ID/webhooks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_JWT" \
  -d '{"name":"My Webhook","kind":"incoming"}'
```

The response's `secret` is also returned exactly once, and the server stores only its SHA-256. Keep it with the webhook `id`.

## 4. Post a message

```bash
mkdir my-bot && cd my-bot
npm init -y
npm pkg set type=module
npm install @klank/sdk
npm install -D tsx typescript
```

`index.ts`:

```ts
import { WebhookBot } from '@klank/sdk'

const bot = new WebhookBot({
  serverUrl: process.env.SERVER_URL ?? 'http://localhost:3000',
  webhookId: process.env.WEBHOOK_ID!,
  webhookSecret: process.env.WEBHOOK_SECRET!,
})

const message = await bot.send('Hello from my bot 🤖')
console.log('posted', message.id, 'to', message.channel_id)
```

```bash
WEBHOOK_ID=… WEBHOOK_SECRET=… npx tsx index.ts
```

`send` signs the exact request body with HMAC-SHA256 and sends the secret alongside it; see [security.md](security.md). It resolves with the created `Message`. If the channel has an active end-to-end-encryption key epoch, the server rejects plaintext and the SDK throws `E2EEChannelError` — bots cannot post into encrypted channels.

That is the whole working path today: no WebSocket, no event loop. It suits CI, alerting, and cron jobs.

## 5. Listening for events

`KlankBot` connects a WebSocket, keeps a fresh single-use ticket per connect, and routes typed events:

```ts
import { KlankBot } from '@klank/sdk'

const bot = new KlankBot({
  token: process.env.BOT_TOKEN!,
  serverUrl: process.env.SERVER_URL ?? 'http://localhost:3000',
})

bot.on('message.new', async (event, ctx) => {
  if (event.plaintext?.includes('hello')) await ctx.say('Hey there 👋')
})

bot.onError((err, event) => console.error('[bot]', event?.type, err))

await bot.start()
```

Delivery requires a server with the bot-model work (see the [status table](../packages/sdk/README.md#status)); against Klank `53d464a` nothing arrives, and the reason is server-side, not a configuration mistake: a bot token authenticates (`start()` succeeds and the socket opens) but bots cannot be channel members, so the server sends them no channel events, and the channel/message/reaction REST routes reject bot tokens with 401. The branches that close this are listed in [server-requirements.md](server-requirements.md).

On a server that has that work, a bot only receives a channel's events once it is a member of that channel. A channel member who is a channel admin or a workspace owner/admin adds it with their own user JWT (never for DMs):

```bash
curl -X POST "$SERVER_URL/api/v1/channels/$CHANNEL_ID/bots" \
  -H "Authorization: Bearer $USER_JWT" \
  -H 'Content-Type: application/json' \
  -d "{\"bot_id\":\"$BOT_ID\"}"
```

Slash commands are registered against the bot the same way, by a workspace owner or admin; the response carries the `signing_secret` once and never again:

```bash
curl -X POST "$SERVER_URL/api/v1/workspaces/$WORKSPACE_ID/slash-commands" \
  -H "Authorization: Bearer $USER_JWT" \
  -H 'Content-Type: application/json' \
  -d "{\"command\":\"/echo\",\"description\":\"Echo the text back\",\"bot_id\":\"$BOT_ID\",\"url\":\"https://bot.example.com/slash\"}"
```

A member then invokes it with `POST /api/v1/channels/{channelId}/commands` `{"command":"/echo","text":"hi"}`. Klank delivers the invocation as a `command.invoked` event over the bot's WebSocket when the bot is connected, and POSTs a signed body to the registered `url` when it is not — the SDK verifies that POST with `verifySlashCommandSignature` plus `parseSlashCommandPayload`, with the recipe in [the SDK README](../packages/sdk/README.md#slash-commands-http). Over the WebSocket the bot posts its own reply, so it must be a member of the channel; on the HTTP path the server posts the `in_channel` reply itself. On `53d464a` there is no registration route at all, so neither path fires yet.

## Next steps

- [packages/sdk/README.md](../packages/sdk/README.md) — full API reference and the per-surface status table.
- [examples/](../examples/) — runnable bots. `examples/community/echo-bot-rust` is a hand-rolled Rust example against the wire protocol, not a supported SDK.
- [deploying-bots.md](deploying-bots.md) — keeping a bot process alive.
