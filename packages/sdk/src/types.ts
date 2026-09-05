// Wire types for the Klank server. Field names and shapes mirror the server
// source exactly (snake_case, RFC3339 timestamps, UUID strings):
//   - REST models:  crates/rs-db/src/models.rs, crates/rs-messaging/src/*.rs
//   - WS events:    crates/rs-realtime/src/events.rs (serde `tag = "type"`)
// Pinned server commit: see README "Server Compatibility".

// ── Config ──

export interface BotConfig {
  /** Bot API token (`bot_` + 64 hex chars). Shown once at creation. */
  token: string
  /** Klank server origin, e.g. `https://chat.example.com`. */
  serverUrl: string
  /** Reconnect the WebSocket after an unexpected close. Default `true`. */
  reconnect?: boolean
  /**
   * Incoming-webhook IDs this bot posts through. The server stamps webhook
   * posts with `sender_id = webhook_id`, so these are treated as self and
   * suppressed from `message.new` routing (prevents echo loops).
   */
  webhookIds?: string[]
  /** Install SIGINT/SIGTERM handlers that call `stop()`. Default `false`. */
  handleSignals?: boolean
  /** WebSocket reconnect/heartbeat tuning. */
  ws?: WsOptions
  /** REST retry tuning and fetch override. */
  client?: ClientOptions
}

export interface WsOptions {
  /** First reconnect delay in ms. Default 1000. */
  baseDelayMs?: number
  /** Reconnect delay ceiling in ms. Default 30000. */
  maxDelayMs?: number
  /** Give up after this many consecutive failed reconnects. Default `Infinity`. */
  maxAttempts?: number
  /** Application heartbeat (`{"type":"ping"}` + WS ping) interval in ms. Default 30000. `0` disables. */
  heartbeatMs?: number
  /** Close the socket if no pong arrives within this many ms of a ping. Default 10000. */
  pongTimeoutMs?: number
}

export interface ClientOptions {
  /** `fetch` implementation. Default: global `fetch`. */
  fetch?: typeof fetch
  /** Max attempts for a 429 before throwing `RateLimitedError`. Default 5. */
  maxRetries?: number
  /** Base delay in ms for 5xx retries (exponential, jittered). Default 250. */
  retryBaseMs?: number
}

export interface WebhookConfig {
  webhookId: string
  /** Raw webhook secret (48 hex chars) returned once at creation. */
  webhookSecret: string
  serverUrl: string
  /** `fetch` implementation. Default: global `fetch`. */
  fetch?: typeof fetch
}

// ── REST models ──

export type SenderType = 'user' | 'bot'
export type ContentType = 'encrypted' | 'plaintext'
export type ChannelKind = 'public' | 'private' | 'dm'
export type PresenceStatus = 'online' | 'away' | 'offline'

export interface Message {
  id: string
  channel_id: string
  /** A user id, a bot id, or — for incoming-webhook posts — the webhook id. */
  sender_id: string
  sender_type: SenderType
  content_type: ContentType
  /** Raw bytes as a JSON array of numbers (serde `Vec<u8>` default). */
  ciphertext: number[] | null
  plaintext: string | null
  nonce: number[] | null
  key_epoch: number | null
  thread_id: string | null
  edited_at: string | null
  deleted_at: string | null
  created_at: string
}

/** Rows from `GET /channels/{id}/messages` carry an extra `has_files` flag. */
export type MessageListItem = Message & { has_files: boolean }

export interface CursorPage<T> {
  items: T[]
  next_cursor: string | null
  has_more: boolean
}

export interface CursorParams {
  /** Start after this id (exclusive). */
  cursor?: string
  /** Default 50, clamped to [1, 100] server-side. */
  limit?: number
}

export interface Channel {
  id: string
  workspace_id: string
  name: string
  topic: string | null
  purpose: string | null
  kind: ChannelKind
  is_archived: boolean
  created_by: string
  created_at: string
  updated_at: string
}

/** `GET /workspaces/{wid}/channels` rows. */
export interface ChannelWithMembers extends Channel {
  member_count: number
  /** Present only for `kind === 'dm'`. */
  dm_user_id?: string
}

export interface Reaction {
  message_id: string
  user_id: string
  emoji: string
  created_at: string
}

export interface User {
  id: string
  email: string
  display_name: string
  avatar_url: string | null
  status: string
  status_text: string | null
}

export interface BotInfo {
  bot_id: string
  workspace_id: string
  name: string
  scopes: string[]
}

export interface WsTicket {
  ticket: string
  /** Seconds until the single-use ticket expires (30). */
  expires_in: number
}

/** Error envelope returned by every non-2xx server response. */
export interface ErrorBody {
  /** HTTP canonical reason, e.g. `"Bad Request"`. */
  error: string
  message: string
}

// ── Slash commands (Klank → bot, HTTP) ──

/** Body Klank POSTs to a slash command URL. Signed via `X-Klank-Signature`. */
export interface SlashCommandPayload {
  command: string
  text: string
  user_id: string
  channel_id: string
  workspace_id: string
}

/** JSON the slash command endpoint must return (2xx). */
export interface SlashCommandResponse {
  response_type: 'ephemeral' | 'in_channel'
  /** Markdown. */
  text: string
}

// ── WebSocket events (server → client) ──
// One interface per `ServerEvent` variant in crates/rs-realtime/src/events.rs.

export interface MessageNewEvent {
  type: 'message.new'
  channel_id: string
  message_id: string
  sender_id: string
  sender_type: SenderType
  content_type: ContentType
  ciphertext: number[] | null
  plaintext: string | null
  nonce: number[] | null
  key_epoch: number | null
  thread_id: string | null
  created_at: string
  /** User ids mentioned via `<@uuid>`. Omitted by the server when empty. */
  mentions?: string[]
}

export interface MessageUpdatedEvent {
  type: 'message.updated'
  channel_id: string
  message_id: string
  edited_at: string
  content_type: ContentType
  plaintext: string | null
  ciphertext: number[] | null
  nonce: number[] | null
  key_epoch: number | null
}

export interface MessageDeletedEvent {
  type: 'message.deleted'
  channel_id: string
  message_id: string
}

export interface ReactionAddedEvent {
  type: 'reaction.added'
  channel_id: string
  message_id: string
  user_id: string
  emoji: string
}

export interface ReactionRemovedEvent {
  type: 'reaction.removed'
  channel_id: string
  message_id: string
  user_id: string
  emoji: string
}

export interface TypingStartEvent {
  type: 'typing.start'
  channel_id: string
  user_id: string
}

/** Auto-emitted by the server 5s after the last typing signal. */
export interface TypingStopEvent {
  type: 'typing.stop'
  channel_id: string
  user_id: string
}

export interface ChannelCreatedEvent {
  type: 'channel.created'
  workspace_id: string
  channel_id: string
  name: string
  kind: ChannelKind
}

export interface ChannelDeletedEvent {
  type: 'channel.deleted'
  workspace_id: string
  channel_id: string
}

export interface ChannelMemberJoinedEvent {
  type: 'channel.member_joined'
  channel_id: string
  user_id: string
}

export interface ChannelMemberLeftEvent {
  type: 'channel.member_left'
  channel_id: string
  user_id: string
}

/** E2EE: a member joined a channel that already has a key epoch. */
export interface ChannelMemberAddedEvent {
  type: 'channel.member_added'
  channel_id: string
  user_id: string
  epoch: number
}

export interface PresenceUpdateEvent {
  type: 'presence.update'
  user_id: string
  status: PresenceStatus
}

export interface UserUpdatedEvent {
  type: 'user.updated'
  user_id: string
  display_name: string
  avatar_url: string | null
}

export interface KeysRequestEvent {
  type: 'keys.request'
  channel_id: string
  requester_user_id: string
  requester_device_id: string
  epoch: number
}

export interface DeviceRegisteredEvent {
  type: 'device.registered'
  user_id: string
  device_id: string
}

export interface DeviceDeletedEvent {
  type: 'device.deleted'
  user_id: string
  device_id: string
}

export interface KeysDeliveredEvent {
  type: 'keys.delivered'
  channel_id: string
  to_device_id: string
  epoch: number
}

export interface KeysRotateEvent {
  type: 'keys.rotate'
  channel_id: string
  new_epoch: number
}

export interface KeysLowEvent {
  type: 'keys.low'
  device_id: string
  remaining: number
}

export interface CanvasSyncEvent {
  type: 'canvas.sync'
  canvas_id: string
  sender_id: string
  data: string
}

export interface CanvasAwarenessEvent {
  type: 'canvas.awareness'
  canvas_id: string
  sender_id: string
  data: string
}

export interface TabAddedEvent {
  type: 'tab.added'
  channel_id: string
  tab: unknown
}

export interface TabRemovedEvent {
  type: 'tab.removed'
  channel_id: string
  tab_id: string
}

export interface TabUpdatedEvent {
  type: 'tab.updated'
  channel_id: string
  tabs: unknown[]
}

export interface EmojiCreatedEvent {
  type: 'emoji.created'
  workspace_id: string
  emoji_id: string
}

export interface EmojiDeletedEvent {
  type: 'emoji.deleted'
  workspace_id: string
  emoji_id: string
}

export interface ImportProgressEvent {
  type: 'import.progress'
  job_id: string
  user_id: string
  phase: string
  progress_pct: number
  current_item: string | null
}

export interface HuddleStartedEvent {
  type: 'huddle.started'
  channel_id: string
  huddle_id: string
  started_by: string
}

export interface HuddleParticipantJoinedEvent {
  type: 'huddle.participant_joined'
  channel_id: string
  huddle_id: string
  user_id: string
}

export interface HuddleParticipantLeftEvent {
  type: 'huddle.participant_left'
  channel_id: string
  huddle_id: string
  user_id: string
}

export interface HuddleEndedEvent {
  type: 'huddle.ended'
  channel_id: string
  huddle_id: string
}

/**
 * Sentinel written by the connection task (not a `ServerEvent` variant
 * server-side) when this socket fell `count` events behind the broadcast.
 * Treat in-memory state as stale and re-fetch via REST.
 */
export interface EventsMissedEvent {
  type: 'events.missed'
  count: number
}

/**
 * Slash command delivered over the WebSocket.
 *
 * RESERVED: no released Klank server emits this yet — slash commands are
 * currently dispatched only over HTTP (see `verifySlashCommandSignature`).
 * Kept so `bot.command()` handlers compile ahead of server support.
 */
export interface CommandInvokedEvent {
  type: 'command.invoked'
  command: string
  text: string
  user_id: string
  channel_id: string
  workspace_id: string
}

export type ServerEvent =
  | MessageNewEvent
  | MessageUpdatedEvent
  | MessageDeletedEvent
  | ReactionAddedEvent
  | ReactionRemovedEvent
  | TypingStartEvent
  | TypingStopEvent
  | ChannelCreatedEvent
  | ChannelDeletedEvent
  | ChannelMemberJoinedEvent
  | ChannelMemberLeftEvent
  | ChannelMemberAddedEvent
  | PresenceUpdateEvent
  | UserUpdatedEvent
  | KeysRequestEvent
  | DeviceRegisteredEvent
  | DeviceDeletedEvent
  | KeysDeliveredEvent
  | KeysRotateEvent
  | KeysLowEvent
  | CanvasSyncEvent
  | CanvasAwarenessEvent
  | TabAddedEvent
  | TabRemovedEvent
  | TabUpdatedEvent
  | EmojiCreatedEvent
  | EmojiDeletedEvent
  | ImportProgressEvent
  | HuddleStartedEvent
  | HuddleParticipantJoinedEvent
  | HuddleParticipantLeftEvent
  | HuddleEndedEvent
  | EventsMissedEvent
  | CommandInvokedEvent

export type ServerEventType = ServerEvent['type']

/** Narrow the union to one variant by its `type` literal. */
export type EventOf<T extends ServerEventType> = Extract<ServerEvent, { type: T }>

/** Short handler names accepted by `bot.on()` alongside the wire names. */
export interface EventAliases {
  message: 'message.new'
  message_updated: 'message.updated'
  message_deleted: 'message.deleted'
  reaction_added: 'reaction.added'
  reaction_removed: 'reaction.removed'
  typing: 'typing.start'
  typing_stop: 'typing.stop'
  channel_created: 'channel.created'
  channel_deleted: 'channel.deleted'
  member_joined: 'channel.member_joined'
  member_left: 'channel.member_left'
  presence: 'presence.update'
}

export type EventName = ServerEventType | keyof EventAliases

/** Resolve a wire name or alias to its event payload type. */
export type ResolveEvent<N extends EventName> = N extends ServerEventType
  ? EventOf<N>
  : N extends keyof EventAliases
    ? EventOf<EventAliases[N]>
    : never

// ── Client → server WebSocket events ──

export type ClientEvent =
  | { type: 'typing'; channel_id: string }
  | { type: 'presence'; status: PresenceStatus }
  | { type: 'ping' }

// ── Handler types ──

export interface BotContext {
  /** The event this context was built for. */
  event: ServerEvent
  /** Send a message to the event's channel. */
  say(text: string): Promise<Message>
  /** Reply in the thread of the triggering message. */
  reply(text: string): Promise<Message>
  /** React to the triggering message. */
  react(emoji: string): Promise<void>
  /** Remove the bot's reaction from the triggering message. */
  unreact(emoji: string): Promise<void>
  /** Send a message to any channel. */
  sendMessage(channelId: string, text: string, options?: SendOptions): Promise<Message>
}

export interface SendOptions {
  /** Parent message id when replying in a thread. */
  threadId?: string
}

export interface CommandContext {
  /**
   * Respond to the slash command. `in_channel` posts to the channel.
   * `ephemeral` is not supported by the server and throws `UnsupportedError`.
   */
  respond(response: { responseType: 'ephemeral' | 'in_channel'; text: string }): Promise<void>
  /** Send a message to the channel where the command was invoked. */
  say(text: string): Promise<Message>
}

export type EventHandler<E extends ServerEvent = ServerEvent> = (
  event: E,
  ctx: BotContext,
) => Promise<void> | void

export type CommandHandler = (
  cmd: CommandInvokedEvent,
  ctx: CommandContext,
) => Promise<void> | void

export type MessageHandler = (
  event: MessageNewEvent,
  ctx: BotContext,
  matches: RegExpMatchArray,
) => Promise<void> | void

export type Middleware = (
  event: ServerEvent,
  ctx: BotContext,
  next: () => Promise<void>,
) => Promise<void> | void
