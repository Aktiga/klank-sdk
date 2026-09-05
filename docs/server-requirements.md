# Server requirements for a working `KlankBot`

Cross-repo handoff for [Aktiga/klank](https://github.com/Aktiga/klank) (issues are disabled there, so this lives here).

`@klank/sdk` (Aktiga/klank-sdk) was built against the bot contract in `docs/superpowers/specs/2026-03-17-bot-sdk-design.md`. As of `53d464a` only half of the server prerequisites exist, so a bot token can authenticate but cannot do anything a bot needs. This issue tracks the server side; the SDK 0.2.0 release documents these as "pending server support" and links here.

Verified against `main` @ 53d464a (2026-04-30).

## 1. Bot tokens are rejected by every channel/message/reaction route

- `crates/rs-api/src/auth_middleware.rs`: `BotOrUser` (accepts `bot_…` or JWT) is used only by `GET /auth/bot-info` and `POST /auth/bot-ws-ticket` (`handlers/auth.rs`).
- Every handler in `crates/rs-api/src/handlers/channel.rs` (`send_message`, `list_messages`, `add_reaction`, `remove_reaction`, `get_channel`, `list_channels`, `get_thread`, `edit_message`, `delete_message`, …) takes `auth: AuthUser`, which runs `jwt::validate_token` → a `bot_` token returns **401 Invalid or expired token**.

Needed: bot-capable routes take `BotOrUser`; membership/role checks resolve for bots (see §2). Scopes (`bots.scopes`, default `["read","write"]`) are stored but never enforced — decide whether `read`/`write` gate list vs. send.

## 2. Bots have no channel membership, so they receive zero WebSocket events and cannot pass `is_member`

- `channel_members.user_id` and `workspace_members.user_id` FK → `users(id)` (`crates/rs-db/migrations/20260317000001_initial_schema.sql`); no later migration relaxes this. A bot id cannot be inserted, so `POST /channels/{id}/members {"user_id": "<bot_id>"}` fails the FK.
- `handlers/ws.rs::ws_upgrade` pre-subscribes via `SELECT channel_id FROM channel_members WHERE user_id = $1` and `workspace_members` — both empty for a bot id → `hub.user_connected(bot_id, [], [])` → `should_send_to_user` (`rs-realtime/src/connection.rs`) filters every channel- and workspace-scoped event. The bot socket connects and stays silent forever.
- `reactions.user_id` FK → `users(id)`, so bot reactions also need schema work.

Options (product call needed):
- (a) Spec §3: bots implicitly subscribe to **all** workspace channels on connect. Simplest; leaks private channels and DMs to any workspace bot.
- (b) Explicit `bot_channel_members(channel_id, bot_id)` (or a nullable `bot_id` on `channel_members` with a CHECK), `ChannelService::is_member` unions it, `add_member` accepts `bot_id`, `ws_upgrade` subscribes from it, `hub.subscribe_to_channel` on add. Matches the existing membership-required model and keeps private channels private. Recommended.

Also: `ws_upgrade` calls `hub.user_connected`, which publishes `presence.update` for the bot id and inserts it into presence; decide whether bots should have presence.

## 3. No slash-command delivery path

- `crates/rs-bots/src/slash_commands.rs::dispatch` (HTTP POST + `X-Klank-Signature`) has **no caller**; there is no slash-command table, no registration route, no `/cmd` parsing on message send.
- `ServerEvent` (`rs-realtime/src/events.rs`) has no `command.invoked` variant, so the spec §4 "deliver over WS to connected bots" path does not exist either.

Needed: a `slash_commands` table (workspace_id, command, url, signing_secret_hash, bot_id?), admin CRUD routes, invocation on message send (or a dedicated `POST /channels/{id}/commands` from the client), then either `dispatch()` to the URL or `ServerEvent::CommandInvoked { command, text, user_id, channel_id, workspace_id }` when the owning bot has a live socket. Ephemeral responses need a per-user delivery mechanism that does not exist today.

## 4. Smaller gaps the SDK has to document around

- No bot token rotation (`DELETE /workspaces/{wid}/bots/{bid}` exists; recreate to rotate).
- No webhook delete/rotate route (`handlers/bots.rs` registers create + list only).
- Incoming webhook signing has no timestamp/nonce → captured `(key, signature, body)` triples replay indefinitely.
- No OpenAPI/utoipa; the SDK hand-mirrors `events.rs` and the models. A `cargo test` that serializes one sample per `ServerEvent` variant into `fixtures/wire/*.json` would let the SDK CI catch drift cheaply.

## Acceptance (what the SDK integration test will do)

1. Create bot → add bot to channel via `POST /channels/{id}/members` → bot token `POST /channels/{id}/messages {plaintext}` returns 201.
2. Bot WS receives `message.new` for that channel; does **not** receive events from channels it is not a member of.
3. Bot token `POST /messages/{id}/reactions` returns 201 and emits `reaction.added`.
4. Slash command `/echo hi` reaches the bot (HTTP or WS) with a verifiable signature; bot's `in_channel` response appears in the channel.
