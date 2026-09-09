// In-process stand-in for the Klank server: a real `node:http` listener plus a real
// `ws` server on the same port, so a `KlankBot` exercises its whole REST + WebSocket
// path (including the ws:// URL it derives) with nothing stubbed.
//
// Type-only imports from `../types.js`. `splitting: false` in tsup means this entry is
// bundled separately from `src/index.ts`, so a runtime import of the main entry would
// duplicate every class — `instanceof KlankError` would then fail across the seam.
//
// `Promise.withResolvers` is unavailable here: tsconfig pins lib ES2022 (TS2550).

import { randomUUID } from 'node:crypto'
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import type { BotInfo, Message, Reaction, ServerEvent } from '../types.js'

/** One REST request the mock received, in the order it arrived. */
export interface RecordedRequest {
  method: string
  /** Pathname only; the query string lives in `query`. */
  path: string
  query: URLSearchParams
  /** Lower-cased header names; repeated headers joined with `, `. */
  headers: Record<string, string>
  rawBody: Buffer
  /** Parsed JSON body, or `undefined` when the request had no JSON body. */
  body: unknown
}

export interface MockResponse {
  status: number
  /** JSON-encoded when present. Omit for an empty body (204). */
  body?: unknown
  headers?: Record<string, string>
}

export type MockHandler = (req: RecordedRequest) => MockResponse | Promise<MockResponse>

export interface MockKlankOptions {
  /** Overrides merged over the defaults: random ids, name `mock-bot`, scopes read/write. */
  botInfo?: Partial<BotInfo>
}

interface Override {
  method: string
  path: string | RegExp
  handler: MockHandler
}

interface RequestWaiter {
  match: (req: RecordedRequest) => boolean
  resolve: (req: RecordedRequest) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

interface SocketWaiter {
  resolve: () => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

const DEFAULT_TIMEOUT_MS = 2000
/** Matches the server's ticket TTL. */
const TICKET_TTL_MS = 30_000

const MESSAGES_RE = /^\/api\/v1\/channels\/([^/]+)\/messages$/
const REACTIONS_RE = /^\/api\/v1\/messages\/([^/]+)\/reactions$/
const REACTION_ONE_RE = /^\/api\/v1\/messages\/([^/]+)\/reactions\/(.+)$/
const MESSAGE_ONE_RE = /^\/api\/v1\/messages\/([^/]+)$/

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function normalizeHeaders(raw: IncomingMessage['headers']): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue
    headers[name] = Array.isArray(value) ? value.join(', ') : value
  }
  return headers
}

/** JSON body only: anything else stays `undefined` rather than guessing a shape. */
function parseBody(contentType: string | undefined, rawBody: Buffer): unknown {
  if (rawBody.length === 0) return undefined
  if (contentType === undefined || !contentType.includes('application/json')) return undefined
  try {
    return JSON.parse(rawBody.toString('utf8'))
  } catch {
    return undefined
  }
}

function field(body: unknown, name: string): string | null {
  if (typeof body !== 'object' || body === null) return null
  const value = Reflect.get(body, name)
  return typeof value === 'string' ? value : null
}

function writeResponse(res: ServerResponse, response: MockResponse): void {
  const headers: Record<string, string> = { ...response.headers }
  if (response.body === undefined) {
    res.writeHead(response.status, headers)
    res.end()
    return
  }
  const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')
  if (!hasContentType) headers['content-type'] = 'application/json'
  res.writeHead(response.status, headers)
  res.end(JSON.stringify(response.body))
}

/**
 * A fake Klank server for bot tests. Start one per test, point a `KlankBot` at
 * `mock.url`, push events with `deliver()`, assert on `requests`, and `close()` it.
 */
export class MockKlank {
  /** Origin to pass as `serverUrl`, e.g. `http://127.0.0.1:54321`. */
  readonly url: string
  /** Identity served by `GET /auth/bot-info` and stamped on messages the mock returns. */
  readonly botInfo: BotInfo
  /** Every REST request in arrival order, including bot-info and ws-ticket. */
  readonly requests: RecordedRequest[] = []

  private readonly server: Server
  private readonly wss = new WebSocketServer({ noServer: true })
  /** Issued ticket → expiry. Deleted on first use: tickets are single-use. */
  private readonly tickets = new Map<string, number>()
  private readonly openSockets = new Set<WebSocket>()
  /** Most recently registered override wins, so this list is searched backwards. */
  private readonly overrides: Override[] = []
  private readonly requestWaiters = new Set<RequestWaiter>()
  private readonly socketWaiters = new Set<SocketWaiter>()
  private closed = false

  private constructor(server: Server, url: string, botInfo: BotInfo) {
    this.server = server
    this.url = url
    this.botInfo = botInfo
    server.on('request', (req, res) => {
      void this.handleRequest(req, res)
    })
    server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head))
  }

  /** Listen on an ephemeral port on 127.0.0.1. */
  static async start(options: MockKlankOptions = {}): Promise<MockKlank> {
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      server.close()
      throw new Error('MockKlank: expected a TCP address')
    }
    const botInfo: BotInfo = {
      bot_id: randomUUID(),
      workspace_id: randomUUID(),
      name: 'mock-bot',
      scopes: ['read', 'write'],
      ...options.botInfo,
    }
    return new MockKlank(server, `http://127.0.0.1:${address.port}`, botInfo)
  }

  /** WebSocket connections currently open. */
  get sockets(): number {
    return this.openSockets.size
  }

  /**
   * Override a route. Checked before the built-in routes and before the bearer-token
   * check, so a handler can model any status the real server can return. `path` is
   * matched by exact pathname or `RegExp.test`; the newest matching override wins.
   */
  respond(method: string, path: string | RegExp, handler: MockHandler): void {
    this.overrides.push({ method: method.toUpperCase(), path, handler })
  }

  /** JSON-encode an event and send it to every open socket. */
  deliver(event: ServerEvent | Record<string, unknown>): void {
    const payload = JSON.stringify(event)
    for (const socket of this.openSockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload)
    }
  }

  /** Resolve with the first matching request — past or future — else reject on timeout. */
  waitForRequest(
    match: (req: RecordedRequest) => boolean,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<RecordedRequest> {
    const seen = this.requests.find(match)
    if (seen) return Promise.resolve(seen)
    return new Promise<RecordedRequest>((resolve, reject) => {
      const waiter: RequestWaiter = {
        match,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.requestWaiters.delete(waiter)
          reject(new Error(`MockKlank: no matching request within ${timeoutMs}ms`))
        }, timeoutMs),
      }
      this.requestWaiters.add(waiter)
    })
  }

  /** Resolve once at least one WebSocket is open, else reject on timeout. */
  waitForSocket(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    if (this.openSockets.size > 0) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const waiter: SocketWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.socketWaiters.delete(waiter)
          reject(new Error(`MockKlank: no WebSocket connected within ${timeoutMs}ms`))
        }, timeoutMs),
      }
      this.socketWaiters.add(waiter)
    })
  }

  /** Terminate every socket and close the listener. Safe to call more than once. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true

    for (const waiter of this.requestWaiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('MockKlank: closed while waiting for a request'))
    }
    this.requestWaiters.clear()
    for (const waiter of this.socketWaiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('MockKlank: closed while waiting for a socket'))
    }
    this.socketWaiters.clear()

    for (const socket of this.openSockets) socket.terminate()
    this.openSockets.clear()
    this.wss.close()
    // Keep-alive connections (undici pools one per origin) would otherwise hold the
    // listener open until their idle timeout.
    this.server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()))
    })
  }

  // ── Internal ──

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let record: RecordedRequest
    try {
      const rawBody = await readBody(req)
      const url = new URL(req.url ?? '/', this.url)
      const headers = normalizeHeaders(req.headers)
      record = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers,
        rawBody,
        body: parseBody(headers['content-type'], rawBody),
      }
    } catch (err) {
      writeResponse(res, {
        status: 500,
        body: { error: 'Internal Server Error', message: String(err) },
      })
      return
    }

    this.record(record)
    try {
      writeResponse(res, await this.route(record))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      writeResponse(res, { status: 500, body: { error: 'Internal Server Error', message } })
    }
  }

  private record(request: RecordedRequest): void {
    this.requests.push(request)
    for (const waiter of this.requestWaiters) {
      if (!waiter.match(request)) continue
      clearTimeout(waiter.timer)
      this.requestWaiters.delete(waiter)
      waiter.resolve(request)
    }
  }

  private async route(req: RecordedRequest): Promise<MockResponse> {
    for (let i = this.overrides.length - 1; i >= 0; i--) {
      const override = this.overrides[i]
      if (!override || override.method !== req.method.toUpperCase()) continue
      const matched =
        typeof override.path === 'string'
          ? override.path === req.path
          : override.path.test(req.path)
      if (matched) return override.handler(req)
    }

    const auth = req.headers.authorization
    if (auth === undefined || !auth.startsWith('Bearer bot_')) {
      return {
        status: 401,
        body: { error: 'Unauthorized', message: 'Missing Authorization header' },
      }
    }

    return this.defaultRoute(req)
  }

  private defaultRoute(req: RecordedRequest): MockResponse {
    if (req.method === 'GET' && req.path === '/api/v1/auth/bot-info') {
      return { status: 200, body: this.botInfo }
    }

    if (req.method === 'POST' && req.path === '/api/v1/auth/bot-ws-ticket') {
      const ticket = randomUUID()
      this.tickets.set(ticket, Date.now() + TICKET_TTL_MS)
      return { status: 200, body: { ticket, expires_in: TICKET_TTL_MS / 1000 } }
    }

    const messages = MESSAGES_RE.exec(req.path)
    if (req.method === 'POST' && messages?.[1] !== undefined) {
      return { status: 201, body: this.message(decodeURIComponent(messages[1]), req.body) }
    }

    const reactions = REACTIONS_RE.exec(req.path)
    if (req.method === 'POST' && reactions?.[1] !== undefined) {
      const reaction: Reaction = {
        message_id: decodeURIComponent(reactions[1]),
        user_id: this.botInfo.bot_id,
        emoji: field(req.body, 'emoji') ?? '',
        created_at: new Date().toISOString(),
      }
      return { status: 201, body: reaction }
    }

    if (req.method === 'DELETE' && REACTION_ONE_RE.test(req.path)) {
      return { status: 204 }
    }

    const one = MESSAGE_ONE_RE.exec(req.path)
    if (one?.[1] !== undefined) {
      const messageId = decodeURIComponent(one[1])
      if (req.method === 'PATCH') {
        // The mock never saw the original post, so the channel it belonged to is unknown.
        const edited: Message = {
          ...this.message(randomUUID(), req.body),
          id: messageId,
          edited_at: new Date().toISOString(),
        }
        return { status: 200, body: edited }
      }
      if (req.method === 'DELETE') return { status: 204 }
    }

    return {
      status: 404,
      body: { error: 'Not Found', message: `No mock route for ${req.method} ${req.path}` },
    }
  }

  private message(channelId: string, body: unknown): Message {
    return {
      id: randomUUID(),
      channel_id: channelId,
      sender_id: this.botInfo.bot_id,
      sender_type: 'bot',
      content_type: 'plaintext',
      ciphertext: null,
      plaintext: field(body, 'plaintext'),
      nonce: null,
      key_epoch: null,
      thread_id: field(body, 'thread_id'),
      edited_at: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
    }
  }

  /**
   * Validate the ticket before handing the socket to `ws`: an invalid one must get an
   * HTTP 401 and no upgrade, exactly like the server, so `KlankBot` sees a failed
   * handshake rather than a socket that opens and then closes.
   */
  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', this.url)
    if (url.pathname !== '/api/v1/ws' || !this.consumeTicket(url.searchParams.get('ticket'))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      socket.destroy()
      return
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.openSockets.add(ws)
      ws.on('close', () => {
        this.openSockets.delete(ws)
      })
      for (const waiter of this.socketWaiters) {
        clearTimeout(waiter.timer)
        waiter.resolve()
      }
      this.socketWaiters.clear()
    })
  }

  /** Single-use: the ticket is spent whether or not it was still valid. */
  private consumeTicket(ticket: string | null): boolean {
    if (ticket === null) return false
    const expiresAt = this.tickets.get(ticket)
    this.tickets.delete(ticket)
    return expiresAt !== undefined && expiresAt > Date.now()
  }
}
