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

This does not work against Klank `53d464a` yet, and the reason is server-side, not a configuration mistake: a bot token authenticates (`start()` succeeds and the socket opens) but bots cannot be channel members, so the server sends them no channel events, and the channel/message/reaction REST routes reject bot tokens with 401. `bot.command()` is in the same position — the server never emits `command.invoked`. The required server work is tracked in [server-requirements.md](server-requirements.md).

Slash commands take the other route: Klank POSTs a signed body to a URL you host, and the SDK verifies it — `verifySlashCommandSignature` plus `parseSlashCommandPayload`, with the recipe in [the SDK README](../packages/sdk/README.md#slash-commands-http). Write that receiver now if you like, but nothing will call it yet: the server has the dispatch code and no way to register a command against it.

## Next steps

- [packages/sdk/README.md](../packages/sdk/README.md) — full API reference and the per-surface status table.
- [examples/](../examples/) — runnable bots. `examples/community/echo-bot-rust` is a hand-rolled Rust example against the wire protocol, not a supported SDK.
- [deploying-bots.md](deploying-bots.md) — keeping a bot process alive.
