import { createHmac } from 'node:crypto'
import { type IncomingMessage, type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { buffer } from 'node:stream/consumers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  E2EEChannelError,
  KlankError,
  type Message,
  NetworkError,
  WebhookAuthError,
  WebhookBot,
  signWebhookBody,
} from '../src/index.js'

interface Captured {
  method: string | undefined
  url: string | undefined
  headers: IncomingMessage['headers']
  body: Buffer
}

const WEBHOOK_ID = '11111111-2222-3333-4444-555555555555'
const SECRET = 'a'.repeat(48)

const MESSAGE: Message = {
  id: '99999999-8888-7777-6666-555555555555',
  channel_id: '12121212-3434-5656-7878-909090909090',
  sender_id: WEBHOOK_ID,
  sender_type: 'bot',
  content_type: 'plaintext',
  ciphertext: null,
  plaintext: 'hello',
  nonce: null,
  key_epoch: null,
  thread_id: null,
  edited_at: null,
  deleted_at: null,
  created_at: '2026-01-01T00:00:00Z',
}

let server: Server
let serverUrl: string
let captured: Captured[]
let reply: { status: number; body: string }

// Executor form, not `Promise.withResolvers`: the repo pins `lib: ES2022` and
// `engines.node >= 20`, and withResolvers needs ES2024 / Node 22.
async function stop(s: Server): Promise<void> {
  if (!s.listening) return
  await new Promise<void>((resolve) => s.close(() => resolve()))
}

beforeEach(async () => {
  captured = []
  reply = { status: 201, body: JSON.stringify(MESSAGE) }
  server = createServer((req, res) => {
    void buffer(req).then((body) => {
      captured.push({ method: req.method, url: req.url, headers: req.headers, body })
      res.writeHead(reply.status, { 'content-type': 'application/json' })
      res.end(reply.body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await stop(server)
})

function bot(url = serverUrl): WebhookBot {
  return new WebhookBot({ webhookId: WEBHOOK_ID, webhookSecret: SECRET, serverUrl: url })
}

/** HMAC computed independently of the SDK, over the bytes the server actually received. */
function expectedSignature(secret: string, raw: Buffer): string {
  return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`
}

function sent(): Captured {
  const req = captured[0]
  if (!req) throw new Error('no request reached the server')
  return req
}

describe('signWebhookBody', () => {
  it('matches the server-side known vector', () => {
    expect(signWebhookBody('s3cr3t', '{"hello":"world"}')).toBe(
      'sha256=c5ea6542cb731d59005472d10164434c5b64ae51f6372f72447e46d1536492ee',
    )
  })

  it('accepts Uint8Array secret and body, agreeing with the string form', () => {
    const enc = new TextEncoder()
    expect(signWebhookBody(enc.encode('s3cr3t'), enc.encode('{"hello":"world"}'))).toBe(
      'sha256=c5ea6542cb731d59005472d10164434c5b64ae51f6372f72447e46d1536492ee',
    )
  })
})

describe('WebhookBot.send', () => {
  it('POSTs the incoming route with both auth headers and a JSON content type', async () => {
    await bot().send('hello')

    expect(captured).toHaveLength(1)
    const req = sent()
    expect(req.method).toBe('POST')
    expect(req.url).toBe(`/api/v1/webhooks/${WEBHOOK_ID}/incoming`)
    expect(req.headers['content-type']).toBe('application/json')
    expect(req.headers['x-klank-webhook-key']).toBe(SECRET)
    expect(req.headers['x-klank-signature']).toBe(expectedSignature(SECRET, req.body))
  })

  it('sends only text — never the secret — and omits username when not given', async () => {
    await bot().send('hello')

    const parsed = JSON.parse(sent().body.toString('utf8')) as Record<string, unknown>
    expect(parsed).toEqual({ text: 'hello' })
    expect(Object.keys(parsed)).toEqual(['text'])
    expect('secret' in parsed).toBe(false)
    expect('username' in parsed).toBe(false)
  })

  it('includes username when given, and signs those exact bytes', async () => {
    await bot().send('hi there', { username: 'deploybot' })

    const req = sent()
    const parsed = JSON.parse(req.body.toString('utf8')) as Record<string, unknown>
    expect(parsed).toEqual({ text: 'hi there', username: 'deploybot' })
    expect(req.headers['x-klank-signature']).toBe(expectedSignature(SECRET, req.body))
  })

  it('signs the UTF-8 bytes of non-ASCII text', async () => {
    await bot().send('héllo — 🚀 "quoted"')

    const req = sent()
    expect(req.headers['x-klank-signature']).toBe(expectedSignature(SECRET, req.body))
    const parsed = JSON.parse(req.body.toString('utf8')) as { text: string }
    expect(parsed.text).toBe('héllo — 🚀 "quoted"')
  })

  it('tolerates a trailing slash on serverUrl', async () => {
    await bot(`${serverUrl}/`).send('x')
    expect(sent().url).toBe(`/api/v1/webhooks/${WEBHOOK_ID}/incoming`)
  })

  it('uses an injected fetch when configured', async () => {
    const calls: string[] = []
    const injected: typeof fetch = (input, init) => {
      calls.push(String(input))
      return fetch(input, init)
    }
    const message = await new WebhookBot({
      webhookId: WEBHOOK_ID,
      webhookSecret: SECRET,
      serverUrl,
      fetch: injected,
    }).send('x')

    expect(calls).toEqual([`${serverUrl}/api/v1/webhooks/${WEBHOOK_ID}/incoming`])
    expect(message).toEqual(MESSAGE)
  })

  it('resolves to the created Message on 201', async () => {
    await expect(bot().send('hello')).resolves.toEqual(MESSAGE)
  })

  it('rejects with WebhookAuthError on 401, preserving the server message', async () => {
    reply = {
      status: 401,
      body: JSON.stringify({ error: 'Unauthorized', message: 'Invalid signature' }),
    }

    const err = await bot()
      .send('x')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WebhookAuthError)
    expect(err).toBeInstanceOf(KlankError)
    const typed = err as WebhookAuthError
    expect(typed.code).toBe('webhook_auth')
    expect(typed.status).toBe(401)
    expect(typed.message).toBe('Invalid signature')
    expect(typed.body).toEqual({ error: 'Unauthorized', message: 'Invalid signature' })
  })

  it('rejects with E2EEChannelError when the channel requires encrypted messages', async () => {
    reply = {
      status: 400,
      body: JSON.stringify({
        error: 'Bad Request',
        message: 'Bad request: Channel requires encrypted messages',
      }),
    }

    const err = await bot()
      .send('x')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(E2EEChannelError)
    const typed = err as E2EEChannelError
    expect(typed.code).toBe('e2ee_channel')
    expect(typed.status).toBe(400)
    expect(typed.message).toBe('Bad request: Channel requires encrypted messages')
  })

  it('rejects with NetworkError when the connection is refused', async () => {
    const deadUrl = serverUrl
    await stop(server)

    const err = await bot(deadUrl)
      .send('x')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NetworkError)
    const typed = err as NetworkError
    expect(typed.code).toBe('network')
    expect(typed.status).toBeUndefined()
    expect(typed.cause).toBeDefined()
  })
})
