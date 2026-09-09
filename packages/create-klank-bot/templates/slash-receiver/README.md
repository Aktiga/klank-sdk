# __NAME__

An HTTP endpoint for a Klank slash command. It verifies the
`X-Klank-Signature` HMAC over the raw request bytes with
[`@klank/sdk`](https://www.npmjs.com/package/@klank/sdk), parses the payload,
and answers `{ "response_type": "in_channel", "text": "echo: …" }`.

`src/index.ts` exports `createHandler(signingSecret)` — a plain
`node:http` request listener — and starts a server when run directly.

## Environment

| Variable | What it is |
|---|---|
| `SLASH_SIGNING_SECRET` | Signing secret Klank uses for this command's dispatches. |
| `PORT` | Port to listen on. Default `8080`. |

```bash
cp .env.example .env
npm install
npm start
```

`npm start` uses `tsx`, which does not read `.env` for you. Either export the
variables (`set -a; . ./.env; set +a`) or run Node 20.6+ with
`node --env-file=.env --import tsx src/index.ts`.

## The dispatch contract

Klank posts to the URL configured for the command:

```
POST <your url>
content-type: application/json
x-klank-signature: sha256=<hex hmac_sha256(signing_secret, raw_body)>

{"command":"/echo","text":"hi","user_id":"…","channel_id":"…","workspace_id":"…"}
```

You must answer 2xx JSON `{ "response_type": "ephemeral" | "in_channel", "text": "…" }`
within 5 seconds. `in_channel` is the only value with a delivery path: the
server has no per-user channel for ephemeral replies.

Verify against the bytes received. The server signs compact serde JSON, so
re-encoding the parsed body breaks the match — never verify against
`JSON.stringify(req.body)`. With Express, mount
`express.raw({ type: 'application/json' })` on the route so `req.body` stays a
`Buffer`.

## Status

`verifySlashCommandSignature` and `parseSlashCommandPayload` implement the
server's dispatch contract, which exists in the server but has no caller yet:
there is no command registration route or UI, so nothing invokes your endpoint
until that lands. Details in
[server-requirements.md](https://github.com/Aktiga/klank-sdk/blob/main/docs/server-requirements.md).

Meanwhile, exercise it yourself:

```bash
BODY='{"command":"/echo","text":"hi","user_id":"u","channel_id":"c","workspace_id":"w"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SLASH_SIGNING_SECRET" -hex | awk '{print $2}')
curl -sS -X POST http://127.0.0.1:8080/slash \
  -H 'content-type: application/json' \
  -H "x-klank-signature: sha256=$SIG" \
  -d "$BODY"
```

## Test

```bash
npm test
```

`test/bot.test.ts` runs the handler on a real server and checks a signed body
(200 JSON), an unsigned body (401), a wrong-secret signature (401), and a
signed body with missing fields (400).
