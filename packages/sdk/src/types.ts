// ── Config ──

export interface BotConfig {
  token: string
  serverUrl: string
  reconnect?: boolean // default true
}

export interface WebhookConfig {
  webhookId: string
  webhookSecret: string
  serverUrl: string
}

// ── API Types ──

export interface Message {
  id: string
  channel_id: string
  sender_id: string
  sender_type: 'user' | 'bot'
  content_type: 'encrypted' | 'plaintext'
  plaintext: string | null
  thread_id: string | null
  edited_at: string | null
  created_at: string
}

export interface Channel {
  id: string
  workspace_id: string
  name: string
  kind: 'public' | 'private' | 'dm'
  topic: string | null
  purpose: string | null
  member_count: number
}

export interface User {
  id: string
  email: string
  display_name: string
  avatar_url: string | null
  status: string
}

export interface BotInfo {
  bot_id: string
  workspace_id: string
  name: string
  scopes: string[]
}

// ── Event Types ──

export interface MessageEvent {
  type: 'message.new'
  channel_id: string
  message_id: string
  sender_id: string
  sender_type: string
  content_type: string
  plaintext: string | null
  thread_id: string | null
  created_at: string
}

export interface MessageUpdatedEvent {
  type: 'message.updated'
  channel_id: string
  message_id: string
  edited_at: string
}

export interface MessageDeletedEvent {
  type: 'message.deleted'
  channel_id: string
  message_id: string
}

export interface ReactionEvent {
  type: 'reaction.added' | 'reaction.removed'
  channel_id: string
  message_id: string
  user_id: string
  emoji: string
}

export interface TypingEvent {
  type: 'typing.start' | 'typing.stop'
  channel_id: string
  user_id: string
}

export interface ChannelEvent {
  type: 'channel.created'
  workspace_id: string
  channel_id: string
  name: string
  kind: string
}

export interface MemberEvent {
  type: 'channel.member_joined' | 'channel.member_left'
  channel_id: string
  user_id: string
}

export interface PresenceEvent {
  type: 'presence.update'
  user_id: string
  status: 'online' | 'away' | 'offline'
}

export interface CommandEvent {
  type: 'command.invoked'
  command: string
  text: string
  user_id: string
  channel_id: string
  workspace_id: string
}

export type ServerEvent =
  | MessageEvent
  | MessageUpdatedEvent
  | MessageDeletedEvent
  | ReactionEvent
  | TypingEvent
  | ChannelEvent
  | MemberEvent
  | PresenceEvent
  | CommandEvent

// ── Handler Types ──

export interface BotContext {
  /** Send a message to the current channel */
  say(text: string): Promise<Message>
  /** Reply in the thread of the triggering message */
  reply(text: string): Promise<Message>
  /** React to the triggering message */
  react(emoji: string): Promise<void>
  /** Send a message to any channel */
  sendMessage(channelId: string, text: string): Promise<Message>
}

export interface CommandContext {
  /** Respond to the slash command */
  respond(response: { responseType: 'ephemeral' | 'in_channel'; text: string }): Promise<void>
  /** Send a message to the channel where the command was invoked */
  say(text: string): Promise<Message>
}

export type EventHandler<E = ServerEvent> = (event: E, ctx: BotContext) => Promise<void> | void
export type CommandHandler = (cmd: CommandEvent, ctx: CommandContext) => Promise<void> | void
export type MessageHandler = (
  event: MessageEvent,
  ctx: BotContext,
  matches: RegExpMatchArray,
) => Promise<void> | void
export type Middleware = (
  event: ServerEvent,
  ctx: BotContext,
  next: () => Promise<void>,
) => Promise<void> | void
