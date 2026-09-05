import { describe, expect, it } from 'vitest'
import {
  AuthError,
  BadRequestError,
  ChannelMembershipError,
  ConnectionError,
  ContextError,
  E2EEChannelError,
  type ErrorBody,
  ForbiddenError,
  KlankError,
  type KlankErrorCode,
  NetworkError,
  NotFoundError,
  RateLimitedError,
  ServerError,
  UnsupportedError,
  WebhookAuthError,
  errorFromResponse,
  parseErrorBody,
} from '../src/index.js'

interface MappingCase {
  label: string
  status: number
  body: ErrorBody | string
  surface: 'api' | 'webhook'
  expected: new (...args: never[]) => KlankError
  code: KlankErrorCode
}

const envelope = (error: string, message: string): ErrorBody => ({ error, message })

const cases: MappingCase[] = [
  {
    label: '400 requiring encrypted messages',
    status: 400,
    body: envelope('Bad Request', 'Bad request: Channel requires encrypted messages'),
    surface: 'api',
    expected: E2EEChannelError,
    code: 'e2ee_channel',
  },
  {
    label: '400 requiring encrypted messages on the webhook surface',
    status: 400,
    body: envelope('Bad Request', 'Channel requires encrypted messages'),
    surface: 'webhook',
    expected: E2EEChannelError,
    code: 'e2ee_channel',
  },
  {
    label: 'any other 400',
    status: 400,
    body: envelope('Bad Request', 'This is not an incoming webhook'),
    surface: 'webhook',
    expected: BadRequestError,
    code: 'bad_request',
  },
  {
    label: '401 on the api surface',
    status: 401,
    body: envelope('Unauthorized', 'Invalid token'),
    surface: 'api',
    expected: AuthError,
    code: 'auth',
  },
  {
    label: '401 on the webhook surface',
    status: 401,
    body: envelope('Unauthorized', 'Invalid webhook secret'),
    surface: 'webhook',
    expected: WebhookAuthError,
    code: 'webhook_auth',
  },
  {
    label: '403 for channel membership',
    status: 403,
    body: envelope('Forbidden', 'Not a member of this channel'),
    surface: 'api',
    expected: ChannelMembershipError,
    code: 'channel_membership',
  },
  {
    label: 'any other 403',
    status: 403,
    body: envelope('Forbidden', 'Insufficient scope'),
    surface: 'api',
    expected: ForbiddenError,
    code: 'forbidden',
  },
  {
    label: '404',
    status: 404,
    body: envelope('Not Found', 'Channel not found'),
    surface: 'api',
    expected: NotFoundError,
    code: 'not_found',
  },
  {
    label: '500',
    status: 500,
    body: envelope('Internal Server Error', 'database error'),
    surface: 'api',
    expected: ServerError,
    code: 'server',
  },
  {
    label: '503',
    status: 503,
    body: 'upstream unavailable',
    surface: 'api',
    expected: ServerError,
    code: 'server',
  },
]

describe('errorFromResponse', () => {
  it.each(cases)('maps $label', ({ status, body, surface, expected, code }) => {
    const err = errorFromResponse(status, body, surface)

    expect(err).toBeInstanceOf(expected)
    expect(err).toBeInstanceOf(KlankError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe(code)
    expect(err.status).toBe(status)
    expect(err.body).toEqual(body)
    expect(err.message).toBe(typeof body === 'string' ? body : body.message)
  })

  it('distinguishes the two 401 surfaces for the same body', () => {
    const body = envelope('Unauthorized', 'Unauthorized')
    expect(errorFromResponse(401, body, 'api')).toBeInstanceOf(AuthError)
    expect(errorFromResponse(401, body, 'webhook')).toBeInstanceOf(WebhookAuthError)
  })

  it('defaults to the api surface', () => {
    expect(errorFromResponse(401, envelope('Unauthorized', 'nope'))).toBeInstanceOf(AuthError)
  })

  it('falls back to an HTTP <status> message when the body is empty', () => {
    expect(errorFromResponse(404, '').message).toBe('HTTP 404')
  })

  it('falls back to the error reason when the envelope message is blank', () => {
    expect(errorFromResponse(409, envelope('Conflict', '')).message).toBe('Conflict')
  })
})

describe('parseErrorBody', () => {
  it('parses the server error envelope', () => {
    expect(parseErrorBody('{"error":"Not Found","message":"Channel not found"}')).toEqual({
      error: 'Not Found',
      message: 'Channel not found',
    })
  })

  it('returns non-JSON text unchanged', () => {
    expect(parseErrorBody('502 Bad Gateway')).toBe('502 Bad Gateway')
  })

  it('returns an empty string for an empty body', () => {
    expect(parseErrorBody('')).toBe('')
  })

  it('returns the raw text for JSON that is not an error envelope', () => {
    expect(parseErrorBody('{"error":"Not Found"}')).toBe('{"error":"Not Found"}')
    expect(parseErrorBody('[1,2]')).toBe('[1,2]')
    expect(parseErrorBody('null')).toBe('null')
  })
})

describe('error class names', () => {
  const instances: KlankError[] = [
    new KlankError('bad_request', 'base'),
    new AuthError('m'),
    new WebhookAuthError('m'),
    new ForbiddenError('m'),
    new ChannelMembershipError('m'),
    new E2EEChannelError('m'),
    new NotFoundError('m'),
    new BadRequestError('m'),
    new RateLimitedError('m', { retryAfterMs: 1000, attempts: 3 }),
    new ServerError('m'),
    new NetworkError('m'),
    new ContextError('m'),
    new UnsupportedError('m'),
    new ConnectionError('m'),
  ]

  it.each(instances)('reports its own constructor name ($name)', (err) => {
    expect(err.name).toBe(err.constructor.name)
    expect(err.name).not.toBe('Error')
  })

  it('carries retry metadata on RateLimitedError', () => {
    const err = new RateLimitedError('slow down', { retryAfterMs: 2500, attempts: 4 })
    expect(err.status).toBe(429)
    expect(err.code).toBe('rate_limited')
    expect(err.retryAfterMs).toBe(2500)
    expect(err.attempts).toBe(4)
  })

  it('preserves the cause on NetworkError and ConnectionError', () => {
    const cause = new Error('ECONNREFUSED')
    expect(new NetworkError('down', { cause }).cause).toBe(cause)
    const conn = new ConnectionError('gave up', { attempts: 5, cause })
    expect(conn.cause).toBe(cause)
    expect(conn.attempts).toBe(5)
  })
})
