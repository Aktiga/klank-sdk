import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AuthError,
  BadRequestError,
  ChannelMembershipError,
  E2EEChannelError,
  ForbiddenError,
  KlankClient,
  NetworkError,
  NotFoundError,
  RateLimitedError,
  ServerError,
} from '../src/index.js'
import type { ClientOptions } from '../src/types.js'

interface RecordedRequest {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

interface ScriptedResponse {
  status: number
  body?: string
  headers?: Record<string, string>
}

const CHANNEL = '11111111-1111-1111-1111-111111111111'
const MESSAGE = '22222222-2222-2222-2222-222222222222'
const WORKSPACE = '33333333-3333-3333-3333-333333333333'
const TOKEN = `bot_${'a'.repeat(64)}`

const messageFixture = {
  id: MESSAGE,
  channel_id: CHANNEL,
  sender_id: '44444444-4444-4444-4444-444444444444',
  sender_type: 'bot',
  content_type: 'plaintext',
  ciphertext: null,
  plaintext: 'hello',
  nonce: null,
  key_epoch: null,
  thread_id: null,
  edited_at: null,
  deleted_at: null,
  created_at: '2026-04-30T12:00:00Z',
}

const errorBody = (error: string, message: string) => JSON.stringify({ error, message })

let server: Server
let origin: string
let received: RecordedRequest[]
let script: ScriptedResponse[]

beforeEach(async () => {
  received = []
  script = []
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: { ...req.headers },
        body: Buffer.concat(chunks).toString('utf8'),
      })
      const next = script.shift() ?? {
        status: 599,
        body: errorBody('Test', 'no scripted response left'),
      }
      res.writeHead(next.status, next.headers ?? { 'content-type': 'application/json' })
      res.end(next.body ?? '')
    })
  })
  // Executor form: `Promise.withResolvers` is ES2024, this package's lib is ES2022 (Node 20).
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  origin = `http://127.0.0.1:${address.port}`
})

function closeServer(): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise<void>((resolve) => server.close(() => resolve()))
}

afterEach(closeServer)

/** `retryBaseMs` is tiny so 5xx backoff does not dominate the suite runtime. */
function makeClient(options: ClientOptions = {}): KlankClient {
  return new KlankClient(origin, TOKEN, { retryBaseMs: 10, ...options })
}

describe('KlankClient request shape', () => {
  it('sends bearer auth, JSON headers and the exact plaintext body for sendMessage', async () => {
    script.push({ status: 201, body: JSON.stringify(messageFixture) })

    const result = await makeClient().sendMessage(CHANNEL, 'hello')

    expect(result).toEqual(messageFixture)
    expect(received).toHaveLength(1)
    const req = received[0]
    expect(req?.method).toBe('POST')
    expect(req?.url).toBe(`/api/v1/channels/${CHANNEL}/messages`)
    expect(req?.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(req?.headers.accept).toBe('application/json')
    expect(req?.headers['content-type']).toBe('application/json')
    expect(req?.body).toBe('{"plaintext":"hello","content_type":"plaintext","sender_type":"bot"}')
  })

  it('omits thread_id entirely when no threadId is given', async () => {
    script.push({ status: 201, body: JSON.stringify(messageFixture) })

    await makeClient().sendMessage(CHANNEL, 'hello')

    const sent = JSON.parse(received[0]?.body ?? 'null') as Record<string, unknown>
    expect('thread_id' in sent).toBe(false)
  })

  it('sends thread_id when threadId is given', async () => {
    script.push({ status: 201, body: JSON.stringify(messageFixture) })

    await makeClient().sendMessage(CHANNEL, 'reply', { threadId: MESSAGE })

    expect(received[0]?.body).toBe(
      `{"plaintext":"reply","content_type":"plaintext","sender_type":"bot","thread_id":"${MESSAGE}"}`,
    )
  })

  it('trims a trailing slash from serverUrl instead of doubling it', async () => {
    script.push({
      status: 200,
      body: JSON.stringify({ items: [], next_cursor: null, has_more: false }),
    })

    await new KlankClient(`${origin}/`, TOKEN).getMessages(CHANNEL)

    expect(received[0]?.url).toBe(`/api/v1/channels/${CHANNEL}/messages`)
  })

  it('sends no body and no content-type on GET', async () => {
    script.push({
      status: 200,
      body: JSON.stringify({ bot_id: 'b', workspace_id: 'w', name: 'n', scopes: ['chat:write'] }),
    })

    const info = await makeClient().getBotInfo()

    expect(info.scopes).toEqual(['chat:write'])
    expect(received[0]?.method).toBe('GET')
    expect(received[0]?.url).toBe('/api/v1/auth/bot-info')
    expect(received[0]?.body).toBe('')
    expect(received[0]?.headers['content-type']).toBeUndefined()
  })

  it('unwraps the ticket from POST /auth/bot-ws-ticket', async () => {
    script.push({ status: 200, body: JSON.stringify({ ticket: 'tkt_abc', expires_in: 30 }) })

    await expect(makeClient().getWsTicket()).resolves.toBe('tkt_abc')
    expect(received[0]?.method).toBe('POST')
    expect(received[0]?.url).toBe('/api/v1/auth/bot-ws-ticket')
  })

  it('URL-encodes cursor pagination params and omits absent ones', async () => {
    const page = JSON.stringify({ items: [], next_cursor: null, has_more: false })
    script.push(
      { status: 200, body: page },
      { status: 200, body: page },
      { status: 200, body: page },
    )
    const client = makeClient()

    await client.getMessages(CHANNEL, { limit: 25, cursor: 'a b/c&d' })
    await client.getMessages(CHANNEL, { limit: 10 })
    await client.getMessages(CHANNEL)

    expect(received[0]?.url).toBe(
      `/api/v1/channels/${CHANNEL}/messages?limit=25&cursor=a+b%2Fc%26d`,
    )
    expect(received[1]?.url).toBe(`/api/v1/channels/${CHANNEL}/messages?limit=10`)
    expect(received[2]?.url).toBe(`/api/v1/channels/${CHANNEL}/messages`)
  })

  it('sends the plaintext edit body via PATCH', async () => {
    script.push({ status: 200, body: JSON.stringify(messageFixture) })

    await makeClient().editMessage(MESSAGE, 'fixed')

    expect(received[0]?.method).toBe('PATCH')
    expect(received[0]?.url).toBe(`/api/v1/messages/${MESSAGE}`)
    expect(received[0]?.body).toBe('{"plaintext":"fixed","content_type":"plaintext"}')
  })

  it('resolves deleteMessage on a 204 with an empty body', async () => {
    script.push({ status: 204 })

    await expect(makeClient().deleteMessage(MESSAGE)).resolves.toBeUndefined()
    expect(received[0]?.method).toBe('DELETE')
    expect(received[0]?.url).toBe(`/api/v1/messages/${MESSAGE}`)
  })

  it('posts the emoji and discards the 201 reaction body', async () => {
    script.push({
      status: 201,
      body: JSON.stringify({ message_id: MESSAGE, user_id: 'u', emoji: '🎉', created_at: 'now' }),
    })

    await expect(makeClient().addReaction(MESSAGE, '🎉')).resolves.toBeUndefined()
    expect(received[0]?.url).toBe(`/api/v1/messages/${MESSAGE}/reactions`)
    expect(received[0]?.body).toBe('{"emoji":"🎉"}')
  })

  it('percent-encodes the emoji in the removeReaction path', async () => {
    script.push({ status: 204 }, { status: 204 })
    const client = makeClient()

    await client.removeReaction(MESSAGE, '🎉')
    // Keycap emoji start with a literal `#`: unencoded, the rest of the path
    // becomes a URL fragment and never reaches the server.
    await client.removeReaction(MESSAGE, '#️⃣')

    expect(received[0]?.method).toBe('DELETE')
    expect(received[0]?.url).toBe(`/api/v1/messages/${MESSAGE}/reactions/%F0%9F%8E%89`)
    expect(received[1]?.url).toBe(`/api/v1/messages/${MESSAGE}/reactions/%23%EF%B8%8F%E2%83%A3`)
  })

  it('reads the thread and channel routes', async () => {
    script.push(
      { status: 200, body: JSON.stringify({ items: [], next_cursor: null, has_more: false }) },
      { status: 200, body: '[]' },
      { status: 200, body: JSON.stringify({ id: CHANNEL, name: 'general' }) },
    )
    const client = makeClient()

    await client.getThread(MESSAGE, { limit: 5 })
    await client.listChannels(WORKSPACE)
    await client.getChannel(CHANNEL)

    expect(received[0]?.url).toBe(`/api/v1/messages/${MESSAGE}/thread?limit=5`)
    expect(received[1]?.url).toBe(`/api/v1/workspaces/${WORKSPACE}/channels`)
    expect(received[2]?.url).toBe(`/api/v1/channels/${CHANNEL}`)
  })
})

describe('KlankClient 429 handling', () => {
  const limited = {
    status: 429,
    headers: { 'retry-after': '0' },
    body: errorBody('Too Many Requests', 'slow down'),
  }

  it('retries a 429 and succeeds once the server relents', async () => {
    script.push(limited, limited, { status: 200, body: JSON.stringify({ id: CHANNEL }) })

    await expect(makeClient().getChannel(CHANNEL)).resolves.toMatchObject({ id: CHANNEL })
    expect(received).toHaveLength(3)
  })

  it('throws RateLimitedError after maxRetries attempts and stops calling', async () => {
    for (let i = 0; i < 10; i++) script.push(limited)

    const error = await makeClient({ maxRetries: 3 })
      .getChannel(CHANNEL)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(RateLimitedError)
    expect((error as RateLimitedError).attempts).toBe(3)
    expect((error as RateLimitedError).status).toBe(429)
    expect(received).toHaveLength(3)
  })

  it('honours Retry-After seconds before retrying', async () => {
    script.push(
      {
        status: 429,
        headers: { 'retry-after': '1' },
        body: errorBody('Too Many Requests', 'wait'),
      },
      { status: 200, body: JSON.stringify({ id: CHANNEL }) },
    )

    const startedAt = Date.now()
    await makeClient().getChannel(CHANNEL)

    // Jitter floor is 0.8 × 1000ms.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(800)
    expect(received).toHaveLength(2)
  })

  it('falls back to a 1s wait when Retry-After is missing', async () => {
    script.push(
      { status: 429, body: errorBody('Too Many Requests', 'wait') },
      { status: 200, body: JSON.stringify({ id: CHANNEL }) },
    )

    const startedAt = Date.now()
    await makeClient().getChannel(CHANNEL)

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(800)
  })

  it('reports the last Retry-After in retryAfterMs', async () => {
    script.push({
      status: 429,
      headers: { 'retry-after': '7' },
      body: errorBody('Too Many Requests', 'wait'),
    })

    const error = await makeClient({ maxRetries: 1 })
      .getChannel(CHANNEL)
      .catch((e: unknown) => e)

    expect((error as RateLimitedError).retryAfterMs).toBe(7000)
    expect(received).toHaveLength(1)
  })
})

describe('KlankClient 5xx handling', () => {
  const unavailable = { status: 503, body: errorBody('Service Unavailable', 'try later') }

  it('retries a 5xx on GET', async () => {
    script.push(unavailable, { status: 200, body: JSON.stringify({ id: CHANNEL }) })

    await expect(makeClient().getChannel(CHANNEL)).resolves.toMatchObject({ id: CHANNEL })
    expect(received).toHaveLength(2)
  })

  it('retries a 5xx on DELETE', async () => {
    script.push(unavailable, { status: 204 })

    await expect(makeClient().deleteMessage(MESSAGE)).resolves.toBeUndefined()
    expect(received).toHaveLength(2)
  })

  it('gives up on a persistent 5xx after 3 attempts', async () => {
    script.push(unavailable, unavailable, unavailable, unavailable)

    await expect(makeClient().getChannel(CHANNEL)).rejects.toBeInstanceOf(ServerError)
    expect(received).toHaveLength(3)
  })

  it('never re-sends a POST after a 5xx', async () => {
    script.push(unavailable, { status: 201, body: JSON.stringify(messageFixture) })

    const error = await makeClient()
      .sendMessage(CHANNEL, 'hello')
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ServerError)
    expect((error as ServerError).status).toBe(503)
    expect((error as ServerError).message).toBe('try later')
    expect(received).toHaveLength(1)
  })

  it('never re-sends a PATCH after a 5xx', async () => {
    script.push(unavailable, { status: 200, body: JSON.stringify(messageFixture) })

    await expect(makeClient().editMessage(MESSAGE, 'fixed')).rejects.toBeInstanceOf(ServerError)
    expect(received).toHaveLength(1)
  })
})

describe('KlankClient error mapping', () => {
  it('maps 401 to AuthError without retrying', async () => {
    script.push({ status: 401, body: errorBody('Unauthorized', 'Invalid bot token') })

    const error = await makeClient()
      .getBotInfo()
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AuthError)
    expect((error as AuthError).message).toBe('Invalid bot token')
    expect(received).toHaveLength(1)
  })

  it('maps the membership 403 to ChannelMembershipError', async () => {
    script.push({ status: 403, body: errorBody('Forbidden', 'Not a member of this channel') })

    const error = await makeClient()
      .sendMessage(CHANNEL, 'hello')
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ChannelMembershipError)
    expect((error as ChannelMembershipError).code).toBe('channel_membership')
  })

  it('maps any other 403 to ForbiddenError', async () => {
    script.push({ status: 403, body: errorBody('Forbidden', 'Insufficient scope') })

    const error = await makeClient()
      .sendMessage(CHANNEL, 'hello')
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ForbiddenError)
    expect(error).not.toBeInstanceOf(ChannelMembershipError)
  })

  it('maps the E2EE 400 to E2EEChannelError', async () => {
    script.push({
      status: 400,
      body: errorBody('Bad Request', 'Channel requires encrypted messages'),
    })

    await expect(makeClient().sendMessage(CHANNEL, 'hello')).rejects.toBeInstanceOf(
      E2EEChannelError,
    )
  })

  it('maps any other 400 to BadRequestError', async () => {
    script.push({ status: 400, body: errorBody('Bad Request', 'plaintext must not be empty') })

    const error = await makeClient()
      .sendMessage(CHANNEL, '')
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(BadRequestError)
    expect(error).not.toBeInstanceOf(E2EEChannelError)
  })

  it('maps 404 to NotFoundError', async () => {
    script.push({ status: 404, body: errorBody('Not Found', 'Channel not found') })

    await expect(makeClient().getChannel(CHANNEL)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('uses the raw text as the message when the error body is not JSON', async () => {
    script.push({
      status: 400,
      body: 'upstream said no',
      headers: { 'content-type': 'text/plain' },
    })

    const error = await makeClient()
      .getChannel(CHANNEL)
      .catch((e: unknown) => e)

    expect((error as BadRequestError).message).toBe('upstream said no')
    expect((error as BadRequestError).body).toBe('upstream said no')
  })

  it('wraps a refused connection in NetworkError with the original cause', async () => {
    const client = makeClient()
    await closeServer()

    const error = await client.getChannel(CHANNEL).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(NetworkError)
    expect((error as NetworkError).code).toBe('network')
    expect((error as NetworkError).cause).toBeDefined()
    expect(received).toHaveLength(0)
  })
})
