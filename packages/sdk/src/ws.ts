import WebSocket from 'ws'
import { ConnectionError } from './errors.js'
import type { ClientEvent, ServerEvent, WsOptions } from './types.js'

export type WsEventCallback = (event: ServerEvent) => void
export type WsErrorCallback = (err: Error) => void

const DEFAULT_BASE_DELAY_MS = 1000
const DEFAULT_MAX_DELAY_MS = 30000
const DEFAULT_HEARTBEAT_MS = 30000
const DEFAULT_PONG_TIMEOUT_MS = 10000

/**
 * WebSocket connection to `{serverUrl}/api/v1/ws` with reconnect and heartbeat.
 *
 * Every attempt mints a fresh ticket via `ticketFn`: tickets are single-use with
 * a 30s TTL, so one can never be replayed across connects.
 */
export class WsManager {
  private readonly serverUrl: string
  private readonly ticketFn: () => Promise<string>
  private readonly reconnect: boolean
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  private readonly maxAttempts: number
  private readonly heartbeatMs: number
  private readonly pongTimeoutMs: number

  private ws: WebSocket | null = null
  private stopped = false
  /** Consecutive failed reconnect attempts since the last successful open. */
  private attempts = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private pongTimer: NodeJS.Timeout | null = null
  private readonly eventListeners = new Set<WsEventCallback>()
  private readonly errorListeners = new Set<WsErrorCallback>()

  constructor(
    serverUrl: string,
    ticketFn: () => Promise<string>,
    options: { reconnect: boolean } & WsOptions,
  ) {
    this.serverUrl = serverUrl
    this.ticketFn = ticketFn
    this.reconnect = options.reconnect
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
    this.maxAttempts = options.maxAttempts ?? Number.POSITIVE_INFINITY
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
    this.pongTimeoutMs = options.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS
  }

  /** Subscribe to parsed server events. Returns an unsubscribe function. */
  onEvent(cb: WsEventCallback): () => void {
    this.eventListeners.add(cb)
    return () => {
      this.eventListeners.delete(cb)
    }
  }

  /**
   * Subscribe to non-fatal failures: malformed frames, socket errors, event-listener
   * throws, and reconnect exhaustion (a `ConnectionError` carrying `attempts`).
   * Returns an unsubscribe function.
   */
  onError(cb: WsErrorCallback): () => void {
    this.errorListeners.add(cb)
    return () => {
      this.errorListeners.delete(cb)
    }
  }

  /** Open the socket. Rejects with `ConnectionError` if this first attempt fails. */
  async connect(): Promise<void> {
    this.stopped = false
    this.attempts = 0
    await this.open()
  }

  /** Close the socket and cancel any pending reconnect. Never reconnects afterwards. */
  disconnect(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopHeartbeat()
    const socket = this.ws
    this.ws = null
    socket?.close()
  }

  /** Send a client event. Silently dropped when the socket is not open. */
  send(event: ClientEvent): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event))
    }
  }

  // ── Internal ──

  /** One connection attempt. Settles exactly once: on `open`, or on the first `error`/`close`. */
  private async open(): Promise<void> {
    let ticket: string
    try {
      ticket = await this.ticketFn()
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      throw new ConnectionError(`Could not obtain WebSocket ticket: ${detail}`, { cause })
    }
    if (this.stopped) return

    const url = new URL(this.serverUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/v1/ws`
    url.search = ''
    url.searchParams.set('ticket', ticket)

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url)
      this.ws = socket
      /** The `connect()` promise has settled. */
      let settled = false
      /** The socket reached OPEN. A failed handshake emits `error` AND `close`;
       *  only a socket that was actually up may trigger the reconnect path. */
      let opened = false

      socket.on('open', () => {
        settled = true
        opened = true
        this.attempts = 0
        this.startHeartbeat(socket)
        resolve()
      })

      socket.on('message', (data) => this.handleFrame(data))

      socket.on('pong', () => {
        if (this.pongTimer) {
          clearTimeout(this.pongTimer)
          this.pongTimer = null
        }
      })

      socket.on('error', (err) => {
        if (!settled) {
          settled = true
          reject(new ConnectionError(`WebSocket connect failed: ${err.message}`, { cause: err }))
          return
        }
        // Post-handshake socket error; a pre-open one was already reported by the rejection.
        if (opened) this.emitError(err)
      })

      socket.on('close', (code, reason) => {
        if (this.ws === socket) {
          this.stopHeartbeat()
          this.ws = null
        }
        if (!settled) {
          settled = true
          reject(new ConnectionError(`WebSocket closed before open (code ${code})`))
          return
        }
        if (opened && this.reconnect && !this.stopped) {
          this.scheduleReconnect()
        }
      })
    })
  }

  private scheduleReconnect(): void {
    // Exponential backoff jittered to 0.8–1.2× so a fleet of bots does not retry in lockstep.
    const delay =
      Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** this.attempts) * (0.8 + 0.4 * Math.random())
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.stopped) return
      this.open().catch((cause: unknown) => {
        if (this.stopped) return
        this.attempts += 1
        if (this.attempts >= this.maxAttempts) {
          // Budget spent: stay down until the caller explicitly calls `connect()` again.
          this.stopped = true
          this.emitError(
            new ConnectionError(`Gave up reconnecting after ${this.attempts} attempts`, {
              attempts: this.attempts,
              cause,
            }),
          )
          return
        }
        this.scheduleReconnect()
      })
    }, delay)
  }

  private startHeartbeat(socket: WebSocket): void {
    if (this.heartbeatMs <= 0) return
    this.heartbeatTimer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return
      // The app-level frame refreshes server-side presence (swept after 5 min idle);
      // the protocol ping detects a link that is open but dead.
      socket.send('{"type":"ping"}')
      socket.ping()
      // Keep the first unanswered ping's deadline rather than extending it every tick.
      if (this.pongTimer) return
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null
        socket.terminate()
      }, this.pongTimeoutMs)
    }, this.heartbeatMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer)
      this.pongTimer = null
    }
  }

  private handleFrame(data: WebSocket.RawData): void {
    const text = data.toString()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (cause) {
      // A decode failure is client-side, so no HTTP-mapped `KlankError` class fits: plain `Error`.
      this.emitError(new Error(`Malformed WebSocket frame: ${text.slice(0, 120)}`, { cause }))
      return
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof Reflect.get(parsed, 'type') !== 'string'
    ) {
      this.emitError(new Error(`WebSocket frame is not a tagged event: ${text.slice(0, 120)}`))
      return
    }

    for (const cb of this.eventListeners) {
      try {
        const result: unknown = cb(parsed as ServerEvent)
        if (result instanceof Promise) {
          result.catch((err: unknown) =>
            this.emitError(err instanceof Error ? err : new Error(String(err))),
          )
        }
      } catch (err) {
        this.emitError(err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  private emitError(err: Error): void {
    for (const cb of this.errorListeners) {
      try {
        cb(err)
      } catch {
        // An error listener that itself throws has nowhere left to report.
      }
    }
  }
}
