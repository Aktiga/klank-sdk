import { NetworkError, RateLimitedError, errorFromResponse, parseErrorBody } from './errors.js'
import type {
  BotInfo,
  Channel,
  ChannelWithMembers,
  ClientOptions,
  CursorPage,
  CursorParams,
  Message,
  MessageListItem,
  SendOptions,
  WsTicket,
} from './types.js'

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

const DEFAULT_MAX_RETRIES = 5
const DEFAULT_RETRY_BASE_MS = 250
/** Used when a 429 arrives with no `Retry-After`, or an unparseable one. */
const FALLBACK_RETRY_AFTER_MS = 1000
/** Attempt budget for a 5xx on an idempotent request. */
const SERVER_ERROR_ATTEMPTS = 3

/** `Retry-After` is delta-seconds or an HTTP-date (RFC 9110 §10.2.3). */
function retryAfterMs(header: string | null): number {
  if (header === null) return FALLBACK_RETRY_AFTER_MS
  const value = header.trim()
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const deadline = Date.parse(value)
  if (Number.isNaN(deadline)) return FALLBACK_RETRY_AFTER_MS
  return Math.max(0, deadline - Date.now())
}

function withQuery(path: string, params: CursorParams | undefined): string {
  if (!params) return path
  const query = new URLSearchParams()
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor !== undefined) query.set('cursor', params.cursor)
  const qs = query.toString()
  return qs ? `${path}?${qs}` : path
}

/** REST client for the Klank bot API: `{serverUrl}/api/v1`, bearer-token auth. */
export class KlankClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly http: typeof fetch
  private readonly maxRetries: number
  private readonly retryBaseMs: number

  constructor(serverUrl: string, token: string, options: ClientOptions = {}) {
    this.baseUrl = `${serverUrl.replace(/\/+$/, '')}/api/v1`
    this.token = token
    // Bound: native `fetch` rejects an alien `this` (illegal invocation).
    this.http = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
  }

  private async request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    }
    let payload: string | undefined
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const url = `${this.baseUrl}${path}`
    // A 5xx may still have committed a POST/PATCH server-side; only re-send idempotent verbs.
    const retryServerErrors = method === 'GET' || method === 'DELETE'

    for (let attempt = 1; ; attempt++) {
      let response: Response
      try {
        response = await this.http(url, { method, headers, body: payload })
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause)
        throw new NetworkError(`${method} ${url} failed: ${detail}`, { cause })
      }

      const text = await response.text()
      if (response.ok) return (text ? JSON.parse(text) : undefined) as T

      let backoffMs: number
      if (response.status === 429) {
        const after = retryAfterMs(response.headers.get('retry-after'))
        if (attempt >= this.maxRetries) {
          throw new RateLimitedError(`Rate limited after ${attempt} attempts: ${method} ${path}`, {
            retryAfterMs: after,
            attempts: attempt,
            body: parseErrorBody(text),
          })
        }
        backoffMs = after
      } else if (response.status >= 500 && retryServerErrors && attempt < SERVER_ERROR_ATTEMPTS) {
        backoffMs = this.retryBaseMs * 2 ** (attempt - 1)
      } else {
        throw errorFromResponse(response.status, parseErrorBody(text), 'api')
      }

      // Jitter to 0.8–1.2× so a fleet of bots does not retry in lockstep.
      // Executor form: `Promise.withResolvers` is ES2024, this package's lib is ES2022 (Node 20).
      await new Promise<void>((resolve) =>
        setTimeout(resolve, backoffMs * (0.8 + 0.4 * Math.random())),
      )
    }
  }

  // ── Auth ──

  getBotInfo(): Promise<BotInfo> {
    return this.request('GET', '/auth/bot-info')
  }

  /** Mint a single-use WebSocket ticket (30s TTL). One per connect. */
  async getWsTicket(): Promise<string> {
    const { ticket } = await this.request<WsTicket>('POST', '/auth/bot-ws-ticket')
    return ticket
  }

  // ── Messages ──

  sendMessage(channelId: string, text: string, options?: SendOptions): Promise<Message> {
    return this.request('POST', `/channels/${encodeURIComponent(channelId)}/messages`, {
      plaintext: text,
      content_type: 'plaintext',
      sender_type: 'bot',
      ...(options?.threadId !== undefined && { thread_id: options.threadId }),
    })
  }

  /** Newest first. */
  getMessages(channelId: string, params?: CursorParams): Promise<CursorPage<MessageListItem>> {
    const path = `/channels/${encodeURIComponent(channelId)}/messages`
    return this.request('GET', withQuery(path, params))
  }

  editMessage(messageId: string, text: string): Promise<Message> {
    return this.request('PATCH', `/messages/${encodeURIComponent(messageId)}`, {
      plaintext: text,
      content_type: 'plaintext',
    })
  }

  deleteMessage(messageId: string): Promise<void> {
    return this.request('DELETE', `/messages/${encodeURIComponent(messageId)}`)
  }

  /** Oldest first. */
  getThread(messageId: string, params?: CursorParams): Promise<CursorPage<Message>> {
    const path = `/messages/${encodeURIComponent(messageId)}/thread`
    return this.request('GET', withQuery(path, params))
  }

  // ── Reactions ──

  async addReaction(messageId: string, emoji: string): Promise<void> {
    await this.request('POST', `/messages/${encodeURIComponent(messageId)}/reactions`, { emoji })
  }

  removeReaction(messageId: string, emoji: string): Promise<void> {
    return this.request(
      'DELETE',
      `/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`,
    )
  }

  // ── Channels ──

  listChannels(workspaceId: string): Promise<ChannelWithMembers[]> {
    return this.request('GET', `/workspaces/${encodeURIComponent(workspaceId)}/channels`)
  }

  getChannel(channelId: string): Promise<Channel> {
    return this.request('GET', `/channels/${encodeURIComponent(channelId)}`)
  }
}
