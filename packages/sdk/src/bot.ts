import { KlankClient } from './client.js'
import { ContextError, UnsupportedError } from './errors.js'
import type {
  BotConfig,
  BotContext,
  BotInfo,
  CommandContext,
  CommandHandler,
  CommandInvokedEvent,
  EventAliases,
  EventHandler,
  EventName,
  MessageHandler,
  Middleware,
  ResolveEvent,
  ServerEvent,
  ServerEventType,
} from './types.js'
import { WsManager } from './ws.js'

/**
 * Short names `on()` accepts alongside wire names. `satisfies EventAliases`
 * pins both the key set and every target, so this table cannot drift from the
 * type that `ResolveEvent` uses to narrow handler arguments.
 */
const ALIAS_TO_WIRE = {
  message: 'message.new',
  message_updated: 'message.updated',
  message_deleted: 'message.deleted',
  reaction_added: 'reaction.added',
  reaction_removed: 'reaction.removed',
  typing: 'typing.start',
  typing_stop: 'typing.stop',
  channel_created: 'channel.created',
  channel_deleted: 'channel.deleted',
  member_joined: 'channel.member_joined',
  member_left: 'channel.member_left',
  presence: 'presence.update',
} as const satisfies EventAliases

/** Type guard so the negative branch below subtracts aliases from the union. */
function isAlias(name: EventName): name is keyof EventAliases {
  return name in ALIAS_TO_WIRE
}

/**
 * Alias or wire name → wire name. Takes a plain `EventName` rather than the
 * caller's generic `N`: a type predicate cannot subtract from an unresolved
 * type parameter, so narrowing only works once the union is concrete.
 */
function resolveEventName(name: EventName): ServerEventType {
  return isAlias(name) ? ALIAS_TO_WIRE[name] : name
}

/** Connects to Klank over the WebSocket and routes events to handlers. */
export class KlankBot {
  private readonly client: KlankClient
  private readonly ws: WsManager
  private readonly config: BotConfig
  /** Ids the server stamps on this bot's own posts: its bot id plus any webhook it posts through. */
  private readonly webhookIds: Set<string>
  private botInfo: BotInfo | null = null

  /**
   * Handlers keyed by resolved wire type. Stored as `EventHandler<never>` so a
   * handler for one narrow variant is assignable in (parameter contravariance);
   * dispatch casts back, safe because the key it was filed under is `event.type`.
   */
  private readonly eventHandlers = new Map<ServerEventType, EventHandler<never>[]>()
  private readonly commandHandlers = new Map<string, CommandHandler>()
  private readonly messageMatchers: Array<{ pattern: RegExp; handler: MessageHandler }> = []
  private readonly middlewares: Middleware[] = []
  private errorHandler: ((err: Error, event?: ServerEvent) => void) | null = null
  private signalHandler: (() => void) | null = null

  constructor(config: BotConfig) {
    this.config = config
    this.webhookIds = new Set(config.webhookIds ?? [])
    this.client = new KlankClient(config.serverUrl, config.token, config.client)
    this.ws = new WsManager(config.serverUrl, () => this.client.getWsTicket(), {
      reconnect: config.reconnect ?? true,
      ...config.ws,
    })

    this.ws.onEvent((event) => {
      void this.handleEvent(event)
    })
    this.ws.onError((err) => this.reportError(err))
  }

  /** Register an event handler by wire name (`'message.new'`) or alias (`'message'`). */
  on<N extends EventName>(name: N, handler: EventHandler<ResolveEvent<N>>): this {
    const wire = resolveEventName(name)
    const handlers = this.eventHandlers.get(wire)
    if (handlers) handlers.push(handler)
    else this.eventHandlers.set(wire, [handler])
    return this
  }

  /** Remove a previously registered handler. The same function reference must be passed. */
  off<N extends EventName>(name: N, handler: EventHandler<ResolveEvent<N>>): this {
    const wire = resolveEventName(name)
    const handlers = this.eventHandlers.get(wire)
    if (!handlers) return this
    const index = handlers.indexOf(handler)
    if (index !== -1) handlers.splice(index, 1)
    if (handlers.length === 0) this.eventHandlers.delete(wire)
    return this
  }

  /** Register a slash command handler. `name` includes the leading slash, e.g. `'/deploy'`. */
  command(name: string, handler: CommandHandler): this {
    this.commandHandlers.set(name, handler)
    return this
  }

  /** Match `message.new` text. A string is compiled as an unanchored `RegExp`. */
  message(pattern: RegExp | string, handler: MessageHandler): this {
    this.messageMatchers.push({
      pattern: typeof pattern === 'string' ? new RegExp(pattern) : pattern,
      handler,
    })
    return this
  }

  /** Add middleware. It runs before handlers and may short-circuit by not calling `next()`. */
  use(middleware: Middleware): this {
    this.middlewares.push(middleware)
    return this
  }

  /** Replace the error sink. Without one, errors go to `console.error`. */
  onError(handler: (err: Error, event?: ServerEvent) => void): this {
    this.errorHandler = handler
    return this
  }

  /** Fetch bot info, then connect the WebSocket. */
  async start(): Promise<void> {
    this.botInfo = await this.client.getBotInfo()
    await this.ws.connect()
    // Opt-in: a library must not hijack process signals from its host by default.
    if (this.config.handleSignals === true && this.signalHandler === null) {
      const shutdown = () => this.stop()
      this.signalHandler = shutdown
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    }
  }

  /** Disconnect and remove any installed signal handlers. Safe to call more than once. */
  stop(): void {
    if (this.signalHandler) {
      process.off('SIGINT', this.signalHandler)
      process.off('SIGTERM', this.signalHandler)
      this.signalHandler = null
    }
    this.ws.disconnect()
  }

  /** The low-level REST client. */
  getClient(): KlankClient {
    return this.client
  }

  /** Bot identity, available after `start()` resolves. */
  getBotInfo(): BotInfo | null {
    return this.botInfo
  }

  // ── Internal ──

  private async handleEvent(event: ServerEvent): Promise<void> {
    // Webhook posts come back stamped with the webhook id, REST posts with the bot id.
    // Both are this bot talking, so neither may re-enter routing (echo loop).
    if (
      event.type === 'message.new' &&
      (event.sender_id === this.botInfo?.bot_id || this.webhookIds.has(event.sender_id))
    ) {
      return
    }

    const ctx = this.buildContext(event)
    try {
      let index = 0
      const next = async (): Promise<void> => {
        const middleware = this.middlewares[index++]
        if (!middleware) {
          await this.dispatch(event, ctx)
          return
        }
        let advanced = false
        await middleware(event, ctx, async () => {
          if (advanced) throw new Error('Middleware called next() more than once')
          advanced = true
          await next()
        })
      }
      await next()
    } catch (err) {
      this.reportError(err instanceof Error ? err : new Error(String(err)), event)
    }
  }

  /** Terminal step of the middleware chain: type handlers, then matchers, then commands. */
  private async dispatch(event: ServerEvent, ctx: BotContext): Promise<void> {
    const handlers = this.eventHandlers.get(event.type)
    if (handlers) {
      // Copy: a handler may register or remove handlers while this loop runs.
      for (const handler of [...handlers]) {
        await (handler as EventHandler)(event, ctx)
      }
    }

    if (event.type === 'message.new') {
      const text = event.plaintext ?? ''
      for (const { pattern, handler } of [...this.messageMatchers]) {
        const matches = text.match(pattern)
        if (matches) await handler(event, ctx, matches)
      }
    }

    if (event.type === 'command.invoked') {
      const handler = this.commandHandlers.get(event.command)
      if (handler) await handler(event, this.buildCommandContext(event))
    }
  }

  private buildContext(event: ServerEvent): BotContext {
    const channelId = 'channel_id' in event ? event.channel_id : undefined
    const messageId = 'message_id' in event ? event.message_id : undefined
    // Replying to a threaded message posts into that same thread, not a nested one.
    const threadRoot = 'thread_id' in event ? event.thread_id : null

    const requireChannel = (helper: string): string => {
      if (channelId === undefined) {
        throw new ContextError(`ctx.${helper}() needs a channel, but '${event.type}' has none`)
      }
      return channelId
    }
    const requireMessage = (helper: string): string => {
      if (messageId === undefined) {
        throw new ContextError(`ctx.${helper}() needs a message, but '${event.type}' has none`)
      }
      return messageId
    }

    return {
      event,
      say: (text) => this.client.sendMessage(requireChannel('say'), text),
      reply: (text) =>
        this.client.sendMessage(requireChannel('reply'), text, {
          threadId: threadRoot ?? requireMessage('reply'),
        }),
      react: (emoji) => this.client.addReaction(requireMessage('react'), emoji),
      unreact: (emoji) => this.client.removeReaction(requireMessage('unreact'), emoji),
      sendMessage: (channel, text, options) => this.client.sendMessage(channel, text, options),
    }
  }

  private buildCommandContext(cmd: CommandInvokedEvent): CommandContext {
    return {
      respond: async (response) => {
        if (response.responseType === 'ephemeral') {
          throw new UnsupportedError(
            'Ephemeral slash responses are not supported by the Klank server yet',
          )
        }
        await this.client.sendMessage(cmd.channel_id, response.text)
      },
      say: (text) => this.client.sendMessage(cmd.channel_id, text),
    }
  }

  private reportError(err: Error, event?: ServerEvent): void {
    if (this.errorHandler) {
      this.errorHandler(err, event)
      return
    }
    console.error('[klank] unhandled bot error:', err)
  }
}
