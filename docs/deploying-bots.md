# Deploying Bots

Your bot needs to stay running to listen for events. Here are deployment options for both TypeScript and Rust bots.

## TypeScript Bots

### Option 1: Docker (Recommended)

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
CMD ["node", "dist/index.js"]
```

```bash
docker build -t my-bot .
docker run -d \
  -e BOT_TOKEN=bot_xxx \
  -e SERVER_URL=http://klank-server:3000 \
  --name my-bot \
  --restart unless-stopped \
  my-bot
```

Add to your `docker-compose.yml` alongside the Klank server:

```yaml
services:
  my-bot:
    build: ./my-bot
    environment:
      BOT_TOKEN: bot_xxx
      SERVER_URL: http://server:3000
    depends_on:
      - server
    restart: unless-stopped
```

### Option 2: Process Manager (PM2)

```bash
npm install -g pm2
pm2 start dist/index.js --name my-bot
pm2 save
pm2 startup  # Auto-start on reboot
```

### Option 3: Systemd Service

```ini
# /etc/systemd/system/my-bot.service
[Unit]
Description=My Klank Bot
After=network.target

[Service]
Type=simple
User=bot
WorkingDirectory=/opt/my-bot
ExecStart=/usr/bin/node dist/index.js
Environment=BOT_TOKEN=bot_xxx
Environment=SERVER_URL=http://localhost:3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable my-bot
sudo systemctl start my-bot
```

### Option 4: Cloud Functions (Webhook-Only)

For `WebhookBot` (no WebSocket), you can use serverless:

- **AWS Lambda** + API Gateway trigger
- **Google Cloud Functions**
- **Vercel Edge Functions**

These only work for webhook-based bots that POST messages in response to external events (CI, monitoring). They can't listen for Klank events.

## Rust Bots

### Option 1: Docker

```dockerfile
FROM rust:1.94 AS builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/my-bot /usr/local/bin/my-bot
CMD ["my-bot"]
```

```bash
docker build -t my-bot .
docker run -d \
  -e BOT_TOKEN=bot_xxx \
  -e SERVER_URL=http://klank-server:3000 \
  --name my-bot \
  --restart unless-stopped \
  my-bot
```

### Option 2: Pre-built Binary

```bash
cargo build --release
scp target/release/my-bot user@server:/opt/my-bot/

# On the server:
BOT_TOKEN=bot_xxx SERVER_URL=http://localhost:3000 /opt/my-bot/my-bot
```

Use systemd (same pattern as TS above) for auto-restart.

### Option 3: Fly.io

```toml
# fly.toml
app = "my-klank-bot"

[build]
  dockerfile = "Dockerfile"

[env]
  SERVER_URL = "https://your-klank.example.com"

# Set BOT_TOKEN as a secret:
# fly secrets set BOT_TOKEN=bot_xxx
```

```bash
fly deploy
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BOT_TOKEN` | Yes (WS bots) | Bot API token from registration (`bot_...`) |
| `SERVER_URL` | Yes | Klank server URL (e.g., `http://localhost:3000`) |
| `WEBHOOK_ID` | For webhooks | Incoming webhook UUID |
| `WEBHOOK_SECRET` | For webhooks | Webhook secret |

## Monitoring

### Health Checks

Add a health check to your bot:

```typescript
import { createServer } from 'http'

// Simple health endpoint
createServer((req, res) => {
  res.writeHead(200)
  res.end('ok')
}).listen(8080)
```

Docker health check:
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8080"]
  interval: 30s
  timeout: 5s
  retries: 3
```

### Logging

The SDK logs to console by default. In production, pipe to your log aggregator:

```bash
docker logs my-bot 2>&1 | tee /var/log/my-bot.log
```

## Network Requirements

- Bot must be able to reach the Klank server via HTTP/HTTPS
- WebSocket connection on the same port as the REST API
- No inbound ports needed (bot connects outbound to server)
- If using slash commands without WebSocket, the server needs to reach the bot's HTTP endpoint
