// Integration tests: a real `node:http` server for REST plus a real `ws` server on
// the same port, so `KlankBot`'s derived ws:// URL is exercised end to end. Time is
// real (fake timers would freeze the `ws` handshake); waits are condition-driven and
// event "fences" — pushing a later event and awaiting it proves an earlier one was
// dropped — so only signal/close checks need no wait at all.
// `Promise.withResolvers` is unavailable here: tsconfig pins lib ES2022 (TS2550).

import { type IncomingMessage, type Server, createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type WebSocket as ServerSocket, WebSocketServer } from 'ws'
import { ContextError, KlankBot, UnsupportedError } from '../src/index.js'
import type {
  BotInfo,
  CommandInvokedEvent,
  Message,
  MessageNewEvent,
  Reaction,
  ServerEvent,
} from '../src/index.js'

const BOT_ID = '00000000-0000-0000-0000-0000000000b0'
const WEBHOOK_ID = '00000000-0000-0000-0000-0000000000e0'
const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const CHANNEL_ID = '00000000-0000-0000-0000-0000000000c1'
const MESSAGE_ID = '00000000-0000-0000-0000-0000000000d1'
const THREAD_ID = '00000000-0000-0000-0000-0000000000d0'
const WORKSPACE_ID = '00000000-0000-0000-0000-0000000000f1'

const BOT_INFO: BotInfo = {
  bot_id: BOT_ID,
  workspace_id: WORKSPACE_ID,
  name: 'deploybot',
  scopes: ['messages:write'],
}

interface Captured {
  method: string
  url: string
  body: string
}

let server: Server
let wss: WebSocketServer
let serverUrl: string
let requests: Captured[]
let botSockets: ServerSocket[]
let closedSockets: number
let bots: KlankBot[]

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

function message(plaintext: string): Message {
  return {
    id: MESSAGE_ID,
    channel_id: CHANNEL_ID,
    sender_id: BOT_ID,
    sender_type: 'bot',
    content_type: 'plaintext',
    ciphertext: null,
    plaintext,
    nonce: null,
    key_epoch: null,
    thread_id: null,
    edited_at: null,
    deleted_at: null,
    created_at: '2026-01-01T00:00:00Z',
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

function waitFor(label: string, predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() > deadline) {
        reject(new Error(`timed out after ${timeoutMs}ms waiting for ${label}`))
        return
      }
      setTimeout(poll, 5)
    }
    poll()
  })
}

/** Registers the bot so `afterEach` always disconnects it and drops signal handlers. */
function build(config: Partial<ConstructorParameters<typeof KlankBot>[0]> = {}): KlankBot {
  const bot = new KlankBot({
    token: `bot_${'0'.repeat(64)}`,
    serverUrl,
    reconnect: false,
    ws: { heartbeatMs: 0 },
    ...config,
  })
  bots.push(bot)
  return bot
}

/** Starts the bot and resolves once the server side of its socket exists. */
async function started(bot: KlankBot): Promise<ServerSocket> {
  const index = botSockets.length
  await bot.start()
  await waitFor('the bot socket', () => botSockets.length > index)
  const socket = botSockets[index]
  if (!socket) throw new Error('bot socket missing')
  return socket
}

function push(socket: ServerSocket, event: ServerEvent): void {
  socket.send(JSON.stringify(event))
}

const REACTION_RE = /^\/api\/v1\/messages\/([^/]+)\/reactions$/
const REACTION_ONE_RE = /^\/api\/v1\/messages\/([^/]+)\/reactions\/(.+)$/
const MESSAGES_RE = /^\/api\/v1\/channels\/([^/]+)\/messages$/

beforeEach(async () => {
  requests = []
  botSockets = []
  closedSockets = 0
  bots = []

  server = createServer(async (req, res) => {
    const url = req.url ?? ''
    const body = await readBody(req)
    requests.push({ method: req.method ?? '', url, body })

    if (url === '/api/v1/auth/bot-info') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(BOT_INFO))
      return
    }
    if (url === '/api/v1/auth/bot-ws-ticket') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ticket: `tkt-${requests.length}`, expires_in: 30 }))
      return
    }
    if (MESSAGES_RE.test(url)) {
      const parsed: unknown = body ? JSON.parse(body) : {}
      const text =
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof Reflect.get(parsed, 'plaintext') === 'string'
          ? String(Reflect.get(parsed, 'plaintext'))
          : ''
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(JSON.stringify(message(text)))
      return
    }
    if (req.method === 'POST' && REACTION_RE.test(url)) {
      const reaction: Reaction = {
        message_id: MESSAGE_ID,
        user_id: BOT_ID,
        emoji: 'tada',
        created_at: '2026-01-01T00:00:00Z',
      }
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(JSON.stringify(reaction))
      return
    }
    if (req.method === 'DELETE' && REACTION_ONE_RE.test(url)) {
      res.writeHead(204)
      res.end()
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found', message: `no route for ${url}` }))
  })

  wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      botSockets.push(ws)
      ws.on('close', () => {
        closedSockets += 1
      })
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('expected a TCP address')
  }
  serverUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  for (const bot of bots) bot.stop()
  for (const socket of botSockets) socket.terminate()
  wss.close()
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
})

describe('KlankBot event routing', () => {
  it('fires the alias and the wire name once each for one message.new', async () => {
    const bot = build()
    const alias: ServerEvent[] = []
    const wire: ServerEvent[] = []
    bot.on('message', (event) => {
      alias.push(event)
    })
    bot.on('message.new', (event) => {
      wire.push(event)
    })
    const socket = await started(bot)

    const event = messageNew()
    push(socket, event)
    await waitFor('both handlers', () => alias.length > 0 && wire.length > 0)

    expect(alias).toEqual([event])
    expect(wire).toEqual([event])
  })

  it('fires reaction_added exactly once', async () => {
    const bot = build()
    const seen: ServerEvent[] = []
    bot.on('reaction_added', (event) => {
      seen.push(event)
    })
    const fence: ServerEvent[] = []
    bot.on('typing', (event) => {
      fence.push(event)
    })
    const socket = await started(bot)

    push(socket, {
      type: 'reaction.added',
      channel_id: CHANNEL_ID,
      message_id: MESSAGE_ID,
      user_id: USER_ID,
      emoji: 'tada',
    })
    push(socket, { type: 'typing.start', channel_id: CHANNEL_ID, user_id: USER_ID })
    await waitFor('the fence event', () => fence.length >= 1)

    expect(seen).toHaveLength(1)
  })

  it('routes message.updated, channel.deleted and typing.stop to their aliases', async () => {
    const bot = build()
    const updated: ServerEvent[] = []
    const deleted: ServerEvent[] = []
    const typingStop: ServerEvent[] = []
    bot.on('message_updated', (event) => {
      updated.push(event)
    })
    bot.on('channel_deleted', (event) => {
      deleted.push(event)
    })
    bot.on('typing_stop', (event) => {
      typingStop.push(event)
    })
    const socket = await started(bot)

    push(socket, {
      type: 'message.updated',
      channel_id: CHANNEL_ID,
      message_id: MESSAGE_ID,
      edited_at: '2026-01-01T00:00:01Z',
      content_type: 'plaintext',
      plaintext: 'edited',
      ciphertext: null,
      nonce: null,
      key_epoch: null,
    })
    push(socket, {
      type: 'channel.deleted',
      workspace_id: WORKSPACE_ID,
      channel_id: CHANNEL_ID,
    })
    push(socket, { type: 'typing.stop', channel_id: CHANNEL_ID, user_id: USER_ID })

    await waitFor(
      'all three aliases',
      () => updated.length === 1 && deleted.length === 1 && typingStop.length === 1,
    )
  })

  it('stops delivering after off()', async () => {
    const bot = build()
    const seen: ServerEvent[] = []
    const fence: ServerEvent[] = []
    const handler = (event: ServerEvent) => {
      seen.push(event)
    }
    bot.on('message', handler)
    bot.on('typing', (event) => {
      fence.push(event)
    })
    const socket = await started(bot)

    bot.off('message', handler)
    push(socket, messageNew())
    push(socket, { type: 'typing.start', channel_id: CHANNEL_ID, user_id: USER_ID })
    await waitFor('the fence event', () => fence.length >= 1)

    expect(seen).toHaveLength(0)
  })
})

describe('KlankBot self-echo suppression', () => {
  it('drops message.new sent by the bot itself', async () => {
    const bot = build()
    const seen: ServerEvent[] = []
    const fence: ServerEvent[] = []
    bot.on('message', (event) => {
      seen.push(event)
    })
    bot.on('typing', (event) => {
      fence.push(event)
    })
    const socket = await started(bot)

    push(socket, messageNew({ sender_id: BOT_ID }))
    push(socket, { type: 'typing.start', channel_id: CHANNEL_ID, user_id: USER_ID })
    await waitFor('the fence event', () => fence.length >= 1)

    expect(seen).toHaveLength(0)
  })

  it('drops message.new stamped with one of its webhook ids', async () => {
    const bot = build({ webhookIds: [WEBHOOK_ID] })
    const seen: ServerEvent[] = []
    const fence: ServerEvent[] = []
    bot.on('message', (event) => {
      seen.push(event)
    })
    bot.on('typing', (event) => {
      fence.push(event)
    })
    const socket = await started(bot)

    push(socket, messageNew({ sender_id: WEBHOOK_ID }))
    push(socket, { type: 'typing.start', channel_id: CHANNEL_ID, user_id: USER_ID })
    await waitFor('the fence event', () => fence.length >= 1)

    expect(seen).toHaveLength(0)
  })

  it('still delivers messages from other senders', async () => {
    const bot = build({ webhookIds: [WEBHOOK_ID] })
    const seen: ServerEvent[] = []
    bot.on('message', (event) => {
      seen.push(event)
    })
    const socket = await started(bot)

    push(socket, messageNew({ sender_id: USER_ID }))
    await waitFor('the message handler', () => seen.length >= 1)
  })
})

describe('KlankBot context helpers', () => {
  it('say posts a plaintext bot message to the event channel', async () => {
    const bot = build()
    bot.on('message', async (_event, ctx) => {
      await ctx.say('hi there')
    })
    const socket = await started(bot)

    push(socket, messageNew())
    await waitFor('the POST', () => requests.some((r) => MESSAGES_RE.test(r.url)))

    const posted = requests.find((r) => MESSAGES_RE.test(r.url))
    expect(posted?.method).toBe('POST')
    expect(posted?.url).toBe(`/api/v1/channels/${CHANNEL_ID}/messages`)
    expect(JSON.parse(posted?.body ?? '{}')).toEqual({
      plaintext: 'hi there',
      content_type: 'plaintext',
      sender_type: 'bot',
    })
  })

  it('exposes the triggering event on ctx', async () => {
    const bot = build()
    const seen: ServerEvent[] = []
    bot.on('message', (_event, ctx) => {
      seen.push(ctx.event)
    })
    const socket = await started(bot)

    const event = messageNew()
    push(socket, event)
    await waitFor('the handler', () => seen.length === 1)

    expect(seen[0]).toEqual(event)
  })

  it('reply threads on the triggering message id', async () => {
    const bot = build()
    bot.on('message', async (_event, ctx) => {
      await ctx.reply('in thread')
    })
    const socket = await started(bot)

    push(socket, messageNew())
    await waitFor('the POST', () => requests.some((r) => MESSAGES_RE.test(r.url)))

    const posted = requests.find((r) => MESSAGES_RE.test(r.url))
    expect(JSON.parse(posted?.body ?? '{}')).toEqual({
      plaintext: 'in thread',
      content_type: 'plaintext',
      sender_type: 'bot',
      thread_id: MESSAGE_ID,
    })
  })

  it('reply keeps the existing thread root for a threaded message', async () => {
    const bot = build()
    bot.on('message', async (_event, ctx) => {
      await ctx.reply('same thread')
    })
    const socket = await started(bot)

    push(socket, messageNew({ thread_id: THREAD_ID }))
    await waitFor('the POST', () => requests.some((r) => MESSAGES_RE.test(r.url)))

    const posted = requests.find((r) => MESSAGES_RE.test(r.url))
    expect(JSON.parse(posted?.body ?? '{}')).toEqual({
      plaintext: 'same thread',
      content_type: 'plaintext',
      sender_type: 'bot',
      thread_id: THREAD_ID,
    })
  })

  it('react and unreact hit the reaction routes', async () => {
    const bot = build()
    bot.on('message', async (_event, ctx) => {
      await ctx.react('tada')
      await ctx.unreact('tada')
    })
    const socket = await started(bot)

    push(socket, messageNew())
    await waitFor(
      'both reaction calls',
      () => requests.filter((r) => r.url.includes('/reactions')).length === 2,
    )

    const [added, removed] = requests.filter((r) => r.url.includes('/reactions'))
    expect(added?.method).toBe('POST')
    expect(added?.url).toBe(`/api/v1/messages/${MESSAGE_ID}/reactions`)
    expect(JSON.parse(added?.body ?? '{}')).toEqual({ emoji: 'tada' })
    expect(removed?.method).toBe('DELETE')
    expect(removed?.url).toBe(`/api/v1/messages/${MESSAGE_ID}/reactions/tada`)
  })

  it('throws ContextError when the event has no channel', async () => {
    const bot = build()
    const errors: Error[] = []
    bot.onError((err) => {
      errors.push(err)
    })
    bot.on('presence', async (_event, ctx) => {
      await ctx.say('nowhere')
    })
    const socket = await started(bot)

    push(socket, { type: 'presence.update', user_id: USER_ID, status: 'online' })
    await waitFor('the context error', () => errors.length === 1)

    expect(errors[0]).toBeInstanceOf(ContextError)
    expect(requests.some((r) => MESSAGES_RE.test(r.url))).toBe(false)
  })
})

describe('KlankBot message matchers', () => {
  it('passes capture groups to the handler', async () => {
    const bot = build()
    const captured: string[][] = []
    bot.message(/deploy (\w+)/, (_event, _ctx, matches) => {
      captured.push([...matches])
    })
    const socket = await started(bot)

    push(socket, messageNew({ plaintext: 'please deploy staging now' }))
    await waitFor('the matcher', () => captured.length === 1)

    expect(captured[0]?.[0]).toBe('deploy staging')
    expect(captured[0]?.[1]).toBe('staging')
  })

  it('does not run a matcher that does not match', async () => {
    const bot = build()
    const captured: string[][] = []
    const fence: ServerEvent[] = []
    bot.message(/deploy (\w+)/, (_event, _ctx, matches) => {
      captured.push([...matches])
    })
    bot.on('typing', (event) => {
      fence.push(event)
    })
    const socket = await started(bot)

    push(socket, messageNew({ plaintext: 'good morning' }))
    push(socket, { type: 'typing.start', channel_id: CHANNEL_ID, user_id: USER_ID })
    await waitFor('the fence event', () => fence.length >= 1)

    expect(captured).toHaveLength(0)
  })
})

describe('KlankBot middleware', () => {
  it('runs before handlers', async () => {
    const bot = build()
    const order: string[] = []
    bot.use(async (_event, _ctx, next) => {
      order.push('middleware')
      await next()
    })
    bot.on('message', () => {
      order.push('handler')
    })
    const socket = await started(bot)

    push(socket, messageNew())
    await waitFor('the handler', () => order.length === 2)

    expect(order).toEqual(['middleware', 'handler'])
  })

  it('short-circuits when next() is not called', async () => {
    const bot = build()
    const seen: string[] = []
    const fence: ServerEvent[] = []
    bot.use(async (event, _ctx, next) => {
      if (event.type === 'message.new') return
      await next()
    })
    bot.on('message', () => {
      seen.push('message')
    })
    bot.on('typing', (event) => {
      fence.push(event)
    })
    const socket = await started(bot)

    push(socket, messageNew())
    push(socket, { type: 'typing.start', channel_id: CHANNEL_ID, user_id: USER_ID })
    await waitFor('the fence event', () => fence.length >= 1)

    expect(seen).toHaveLength(0)
  })

  it('reports a middleware that calls next() twice', async () => {
    const bot = build()
    const errors: Error[] = []
    bot.onError((err) => {
      errors.push(err)
    })
    bot.use(async (_event, _ctx, next) => {
      await next()
      await next()
    })
    bot.on('message', () => undefined)
    const socket = await started(bot)

    push(socket, messageNew())
    await waitFor('the middleware error', () => errors.length === 1)

    expect(errors[0]?.message).toContain('next() more than once')
  })
})

describe('KlankBot error handling', () => {
  it('passes the error and the event to onError, then keeps processing', async () => {
    const bot = build()
    const seen: Array<{ err: Error; event?: ServerEvent }> = []
    bot.onError((err, event) => {
      seen.push({ err, event })
    })
    bot.on('message', () => {
      throw new Error('boom')
    })
    const socket = await started(bot)

    const first = messageNew({ plaintext: 'first' })
    push(socket, first)
    await waitFor('the first error', () => seen.length === 1)
    push(socket, messageNew({ plaintext: 'second' }))
    await waitFor('the second error', () => seen.length === 2)

    expect(seen[0]?.err.message).toBe('boom')
    expect(seen[0]?.event).toEqual(first)
  })
})

describe('KlankBot slash commands', () => {
  const command: CommandInvokedEvent = {
    type: 'command.invoked',
    command: '/deploy',
    text: 'staging',
    user_id: USER_ID,
    channel_id: CHANNEL_ID,
    workspace_id: WORKSPACE_ID,
  }

  it('routes to the registered command and posts an in_channel response', async () => {
    const bot = build()
    const seen: CommandInvokedEvent[] = []
    bot.command('/deploy', async (cmd, ctx) => {
      seen.push(cmd)
      await ctx.respond({ responseType: 'in_channel', text: `deploying ${cmd.text}` })
    })
    const socket = await started(bot)

    push(socket, command)
    await waitFor('the POST', () => requests.some((r) => MESSAGES_RE.test(r.url)))

    expect(seen).toEqual([command])
    const posted = requests.find((r) => MESSAGES_RE.test(r.url))
    expect(JSON.parse(posted?.body ?? '{}')).toEqual({
      plaintext: 'deploying staging',
      content_type: 'plaintext',
      sender_type: 'bot',
    })
  })

  it('surfaces UnsupportedError for an ephemeral response', async () => {
    const bot = build()
    const errors: Error[] = []
    bot.onError((err) => {
      errors.push(err)
    })
    bot.command('/deploy', async (_cmd, ctx) => {
      await ctx.respond({ responseType: 'ephemeral', text: 'only you' })
    })
    const socket = await started(bot)

    push(socket, command)
    await waitFor('the unsupported error', () => errors.length === 1)

    expect(errors[0]).toBeInstanceOf(UnsupportedError)
    expect(requests.some((r) => MESSAGES_RE.test(r.url))).toBe(false)
  })
})

describe('KlankBot lifecycle', () => {
  it('leaves process signal listeners alone by default', async () => {
    const bot = build()
    const before = process.listenerCount('SIGINT')
    const beforeTerm = process.listenerCount('SIGTERM')

    await started(bot)

    expect(process.listenerCount('SIGINT')).toBe(before)
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm)
  })

  it('installs and removes signal listeners when handleSignals is set', async () => {
    const bot = build({ handleSignals: true })
    const before = process.listenerCount('SIGINT')
    const beforeTerm = process.listenerCount('SIGTERM')

    await started(bot)
    expect(process.listenerCount('SIGINT')).toBe(before + 1)
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm + 1)

    bot.stop()
    expect(process.listenerCount('SIGINT')).toBe(before)
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm)
  })

  it('exposes bot info after start and closes the socket on stop', async () => {
    const bot = build()
    await started(bot)

    expect(bot.getBotInfo()).toEqual(BOT_INFO)

    bot.stop()
    await waitFor('the server-side close', () => closedSockets === 1)

    // Repeated stops must not throw.
    bot.stop()
  })
})
