# Klank Wire-Format Specification (Post-Hardening, 2026-04-07)

This document is the SDK's source of truth. It captures every wire format
the Klank server expects, derived from server source as of commit
**`50df1f960252f3844f8be4247cfcc48a0d99496d`** on branch `main`.

All file:line citations are relative to the `rust-slack` repository.

---

## Conventions

### Base URL & paths
- All API endpoints are nested under `/api/v1` — see
  `crates/rs-api/src/lib.rs:104` (`.nest("/api/v1", api_routes())`).
- A `GET /health` endpoint exists at the top level returning the literal
  string `"ok"` (`crates/rs-api/src/lib.rs:103`,
  `crates/rs-api/src/lib.rs:155`).
- The fallback serves a SPA from `STATIC_DIR` (default `client/dist`)
  with `index.html` SPA fallback (`crates/rs-api/src/lib.rs:100`).

### Content type
- All JSON request/response bodies are `application/json; charset=utf-8`.
- Bodies are parsed with serde_json. Strings are UTF-8.
- File uploads use `multipart/form-data`
  (`crates/rs-api/src/handlers/files.rs:93`).

### Authentication header
- Both user JWTs and bot tokens are passed as
  `Authorization: Bearer <token>`
  (`crates/rs-api/src/auth_middleware.rs:27-33`).
- Bot tokens are distinguished by the literal `bot_` prefix
  (`crates/rs-api/src/auth_middleware.rs:77`,
  `crates/rs-bots/src/bots.rs:115`).
- Anything else is parsed as a JWT.

### Error response shape
Defined in `crates/rs-api/src/error.rs:18-43`:

```ts
interface ErrorBody {
  /** HTTP canonical reason, e.g. "Bad Request", "Unauthorized" */
  error: string;
  /** Server-supplied human-readable message */
  message: string;
}
```

HTTP status mapping (`crates/rs-common/src/errors.rs:30-40`):
| AppError variant   | HTTP |
|--------------------|------|
| `NotFound`         | 404  |
| `Unauthorized`     | 401  |
| `Forbidden`        | 403  |
| `BadRequest`       | 400  |
| `Conflict`         | 409  |
| `NotImplemented`   | 501  |
| `Internal`/`Database` | 500 |

The auth middleware emits its own error envelope (same shape) directly
for missing / malformed / invalid tokens
(`crates/rs-api/src/auth_middleware.rs:119-138`):
- `MissingToken` → 401, message `"Missing Authorization header"`
- `InvalidFormat` → 401, message `"Expected: Bearer <token>"`
- `InvalidToken` → 401, message `"Invalid or expired token"`

`AppError::is_retryable()` returns true only for `Database`/`Internal`
(`crates/rs-common/src/errors.rs:47-49`). The SDK should treat 5xx as
retryable; 4xx as permanent.

### Pagination
Cursor-based, defined in `crates/rs-common/src/pagination.rs`:

```ts
// Query params on list endpoints
interface CursorParams {
  cursor?: string;   // UUID; start after this id (exclusive)
  limit?: number;    // default 50, clamped to [1, 100]
}

interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;  // UUID, null if no more pages
  has_more: boolean;
}
```

Source: `crates/rs-common/src/pagination.rs:5-17` (params),
`crates/rs-common/src/pagination.rs:21-46` (page).

Cursor semantics differ between message list (descending: paging "older")
and thread reply list (ascending: paging "newer"):
- `list_messages`: `ORDER BY created_at DESC, id DESC`, cursor selects rows
  where `(created_at, id) < cursor`
  (`crates/rs-messaging/src/messages.rs:121`).
- `get_thread`: `ORDER BY created_at ASC, id ASC`, cursor selects rows
  where `(created_at, id) > cursor`
  (`crates/rs-messaging/src/messages.rs:244`).

### Timestamps
- All timestamps are RFC3339 (ISO 8601) UTC, serialized by `chrono`'s
  default `DateTime<Utc>` impl, e.g. `"2026-04-07T15:04:05.123456Z"`.
- See `crates/rs-db/src/models.rs` — every model uses
  `chrono::DateTime<Utc>` (e.g. `Channel.created_at` line 72).
- JWT `exp`/`iat` are integer Unix seconds
  (`crates/rs-auth/src/jwt.rs:11-15`).

### IDs
- All entity IDs are UUIDs in canonical hyphenated form
  (`uuid::Uuid` serialized as string). The DB defaults are PostgreSQL
  `gen_random_uuid()` (UUID v4). The wire encoding is the standard
  36-character hex form, e.g. `"550e8400-e29b-41d4-a716-446655440000"`.
- Bot tokens: literal `bot_` + 64 lowercase hex chars (32 random bytes),
  total length 68. See `crates/rs-bots/src/bots.rs:110-116`.
- Webhook secrets: 48 lowercase hex chars (24 random bytes), no prefix.
  See `crates/rs-bots/src/webhooks.rs:169-174`.
- Password reset tokens: 48 lowercase hex chars
  (`crates/rs-api/src/handlers/auth.rs:459-464`).
- WS tickets: UUID v4 string
  (`crates/rs-api/src/handlers/auth.rs:359`).

---

## Authentication

### User registration
`POST /api/v1/auth/register` — `crates/rs-api/src/handlers/auth.rs:79`.

```ts
interface RegisterRequest {
  email: string;
  password: string;       // min 8 chars enforced server-side
  display_name: string;
  invite_token?: string;
}
```
Source: `crates/rs-auth/src/service.rs:14-19`.

Returns `201` with `AuthResponse` (see below). On a "needs reset" collision
returns `409` with body
`{ "error": "account_needs_reset", "message": "..." }`
(`crates/rs-api/src/handlers/auth.rs:163-167`).

Rate limit: 10 burst, 1/6s refill, per IP
(`crates/rs-api/src/handlers/auth.rs:22-34`). Behind a reverse proxy
the limiter uses `X-Forwarded-For` via `SmartIpKeyExtractor`.

### Login
`POST /api/v1/auth/login` — `crates/rs-api/src/handlers/auth.rs:194`.

```ts
interface LoginRequest { email: string; password: string; }

interface AuthResponse {
  user: UserResponse;
  tokens: TokenPair;
}

interface UserResponse {
  id: string;            // UUID
  email: string;
  display_name: string;
  avatar_url: string | null;
  status: string;        // "online" | "away" | "offline"
  status_text: string | null;
}

interface TokenPair {
  access_token: string;  // JWT
  refresh_token: string; // JWT
  expires_in: number;    // access token lifetime in seconds
}
```
Source: `crates/rs-auth/src/service.rs:22-46`,
`crates/rs-auth/src/jwt.rs:24-28`.

Same rate limit as register.

### Refresh
`POST /api/v1/auth/refresh` — `crates/rs-api/src/handlers/auth.rs:212`.

```ts
interface RefreshRequest { refresh_token: string; }
// returns: TokenPair
```

**Rate limit (looser):** burst 12, refill 1/5s per IP
(`crates/rs-api/src/handlers/auth.rs:39-48`). Headroom for multi-tab
clients but still bounded.

### Logout
`POST /api/v1/auth/logout`. Requires `Authorization: Bearer <jwt>`.
Returns `204`. (`crates/rs-api/src/handlers/auth.rs:228-235`)

### JWT internals
Access tokens are short-lived JWTs. Claims
(`crates/rs-auth/src/jwt.rs:9-20`):

```ts
interface Claims {
  sub: string;        // UUID
  exp: number;        // unix seconds
  iat: number;        // unix seconds
  jti: string;        // unique per token
  token_type: "access" | "refresh";
}
```

The middleware rejects refresh tokens at protected endpoints:
`claims.token_type` must be `"access"`
(`crates/rs-api/src/auth_middleware.rs:39-41`).

### Bot tokens
- Created via `POST /api/v1/workspaces/{wid}/bots`
  (`crates/rs-api/src/handlers/bots.rs:37`).
- Caller must be workspace `owner` or `admin`
  (`crates/rs-api/src/handlers/bots.rs:43`).
- The raw token is **returned exactly once on creation** in
  `BotResponse.api_token`. After that, only the SHA-256 hash is stored
  in `bots.api_token_hash`. See:
  - `crates/rs-bots/src/bots.rs:39-71` (issue),
  - `crates/rs-bots/src/bots.rs:84-96` (auth lookup by hash),
  - `crates/rs-api/src/auth_middleware.rs:77-94` (middleware path).
- Token format: `bot_` + 64 hex chars
  (`crates/rs-bots/src/bots.rs:110-116`).
- Use it the same way as a JWT: `Authorization: Bearer bot_…`.
- **There is no rotation or refresh endpoint for bot tokens.** To
  "rotate", create a new bot and delete the old. (No delete endpoint
  is currently exposed — see Open Questions.)

```ts
interface CreateBotRequest {
  name: string;
  avatar_url?: string;
  webhook_url?: string;
  scopes?: string[];     // defaults to ["read","write"]
}

interface BotResponse {
  id: string;
  name: string;
  avatar_url: string | null;
  api_token: string | null;   // present only on creation; null on list
  scopes: string[];
}
```
Source: `crates/rs-bots/src/bots.rs:7-23`.

### Bot info
`GET /api/v1/auth/bot-info` — for the holder of a bot token to discover
its workspace_id and metadata. Rejected with 400 for user JWTs.
Source: `crates/rs-api/src/handlers/auth.rs:413-437`.

```ts
interface BotInfoResponse {
  bot_id: string;
  workspace_id: string;
  name: string;
  scopes: string[];
}
```

### WebSocket tickets
WebSockets cannot send `Authorization` headers from browsers, so the
client trades a Bearer token for a single-use ticket.

- `POST /api/v1/auth/ws-ticket` (user JWT) →
  `crates/rs-api/src/handlers/auth.rs:355`
- `POST /api/v1/auth/bot-ws-ticket` (bot token) →
  `crates/rs-api/src/handlers/auth.rs:377`

Both return:
```ts
interface WsTicketResponse {
  ticket: string;       // UUID
  expires_in: number;   // 30
}
```
Tickets are stored in `ws_tickets`, expire after 30s, and are deleted
on first use (`crates/rs-api/src/handlers/ws.rs:29-40`). The SDK then
connects to:

```
GET /api/v1/ws?ticket=<ticket>
```

(`crates/rs-api/src/handlers/ws.rs:13`,
`crates/rs-api/src/handlers/ws.rs:23`).

---

## Workspaces

Routes registered in `crates/rs-api/src/handlers/workspace.rs:23-43`.
Mounted under `/api/v1/workspaces` (`crates/rs-api/src/lib.rs:131`).

| Method | Path | Purpose |
|---|---|---|
| POST   | `/api/v1/workspaces`                              | Create workspace |
| GET    | `/api/v1/workspaces`                              | List user's workspaces |
| GET    | `/api/v1/workspaces/discoverable`                 | Workspaces joinable by email domain |
| GET    | `/api/v1/workspaces/{id}`                         | Get workspace |
| PATCH  | `/api/v1/workspaces/{id}`                         | Update |
| POST   | `/api/v1/workspaces/{id}/invite`                  | Create invite |
| GET    | `/api/v1/workspaces/{id}/invites`                 | List invites |
| POST   | `/api/v1/workspaces/{id}/invites/{invite_id}/revoke` | Revoke invite |
| POST   | `/api/v1/workspaces/{id}/join/{token}`            | Accept invite |
| POST   | `/api/v1/workspaces/{id}/join-by-domain`          | Self-join via domain |
| GET    | `/api/v1/workspaces/{id}/members`                 | List members |
| PATCH  | `/api/v1/workspaces/{id}/members/{uid}`           | Update role |
| DELETE | `/api/v1/workspaces/{id}/members/{uid}`           | Remove member |
| GET    | `/api/v1/workspaces/{id}/emoji`                   | List custom emoji |
| POST   | `/api/v1/workspaces/{id}/emoji`                   | Create custom emoji |
| PATCH  | `/api/v1/workspaces/{id}/emoji/{emoji_id}`        | Update emoji |
| DELETE | `/api/v1/workspaces/{id}/emoji/{emoji_id}`        | Delete emoji |

A separate `/api/v1/invite` group handles unauthenticated invite URL
lookup: `.nest("/invite", handlers::workspace::invite_routes())`
(`crates/rs-api/src/lib.rs:132`).

Roles: `"owner" | "admin" | "member" | "guest"`. Guests cannot create
channels (except DMs) (`crates/rs-api/src/handlers/channel.rs:81-87`).

---

## Channels

Routes in `crates/rs-api/src/handlers/channel.rs:26-69`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST   | `/api/v1/workspaces/{wid}/channels`             | user JWT | guest cannot create non-DM |
| GET    | `/api/v1/workspaces/{wid}/channels`             | user JWT | scoped to membership/role |
| GET    | `/api/v1/workspaces/{wid}/channels/browse`      | user JWT | public discovery |
| GET    | `/api/v1/channels/{id}`                         | user JWT | must be member |
| PATCH  | `/api/v1/channels/{id}`                         | user JWT | channel admin only |
| DELETE | `/api/v1/channels/{id}`                         | user JWT | channel admin OR ws admin/owner |
| POST   | `/api/v1/channels/{id}/join`                    | user JWT | public channels only |
| POST   | `/api/v1/channels/{id}/members`                 | user JWT | channel admin only |
| GET    | `/api/v1/channels/{id}/members`                 | user JWT | must be member |
| DELETE | `/api/v1/channels/{id}/members/{uid}`           | user JWT | self-leave OR channel admin |

### Create channel
```ts
interface CreateChannelRequest {
  name: string;            // required for non-DM
  kind?: "public" | "private" | "dm";   // default "public"
  topic?: string;
  purpose?: string;
  dm_user_id?: string;     // required when kind === "dm"
}
```
Source: `crates/rs-messaging/src/channels.rs:27-35`.

DM creation is **idempotent**: if a 2-person DM already exists between
the two users in the workspace, the existing channel is returned with
`200`-equivalent success (`crates/rs-messaging/src/channels.rs:96-121`).
Otherwise the creator becomes channel admin
(`crates/rs-messaging/src/channels.rs:189-197`).

### Channel response
The list endpoint returns rows with member count and DM partner folded
in (`crates/rs-messaging/src/channels.rs:51-59`):

```ts
interface Channel {
  id: string;
  workspace_id: string;
  name: string;
  topic: string | null;
  purpose: string | null;
  kind: string;            // "public" | "private" | "dm"
  is_archived: boolean;
  created_by: string;
  created_at: string;      // RFC3339
  updated_at: string;
}

interface ChannelWithMembers extends Channel {
  member_count: number;
  dm_user_id?: string;     // present only for kind === "dm"
}
```
Underlying `Channel` model: `crates/rs-db/src/models.rs:63-74`.

Browse returns:
```ts
interface PublicChannelInfo {
  id: string;
  name: string;
  topic: string | null;
  purpose: string | null;
  kind: string;
  member_count: number;
  is_member: boolean;
}
```
(`crates/rs-messaging/src/channels.rs:62-70`)

### Add member / membership requirements
```ts
interface AddMemberRequest {
  user_id: string;
  share_history?: boolean;
}
```
Source: `crates/rs-messaging/src/channels.rs:46-49`.

**Channel membership is required for almost every per-channel
operation.** The check is `ChannelService::is_member`
(`crates/rs-messaging/src/channels.rs:473-488`). Endpoints that enforce
it return `403 Forbidden { message: "Not a member of this channel" }`:

- `GET /channels/{id}` (`crates/rs-api/src/handlers/channel.rs:150-155`)
- `GET /channels/{id}/members` (`...:277-282`)
- `POST /channels/{id}/messages` (`...:406-411`)
- `GET /channels/{id}/messages` (`...:468-473`)
- `GET /messages/{id}/thread` (`...:527-532`)
- `POST /messages/{id}/reactions` (`...:565-570`)
- `GET /messages/{id}/reactions` (`...:546-551`)
- `GET /messages/{id}/files` (`...:614-619`)
- `POST /files/upload` for the parent message's channel (`files.rs:191-196`)
- `GET /files/{id}/download` (`files.rs:261-266`)
- `GET /files/{id}` metadata (`files.rs:300-305`)
- `POST /channels/{id}/keys/request` (`keys.rs:60-65`)
- `POST /keys/distribute` (`keys.rs:183-188`)
- `GET/POST /keys/epochs/{channel_id}` (`keys.rs:271-276`, `288-293`)
- `POST /keys/epochs/{channel_id}/rotate` (`keys.rs:306-311`)

To **add a bot to a channel**: bots cannot self-join. A workspace
admin/owner (or channel admin) calls
`POST /api/v1/channels/{id}/members` with `{"user_id": "<bot_id>"}`.
The bot's id is the same UUID returned by bot creation, and is also
used as the `sender_id` for messages it sends (see Webhooks).
**Caveat:** the current admin path uses the user's `channel_members.role`
column; bots inserted via the same code path will appear as `"member"`.
The SDK should not assume it can elevate itself.

---

## Messages

Routes in `crates/rs-api/src/handlers/channel.rs:50-69`.

| Method | Path | Notes |
|---|---|---|
| POST   | `/api/v1/channels/{id}/messages`           | send |
| GET    | `/api/v1/channels/{id}/messages`           | list (paginated, descending) |
| PATCH  | `/api/v1/messages/{id}`                    | edit (sender only) |
| DELETE | `/api/v1/messages/{id}`                    | soft delete (sender only) |
| GET    | `/api/v1/messages/{id}/thread`             | thread replies (paginated, ascending) |
| GET    | `/api/v1/messages/{id}/files`              | attachments |
| POST   | `/api/v1/messages/{id}/reactions`          | add reaction |
| GET    | `/api/v1/messages/{id}/reactions`          | list reactions |
| DELETE | `/api/v1/messages/{id}/reactions/{emoji}`  | remove reaction (URL-encoded emoji) |

### Send message
```ts
interface SendMessageRequest {
  /** Encrypted body. base64-encoded over the wire (serde encodes Vec<u8> as array of numbers — see Open Questions). */
  ciphertext?: number[];
  /** Plaintext (only for bot tokens / non-E2EE channels). */
  plaintext?: string;
  /** Decryption nonce (encoded same as ciphertext). */
  nonce?: number[];
  /** Which channel key epoch was used. */
  key_epoch?: number;
  /** Parent message id when this is a thread reply. */
  thread_id?: string;
  /** IGNORED on send by users — server overrides to "user" (S-MSG-001). */
  sender_type?: string;
  /** "encrypted" (default) | "plaintext" */
  content_type?: string;
}
```
Source: `crates/rs-messaging/src/messages.rs:20-36`.

Validation rules (`crates/rs-messaging/src/messages.rs:55-68`):
- `content_type` defaults to `"encrypted"`.
- `sender_type` defaults to `"user"` (and is force-overridden to that
  for user JWT senders by the handler at `channel.rs:413-414`).
- Encrypted requires `ciphertext`; plaintext requires `plaintext`.

### E2EE enforcement on send (Phase 9 H-1)
Source: `crates/rs-api/src/handlers/channel.rs:417-431`. The handler runs:

```sql
SELECT EXISTS(
  SELECT 1 FROM channel_key_epochs
  WHERE channel_id = $1 AND status = 'active'
)
```

If a row exists **and** the request specifies `content_type: "plaintext"`,
the request is rejected:

- HTTP `400 Bad Request`
- Body: `{ "error": "Bad Request", "message": "Bad request: Channel requires encrypted messages" }`

**SDK guidance for this error:** the channel has at least one active
key epoch. The bot must:
1. Fetch the current epoch via `GET /api/v1/keys/epochs/{channel_id}`.
2. Encrypt with that epoch's key (which the bot must have received via
   `GET /api/v1/keys/pending/{device_id}` after registering its device).
3. Resend with `content_type: "encrypted"` and the populated
   `ciphertext`/`nonce`/`key_epoch`.

If the bot has no device and no key, the user-facing remediation is:
"this channel requires end-to-end encryption; the bot has not been
provisioned with the channel key — ask a member to invite the bot's
device." Bots writing to non-E2EE channels (no active epoch) are
unaffected and may continue to send `plaintext` messages.

**Important:** there is **no per-channel `e2ee_required` flag** on
the channel record. Whether a channel "requires E2EE" is purely
derived from the existence of any `active`-status row in
`channel_key_epochs`. There is also no workspace-wide setting that
forces E2EE for new channels.

### Message wire shape
Returned as the underlying `Message` model
(`crates/rs-db/src/models.rs:91-106`):

```ts
interface Message {
  id: string;
  channel_id: string;
  sender_id: string;            // user_id, bot_id, or webhook_id
  sender_type: string;          // "user" | "bot"
  content_type: string;         // "encrypted" | "plaintext"
  ciphertext: number[] | null;  // bytes
  plaintext: string | null;
  nonce: number[] | null;
  key_epoch: number | null;
  thread_id: string | null;
  edited_at: string | null;     // RFC3339
  deleted_at: string | null;
  created_at: string;
  import_source_id: string | null;
}
```

The list endpoint returns each row flattened with an extra
`has_files: boolean` (`crates/rs-messaging/src/messages.rs:13-18`):

```ts
type MessageListItem = Message & { has_files: boolean };
// Wrapped in CursorPage<MessageListItem>
```

### Edit
```ts
interface EditMessageRequest {
  ciphertext?: number[];
  plaintext?: string;
  nonce?: number[];
}
```
Only the sender can edit; deleted messages cannot be edited
(`crates/rs-messaging/src/messages.rs:171-194`). On success an
`message.updated` WS event is published.

### Delete
Soft delete via `deleted_at = now()`. Sender only. Emits `message.deleted`
WS event. Returns `204`.

### Reactions
```ts
interface AddReactionRequest { emoji: string; }
```
Channel-membership enforced (`channel.rs:565`). Add returns `201` with
the reaction row; remove returns `204`. The remove path uses the emoji
as a path parameter — **the SDK MUST URL-encode** the emoji string.

---

## Files

Routes in `crates/rs-api/src/handlers/files.rs:78-85`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/files/upload`               | user JWT | multipart, channel-membership enforced |
| GET  | `/api/v1/files/{id}/download`        | user JWT | bytes, channel-membership enforced |
| GET  | `/api/v1/files/{id}`                 | user JWT | metadata, channel-membership enforced |
| GET  | `/api/v1/files/avatars/{a}/{b}`      | none     | only avatar/emoji blobs; locked-down |

### Upload
Multipart form fields (`crates/rs-api/src/handlers/files.rs:106-173`):

| Field | Required | Meaning |
|---|---|---|
| `file` | yes | the binary content |
| `message_id` | yes | UUID of the message to attach to |
| `encrypted` | no | string `"true"` / `"false"`; default false |
| `is_thumbnail` | no | string `"true"` / `"false"`; default false |
| `crypto_header` | no | JSON string ≤4096 bytes; opaque to server |

Server enforces:
- **Body cap:** `max_file_size_bytes + 64 KiB` at the axum layer
  (`crates/rs-api/src/lib.rs:29`,
  `crates/rs-api/src/lib.rs:111`); the per-field reader also aborts
  early as soon as the running buffer would exceed
  `max_file_size_bytes` (`files.rs:122-145`).
- **Channel membership** for the parent message's channel
  (`files.rs:188-196`).
- **SVG rejection (H-5):** any upload that sniffs as SVG (declared MIME
  `image/svg+xml`, or content starting with `<svg` / `<?xml`) is
  rejected as `400 Bad request: SVG uploads are not supported`.
  **Skipped for `encrypted=true`** because ciphertext is random
  (`files.rs:200-205`).
- **Magic-byte validation for images** (PNG, JPEG, GIF, WebP, ICO, BMP).
  Same `encrypted=true` skip applies (`files.rs:209-214`,
  `files.rs:58-76`).
- **Crypto header size cap:** 4096 bytes
  (`files.rs:19-26`); contents must parse as JSON
  (`files.rs:29-35`).

Response:
```ts
interface UploadResponse {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;        // i64
  encrypted: boolean;
  crypto_header: unknown | null;  // arbitrary JSON
}
```
Source: `crates/rs-files/src/service.rs:9-17`.

### Download
Returns the raw bytes. **For encrypted files the bytes are still the
ciphertext** — there is no server-side decryption. Headers set
(`files.rs:268-281`):
- `Content-Type: <mime_type>` (as uploaded)
- `Content-Disposition: attachment; filename="<sanitized>"`
  (sanitization strips `"`, `\n`, `\r`, `\\`, `/`)
- `Cache-Control: public, max-age=31536000, immutable`

H-3 fix: if the parent message has been deleted, the download fails
closed with `403 File not accessible`.

### Metadata (`GET /api/v1/files/{id}`)
Returns the full `File` row (`crates/rs-db/src/models.rs:121-133`):

```ts
interface File {
  id: string;
  message_id: string;
  uploader_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  encrypted: boolean;
  crypto_header: unknown | null;
  created_at: string;
  is_thumbnail: boolean;
}
```

The `crypto_header` is sensitive (it carries the wrapped key envelope).
Channel membership enforced before this is returned (L-2 fix:
`files.rs:295-305`).

### List for message
`GET /api/v1/messages/{id}/files`. Excludes thumbnails — H-5: thumbnails
share the parent's `message_id` but are filtered out
(`crates/rs-files/src/service.rs:130-141`). Thumbnails are decrypted via
the parent's `crypto_header` thumb envelope only.

### Avatar/emoji blobs
`GET /api/v1/files/avatars/{a}/{b}` is a public route with strict
allowlisting (`files.rs:317-400`):
- `{a}` must be exactly 2 lowercase hex chars.
- `{b}` must be `<uuid>.<ext>` where ext is 1-5 lowercase alnum chars.
- The composed `{a}/{b}` storage key MUST NOT match any row in `files`
  (those are private attachments, served via the auth'd path only —
  H-1 fix at `files.rs:369-377`).

This is the only unauthenticated file route. Avatars uploaded via
`POST /api/v1/auth/me/avatar` (`auth.rs:281`) end up here.

---

## Webhooks (Incoming)

Routes (`crates/rs-api/src/handlers/bots.rs:22-33`):

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST   | `/api/v1/channels/{cid}/webhooks`        | user JWT, ws owner/admin | create |
| GET    | `/api/v1/channels/{cid}/webhooks`        | user JWT, ws owner/admin | list |
| POST   | `/api/v1/webhooks/{id}/incoming`         | HMAC headers (no JWT)    | dispatch |

### Create
```ts
interface CreateWebhookRequest {
  name: string;
  kind: "incoming" | "outgoing";
  url?: string;             // for outgoing
  events?: string[];
}

interface WebhookResponse {
  id: string;
  channel_id: string;
  name: string;
  kind: string;
  url: string;
  /** Plaintext secret — RETURNED EXACTLY ONCE on creation. Store it now. */
  secret: string | null;
  events: string[];
}
```
Source: `crates/rs-bots/src/webhooks.rs:7-25`. Persistence stores
`secret_hash = sha256(secret)`, never the raw secret
(`webhooks.rs:51-71`).

There is currently no DELETE route for webhooks in
`crates/rs-api/src/handlers/bots.rs:22-33`. See Open Questions.

### Trigger an incoming webhook (FULL DETAIL — Phase 11 C-2)

Endpoint: `POST /api/v1/webhooks/{id}/incoming`

Headers (both required, exact spelling, case-insensitive on the wire):

| Header | Value |
|---|---|
| `X-Klank-Webhook-Key` | the raw webhook secret returned at creation |
| `X-Klank-Signature`   | `sha256=<hex_lower(hmac_sha256(raw_secret, body))>` |
| `Content-Type`        | `application/json` |

The body is strictly:

```ts
interface IncomingWebhookPayload {
  text: string;
  username?: string;   // currently parsed but not persisted
}
```
(`crates/rs-bots/src/webhooks.rs:31-34`)

**Verification algorithm** (`webhooks.rs:107-141`):
1. Look up webhook by id; reject 400 if `kind != "incoming"`.
2. Check `sha256(provided_raw_secret) == webhook.secret_hash`
   in constant time. Failure → `401 Invalid webhook secret`.
3. Strip `sha256=` prefix from `X-Klank-Signature`. Bad format →
   `401 Bad signature format`. Bad hex → `401 Bad signature hex`.
4. Compute `hmac_sha256(raw_secret, raw_body)` and compare to the
   provided bytes via `verify_slice`. Mismatch → `401 Invalid signature`.

Notes:
- The HMAC is over the **exact raw bytes of the request body**, not a
  canonicalized form. The SDK MUST sign the same bytes it sends; do
  not re-serialize between signing and POSTing.
- Hex is **lowercase**.
- There is **no timestamp window and no nonce** in the protocol — the
  signature alone provides body integrity, and possession of the raw
  secret provides authentication. Replays of the same body are
  *currently* possible. (Open question: should we add a timestamp?)

**Worked example** (computed from real Rust code in `/tmp/sigv`):

```
secret      : s3cr3t
body        : {"hello":"world"}
stored hash : 4e738ca5563c06cfd0018299933d58db1dd8bf97f6973dc99bf6cdc64b5550bd
              (= sha256 of "s3cr3t")

X-Klank-Webhook-Key: s3cr3t
X-Klank-Signature: sha256=c5ea6542cb731d59005472d10164434c5b64ae51f6372f72447e46d1536492ee
```

```sh
# Reproducible one-liner
python3 -c 'import hmac,hashlib; print("sha256="+hmac.new(b"s3cr3t",b"{\"hello\":\"world\"}",hashlib.sha256).hexdigest())'
# sha256=c5ea6542cb731d59005472d10164434c5b64ae51f6372f72447e46d1536492ee
```

On success the server creates a `sender_type='bot'`,
`content_type='plaintext'` message in the webhook's channel using the
**webhook id as the sender_id** (`bots.rs:144-156`), publishes
`message.new` to the realtime hub, and returns `201 Created` with the
created `Message` row.

**E2EE caveat:** the incoming webhook handler always inserts a
plaintext message. If the channel has an active key epoch, this
**bypasses** the `H-1` plaintext-rejection check (which only runs in
the user-facing `send_message` handler). This is a deliberate trade-off
documented at `bots.rs:99-156` but worth flagging — see Open Questions.

---

## Slash commands (FULL DETAIL — Phase 11 H-5)

Slash commands are dispatched **outbound** from Klank to the bot's
configured URL. The bot is the HTTP server in this direction. Source:
`crates/rs-bots/src/slash_commands.rs`.

(There is no router-registered "create slash command" endpoint in the
files reviewed; slash command storage and admin UI are pending —
see Open Questions. The dispatch path is implemented and is the
contract a bot developer must satisfy.)

### Outbound request from Klank

```
POST <bot-supplied URL>
content-type: application/json
x-klank-signature: sha256=<hex_lower(hmac_sha256(signing_secret, raw_body))>
```

Body (`slash_commands.rs:5-12`):

```ts
interface SlashCommandPayload {
  command: string;       // e.g. "/echo"
  text: string;          // remainder of the user message
  user_id: string;       // UUID
  channel_id: string;    // UUID
  workspace_id: string;  // UUID
}
```

Encoding: Rust `serde_json::to_vec` with default settings
(`slash_commands.rs:41-42`). This is **compact JSON, no whitespace
between tokens, fields in declaration order**. The SDK MUST verify
against the raw bytes received — do not reformat.

Klank uses a 5-second request timeout (`slash_commands.rs:55`).

### Expected response from the bot

```ts
interface SlashCommandResponse {
  response_type: "ephemeral" | "in_channel";
  text: string;          // markdown
}
```
(`slash_commands.rs:14-21`)

Anything other than 2xx triggers a server-side error
(`slash_commands.rs:60-62`).

### Verification algorithm (bot side)

```
1. Read X-Klank-Signature header.
2. Strip "sha256=" prefix.
3. Hex-decode.
4. Compute HMAC-SHA256(signing_secret, raw_request_body).
5. Compare in constant time.
```

The signing secret is whatever the operator configured per slash
command (recommended 32 random bytes — `slash_commands.rs:33-36`).

### Worked example

Computed via the real Rust code path
(`crates/rs-bots/src/slash_commands.rs:38-47`):

```
signing_secret : super-secret-32-bytes-of-entropy   (32 ASCII bytes)
payload        : { command: "/echo", text: "hi",
                   user_id, channel_id, workspace_id all = nil UUID }
serialized body:
{"command":"/echo","text":"hi","user_id":"00000000-0000-0000-0000-000000000000","channel_id":"00000000-0000-0000-0000-000000000000","workspace_id":"00000000-0000-0000-0000-000000000000"}

X-Klank-Signature: sha256=a8d6ef56cbb2a3c7071ec4aada44b499347053d291580b8500bc042b24fea42c
```

(Reproducible:
`python3 -c 'import hmac,hashlib; print(hmac.new(b"super-secret-32-bytes-of-entropy", b"<the body above>", hashlib.sha256).hexdigest())'`)

### Differences from the webhook signing model

| | Incoming webhooks | Outgoing slash commands |
|---|---|---|
| Direction | Bot → Klank | Klank → Bot |
| Header for raw secret | `X-Klank-Webhook-Key` (plaintext) | n/a — bot already has it |
| Signature header | `X-Klank-Signature: sha256=<hex>` | `X-Klank-Signature: sha256=<hex>` |
| Replay protection | none | none |
| Body canonicalization | none (raw bytes) | none (raw bytes serialized by serde_json) |

---

## E2EE keys

Routes in `crates/rs-api/src/handlers/keys.rs:21-44`.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/keys/devices`                                | upload device key bundle |
| POST | `/api/v1/keys/devices/{device_id}/prekeys`           | replenish OTPs |
| GET  | `/api/v1/keys/devices/{device_id}/status`            | OTP count |
| GET  | `/api/v1/keys/users/{uid}/prekeys`                   | fetch bundle (one OTP per device) — **must share workspace with target** |
| POST | `/api/v1/keys/distribute`                             | submit encrypted key distribution; must own `from_device_id` and be channel member |
| GET  | `/api/v1/keys/pending/{device_id}`                   | poll pending distributions for caller's device |
| POST | `/api/v1/keys/delivered/{dist_id}`                   | ack delivery |
| GET  | `/api/v1/keys/epochs/{channel_id}`                   | list epochs (must be channel member) |
| POST | `/api/v1/keys/epochs/{channel_id}`                   | initialize epoch 0 |
| POST | `/api/v1/keys/epochs/{channel_id}/rotate`            | rotate, emits `keys.rotate` |
| POST | `/api/v1/channels/{channel_id}/keys/request`         | publish `keys.request` event; must own `requester_device_id` |

The wire shapes for `UploadDeviceKeysRequest`, `DistributeKeysRequest`,
and the prekey bundle live in `crates/rs-crypto/src/`. **The SDK
implementer should consume these directly from `klank-crypto` rather
than re-derive them in TypeScript** (see Crypto headers section
below). They are intentionally not transcribed here because Phase G
will hand the SDK the crate as a dependency.

### Pending key request bodies seen in the handlers

```ts
// POST /channels/:channel_id/keys/request
interface RequestKeyBody {
  epoch: number;
  requester_device_id: string;
}

// POST /keys/devices/:device_id/prekeys
type ReplenishPrekeysRequest = number[][];   // Vec<Vec<u8>>: arrays of byte arrays
```
(`crates/rs-api/src/handlers/keys.rs:46-50`,
`crates/rs-api/src/handlers/keys.rs:117`).

---

## Real-time / WebSocket

### Connect
1. Obtain a ticket via `POST /api/v1/auth/ws-ticket` (user) or
   `POST /api/v1/auth/bot-ws-ticket` (bot). The bot ticket endpoint
   rejects user JWTs with 400 (`auth.rs:381-385`).
2. Open a WebSocket to `GET /api/v1/ws?ticket=<ticket>` (no
   `Authorization` header — the ticket is consumed and deleted in a
   single SQL `DELETE … RETURNING user_id` statement,
   `ws.rs:29-33`).
3. The server pre-subscribes the connection to every channel the user
   currently belongs to (`ws.rs:46-52`).

### Frame format
- All frames are JSON text. Binary frames are ignored
  (`crates/rs-realtime/src/connection.rs:69`).
- The server uses tokio broadcast; on lag the SDK receives a special
  envelope (see `events.missed`).

### Server → client envelope
Server events use serde's internally tagged enum with `tag = "type"`
(`crates/rs-realtime/src/events.rs:7-8`). Every event is a JSON object
whose `type` field tells you which variant it is, with the rest of the
fields flattened to top level.

Complete list (`crates/rs-realtime/src/events.rs:9-216`):

#### Messages
- `message.new`
  ```ts
  {
    type: "message.new";
    channel_id: string;
    message_id: string;
    sender_id: string;
    sender_type: string;
    content_type: string;
    ciphertext: number[] | null;
    plaintext: string | null;
    nonce: number[] | null;
    key_epoch: number | null;
    thread_id: string | null;
    created_at: string;
    mentions?: string[];   // omitted when empty
  }
  ```
- `message.updated`
  ```ts
  { type: "message.updated"; channel_id; message_id; edited_at;
    content_type; plaintext; ciphertext; nonce; key_epoch; }
  ```
- `message.deleted`
  ```ts
  { type: "message.deleted"; channel_id; message_id; }
  ```

#### Reactions
- `reaction.added` → `{ channel_id, message_id, user_id, emoji }`
- `reaction.removed` → same fields

#### Typing
- `typing.start` / `typing.stop` → `{ channel_id, user_id }`
- The server auto-emits `typing.stop` 5 seconds after the last
  client `typing` event for the same `(user, channel)` tuple
  (`connection.rs:182-189`).

#### Channels
- `channel.created` → `{ workspace_id, channel_id, name, kind }`
- `channel.deleted` → `{ workspace_id, channel_id }`
- `channel.member_joined` / `channel.member_left` → `{ channel_id, user_id }`
- `channel.member_added` (E2EE only) →
  `{ channel_id, user_id, epoch }` — emitted when a new member joins a
  channel that already has an active key epoch, asking other members to
  rewrap the channel key for the new device set.

#### Presence
- `presence.update` → `{ user_id, status }` where status ∈
  `"online" | "away" | "offline"`.

#### E2EE keys
- `keys.request` → `{ channel_id, requester_user_id, requester_device_id, epoch }`
- `device.registered` → `{ user_id, device_id }` — broadcast widely;
  client must filter by checking its own channel memberships
  (`events.rs:108-120`).
- `keys.delivered` → `{ channel_id, to_device_id, epoch }` (only sent
  to the owning user — `connection.rs:108-112`).
- `keys.rotate` → `{ channel_id, new_epoch }`
- `keys.low` → `{ device_id, remaining }`

#### Canvas
- `canvas.sync` / `canvas.awareness` → `{ canvas_id, sender_id, data }`

#### Channel tabs
- `tab.added` → `{ channel_id, tab: any }`
- `tab.removed` → `{ channel_id, tab_id }`
- `tab.updated` → `{ channel_id, tabs: any[] }`

#### Custom emoji
- `emoji.created` / `emoji.deleted` → `{ workspace_id, emoji_id }`

#### Import progress
- `import.progress` → `{ job_id, user_id, phase, progress_pct, current_item }`

#### Huddles
- `huddle.started` → `{ channel_id, huddle_id, started_by }`
- `huddle.participant_joined` / `huddle.participant_left` →
  `{ channel_id, huddle_id, user_id }`
- `huddle.ended` → `{ channel_id, huddle_id }`

### `events.missed` semantics
**This is NOT a `ServerEvent` variant.** It is a sentinel envelope
emitted directly by the connection task when the broadcast receiver
returns `Lagged(n)` (`crates/rs-realtime/src/connection.rs:41-52`):

```json
{ "type": "events.missed", "count": <n> }
```

Trigger: the SDK's tokio broadcast slot fell behind by `n` events
(slow consumer or transient backpressure). The SDK should treat this
as **"the firehose is incomplete"** and reconcile state by:
- Re-fetching the last page of `/messages` for any channel the user
  is actively viewing.
- Re-fetching `/keys/pending/{device_id}` if E2EE is in use.
- Re-fetching presence for visible users.

The connection itself remains open; only events were dropped.

### Client → server events
Defined in `crates/rs-realtime/src/events.rs:222-243`. Same
`{ type, ...payload }` envelope:

- `typing` → `{ channel_id }` (must be a member of the channel —
  rejected silently otherwise, `connection.rs:163-173`).
- `presence` → `{ status: "online" | "away" | "offline" }`
- `ping` → no-op
- `canvas.join` → `{ canvas_id }` (must be canvas owner/collaborator)
- `canvas.leave` → `{ canvas_id }`
- `canvas.sync` → `{ canvas_id, data: string }` (capped at 512 KiB,
  dropped silently if larger — `connection.rs:225-234`)
- `canvas.awareness` → `{ canvas_id, data: string }`

### Reconnect & backoff
The server does not implement application-level pings beyond axum's
WebSocket pongs (`connection.rs:69` ignores client `ping` opcode;
`ClientEvent::Ping` is a no-op). The SDK should:
- Reconnect on close with exponential backoff (e.g. 1s → 30s).
- Always obtain a **fresh** ticket on reconnect (tickets are
  single-use and 30s TTL).
- After reconnect, treat all in-memory channel state as potentially
  stale and reconcile via REST (same approach as `events.missed`).

### Event filtering
The server filters per-user before sending — see
`should_send_to_user` at `connection.rs:85-156`. Channel-scoped events
only reach users currently subscribed to that channel in the hub. New
DM creation re-subscribes both members in the hub explicitly
(`channel.rs:108-118`).

---

## Rate limiting

| Endpoint group | Limit | Source |
|---|---|---|
| `register`, `login`, `forgot-password`, `reset-password` | burst 10, refill 1/6s per IP | `auth.rs:22-34` |
| `refresh` | burst 12, refill 1/5s per IP | `auth.rs:39-48` |
| Everything else | unlimited | (no `GovernorLayer` applied) |

The IP key extractor is `SmartIpKeyExtractor` (`tower-governor`),
which honors `X-Forwarded-For` set by the upstream Caddy reverse
proxy.

**Headers returned on rate-limit hit:** governed by `tower-governor`
defaults. The SDK should treat HTTP `429` as the signal and read
`Retry-After` (in seconds) when present. We do **not** emit
`X-RateLimit-*` headers ourselves.

Other server-side caps that act like rate limits even though they're
not in the limiter:
- WebSocket canvas sync payload: 512 KiB drop
  (`connection.rs:225`).
- File uploads: `max_file_size_bytes` from config.
- crypto_header: 4096 bytes (`files.rs:19-26`).

---

## CORS

Defined in `crates/rs-api/src/lib.rs:49-98`.

Always-allowed origins (hard-coded allowlist, no wildcards):
- `https://tauri.localhost`
- `tauri://localhost`
- `http://tauri.localhost`
- `http://localhost:5173`
- `http://localhost:1420`
- `http://127.0.0.1:5173`
- `http://127.0.0.1:1420`

Plus, when configured:
- `APP_URL` (the canonical web frontend; trailing slash trimmed).
- Anything in the `CORS_ORIGINS` env var, comma-separated.

Adding a new origin: set `CORS_ORIGINS=https://chat.example.com,...`
on the server process and restart. There is no API for adding origins
at runtime.

Allowed methods: `GET, POST, PATCH, DELETE, OPTIONS`.
Allowed headers: `Authorization, Content-Type, Accept`.
Credentials: allowed (`allow_credentials(true)`).

Tauri WebViews send no `Origin` header — those requests bypass the
predicate entirely (intentional, see `lib.rs:80-87`).

Other security headers, set globally on every response:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`

---

## Crypto headers (Phase G — full bot E2EE)

The server treats `crypto_header` as an opaque JSON blob — it never
inspects fields (`crates/rs-api/src/handlers/files.rs:28-35`). The
schema is owned by `klank-crypto`. For SDK Phase G, the implementer
should:

1. Add `klank-crypto` (the `crates/rs-crypto/` crate) as a dependency
   in whatever form the SDK consumes Rust code (wasm-bindgen, neon,
   napi-rs, or a Rust→TS port).
2. Use it to:
   - Generate device keys → POST `/api/v1/keys/devices`
   - Wrap channel keys for new members → `/api/v1/keys/distribute`
   - Build the `crypto_header` JSON for file uploads
3. The MLS-style group epoch model is encoded in
   `channel_key_epochs` (status `'active'` / non-active). The SDK
   only needs to know:
   - There may be many epochs per channel; the **active** one is what
     new messages must use.
   - Rotation is explicit (`POST /keys/epochs/{channel_id}/rotate`).
   - When the rotated `keys.rotate` event arrives, all subsequent
     messages should target the new `epoch`.

For now (Phases 0-F), bots typically operate in non-E2EE channels.

---

## Open questions

The SDK team will need answers to these before they can finish Phase 0:

1. **Vec<u8> wire encoding for messages.** The Rust types
   `ciphertext: Option<Vec<u8>>` and `nonce: Option<Vec<u8>>` use
   serde's default `Vec<u8>` serialization, which produces a JSON
   array of integers `[10, 20, ...]`, not base64. The doc-comment in
   `messages.rs:23` says "Base64-encoded ciphertext" but no
   `#[serde(with = "base64")]` attribute is present. **Confirm:** does
   the existing TS client send arrays-of-ints, or has the encoding
   been changed somewhere I haven't looked? This affects every
   E2EE message send.

2. **Webhook replay protection.** There is no timestamp window or
   nonce on the incoming webhook signing scheme — a captured
   `(X-Klank-Webhook-Key, X-Klank-Signature, body)` triple is
   indefinitely replayable. Is this acceptable for the SDK to expose,
   or should we add a `X-Klank-Timestamp` header + max-age check
   before shipping the SDK?

3. **Webhook E2EE bypass.** Incoming webhook → `bots.rs:144-156`
   inserts a `content_type='plaintext'` message even when the
   target channel has an active key epoch (the `H-1` rejection only
   runs in `send_message`). This means a bot using webhooks can
   silently leak plaintext into an E2EE channel. **Is this intended?**
   If not, we need to mirror the H-1 check there before the SDK
   advertises webhook support.

4. **Slash command registration endpoint.** `slash_commands.rs`
   only contains the dispatch helper; there is no `POST
   /api/v1/.../slash_commands` route registered in any handler I
   reviewed. How does an operator register a slash command and its
   `signing_secret`? Is this still TODO?

5. **Webhook delete endpoint.** `bots.rs:22-33` only registers
   `create` and `list` for webhooks. Deletion / rotation of the
   secret is not exposed. Confirm whether this is by design.

6. **Bot delete / token rotation.** Same gap — `BotService` has no
   `delete` or `rotate_token` method, and no DELETE route exists.

7. **Bot adding itself to a channel.** Bots cannot self-join (they
   have no `user_id`). The current path is for a workspace admin to
   call `POST /channels/{id}/members` with the bot's id, but the
   `channel_members.role` enum and the rest of the membership code
   are designed around `users.id`. Is the FK actually defined as
   permissive enough to insert a bot id? **The SDK needs the
   "add bot to channel" flow nailed down before any /channels/.../messages
   call from a bot will work** (channel-membership is enforced on
   send).

8. **`message.new` `mentions` for bots.** When the server publishes
   `message.new` for a bot/webhook message, it extracts mentions from
   `payload.text` (`bots.rs:159`). For an E2EE channel (where the bot
   should not be sending plaintext), there is no path that surfaces
   mentions. The SDK should clarify how bots are supposed to detect
   "I was mentioned" in E2EE channels.

9. **Outbound webhook (kind="outgoing") dispatch path.** `kind` can
   be `"incoming"` or `"outgoing"`, but no code in the files reviewed
   reads outgoing webhooks back out and dispatches them on
   `message.new`. The SDK should not promise outgoing webhooks until
   that path is verified.

10. **Bot WS subscriptions.** `create_bot_ws_ticket` stores the bot's
    id in `ws_tickets.user_id` (`auth.rs:391`), and `ws_upgrade`
    pre-subscribes by `channel_members.user_id = <id>`. If bots are
    not actually inserted into `channel_members`, the bot's WS
    connection will receive zero channel-scoped events. This needs
    confirmation alongside (7).
