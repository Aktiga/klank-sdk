# __NAME__

A long-running Klank bot built on [`@klank/sdk`](https://www.npmjs.com/package/@klank/sdk).
It connects over the WebSocket, replies `echo: <text>` to every message it can
read, logs errors through `bot.onError`, and stops cleanly on `SIGTERM`.

`src/index.ts` exports `createBot(config)` and starts a bot when run directly.

## Status

Against Klank `53d464a` (2026-04-30) this bot connects but receives nothing:
the server accepts bot tokens on two routes and has no channel-membership
model for bots, so most of the interactive surface cannot do anything yet.
Details in
[server-requirements.md](https://github.com/Aktiga/klank-sdk/blob/main/docs/server-requirements.md).

Running it needs a server with the bot-model work: bot channel membership
(so events arrive and `ctx.say` is allowed) and bot tokens accepted on the
message routes. Until then, `webhook-poster` is the template that works.

## Environment

| Variable | What it is |
|---|---|
| `SERVER_URL` | Server origin, e.g. `https://chat.example.com`. |
| `BOT_TOKEN` | Bot API token (`bot_` + 64 hex chars), shown once at creation. |

```bash
cp .env.example .env
npm install
npm start
```

`npm start` uses `tsx`, which does not read `.env` for you. Either export the
variables (`set -a; . ./.env; set +a`) or run Node 20.6+ with
`node --env-file=.env --import tsx src/index.ts`.

## Register the bot

With a user JWT for a workspace owner or admin:

```bash
curl -X POST "$SERVER_URL/api/v1/workspaces/$WORKSPACE_ID/bots" \
  -H "Authorization: Bearer $USER_JWT" \
  -H 'content-type: application/json' \
  -d '{"name":"echo","scopes":["read","write"]}'
```

The response's `api_token` is shown exactly once; the server stores only its
SHA-256. Copy it into `BOT_TOKEN`. There is no rotation endpoint: delete the
bot with `DELETE /api/v1/workspaces/$WORKSPACE_ID/bots/$BOT_ID` and create a
new one. The bot then has to be added to each channel it should listen in.

Bots post plaintext (`content_type: "plaintext"`). A channel with an active key
epoch rejects that with 400, surfaced as `E2EEChannelError`.

## Test

```bash
npm test
```

`test/bot.test.ts` runs the bot against `MockKlank` from `@klank/sdk/testing` —
a real local HTTP + WebSocket server — and asserts the echo reply is posted to
the right channel.
