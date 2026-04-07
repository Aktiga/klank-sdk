# Codebase Concerns — Klank Bot SDK

**Analysis Date:** 2026-04-07
**Repo:** `/Users/stevemeisner/Sites/rust-slack-sdk` (`@klank/sdk@0.1.0`)
**Sources:** `.planning/BASELINE-REPORT.md`, `.planning/SDK-REFRESH-ROADMAP.md`, direct read of `packages/sdk-typescript/src/*.ts`

Concerns are grouped by severity. Every entry cites the specific file:line in this repo and, where relevant, the server commit that broke the SDK.

---

## Critical — Broken Against Current Server

These will fail (or already fail) the moment a current Klank server is on the other end. They block any 0.2 release.

### C-1. `WebhookBot.send` is broken — secret in body, no HMAC signature

- **Files:** `packages/sdk-typescript/src/webhook.ts:12-30` (specifically the body at lines 18-22 and the missing headers at line 17)
- **What's wrong:** SDK posts `{ text, username, secret }` as JSON body with only `Content-Type: application/json`. The `secret` field was removed from `IncomingWebhookPayload` server-side, and the server now requires two headers:
  - `X-Klank-Webhook-Key: <raw-secret>`
  - `X-Klank-Signature: sha256=<hex(hmac_sha256(raw_secret, raw_body))>`
- **Server change:** Phase 11 C-2, commit `3032236` (`crates/rs-bots/src/webhooks.rs:75-130`, `crates/rs-api/src/handlers/bots.rs:99-141`).
- **Impact:** Every `WebhookBot` call returns 401. 100% of webhook bots are dead the moment Phase 11 is deployed.
- **Fix approach:** Move secret to `X-Klank-Webhook-Key` header, compute HMAC-SHA256 over the exact serialized body bytes (serialize once, sign, post — no re-stringify), set `X-Klank-Signature: sha256=<hex>`. Drop `secret` from the body. Throw a typed `WebhookAuthError` on 401. See roadmap M-1.

### C-2. Bots cannot post to E2EE channels at all

- **Files:** `packages/sdk-typescript/src/client.ts:57-67` (`sendMessage` always sends `content_type: 'plaintext'`); `packages/sdk-typescript/src/types.ts` (`Message.content_type` union has `'encrypted'` but no code path handles it anywhere in the SDK).
- **What's wrong:** Server now rejects plaintext sends to any E2EE-flagged channel. SDK has no MLS / x25519 / decrypt path and no key state — it cannot encrypt outgoing messages or decrypt incoming ones. When a bot is added to an E2EE channel:
  - Outbound: `client.sendMessage` returns a server 4xx wrapped in a generic `Error`.
  - Inbound: events arrive with `plaintext: null`; bot silently does nothing (no log, no handler dispatch).
- **Server change:** Phase 9 H-1, commit `b9cb1da`.
- **Impact:** Any user who adds a bot to an E2EE channel gets silent failure on receive and opaque errors on send. README still claims "bots are plaintext, they appear next to encrypted messages."
- **Fix approach (short term):** Document the ban; on send, detect the server error and throw a typed `E2EEChannelError` with an actionable message. (Long term is Open Decision #1 in the roadmap — full bot MLS, admin opt-out, or a "bot identity" path.) See roadmap M-2.

### C-3. README "Server Compatibility" pin is stale by 6+ phases

- **Files:** `README.md` "Server Compatibility" section (pinned to commit `d7c956c`).
- **What's wrong:** The pinned commit predates Phases 6 through 11. Anyone trusting the pin and running `main` will hit C-1 and C-2 immediately and have no signal that the SDK is out of sync.
- **Impact:** Users have no way to know the SDK is broken against current server until things 401/400 in production.
- **Fix approach:** Update pin to the post-phase-11 commit on every SDK release, and add a CI check that fails the build if the SDK compatibility commit lags `main` by more than N commits. See roadmap M-7.

---

## High — Silent Bugs and User-Visible Wrong Behavior

These don't break against the server, but they cause incorrect behavior the user can't easily diagnose.

### H-1. `ctx.respond({ responseType: 'ephemeral' })` is a silent no-op

- **Files:** `packages/sdk-typescript/src/bot.ts:194-205` (`buildCommandContext`). The `if (response.responseType === 'in_channel')` branch on line 198 is the only branch — ephemeral responses fall through with no error and no log. Comment on line 201: `// Ephemeral responses are more complex — would need server support`.
- **What's wrong:** README documents `ctx.respond({ responseType: 'ephemeral', text })` as a supported call. The SDK accepts it and discards it. The user sees nothing in chat and no error in logs.
- **Impact:** Slash commands that try to respond ephemerally (the most common kind — error responses, private acknowledgments) appear to do nothing.
- **Fix approach:** Either implement a real ephemeral path (requires server support — verify the endpoint exists; if not, file a server ticket) or, at minimum, throw `NotImplementedError` so failures are loud. Update README to remove the false claim until the path lands.

### H-2. 429 rate-limit handler recurses forever with no max retries

- **Files:** `packages/sdk-typescript/src/client.ts:24-29` (the `if (res.status === 429)` block — the recursive `return this.fetch(path, options)` on line 28 has no retry counter).
- **What's wrong:** Reads `Retry-After`, sleeps, calls itself again. No max retries, no jitter, no give-up. A server stuck in a rate-limit loop will hang the bot indefinitely with no observable error.
- **Impact:** A misconfigured server or a sustained 429 storm hangs every REST call forever. No timeout, no thrown error, no metric to alert on.
- **Fix approach:** Add max-retries (default 5), jitter (`Retry-After * (0.8 + random*0.4)`), and a typed `RateLimitedError` after the cap. See roadmap M-6.

### H-3. `start()` installs process-level SIGINT/SIGTERM — multi-bot processes break

- **Files:** `packages/sdk-typescript/src/bot.ts:74-77` (`process.on('SIGINT', shutdown)` / `process.on('SIGTERM', shutdown)` inside the `start()` method).
- **What's wrong:** Every `KlankBot` instance registers global signal handlers. A process running two bots gets two handlers; the first bot's handler closes the second bot's WS via the `shutdown` closure that captures `this`, but neither handler is removed on `stop()`, and the signals are never `process.removeListener`'d. Also: any host that already manages signals (Lambda, a test runner) gets stomped.
- **Impact:** Test suites that instantiate `KlankBot` leak listeners. Multi-bot processes have undefined shutdown order. Anything that expects to own `SIGINT` (e.g. a debugger, a parent supervisor) loses control.
- **Fix approach:** Remove the signal handlers from `start()`. Document that the host process is responsible for calling `bot.stop()`. Optionally expose a `bot.installSignalHandlers()` opt-in.

### H-4. Self-message filter compares `bot_id`, not `webhook_id` — bots echo themselves via their own webhook

- **Files:** `packages/sdk-typescript/src/bot.ts:101` (`(event as MessageEvent).sender_id === this.botInfo?.bot_id`). Server-side: `crates/rs-bots/src/bots.rs:152` stamps webhook posts with `sender_id = webhook_id`, not `bot_id`.
- **What's wrong:** A bot that listens on a channel AND posts to that same channel via its own incoming webhook will see its own webhook posts as `message.new` events with `sender_id = <webhook_id>`, which never equals `bot_id`. The self-suppression check passes, the bot replies to itself, infinite loop until rate limit.
- **Impact:** Any bot that combines `KlankBot` event listening with `WebhookBot` posting to the same channel will loop. This is a common pattern (CI bot listens for `/status` and webhook-posts build results).
- **Fix approach:** Track the bot's own webhook IDs (fetch on `start()` or accept in config) and suppress events whose `sender_id` matches any of them. Or have the server stamp webhook posts with both fields.

### H-5. WebSocket: no heartbeat, no jitter, listeners cannot be removed, parse errors swallowed

- **Files:** `packages/sdk-typescript/src/ws.ts`
  - No heartbeat: nothing in `connect()` (lines 26-63) sends pings or watches for pongs.
  - No jitter in reconnect: line 53 doubles `reconnectDelay` deterministically. A thundering herd of bots reconnecting after a server blip will all hit at the same intervals.
  - Listeners cannot be removed: `onEvent` (lines 22-24) only pushes to `this.listeners`; there is no `offEvent` and no return-handle. Tests cannot clean up.
  - Parse errors silently swallowed: line 46 `} catch { /* ignore parse errors */ }`. A malformed frame produces no log, no metric, no error handler invocation.
  - No max-reconnect cap: the loop runs forever.
- **Impact:** Long-lived bots accumulate undetected dropped connections (no heartbeat → silent half-open sockets). Parse bugs in the SDK or server are invisible. Tests leak listeners.
- **Fix approach:** Add ping/pong with a timeout (close on missed pong). Add jitter to reconnect (`delay * (0.8 + random*0.4)`). Return an unsubscribe function from `onEvent`. Surface parse errors via the bot's `onError` handler. Add a max-reconnect-attempts cap that throws after N failures.

### H-6. README markets "TypeScript or Rust" — there is no Rust crate

- **Files:** `README.md` headline / intro, `docs/getting-started.md`, `docs/deploying-bots.md`. Repo: `packages/` contains `sdk-typescript/` and `create-bot/` only — no `sdk-rust/`. The only Rust artifact is `examples/echo-bot-rust/src/main.rs`, a single hand-rolled `reqwest` + `tokio-tungstenite` file with no library API.
- **What's wrong:** False marketing. Users expecting `cargo add klank-sdk` find nothing.
- **Impact:** Credibility hit on first contact. A Rust-only shop will evaluate, find no crate, and bounce.
- **Fix approach:** Drop the Rust claim from README and docs. Move `examples/echo-bot-rust/` to `examples/community/` with a header explaining it's a hand-rolled example, not a supported SDK. Defer building a real crate until a user asks. See roadmap Phase F-drop.

### H-7. `templates/typescript/src/` is empty — `create-klank-bot` story is vapor

- **Files:** `templates/typescript/src/` (directory exists, contains zero files).
- **What's wrong:** Repo is shaped for an `npx create-klank-bot` scaffolder but ships no template files. `packages/create-bot/` exists but has nothing to copy.
- **Impact:** Documented or implied scaffolder fails or produces empty projects.
- **Fix approach:** Either populate templates (echo bot, slash command receiver, webhook poster) per roadmap Phase G, or remove the empty directory and the scaffolder package until they can ship.

---

## Medium — Tooling, Coverage, and API Gaps

These don't break anything today but compound risk and slow every future change.

### M-1. Zero tests despite `vitest` declared

- **Files:** `packages/sdk-typescript/package.json` declares `"test": "vitest"` and `vitest` in `devDependencies`. No `*.test.ts` or `*.spec.ts` exists anywhere in the repo.
- **Impact:** Every change is a regression risk. The C-1 webhook break could have been caught by a single round-trip test. Per CLAUDE.md "Tests must prove the system works" — there are no tests at all.
- **Fix approach:** Start with regression tests for C-1 (webhook signing round-trip), H-2 (429 cap), H-4 (self-message via webhook). Build out a `MockKlank` test kit (roadmap Phase E).

### M-2. No CI, no lint, no formatter

- **Files:** No `.github/` directory. No `.eslintrc*`, `.prettierrc*`, `eslint.config.*`, or `biome.json`. No `tsup.config.ts`. No lockfile.
- **Impact:** Style drift, no automated build verification, no PR gates. Anyone can push anything.
- **Fix approach:** Add `.github/workflows/ci.yml` running `tsc --noEmit`, `vitest`, and a linter (eslint or biome). Commit a lockfile.

### M-3. Hand-written `types.ts` will drift from server

- **Files:** `packages/sdk-typescript/src/types.ts` (~155 lines, all hand-written). No codegen, no schema source of truth. Server types live in `crates/rs-*/src/*.rs` and have no export pipeline.
- **Impact:** Every server schema change risks silent SDK drift. The `Message.content_type: 'encrypted' | 'plaintext'` field is correct today but nothing prevents the next server change from invalidating it.
- **Fix approach:** Add `utoipa` to the server, generate OpenAPI, run `openapi-typescript` in SDK CI. See roadmap Open Decision #3.

### M-4. No error taxonomy — everything throws raw `Error`

- **Files:**
  - `packages/sdk-typescript/src/client.ts:38` — `throw new Error(\`API error ${res.status}: ${err.message}\`)`
  - `packages/sdk-typescript/src/webhook.ts:28` — `throw new Error(\`Webhook error ${res.status}: ${err.message}\`)`
  - `packages/sdk-typescript/src/bot.ts:179, 183, 187` — `throw new Error('No channel context')` etc.
- **Impact:** Callers cannot `instanceof`-discriminate. Cannot distinguish auth failure from network failure from rate limit from "channel is E2EE". Every error-handling branch becomes string parsing.
- **Fix approach:** Define `KlankError` base + typed subclasses (`AuthError`, `RateLimitedError`, `WebhookAuthError`, `E2EEChannelError`, `ChannelMembershipError`, `NotFoundError`, `ServerError`). Throw the right one based on status + body shape.

### M-5. Auth has no refresh and no re-auth on 401

- **Files:** `packages/sdk-typescript/src/client.ts:8-32`. `KlankClient` only knows the bearer token passed to the constructor. The `fetch` wrapper has no 401 path; a 401 falls through to the generic `!res.ok` branch on line 36 and throws.
- **Impact:** A revoked or rotated token kills the bot with an opaque "API error 401: Unauthorized." No refresh hook, no callback to fetch a new token, no retry. The bot dies silently from the user's perspective.
- **Fix approach:** Add an optional `tokenProvider: () => Promise<string>` in `BotConfig`. On 401, call it once, retry the request. Throw a typed `AuthError` if retry also 401s. (Server has no token-refresh endpoint yet — see roadmap Open Decision #5.)

### M-6. Missing client helpers for common operations

- **Files:** `packages/sdk-typescript/src/client.ts` (the entire surface is at lines 44-96).
- **What's missing** (none of these have any method):
  - File upload / download
  - Message edit (`PATCH /messages/:id`)
  - Message delete (`DELETE /messages/:id`)
  - Channel join / leave / add bot to channel
  - Member listing
  - User lookup
  - Search
  - DM open / list
  - Pinned messages
  - Ephemeral message send
  - Workspace listing
  - Thread fetch
  - Presence
- **Impact:** Bots that need any of these have to drop down and hand-write `fetch` calls against `${serverUrl}/api/v1/...`, defeating the point of having an SDK.
- **Fix approach:** Roadmap Phase A — design the full surface, verify each endpoint exists server-side (some may need server work, e.g. `PATCH /messages/:id`), implement.

### M-7. Examples cannot be installed standalone — no `package.json`

- **Files:** `examples/echo-bot-ts/`, `examples/ci-bot-ts/`, `examples/webhook-bot/` — each contains an `index.ts` but no `package.json`. (`examples/echo-bot-rust/` has its own `Cargo.toml` because it's a hand-rolled crate.)
- **Impact:** Anyone copying an example cannot `cd examples/echo-bot-ts && npm install && npm run start`. The examples are documentation, not runnable code.
- **Fix approach:** Add a `package.json` per example with a `dependencies` block pointing at `@klank/sdk` (workspace `*` or a published version), a `start` script, and an `.env.example`.

---

## Cross-Reference: Server Phases vs SDK Status

| Server change | Commit | SDK status | This doc |
|---|---|---|---|
| Webhook secrets hashed; require headers + HMAC | `3032236` (Phase 11 C-2) | **Broken** | C-1 |
| E2EE enforced on send | `b9cb1da` (Phase 9 H-1) | **Broken** (no MLS path) | C-2 |
| Slash command outbound HMAC-signed | `a603a09` (Phase 11 H-5) | No verifier helper | (M-3 in roadmap, not a regression) |
| Bot tokens hashed at rest | `36ca613` (Phase 6 H-3) | Aligned; docs need note | (M-4 in roadmap) |
| Channel membership required | multiple | No helper, opaque 403s | M-6 (this doc) |
| Rate-limit on `/refresh` | `16f022c` (Phase 6 H-2) | SDK has no refresh; generic 429 handler unsafe | H-2 |
| Server compat pin | — | Stale by 6+ phases | C-3 |

---

## Top Three Things to Fix First

1. **C-1** — `WebhookBot` HMAC. Single file, ~30 lines, unblocks every webhook user.
2. **C-2** — E2EE-channel typed error + README correction. Stops silent failures.
3. **H-2** — 429 retry cap. One file, prevents production hangs.

Everything else can wait one release cycle.

---

*Concerns audit: 2026-04-07*
