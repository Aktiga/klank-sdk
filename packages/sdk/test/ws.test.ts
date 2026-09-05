// Integration tests against a real `ws` server on a real socket, so time is real:
// fake timers would freeze the `ws` library's own handshake/close timers and the
// reconnect backoff under test. Delays are kept tiny via `baseDelayMs: 10`, waits
// are condition-driven (`waitFor`), and the few fixed `sleep`s only back negative
// assertions ("nothing else happened"), which have no event to await.
// `Promise.withResolvers` is unavailable here: tsconfig pins lib ES2022 (TS2550).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type WebSocket as ServerSocket, WebSocketServer } from 'ws'
import { ConnectionError } from '../src/index.js'
import type { ServerEvent, TypingStartEvent } from '../src/index.js'
import { WsManager } from '../src/ws.js'

const TYPING: TypingStartEvent = {
  type: 'typing.start',
  channel_id: '11111111-1111-1111-1111-111111111111',
  user_id: '22222222-2222-2222-2222-222222222222',
}

let wss: WebSocketServer
let serverUrl: string
/** `req.url` of every upgrade the server accepted, in order. */
let connections: string[]
let sockets: ServerSocket[]
/** Text frames the server received, in order. */
let framesReceived: string[]
let refusedUpgrades: number
/** When true the server answers 403 but keeps listening, so the port stays bound. */
let refuse: boolean
let managers: WsManager[]
let ticketCalls: number

/** Distinct value per call: the server issues single-use tickets. */
function nextTicket(): Promise<string> {
  ticketCalls += 1
  return Promise.resolve(`ticket-${ticketCalls}`)
}

/** Registers the manager so `afterEach` always tears its timers down. */
function manage(options: ConstructorParameters<typeof WsManager>[2]): WsManager {
  const manager = new WsManager(serverUrl, nextTicket, options)
  managers.push(manager)
  return manager
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(async () => {
  connections = []
  sockets = []
  framesReceived = []
  refusedUpgrades = 0
  refuse = false
  managers = []
  ticketCalls = 0

  wss = new WebSocketServer({
    port: 0,
    path: '/api/v1/ws',
    verifyClient: (_info, done) => {
      if (refuse) {
        refusedUpgrades += 1
        done(false, 403)
        return
      }
      done(true)
    },
  })
  wss.on('connection', (socket, req) => {
    connections.push(req.url ?? '')
    sockets.push(socket)
    socket.on('message', (data, isBinary) => {
      if (!isBinary) framesReceived.push(data.toString())
    })
  })

  await new Promise<void>((resolve) => wss.on('listening', () => resolve()))
  const address = wss.address()
  if (address === null || typeof address === 'string') {
    throw new Error('expected a TCP address, got a pipe')
  }
  serverUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  for (const manager of managers) manager.disconnect()
  for (const socket of sockets) socket.terminate()
  await new Promise<void>((resolve, reject) => {
    wss.close((err) => (err ? reject(err) : resolve()))
  })
})

describe('WsManager', () => {
  it('connects to /api/v1/ws with the ticket in the query string', async () => {
    const manager = manage({ reconnect: false, heartbeatMs: 0 })

    await manager.connect()

    expect(ticketCalls).toBe(1)
    expect(connections).toEqual(['/api/v1/ws?ticket=ticket-1'])
  })

  it('tolerates a trailing slash on serverUrl', async () => {
    const manager = new WsManager(`${serverUrl}/`, nextTicket, {
      reconnect: false,
      heartbeatMs: 0,
    })
    managers.push(manager)

    await manager.connect()

    expect(connections).toEqual(['/api/v1/ws?ticket=ticket-1'])
  })

  it('mints a fresh ticket for every reconnect', async () => {
    const manager = manage({ reconnect: true, baseDelayMs: 10, heartbeatMs: 0 })
    await manager.connect()
    expect(ticketCalls).toBe(1)

    sockets[0]?.close()
    await waitFor('the second connection', () => connections.length === 2)

    expect(ticketCalls).toBe(2)
    expect(connections[1]).toBe('/api/v1/ws?ticket=ticket-2')
  })

  it('waits out the backoff delay before reconnecting', async () => {
    const manager = manage({ reconnect: true, baseDelayMs: 10, heartbeatMs: 0 })
    await manager.connect()

    const closedAt = Date.now()
    sockets[0]?.close()
    await waitFor('the second connection', () => connections.length === 2)

    // 10ms base jittered to 0.8–1.2×, so the floor is 8ms.
    expect(Date.now() - closedAt).toBeGreaterThanOrEqual(8)
  })

  it('gives up after maxAttempts consecutive failures', async () => {
    const manager = manage({ reconnect: true, baseDelayMs: 10, maxAttempts: 2, heartbeatMs: 0 })
    const errors: Error[] = []
    manager.onError((err) => errors.push(err))
    await manager.connect()

    refuse = true
    sockets[0]?.close()
    await waitFor('reconnect exhaustion', () => errors.length > 0)

    const err = errors[0]
    if (!(err instanceof ConnectionError)) throw new Error(`expected ConnectionError, got ${err}`)
    expect(err.attempts).toBe(2)
    expect(refusedUpgrades).toBe(2)

    await sleep(100)
    expect(refusedUpgrades).toBe(2)
    expect(errors).toHaveLength(1)
  })

  it('never reconnects after disconnect()', async () => {
    const manager = manage({ reconnect: true, baseDelayMs: 10, heartbeatMs: 0 })
    await manager.connect()

    manager.disconnect()
    await sleep(100)

    expect(connections).toHaveLength(1)
  })

  it('reports a malformed frame and still delivers the next valid one', async () => {
    const manager = manage({ reconnect: false, heartbeatMs: 0 })
    const events: ServerEvent[] = []
    const errors: Error[] = []
    manager.onEvent((event) => events.push(event))
    manager.onError((err) => errors.push(err))
    await manager.connect()

    sockets[0]?.send('{not json')
    await waitFor('the parse error', () => errors.length === 1)
    sockets[0]?.send(JSON.stringify(TYPING))
    await waitFor('the valid event', () => events.length === 1)

    expect(errors[0]?.message).toContain('Malformed WebSocket frame')
    expect(events[0]).toEqual(TYPING)
  })

  it('reports a frame that parses but carries no type tag', async () => {
    const manager = manage({ reconnect: false, heartbeatMs: 0 })
    const events: ServerEvent[] = []
    const errors: Error[] = []
    manager.onEvent((event) => events.push(event))
    manager.onError((err) => errors.push(err))
    await manager.connect()

    sockets[0]?.send('42')
    await waitFor('the untagged-frame error', () => errors.length === 1)

    expect(errors[0]?.message).toContain('not a tagged event')
    expect(events).toHaveLength(0)
  })

  it('stops delivering to an unsubscribed listener', async () => {
    const manager = manage({ reconnect: false, heartbeatMs: 0 })
    const unsubscribed: ServerEvent[] = []
    const kept: ServerEvent[] = []
    const unsubscribe = manager.onEvent((event) => unsubscribed.push(event))
    manager.onEvent((event) => kept.push(event))
    await manager.connect()

    sockets[0]?.send(JSON.stringify(TYPING))
    await waitFor('the first delivery', () => kept.length === 1)
    expect(unsubscribed).toHaveLength(1)

    unsubscribe()
    sockets[0]?.send(JSON.stringify(TYPING))
    // The still-subscribed listener proves the frame arrived at all.
    await waitFor('the second delivery', () => kept.length === 2)

    expect(unsubscribed).toHaveLength(1)
  })

  it('routes a throwing event listener to onError without starving the next one', async () => {
    const manager = manage({ reconnect: false, heartbeatMs: 0 })
    const errors: Error[] = []
    const seen: ServerEvent[] = []
    manager.onEvent(() => {
      throw new Error('listener exploded')
    })
    manager.onEvent((event) => seen.push(event))
    manager.onError((err) => errors.push(err))
    await manager.connect()

    sockets[0]?.send(JSON.stringify(TYPING))
    await waitFor('the listener error', () => errors.length === 1)

    expect(errors[0]?.message).toBe('listener exploded')
    expect(seen).toEqual([TYPING])
  })

  it('sends the app-level ping frame on the heartbeat interval', async () => {
    const manager = manage({ reconnect: false, heartbeatMs: 20 })
    await manager.connect()

    await waitFor('a ping frame', () => framesReceived.includes('{"type":"ping"}'), 200)
  })

  it('terminates a socket that stops answering pings, then reconnects', async () => {
    await new Promise<void>((resolve, reject) => {
      wss.close((err) => (err ? reject(err) : resolve()))
    })
    // A server that never answers a protocol ping: the pong deadline is the only
    // thing that can notice a socket which is still "open" but actually dead.
    wss = new WebSocketServer({ port: 0, path: '/api/v1/ws', autoPong: false })
    wss.on('connection', (socket, req) => {
      connections.push(req.url ?? '')
      sockets.push(socket)
    })
    await new Promise<void>((resolve) => wss.on('listening', () => resolve()))
    const address = wss.address()
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP address, got a pipe')
    }
    serverUrl = `http://127.0.0.1:${address.port}`

    const manager = manage({
      reconnect: true,
      baseDelayMs: 10,
      heartbeatMs: 20,
      pongTimeoutMs: 30,
    })
    await manager.connect()
    expect(connections).toHaveLength(1)

    await waitFor('the post-terminate reconnect', () => connections.length >= 2, 500)
  })

  it('rejects connect() with ConnectionError and starts no reconnect loop', async () => {
    refuse = true
    const manager = manage({ reconnect: true, baseDelayMs: 10, heartbeatMs: 0 })

    await expect(manager.connect()).rejects.toBeInstanceOf(ConnectionError)

    expect(refusedUpgrades).toBe(1)
    await sleep(60)
    expect(refusedUpgrades).toBe(1)
  })

  it('rejects connect() with ConnectionError when the ticket cannot be minted', async () => {
    const manager = new WsManager(serverUrl, () => Promise.reject(new Error('401 Unauthorized')), {
      reconnect: false,
    })
    managers.push(manager)

    await expect(manager.connect()).rejects.toBeInstanceOf(ConnectionError)

    expect(connections).toHaveLength(0)
  })

  it('drops send() while closed and delivers it once open', async () => {
    const manager = manage({ reconnect: false, heartbeatMs: 0 })

    manager.send({ type: 'ping' })
    await manager.connect()
    manager.send({ type: 'typing', channel_id: TYPING.channel_id })

    await waitFor('the typing frame', () => framesReceived.length === 1)
    expect(framesReceived).toEqual([`{"type":"typing","channel_id":"${TYPING.channel_id}"}`])
  })
})
