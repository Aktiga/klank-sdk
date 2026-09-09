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
within 5 seconds. On this HTTP dispatch path the server hands your reply back to
the invoker in the body of its own `200`
(`{ "delivery": "http", "response": { … }, "posted": false }`), so an `ephemeral`
reply does reach the caller. `in_channel` is additionally posted into the channel
as a message — unless the channel has an active key epoch, where plaintext is
refused and `posted` stays `false`.

Verify against the bytes received. The server signs compact serde JSON, so
re-encoding the parsed body breaks the match — never verify against
`JSON.stringify(req.body)`. With Express, mount
`express.raw({ type: 'application/json' })` on the route so `req.body` stays a
`Buffer`.

## Status

`verifySlashCommandSignature` and `parseSlashCommandPayload` implement the
server's dispatch contract. Command registration lands with the server
bot-model work, [Aktiga/klank PR #6](https://github.com/Aktiga/klank/pull/6)
(`feat/bot-model`); on a server without it there is no route to point a command
at this endpoint. Details in
[server-requirements.md](https://github.com/Aktiga/klank-sdk/blob/main/docs/server-requirements.md).

## Point a command at this receiver

With a user JWT for a workspace owner or admin. The response carries the
`signing_secret` once and never again — copy it into `SLASH_SIGNING_SECRET`:

```bash
curl -X POST "$SERVER_URL/api/v1/workspaces/$WORKSPACE_ID/slash-commands" \
  -H "Authorization: Bearer $USER_JWT" \
  -H 'content-type: application/json' \
  -d '{"command":"/echo","url":"https://<your host>/slash"}'
```

A member then invokes it with `POST /api/v1/channels/$CHANNEL_ID/commands`
`{"command":"/echo","text":"hi"}`, and Klank posts the signed body above to your
`url`. Add `"bot_id"` to the registration to deliver over a connected bot's
WebSocket instead, with this HTTP dispatch as the fallback.

To exercise the endpoint without a server:

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
