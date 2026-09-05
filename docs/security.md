# Security

How Klank authenticates bot traffic, what the signatures do and do not prove, and what the SDK keeps out of your logs. Verified against [Aktiga/klank](https://github.com/Aktiga/klank) `53d464a` (2026-04-30).

## Two signed directions

| | Incoming webhook | Slash command dispatch |
|---|---|---|
| Direction | your bot → Klank | Klank → your bot |
| Route | `POST /api/v1/webhooks/{id}/incoming` | `POST <your url>` |
| Raw secret sent | yes, `X-Klank-Webhook-Key` | no, both sides already hold it |
| Signature | `X-Klank-Signature: sha256=<hex>` | `x-klank-signature: sha256=<hex>` |
| Signed over | exact raw request body bytes | exact raw request body bytes |
| Replay protection | none | none |

Both signatures are HMAC-SHA256, hex-encoded **lowercase**, prefixed `sha256=`. Neither includes a timestamp or a nonce.

## Incoming webhooks (bot → Klank)

`WebhookBot.send` sends:

```
POST /api/v1/webhooks/{webhookId}/incoming
Content-Type: application/json
X-Klank-Webhook-Key: <raw webhook secret>
X-Klank-Signature: sha256=<hex hmac_sha256(raw_secret, body)>

{"text":"…","username":"…"}
```

The body carries no secret field. The server:

1. Looks up the webhook, rejecting a non-incoming webhook with 400 `This is not an incoming webhook`.
2. Compares `sha256(provided_key)` against the stored `secret_hash` in constant time; mismatch is 401 `Invalid webhook secret`.
3. Strips the `sha256=` prefix (401 `Bad signature format`), hex-decodes it (401 `Bad signature hex`).
4. Recomputes the HMAC over the raw body and compares; mismatch is 401 `Invalid signature`.

Missing headers are 401 `Missing X-Klank-Webhook-Key header` / `Missing X-Klank-Signature header`. The SDK maps every 401 on this route to `WebhookAuthError`.

**Sign the exact bytes you send.** The HMAC covers the raw body, not a canonical form: serialize once, sign that string, POST that string. Re-serializing between signing and sending — a JSON round-trip, a proxy that reformats, a logging middleware that rewrites the body — invalidates the signature. `signWebhookBody(secret, body)` is exported if you need to sign a body you assembled yourself.

Known-good vector, useful for debugging a mismatch:

```
secret: s3cr3t
body:   {"hello":"world"}
X-Klank-Signature: sha256=c5ea6542cb731d59005472d10164434c5b64ae51f6372f72447e46d1536492ee
```

## Slash commands (Klank → bot)

Klank POSTs compact JSON with `x-klank-signature`. Verify before doing anything else:

```ts
const header = req.headers['x-klank-signature']
const ok = verifySlashCommandSignature({
  rawBody, // Buffer or string of the untouched request body
  signatureHeader: Array.isArray(header) ? header[0] : header,
  signingSecret,
})
if (!ok) return res.writeHead(401).end()
```

`verifySlashCommandSignature` returns `false` — never throws — for a missing header, a header without the `sha256=` prefix, a wrong-length or non-hex digest, and a genuine mismatch. Only reject; do not report which check failed.

The server signs its own serialization: compact JSON, no whitespace, fields in declaration order. Verify against the bytes you received. In Express, that means `express.raw({ type: 'application/json' })` on the route so `req.body` is a `Buffer`; verifying `JSON.stringify(req.body)` after `express.json()` will fail even when the request is genuine, and worse, may pass on a body you did not receive. Answer within 5 seconds; Klank times the request out and treats any non-2xx as an error.

Known-good vector:

```
signing_secret: super-secret-32-bytes-of-entropy
body:           {"command":"/echo","text":"hi","user_id":"00000000-0000-0000-0000-000000000000","channel_id":"00000000-0000-0000-0000-000000000000","workspace_id":"00000000-0000-0000-0000-000000000000"}
x-klank-signature: sha256=a8d6ef56cbb2a3c7071ec4aada44b499347053d291580b8500bc042b24fea42c
```

## Constant-time comparison

Digest comparison in the SDK uses `crypto.timingSafeEqual`, after length and character-class checks that depend only on the attacker-supplied header. The server compares the webhook secret hash and the HMAC in constant time too. If you write your own verifier, do the same: `a === b` on hex strings leaks how far a forged digest matched.

## No replay protection

Neither direction includes a timestamp or nonce, so a captured request replays indefinitely: the same `(key, signature, body)` triple posts the same message again, and a captured slash dispatch can be re-delivered to your endpoint. The signature proves body integrity and possession of the secret; it proves nothing about freshness.

Until the protocol gains a timestamp (tracked in [server-requirements.md](server-requirements.md)):

- Use HTTPS everywhere. Over plaintext HTTP, `X-Klank-Webhook-Key` is the secret itself, in the clear, on every request.
- Restrict who can reach the endpoints. Allowlist your Klank server's egress addresses on a slash command receiver; keep webhook secrets out of anything that can be read by a wider audience than the channel they post to.
- Treat a webhook secret as a channel-write capability. Anyone holding it can post as that webhook, and the messages are attributed to it.
- Make command handlers idempotent, or at least harmless to run twice.

## Bot tokens

A bot token is `bot_` + 64 hex characters, returned exactly once from `POST /api/v1/workspaces/{wid}/bots`. The server stores only its SHA-256, so a lost token cannot be recovered and there is no rotation endpoint: delete the bot with `DELETE /api/v1/workspaces/{wid}/bots/{bid}` and create a new one, then update the deployment. Deleting the bot invalidates the token immediately; subsequent requests get 401 (`AuthError`).

Webhook secrets have the same one-shot model, and `53d464a` has no webhook delete or rotate route at all — rotating one means creating a replacement webhook and retiring the old channel binding.

Bot scopes (`["read","write"]` by default) are stored but not enforced by the server yet. Do not treat a scope as a control.

WebSocket authentication uses a separate short-lived credential: `POST /api/v1/auth/bot-ws-ticket` returns a single-use ticket valid for 30 seconds, passed as `?ticket=…` on the socket URL. The SDK fetches a fresh one for every connect, including every reconnect, so the long-lived token never appears in a query string.

## Channel membership

Reads and writes require the caller to be a member of the channel; the server answers a non-member with 403 `Not a member of this channel`, which the SDK raises as `ChannelMembershipError`. Adding a bot to a channel is not possible on `53d464a`, which is why the interactive surface is inert — see [server-requirements.md](server-requirements.md).

## Bots and end-to-end encryption

Bots send plaintext (`content_type: "plaintext"`). A channel with an active key epoch rejects plaintext with 400 `Channel requires encrypted messages`, on the incoming webhook route as well as the message send route; the SDK raises `E2EEChannelError` either way. Anything a bot posts is readable by the server operator; do not route secrets through a bot into a channel whose members expect end-to-end encryption.

## What the SDK never logs

The SDK writes nothing to the console — no request logs, no reconnect chatter, no token or secret material. Errors are surfaced by throwing, or through `bot.onError`, and that is the only place bot-visible data can reach your logs.

`KlankError` carries `code`, `status`, and `body` (the server's `{ error, message }` envelope). Error text comes from that envelope or from the underlying network error — the SDK never interpolates your token, webhook secret, or a computed signature into a message. Two things to keep out of logs yourself: a `ConnectionError`'s `cause` can carry the WebSocket URL, which includes a single-use ticket, and event objects contain channel content, so prefer logging `code`/`status`/`event.type` over whole objects.
