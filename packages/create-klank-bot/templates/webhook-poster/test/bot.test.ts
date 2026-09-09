import { createHmac } from 'node:crypto'
import { type IncomingMessage, type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { buffer } from 'node:stream/consumers'
import type { Message } from '@klank/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { notify } from '../src/index.js'

const WEBHOOK_ID = '11111111-2222-3333-4444-555555555555'
const SECRET = 'a'.repeat(48)

const MESSAGE: Message = {
  id: '99999999-8888-7777-6666-555555555555',
  channel_id: '12121212-3434-5656-7878-909090909090',
  sender_id: WEBHOOK_ID,
  sender_type: 'bot',
  content_type: 'plaintext',
  ciphertext: null,
  plaintext: 'Build #42 passed',
  nonce: null,
  key_epoch: null,
  thread_id: null,
  edited_at: null,
  deleted_at: null,
  created_at: '2026-01-01T00:00:00Z',
}

interface Captured {
  url: string | undefined
  headers: IncomingMessage['headers']
  body: Buffer
}

let server: Server
let captured: Captured[]

beforeEach(async () => {
  captured = []
  server = createServer((req, res) => {
    void buffer(req).then((body) => {
      captured.push({ url: req.url, headers: req.headers, body })
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(JSON.stringify(MESSAGE))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))

  process.env.SERVER_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.WEBHOOK_ID = WEBHOOK_ID
  process.env.WEBHOOK_SECRET = SECRET
})

afterEach(async () => {
  delete process.env.SERVER_URL
  delete process.env.WEBHOOK_ID
  delete process.env.WEBHOOK_SECRET
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
})

function sent(): Captured {
  const request = captured[0]
  if (!request) throw new Error('no request reached the server')
  return request
}

describe('notify', () => {
  it('posts the incoming-webhook route with both auth headers', async () => {
    await notify('Build #42 passed')

    const request = sent()
    expect(request.url).toBe(`/api/v1/webhooks/${WEBHOOK_ID}/incoming`)
    expect(request.headers['x-klank-webhook-key']).toBe(SECRET)
    expect(JSON.parse(request.body.toString('utf8'))).toEqual({ text: 'Build #42 passed' })
  })

  it('signs the exact bytes the server received', async () => {
    await notify('héllo — 🚀')

    const request = sent()
    // HMAC computed here, over the received bytes, never from the sent string.
    const expected = `sha256=${createHmac('sha256', SECRET).update(request.body).digest('hex')}`
    expect(request.headers['x-klank-signature']).toBe(expected)
  })

  it('resolves with the message the server created', async () => {
    await expect(notify('Build #42 passed')).resolves.toEqual(MESSAGE)
  })

  it('fails with an actionable message when the environment is incomplete', async () => {
    delete process.env.WEBHOOK_SECRET

    await expect(notify('nope')).rejects.toThrow(/Missing WEBHOOK_SECRET/)
    expect(captured).toHaveLength(0)
  })
})
