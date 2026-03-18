# Klank Bot SDK

Build bots for [Klank](https://github.com/Aktiga/klank) with TypeScript or Rust. Framework with batteries: event listeners, command routing, message matching, middleware.

## Quick Start

### Install

```bash
npm install @klank/sdk
```

### Create a Bot

```typescript
import { KlankBot } from '@klank/sdk'

const bot = new KlankBot({
  token: process.env.BOT_TOKEN!,
  serverUrl: 'http://localhost:3000',
})

bot.on('message', async (event, ctx) => {
  if (event.plaintext?.includes('hello')) {
    await ctx.say('Hey there! 👋')
  }
})

bot.command('/status', async (cmd, ctx) => {
  await ctx.respond({ responseType: 'in_channel', text: 'All systems green ✅' })
})

await bot.start()
```

## Getting Started

### 1. Register Your Bot

First, register a bot in your Klank workspace:

```bash
curl -X POST http://localhost:3000/api/v1/workspaces/YOUR_WORKSPACE_ID/bots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_USER_JWT" \
  -d '{"name": "My Bot", "scopes": ["read", "write"]}'
```

Save the `api_token` from the response — it starts with `bot_` and is only shown once.

### 2. Create a Webhook (Optional)

If your bot needs to post messages without a WebSocket connection:

```bash
curl -X POST http://localhost:3000/api/v1/channels/CHANNEL_ID/webhooks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_USER_JWT" \
  -d '{"name": "My Webhook", "kind": "incoming"}'
```

### 3. Write Your Bot

```typescript
import { KlankBot } from '@klank/sdk'

const bot = new KlankBot({
  token: 'bot_your_token_here',
  serverUrl: 'http://localhost:3000',
})

// Listen for messages
bot.on('message', async (event, ctx) => {
  console.log(`${event.sender_id}: ${event.plaintext}`)
})

// Start listening
await bot.start()
```

### 4. Run It

```bash
BOT_TOKEN=bot_your_token npx tsx src/index.ts
```

## API Reference

### KlankBot

The main bot class. Connects via WebSocket and routes events to handlers.

```typescript
const bot = new KlankBot({
  token: string,          // Bot API token (bot_...)
  serverUrl: string,      // Klank server URL
  reconnect?: boolean,    // Auto-reconnect on disconnect (default: true)
})
```

#### Event Listeners

```typescript
bot.on('message', async (event, ctx) => { ... })
bot.on('reaction_added', async (event, ctx) => { ... })
bot.on('reaction_removed', async (event, ctx) => { ... })
bot.on('member_joined', async (event, ctx) => { ... })
bot.on('member_left', async (event, ctx) => { ... })
bot.on('channel_created', async (event, ctx) => { ... })
bot.on('presence', async (event, ctx) => { ... })
bot.on('typing', async (event, ctx) => { ... })
```

#### Slash Commands

```typescript
bot.command('/deploy', async (cmd, ctx) => {
  // cmd.text = everything after the command
  // cmd.userId, cmd.channelId, cmd.workspaceId
  await ctx.respond({ responseType: 'in_channel', text: 'Deploying...' })
})
```

#### Message Matching

```typescript
// String or RegExp — capture groups available
bot.message(/deploy\s+(.+)/, async (event, ctx, matches) => {
  const target = matches[1]
  await ctx.say(`Deploying ${target}...`)
})
```

#### Middleware

Runs before every handler. Call `next()` to continue.

```typescript
bot.use(async (event, ctx, next) => {
  const start = Date.now()
  await next()
  console.log(`Handled ${event.type} in ${Date.now() - start}ms`)
})
```

#### Context Object

Every handler receives a `ctx` with convenience methods:

| Method | Description |
|--------|-------------|
| `ctx.say(text)` | Send message to the event's channel |
| `ctx.reply(text)` | Reply in thread of the triggering message |
| `ctx.react(emoji)` | React to the triggering message |
| `ctx.sendMessage(channelId, text)` | Send to any channel |

#### Lifecycle

```typescript
await bot.start()    // Connect WS, start listening
bot.stop()           // Disconnect, cleanup

bot.onError((err) => {
  console.error('Handler error:', err)
})
```

### WebhookBot

Simpler bot that just posts messages via incoming webhook. No WebSocket needed.

```typescript
import { WebhookBot } from '@klank/sdk'

const bot = new WebhookBot({
  webhookId: 'uuid-here',
  webhookSecret: 'secret-here',
  serverUrl: 'http://localhost:3000',
})

await bot.send('Build #42 passed! ✅')
await bot.send('Deploy failed ❌', { username: 'CI Bot' })
```

### KlankClient

Low-level typed REST client for direct API access:

```typescript
import { KlankClient } from '@klank/sdk'

const client = new KlankClient('http://localhost:3000', 'bot_token')

// Bot info
const info = await client.getBotInfo()

// Messages
const msg = await client.sendMessage(channelId, 'Hello!')
const history = await client.getMessages(channelId, 50)

// Reactions
await client.addReaction(messageId, '🎉')
await client.removeReaction(messageId, '🎉')

// Channels
const channels = await client.listChannels(workspaceId)
const channel = await client.getChannel(channelId)
```

## Examples

### Echo Bot

Echoes every message back and reacts to greetings:

```typescript
const bot = new KlankBot({ token, serverUrl })

bot.on('message', async (event, ctx) => {
  if (event.plaintext) {
    await ctx.say(`Echo: ${event.plaintext}`)
  }
})

bot.message(/hello|hi|hey/i, async (event, ctx) => {
  await ctx.react('👋')
})

await bot.start()
```

### CI Notification Bot

Posts build results via webhook:

```typescript
const bot = new WebhookBot({ webhookId, webhookSecret, serverUrl })

// Call this from your CI pipeline
async function notifyBuild(status: 'pass' | 'fail', buildNum: number) {
  const emoji = status === 'pass' ? '✅' : '❌'
  await bot.send(`Build #${buildNum} ${status} ${emoji}`)
}
```

### Scheduled Status Bot

Responds to /status and posts periodic updates:

```typescript
const bot = new KlankBot({ token, serverUrl })

bot.command('/status', async (cmd, ctx) => {
  const uptime = process.uptime()
  await ctx.respond({
    responseType: 'ephemeral',
    text: `Bot uptime: ${Math.floor(uptime / 60)} minutes`
  })
})

await bot.start()
```

## Bot Messages & E2EE

Bot messages are **plaintext** — they are NOT end-to-end encrypted. Bot messages are stored with `sender_type: "bot"` and `content_type: "plaintext"`. They appear in channels alongside encrypted user messages, clearly marked with a "BOT" badge.

## Supported Events

| Server Event | SDK Handler | Description |
|-------------|-------------|-------------|
| `message.new` | `bot.on('message')` | New message in a channel |
| `message.updated` | `bot.on('message_updated')` | Message was edited |
| `message.deleted` | `bot.on('message_deleted')` | Message was deleted |
| `reaction.added` | `bot.on('reaction_added')` | Reaction added to message |
| `reaction.removed` | `bot.on('reaction_removed')` | Reaction removed |
| `typing.start` | `bot.on('typing')` | User started typing |
| `channel.created` | `bot.on('channel_created')` | New channel created |
| `channel.member_joined` | `bot.on('member_joined')` | User joined channel |
| `channel.member_left` | `bot.on('member_left')` | User left channel |
| `presence.update` | `bot.on('presence')` | User presence changed |

E2EE key events (`keys.*`) are not exposed to bots.

## Server Compatibility

Requires [Klank](https://github.com/Aktiga/klank) server with bot support (commit `d7c956c` or later).

## License

MIT
