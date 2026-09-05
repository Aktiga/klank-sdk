import type { ErrorBody } from './types.js'

export type KlankErrorCode =
  | 'auth'
  | 'webhook_auth'
  | 'forbidden'
  | 'channel_membership'
  | 'e2ee_channel'
  | 'not_found'
  | 'bad_request'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'context'
  | 'unsupported'
  | 'connection'

/** Base class for every error thrown by `@klank/sdk`. Discriminate with `instanceof` or `code`. */
export class KlankError extends Error {
  readonly code: KlankErrorCode
  /** HTTP status when the error came from a server response. */
  readonly status?: number
  /** Parsed `{ error, message }` envelope, or the raw text when not JSON. */
  readonly body?: ErrorBody | string

  constructor(
    code: KlankErrorCode,
    message: string,
    options: { status?: number; body?: ErrorBody | string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = new.target.name
    this.code = code
    this.status = options.status
    this.body = options.body
  }
}

/** 401 from a bearer-token endpoint: token missing, malformed, revoked, or deleted with its bot. */
export class AuthError extends KlankError {
  constructor(message: string, options?: { status?: number; body?: ErrorBody | string }) {
    super('auth', message, options)
  }
}

/** 401 from `POST /webhooks/{id}/incoming`: bad secret, bad signature, or stale headers. */
export class WebhookAuthError extends KlankError {
  constructor(message: string, options?: { status?: number; body?: ErrorBody | string }) {
    super('webhook_auth', message, options)
  }
}

/** 403 not attributable to channel membership (e.g. role checks). */
export class ForbiddenError extends KlankError {
  constructor(message: string, options?: { status?: number; body?: ErrorBody | string }) {
    super('forbidden', message, options)
  }
}

/** 403 `Not a member of this channel`. Bots must be added to a channel before reading or posting. */
export class ChannelMembershipError extends KlankError {
  constructor(message: string, options?: { status?: number; body?: ErrorBody | string }) {
    super('channel_membership', message, options)
  }
}

/** 400 `Channel requires encrypted messages`: plaintext rejected because the channel has an active E2EE key epoch. */
export class E2EEChannelError extends KlankError {
  constructor(message: string, options?: { status?: number; body?: ErrorBody | string }) {
    super('e2ee_channel', message, options)
  }
}

export class NotFoundError extends KlankError {
  constructor(message: string, options?: { status?: number; body?: ErrorBody | string }) {
    super('not_found', message, options)
  }
}

/** Any other 4xx. */
export class BadRequestError extends KlankError {
  constructor(message: string, options?: { status?: number; body?: ErrorBody | string }) {
    super('bad_request', message, options)
  }
}

/** 429 still returned after the retry budget was exhausted. */
export class RateLimitedError extends KlankError {
  /** Last `Retry-After` the server sent, in ms. */
  readonly retryAfterMs: number
  readonly attempts: number

  constructor(
    message: string,
    options: { retryAfterMs: number; attempts: number; body?: ErrorBody | string },
  ) {
    super('rate_limited', message, { status: 429, body: options.body })
    this.retryAfterMs = options.retryAfterMs
    this.attempts = options.attempts
  }
}

/** 5xx (after retries where the request was retryable). */
export class ServerError extends KlankError {
  constructor(message: string, options?: { status?: number; body?: ErrorBody | string }) {
    super('server', message, options)
  }
}

/** `fetch` itself rejected (DNS, refused, TLS, aborted). */
export class NetworkError extends KlankError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('network', message, options)
  }
}

/** A `ctx` helper was called on an event that has no channel/message to act on. */
export class ContextError extends KlankError {
  constructor(message: string) {
    super('context', message)
  }
}

/** The server has no implementation for this operation (e.g. ephemeral slash responses). */
export class UnsupportedError extends KlankError {
  constructor(message: string) {
    super('unsupported', message)
  }
}

/** WebSocket could not connect, or reconnect attempts were exhausted. */
export class ConnectionError extends KlankError {
  readonly attempts?: number

  constructor(message: string, options: { attempts?: number; cause?: unknown } = {}) {
    super('connection', message, { cause: options.cause })
    this.attempts = options.attempts
  }
}

const MEMBERSHIP_RE = /not a member of this channel/i
const E2EE_RE = /requires encrypted messages/i

/** Parse a non-2xx response body into the server's error envelope (or raw text). */
export function parseErrorBody(text: string): ErrorBody | string {
  if (!text) return ''
  try {
    const parsed: unknown = JSON.parse(text)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as ErrorBody).message === 'string'
    ) {
      return parsed as ErrorBody
    }
  } catch {
    // not JSON
  }
  return text
}

/**
 * Map a non-2xx status + parsed body to a typed error. `surface` selects the
 * 401 class: bearer endpoints → `AuthError`, the incoming-webhook endpoint →
 * `WebhookAuthError`. 429 and retryable 5xx are handled by the caller's retry
 * loop before reaching here; this maps whatever remains.
 */
export function errorFromResponse(
  status: number,
  body: ErrorBody | string,
  surface: 'api' | 'webhook' = 'api',
): KlankError {
  const message = (typeof body === 'string' ? body : body.message || body.error) || `HTTP ${status}`
  const opts = { status, body }
  switch (status) {
    case 400:
      return E2EE_RE.test(message)
        ? new E2EEChannelError(message, opts)
        : new BadRequestError(message, opts)
    case 401:
      return surface === 'webhook'
        ? new WebhookAuthError(message, opts)
        : new AuthError(message, opts)
    case 403:
      return MEMBERSHIP_RE.test(message)
        ? new ChannelMembershipError(message, opts)
        : new ForbiddenError(message, opts)
    case 404:
      return new NotFoundError(message, opts)
    default:
      if (status >= 500) return new ServerError(message, opts)
      return new BadRequestError(message, opts)
  }
}
