// `MockKlank` is exercised the way a consumer would use it: a REAL `KlankBot` from the
// main entry talks to the mock over real `node:http` + `ws` on port 0. Time is real
// (fake timers would freeze the `ws` handshake); waits are condition-driven.

import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  ChannelMembershipError,
  ConnectionError,
  KlankBot,
  type BotConfig,
  type MessageNewEvent,
  type ServerEvent,
} from '../src/index.js'
import { MockKlank } from '../src/testing/index.js'

const TOKEN = `bot_${'0'.repeat(64)}`
const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const CHANNEL_ID = '00000000-0000-0000-0000-0000000000c1'
const MESSAGE_ID = '00000000-0000-0000-0000-0000000000d1'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let mocks: MockKlank[] = []
let bots: KlankBot[] = []

afterEach(async () => {
  for (const bot of bots) bot.stop()
  for (const mock of mocks) await mock.close()
  bots = []
  mocks = []
})

async function startMock(...args: Parameters<typeof MockKlank.start>): Promise<MockKlank> {
  const mock = await MockKlank.start(...args)
  mocks.push(mock)
  return mock
}

function build(mock: MockKlank, config: Partial<BotConfig> = {}): KlankBot {
  const bot = new KlankBot({
    token: TOKEN,
    serverUrl: mock.url,
    reconnect: false,
    ws: { heartbeatMs: 0 },
    ...config,
  })
  bots.push(bot)
  return bot
}

function messageNew(overrides: Partial<MessageNewEvent> = {}): MessageNewEvent {
  return {
    type: 'message.new',
    channel_id: CHANNEL_ID,
    message_id: MESSAGE_ID,
    sender_id: USER_ID,
    sender_type: 'user',
    content_type: 'plaintext',
    ciphertext: null,
    plaintext: 'hello',
    nonce: null,
    key_epoch: null,
    thread_id: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** Raw `ws` connect: resolves on `open`, rejects with the handshake error otherwise. */
function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.on('open', () => resolve(socket))
    socket.on('error', reject)
  })
}

async function mintTicket(mock: MockKlank): Promise<string> {
  const response = await fetch(`${mock.url}/api/v1/auth/bot-ws-ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as { ticket: string; expires_in: number }
  expect(body.expires_in).toBe(30)
  expect(body.ticket).toMatch(UUID_RE)
  return body.ticket
}

describe('MockKlank.start', () => {
  it('serves bot-info and a ws ticket so a real KlankBot starts', async () => {
    const mock = await startMock()
    const bot = build(mock)

    await bot.start()

    expect(mock.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /api/v1/auth/bot-info',
      'POST /api/v1/auth/bot-ws-ticket',
    ])
    expect(mock.sockets).toBe(1)
    expect(bot.getBotInfo()).toEqual(mock.botInfo)
    expect(mock.botInfo.name).toBe('mock-bot')
    expect(mock.botInfo.scopes).toEqual(['read', 'write'])
    expect(mock.botInfo.bot_id).toMatch(UUID_RE)
    expect(mock.botInfo.workspace_id).toMatch(UUID_RE)
  })

  it('applies botInfo overrides on top of the defaults', async () => {
    const mock = await startMock({ botInfo: { name: 'echo', scopes: ['read'] } })
    expect(mock.botInfo.name).toBe('echo')
    expect(mock.botInfo.scopes).toEqual(['read'])
    expect(mock.botInfo.bot_id).toMatch(UUID_RE)
  })

  it('records the query string and leaves body undefined without a JSON content-type', async () => {
    const mock = await startMock()
    const bot = build(mock)
    await bot.start()

    const ticket = mock.requests[1]
    expect(ticket?.body).toBeUndefined()
    expect(ticket?.rawBody.length).toBe(0)

    await bot
      .getClient()
      .getMessages(CHANNEL_ID, { limit: 5 })
      .catch(() => undefined)
    const listed = await mock.waitForRequest(
      (r) => r.method === 'GET' && r.path.endsWith('/messages'),
    )
    expect(listed.query.get('limit')).toBe('5')
  })
})

describe('MockKlank.deliver and the default REST routes', () => {
  it('routes a delivered event to a handler whose ctx.say hits the messages route', async () => {
    const mock = await startMock()
    const bot = build(mock)
    let said: Promise<unknown> | undefined
    bot.on('message', (_event, ctx) => {
      said = ctx.say('x')
    })
    await bot.start()

    mock.deliver(messageNew())

    const posted = await mock.waitForRequest(
      (r) => r.method === 'POST' && r.path.endsWith('/messages'),
    )
    expect(posted.path).toBe(`/api/v1/channels/${CHANNEL_ID}/messages`)
    expect(posted.body).toEqual({ plaintext: 'x', content_type: 'plaintext', sender_type: 'bot' })
    expect(posted.rawBody.toString()).toBe(JSON.stringify(posted.body))
    expect(posted.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(posted.headers['content-type']).toBe('application/json')

    await expect(said).resolves.toMatchObject({
      channel_id: CHANNEL_ID,
      sender_id: mock.botInfo.bot_id,
      sender_type: 'bot',
      content_type: 'plaintext',
      plaintext: 'x',
      thread_id: null,
    })
  })

  it('echoes thread_id for replies', async () => {
    const mock = await startMock()
    const bot = build(mock)
    let replied: Promise<unknown> | undefined
    bot.on('message', (_event, ctx) => {
      replied = ctx.reply('y')
    })
    await bot.start()

    mock.deliver(messageNew())

    const posted = await mock.waitForRequest(
      (r) => r.method === 'POST' && r.path.endsWith('/messages'),
    )
    expect(posted.body).toMatchObject({ thread_id: MESSAGE_ID })
    await expect(replied).resolves.toMatchObject({ thread_id: MESSAGE_ID, plaintext: 'y' })
  })

  it('serves reactions, edits and deletes', async () => {
    const mock = await startMock()
    const client = build(mock).getClient()

    await expect(client.addReaction(MESSAGE_ID, 'tada')).resolves.toBeUndefined()
    await expect(client.removeReaction(MESSAGE_ID, 'tada')).resolves.toBeUndefined()
    await expect(client.editMessage(MESSAGE_ID, 'edited')).resolves.toMatchObject({
      id: MESSAGE_ID,
      plaintext: 'edited',
      sender_id: mock.botInfo.bot_id,
    })
    await expect(client.deleteMessage(MESSAGE_ID)).resolves.toBeUndefined()

    expect(mock.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `POST /api/v1/messages/${MESSAGE_ID}/reactions`,
      `DELETE /api/v1/messages/${MESSAGE_ID}/reactions/tada`,
      `PATCH /api/v1/messages/${MESSAGE_ID}`,
      `DELETE /api/v1/messages/${MESSAGE_ID}`,
    ])
  })
})

describe('MockKlank.waitForRequest', () => {
  it('resolves for a request that already happened', async () => {
    const mock = await startMock()
    await build(mock).start()

    const info = await mock.waitForRequest((r) => r.path === '/api/v1/auth/bot-info')
    expect(info.method).toBe('GET')
  })

  it('rejects once the timeout passes with no match', async () => {
    const mock = await startMock()
    await expect(mock.waitForRequest(() => false, 50)).rejects.toThrow(/50ms/)
  })
})

describe('MockKlank tickets', () => {
  it('accepts a ticket once and rejects its reuse without upgrading', async () => {
    const mock = await startMock()
    const ticket = await mintTicket(mock)
    const wsUrl = `${mock.url.replace('http', 'ws')}/api/v1/ws?ticket=${ticket}`

    const first = await connect(wsUrl)
    await mock.waitForSocket()
    expect(mock.sockets).toBe(1)

    await expect(connect(wsUrl)).rejects.toThrow(/401/)
    expect(mock.sockets).toBe(1)
    first.terminate()
  })

  it('rejects unknown and missing tickets', async () => {
    const mock = await startMock()
    const base = `${mock.url.replace('http', 'ws')}/api/v1/ws`
    await expect(connect(`${base}?ticket=nope`)).rejects.toThrow(/401/)
    await expect(connect(base)).rejects.toThrow(/401/)
    expect(mock.sockets).toBe(0)
  })
})

describe('MockKlank.respond', () => {
  it('overrides a route so ctx.say surfaces ChannelMembershipError to onError', async () => {
    const mock = await startMock()
    mock.respond('POST', /\/messages$/, () => ({
      status: 403,
      body: { error: 'Forbidden', message: 'Not a member of this channel' },
    }))
    const bot = build(mock)
    let sayError: unknown
    bot.on('message', async (_event, ctx) => {
      try {
        await ctx.say('x')
      } catch (err) {
        sayError = err
        throw err
      }
    })
    const reported = new Promise<{ err: Error; event?: ServerEvent }>((resolve) => {
      bot.onError((err, event) => resolve({ err, event }))
    })
    await bot.start()

    const delivered = messageNew()
    mock.deliver(delivered)

    const { err, event } = await reported
    expect(err).toBeInstanceOf(ChannelMembershipError)
    expect(err).toBe(sayError)
    expect((err as ChannelMembershipError).status).toBe(403)
    expect(event).toEqual(delivered)
  })

  it('lets the most recent override win and matches exact string paths', async () => {
    const mock = await startMock()
    mock.respond('GET', '/api/v1/auth/bot-info', () => ({ status: 500, body: { error: 'x' } }))
    mock.respond('GET', '/api/v1/auth/bot-info', () => ({
      status: 200,
      body: { ...mock.botInfo, name: 'overridden' },
      headers: { 'x-mock': 'yes' },
    }))

    const response = await fetch(`${mock.url}/api/v1/auth/bot-info`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('x-mock')).toBe('yes')
    expect(await response.json()).toMatchObject({ name: 'overridden' })
  })
})

describe('MockKlank unmatched requests', () => {
  it('returns the 404 envelope for unknown routes', async () => {
    const mock = await startMock()
    const response = await fetch(`${mock.url}/api/v1/nope`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: 'Not Found',
      message: 'No mock route for GET /api/v1/nope',
    })
    expect(mock.requests.at(-1)?.path).toBe('/api/v1/nope')
  })

  it('returns 401 without a bearer token', async () => {
    const mock = await startMock()
    const response = await fetch(`${mock.url}/api/v1/auth/bot-info`)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'Unauthorized',
      message: 'Missing Authorization header',
    })
  })
})

describe('MockKlank.close', () => {
  it('closes the bot socket and the server', async () => {
    const mock = await startMock()
    // Reconnect budget of one so the bot reports the lost connection instead of retrying forever.
    const bot = build(mock, {
      reconnect: true,
      ws: { heartbeatMs: 0, baseDelayMs: 10, maxAttempts: 1 },
    })
    const reported = new Promise<Error>((resolve) => {
      bot.onError((err) => resolve(err))
    })
    await bot.start()
    expect(mock.sockets).toBe(1)

    await mock.close()

    expect(mock.sockets).toBe(0)
    await expect(reported).resolves.toBeInstanceOf(ConnectionError)
    await expect(fetch(`${mock.url}/api/v1/auth/bot-info`)).rejects.toThrow()
  })
})
