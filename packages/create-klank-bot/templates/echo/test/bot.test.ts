import type { KlankBot } from '@klank/sdk'
import { MockKlank, type RecordedRequest } from '@klank/sdk/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { createBot } from '../src/index.js'

const CHANNEL_ID = '22222222-2222-2222-2222-222222222222'
const MESSAGE_ID = '33333333-3333-3333-3333-333333333333'
const USER_ID = '44444444-4444-4444-4444-444444444444'

let mock: MockKlank | undefined
let bot: KlankBot | undefined

afterEach(async () => {
  bot?.stop()
  bot = undefined
  await mock?.close()
  mock = undefined
})

/** No reconnect loop and no heartbeat timer, so a failed assertion cannot leave one running. */
function build(mock: MockKlank): KlankBot {
  return createBot({
    token: 'bot_test',
    serverUrl: mock.url,
    reconnect: false,
    ws: { heartbeatMs: 0 },
  })
}

function messageNew(plaintext: string): Record<string, unknown> {
  return {
    type: 'message.new',
    channel_id: CHANNEL_ID,
    message_id: MESSAGE_ID,
    sender_id: USER_ID,
    sender_type: 'user',
    content_type: 'plaintext',
    ciphertext: null,
    plaintext,
    nonce: null,
    key_epoch: null,
    thread_id: null,
    created_at: '2026-01-01T00:00:00Z',
  }
}

describe('createBot', () => {
  it('echoes an incoming message back into its channel', async () => {
    mock = await MockKlank.start()
    bot = build(mock)

    await bot.start()
    await mock.waitForSocket()
    mock.deliver(messageNew('hi'))
    const request = await mock.waitForRequest((req: RecordedRequest) =>
      req.path.endsWith('/messages'),
    )

    expect(request.method).toBe('POST')
    expect(request.path).toBe(`/api/v1/channels/${CHANNEL_ID}/messages`)
    expect(request.body).toMatchObject({ plaintext: 'echo: hi', content_type: 'plaintext' })
  })

  it('ignores a message with no readable text', async () => {
    mock = await MockKlank.start()
    bot = build(mock)

    await bot.start()
    await mock.waitForSocket()
    mock.deliver({
      ...messageNew(''),
      plaintext: null,
      content_type: 'encrypted',
      ciphertext: [1, 2],
    })
    await expect(
      mock.waitForRequest((req: RecordedRequest) => req.path.endsWith('/messages'), 200),
    ).rejects.toThrow()
  })
})
