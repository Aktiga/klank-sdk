import { KlankClient } from './client'
import { WsManager } from './ws'
import type {
  BotConfig, BotContext, BotInfo, CommandContext, CommandEvent, CommandHandler,
  EventHandler, Message, MessageEvent, MessageHandler, Middleware, ServerEvent,
} from './types'

/** Main bot class — connect to Klank and handle events. */
export class KlankBot {
  private client: KlankClient
  private ws: WsManager
  private config: BotConfig
  private botInfo: BotInfo | null = null

  private eventHandlers: Map<string, EventHandler[]> = new Map()
  private commandHandlers: Map<string, CommandHandler> = new Map()
  private messageMatchers: Array<{ pattern: RegExp; handler: MessageHandler }> = []
  private middlewares: Middleware[] = []
  private errorHandler: ((err: Error) => void) | null = null

  constructor(config: BotConfig) {
    this.config = { reconnect: true, ...config }
    this.client = new KlankClient(config.serverUrl, config.token)
    this.ws = new WsManager(
      config.serverUrl,
      () => this.client.getWsTicket(),
      this.config.reconnect,
    )

    this.ws.onEvent((event) => this.handleEvent(event))
  }

  /** Register an event handler. */
  on(eventType: string, handler: EventHandler): this {
    const handlers = this.eventHandlers.get(eventType) || []
    handlers.push(handler)
    this.eventHandlers.set(eventType, handlers)
    return this
  }

  /** Register a slash command handler. */
  command(name: string, handler: CommandHandler): this {
    this.commandHandlers.set(name, handler)
    return this
  }

  /** Register a message pattern matcher. */
  message(pattern: RegExp | string, handler: MessageHandler): this {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
    this.messageMatchers.push({ pattern: regex, handler })
    return this
  }

  /** Add middleware that runs before handlers. */
  use(middleware: Middleware): this {
    this.middlewares.push(middleware)
    return this
  }

  /** Register an error handler. */
  onError(handler: (err: Error) => void): this {
    this.errorHandler = handler
    return this
  }

  /** Start the bot: fetch bot info, connect WebSocket. */
  async start(): Promise<void> {
    this.botInfo = await this.client.getBotInfo()
    console.log(`[bot] ${this.botInfo.name} starting (workspace: ${this.botInfo.workspace_id})`)

    await this.ws.connect()
    console.log(`[bot] Connected to WebSocket`)

    // Handle shutdown signals
    const shutdown = () => this.stop()
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  }

  /** Stop the bot: disconnect WebSocket. */
  stop(): void {
    console.log('[bot] Shutting down...')
    this.ws.disconnect()
  }

  /** Get the low-level REST client. */
  getClient(): KlankClient {
    return this.client
  }

  /** Get bot info (available after start). */
  getBotInfo(): BotInfo | null {
    return this.botInfo
  }

  // ── Internal ──

  private async handleEvent(event: ServerEvent): Promise<void> {
    try {
      // Skip self-messages
      if (event.type === 'message.new' && (event as MessageEvent).sender_id === this.botInfo?.bot_id) {
        return
      }

      const ctx = this.buildContext(event)

      // Run middleware chain
      let middlewareIndex = 0
      const next = async () => {
        if (middlewareIndex < this.middlewares.length) {
          const mw = this.middlewares[middlewareIndex++]
          if (mw) {
            await mw(event, ctx, next)
          }
        }
      }
      if (this.middlewares.length > 0) {
        await next()
      }

      // Route to specific handlers
      const eventType = event.type.replace('.', '_') // message.new -> message_new
      const handlers = this.eventHandlers.get(eventType) || []

      // Also check shorthand names
      const shorthands: Record<string, string> = {
        'message.new': 'message',
        'reaction.added': 'reaction_added',
        'reaction.removed': 'reaction_removed',
        'channel.member_joined': 'member_joined',
        'channel.member_left': 'member_left',
        'channel.created': 'channel_created',
        'presence.update': 'presence',
        'typing.start': 'typing',
      }
      const shorthand = shorthands[event.type]
      if (shorthand) {
        handlers.push(...(this.eventHandlers.get(shorthand) || []))
      }

      for (const handler of handlers) {
        await handler(event, ctx)
      }

      // Message pattern matching
      if (event.type === 'message.new') {
        const msgEvent = event as MessageEvent
        const text = msgEvent.plaintext || ''
        for (const { pattern, handler } of this.messageMatchers) {
          const matches = text.match(pattern)
          if (matches) {
            await handler(msgEvent, ctx, matches)
          }
        }
      }

      // Slash command routing
      if (event.type === 'command.invoked') {
        const cmdEvent = event as CommandEvent
        const handler = this.commandHandlers.get(cmdEvent.command)
        if (handler) {
          const cmdCtx = this.buildCommandContext(cmdEvent)
          await handler(cmdEvent, cmdCtx)
        }
      }
    } catch (err) {
      if (this.errorHandler) {
        this.errorHandler(err as Error)
      } else {
        console.error('[bot] Handler error:', err)
      }
    }
  }

  private buildContext(event: ServerEvent): BotContext {
    const channelId = 'channel_id' in event ? (event as any).channel_id : undefined
    const messageId = 'message_id' in event ? (event as any).message_id : undefined

    return {
      say: async (text: string) => {
        if (!channelId) throw new Error('No channel context')
        return this.client.sendMessage(channelId, text)
      },
      reply: async (text: string) => {
        if (!channelId || !messageId) throw new Error('No message context')
        return this.client.sendMessage(channelId, text, { threadId: messageId })
      },
      react: async (emoji: string) => {
        if (!messageId) throw new Error('No message context')
        await this.client.addReaction(messageId, emoji)
      },
      sendMessage: (chId: string, text: string) => this.client.sendMessage(chId, text),
    }
  }

  private buildCommandContext(cmd: CommandEvent): CommandContext {
    return {
      respond: async (response) => {
        // For now, respond by posting to the channel
        if (response.responseType === 'in_channel') {
          await this.client.sendMessage(cmd.channel_id, response.text)
        }
        // Ephemeral responses are more complex — would need server support
      },
      say: (text: string) => this.client.sendMessage(cmd.channel_id, text),
    }
  }
}
