import { createHmac } from 'node:crypto'
import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { SlashCommandResponse } from '@klank/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHandler } from '../src/index.js'

const SECRET = 'slash-signing-secret'

const PAYLOAD = JSON.stringify({
  command: '/echo',
  text: 'hi',
  user_id: '11111111-1111-1111-1111-111111111111',
  channel_id: '22222222-2222-2222-2222-222222222222',
  workspace_id: '33333333-3333-3333-3333-333333333333',
})

let server: Server
let url: string

beforeEach(async () => {
  server = createServer(createHandler(SECRET))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/slash`
})

afterEach(async () => {
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
})

/** Sign exactly the bytes being sent, the way the Klank server does. */
function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
}

async function post(body: string, signature?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signature !== undefined) headers['x-klank-signature'] = signature
  return fetch(url, { method: 'POST', headers, body })
}

describe('createHandler', () => {
  it('answers a signed dispatch with in-channel text', async () => {
    const res = await post(PAYLOAD, sign(PAYLOAD))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.json()).toEqual<SlashCommandResponse>({
      response_type: 'in_channel',
      text: 'echo: hi',
    })
  })

  it('rejects an unsigned body with 401 and no response body', async () => {
    const res = await post(PAYLOAD)

    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
  })

  it('rejects a body signed with the wrong secret', async () => {
    const wrong = createHmac('sha256', 'wrong').update(PAYLOAD).digest('hex')

    const res = await post(PAYLOAD, `sha256=${wrong}`)

    expect(res.status).toBe(401)
  })

  it('answers 400 for a correctly signed body that is not a slash payload', async () => {
    const body = '{"command":"/echo"}'

    const res = await post(body, sign(body))

    expect(res.status).toBe(400)
  })
})
