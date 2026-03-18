# Getting Started

Build your first Klank bot in 5 minutes.

## Prerequisites

- A running [Klank](https://github.com/Aktiga/klank) server
- A registered bot with an API token (see below)
- Node.js 22+ (for TypeScript) or Rust 1.94+ (for Rust)

## Register a Bot

You need a user account first. Then register a bot in your workspace:

```bash
# Register (if you don't have an account)
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password","display_name":"You"}'

# Save the access_token from the response, then:
curl -X POST http://localhost:3000/api/v1/workspaces/YOUR_WORKSPACE_ID/bots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{"name":"My Bot","scopes":["read","write"]}'
```

Save the `api_token` — it starts with `bot_` and is only shown once.

## TypeScript Bot

### 1. Create project

```bash
mkdir my-bot && cd my-bot
npm init -y
npm install @klank/sdk
npm install -D typescript tsx
```

### 2. Write the bot

Create `src/index.ts`:

```typescript
import { KlankBot } from '@klank/sdk'

const bot = new KlankBot({
  token: process.env.BOT_TOKEN!,
  serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
})

bot.on('message', async (event, ctx) => {
  if (event.plaintext?.includes('hello')) {
    await ctx.say('Hey there! 👋')
    await ctx.react('👋')
  }
})

bot.command('/ping', async (cmd, ctx) => {
  await ctx.respond({ responseType: 'in_channel', text: 'Pong! 🏓' })
})

await bot.start()
console.log('Bot is running!')
```

### 3. Run it

```bash
BOT_TOKEN=bot_your_token SERVER_URL=http://localhost:3000 npx tsx src/index.ts
```

## Rust Bot

### 1. Create project

```bash
cargo init my-bot
cd my-bot
```

Add to `Cargo.toml`:
```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "rustls-tls"] }
tokio-tungstenite = { version = "0.28", features = ["rustls-tls-webpki-roots"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
futures-util = "0.3"
```

### 2. Write the bot

See `examples/echo-bot-rust/src/main.rs` for a complete example that:
- Connects via WebSocket with ticket-based auth
- Listens for messages
- Echoes them back

### 3. Run it

```bash
BOT_TOKEN=bot_your_token SERVER_URL=http://localhost:3000 cargo run
```

## Webhook-Only Bot

If you just need to post messages (no event listening):

```typescript
import { WebhookBot } from '@klank/sdk'

const bot = new WebhookBot({
  webhookId: process.env.WEBHOOK_ID!,
  webhookSecret: process.env.WEBHOOK_SECRET!,
  serverUrl: 'http://localhost:3000',
})

await bot.send('Hello from my bot! 🤖')
```

No WebSocket, no event loop — just POST and done. Perfect for CI/CD.

## Next Steps

- See [examples/](../examples/) for complete working bots
- See [Deploying Bots](deploying-bots.md) for production deployment
- See the [README](../README.md) for full API reference
