# __NAME__

Posts messages into one Klank channel through an incoming webhook, using
[`@klank/sdk`](https://www.npmjs.com/package/@klank/sdk). No bot token and no
WebSocket: one signed `POST` per message. This is the path that works against
today's Klank server.

`src/index.ts` exports `notify(text)` and, when run directly, posts its
arguments as one message.

## Environment

| Variable | What it is |
|---|---|
| `SERVER_URL` | Server origin, e.g. `https://chat.example.com`. |
| `WEBHOOK_ID` | Webhook UUID from the create response. |
| `WEBHOOK_SECRET` | Raw webhook secret (48 hex chars) from the create response. |

```bash
cp .env.example .env
npm install
npm start "Build #42 passed"
```

`npm start` uses `tsx`, which does not read `.env` for you. Either export the
variables (`set -a; . ./.env; set +a`) or run Node 20.6+ with
`node --env-file=.env --import tsx src/index.ts`.

## Create the webhook

With a user JWT for a workspace owner or admin (webhooks belong to a channel):

```bash
curl -X POST "$SERVER_URL/api/v1/channels/$CHANNEL_ID/webhooks" \
  -H "Authorization: Bearer $USER_JWT" \
  -H 'content-type: application/json' \
  -d '{"name":"CI","kind":"incoming"}'
```

The response's `secret` is returned exactly once; the server stores only its
SHA-256. Copy it into `WEBHOOK_SECRET` and the response `id` into `WEBHOOK_ID`.

## How the request is authenticated

`WebhookBot.send` posts `POST /api/v1/webhooks/{WEBHOOK_ID}/incoming` with
`X-Klank-Webhook-Key` (the raw secret) and `X-Klank-Signature`
(`sha256=<hex hmac_sha256(secret, body)>`) over the exact bytes it sends.

Channels with an active key epoch reject plaintext: `send` throws
`E2EEChannelError`. A wrong or missing secret throws `WebhookAuthError`.

## Test

```bash
npm test
```

`test/bot.test.ts` runs a real HTTP server on port 0, checks both auth headers
against an HMAC it computes itself over the received bytes, and asserts
`notify` resolves with the created message.
