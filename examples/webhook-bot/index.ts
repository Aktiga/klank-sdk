/**
 * Webhook bot — the simplest thing that works: post messages through an
 * incoming webhook. No WebSocket, no event loop, nothing to keep alive.
 *
 * Usage:
 *   SERVER_URL=http://localhost:3000 WEBHOOK_ID=uuid WEBHOOK_SECRET=secret npx tsx index.ts
 */
import { E2EEChannelError, NetworkError, WebhookAuthError, WebhookBot } from '@klank/sdk'

const webhookId = process.env.WEBHOOK_ID
const webhookSecret = process.env.WEBHOOK_SECRET
if (!webhookId) throw new Error('WEBHOOK_ID is required')
if (!webhookSecret) throw new Error('WEBHOOK_SECRET is required')

const serverUrl = process.env.SERVER_URL ?? 'http://localhost:3000'

const bot = new WebhookBot({ serverUrl, webhookId, webhookSecret })

async function main() {
  const first = await bot.send('Hello from the webhook bot 🤖')
  console.log(`posted ${first.id} to channel ${first.channel_id}`)

  // `username` is accepted by the server but not persisted on 53d464a.
  await bot.send('Build #42 passed ✅', { username: 'CI Pipeline' })
}

main().catch((err: unknown) => {
  if (err instanceof WebhookAuthError) {
    console.error(`webhook rejected the credentials (${err.status}): ${err.message}`)
    console.error('Check WEBHOOK_ID and WEBHOOK_SECRET: the raw secret is shown once, at creation.')
  } else if (err instanceof E2EEChannelError) {
    console.error(`channel requires encrypted messages: ${err.message}`)
    console.error('Bots post plaintext. Point the webhook at a channel with no active key epoch.')
  } else if (err instanceof NetworkError) {
    console.error(`could not reach ${serverUrl}: ${err.message}`)
  } else {
    throw err
  }
  process.exitCode = 1
})
