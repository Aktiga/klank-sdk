# @klank/sdk

## 0.2.0

### Minor Changes

- 8d94750: First publishable release, cut against Klank server `53d464a`.

  - `WebhookBot.send` now authenticates with `X-Klank-Webhook-Key` + `X-Klank-Signature` (HMAC-SHA256 over the exact body bytes) and returns the created `Message`. The old `secret`-in-body scheme has been removed server-side.
  - Typed error taxonomy: `KlankError` base with `AuthError`, `WebhookAuthError`, `ChannelMembershipError`, `E2EEChannelError`, `RateLimitedError`, `ServerError`, `NetworkError`, `ContextError`, `UnsupportedError`, `ConnectionError`, and more — no more bare `Error`s.
  - `verifySlashCommandSignature` / `parseSlashCommandPayload` for HTTP slash command receivers (constant-time compare).
  - `KlankClient`: bounded, jittered 429 retries; 5xx retried only for GET/DELETE; `editMessage`, `deleteMessage`, `getThread`; response types match the server (`CursorPage`, `MessageListItem`, `ChannelWithMembers`).
  - `KlankBot`: `on()` narrows the event by name (wire names and aliases), `off()`, `ctx.event`/`ctx.unreact`, webhook self-echo suppression via `webhookIds`, no process signal handlers unless `handleSignals: true`.
  - WebSocket: fresh ticket per connect, jittered exponential reconnect with a cap, heartbeat + pong timeout, parse errors surfaced through `onError`, `events.missed` delivered as an event.
  - Wire types regenerated from the server source: every `ServerEvent` variant is modelled.
  - Docs rewritten with an explicit status table; the Rust SDK claim is gone (a hand-rolled example lives in `examples/community`).

## 0.1.0

Initial pre-refresh release. Baseline that predates the v0.2 → v0.4 SDK refresh milestone. See repository `.planning/BASELINE-REPORT.md` for the full state at this tag.
