# Deploying bots

Two shapes of bot, two deployment stories.

- **Webhook posters** (`WebhookBot`) run on demand: a CI step, a cron job, a Lambda. Nothing to keep alive.
- **Event bots** (`KlankBot`) hold a WebSocket and must stay running. Note that events do not reach bots on Klank `53d464a` — see [server-requirements.md](server-requirements.md) — so a long-running bot has nothing to react to yet.

## Environment variables

The SDK reads no environment variables itself; these are the names the examples and snippets use.

| Variable | Used by | Description |
|---|---|---|
| `SERVER_URL` | both | Klank server origin, e.g. `https://chat.example.com`. |
| `BOT_TOKEN` | `KlankBot`, `KlankClient` | Bot API token (`bot_` + 64 hex), shown once at creation. |
| `WEBHOOK_ID` | `WebhookBot` | Incoming webhook UUID. |
| `WEBHOOK_SECRET` | `WebhookBot` | Raw webhook secret, shown once at creation. |
| `SLASH_SIGNING_SECRET` | slash receivers | Per-command signing secret configured on the server side. |

Pass tokens as secrets (Docker secrets, `fly secrets set`, systemd `EnvironmentFile` with mode 0600), never in an image layer or a committed compose file.

## Docker

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "dist/index.js"]
```

```bash
docker run -d --name my-bot --restart unless-stopped \
  -e SERVER_URL=http://klank-server:3000 \
  -e BOT_TOKEN=bot_xxx \
  my-bot
```

Docker sends `SIGTERM` on `docker stop`, so wire up shutdown (below) or the container waits out the 10 s grace period on every deploy.

## Systemd

```ini
[Unit]
Description=My Klank Bot
After=network-online.target

[Service]
Type=simple
User=bot
WorkingDirectory=/opt/my-bot
ExecStart=/usr/bin/node dist/index.js
EnvironmentFile=/etc/my-bot.env
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

A process manager such as PM2 works the same way; the SDK does not care.

## Shutdown

`KlankBot` installs no signal handlers by default. The host process decides when to stop:

```ts
process.on('SIGTERM', () => bot.stop())
process.on('SIGINT', () => bot.stop())
```

`stop()` disables reconnect and closes the socket, so the process exits once the event loop drains. For a single-bot process, `handleSignals: true` installs exactly those two handlers for you:

```ts
const bot = new KlankBot({ token, serverUrl, handleSignals: true })
```

Leave it `false` when the process owns other resources (an HTTP server, a database pool) or runs more than one bot — you want one shutdown path, not several racing ones.

## Serverless

`WebhookBot` fits a function runtime: construct it per invocation, `await send(...)`, return. `KlankBot` does not — a WebSocket cannot survive a frozen function instance.

A slash command receiver is a plain HTTP handler and deploys anywhere, as long as the Klank server can reach its URL and it answers within 5 seconds. Verify the signature against the raw request body; frameworks that parse JSON for you will break the HMAC (see [security.md](security.md)).

## Reconnects and gaps

With `reconnect: true` (the default) the socket retries with jittered exponential backoff from `baseDelayMs` up to `maxDelayMs`, fetching a fresh single-use ticket each attempt. After `maxAttempts` consecutive failures the SDK reports a `ConnectionError` to `onError` and stops — let the supervisor restart the process rather than retrying forever in place.

While disconnected, events are lost: the server has no replay. On reconnect, or on an `events.missed` event, re-fetch state over REST instead of trusting anything cached.

## Health checks

The SDK exposes no health endpoint. If your platform needs one, add a socket of your own:

```ts
import { createServer } from 'node:http'

createServer((_req, res) => {
  res.writeHead(bot.getBotInfo() ? 200 : 503).end()
}).listen(8080)
```

## Logging

The SDK logs nothing. Route errors yourself:

```ts
bot.onError((err, event) => console.error('[bot]', event?.type ?? 'connection', err))
```

`KlankError` instances carry `code`, `status`, and the server's `body`; log those fields rather than the whole object, which can contain message text.

## Network requirements

- Outbound HTTP(S) to the Klank server; the WebSocket runs on the same origin and port as the REST API.
- No inbound ports for an event bot or a webhook poster.
- Inbound HTTPS only if you host a slash command receiver.
