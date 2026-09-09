import { pathToFileURL } from 'node:url'
import { type Message, WebhookBot } from '@klank/sdk'

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`)
  }
  return value
}

/**
 * Post `text` into the webhook's channel and resolve with the created message.
 * Reads the environment on every call so a host can rotate the secret without
 * restarting, and so tests can point it at their own server. `async` so a
 * missing variable rejects the promise instead of throwing at the call site.
 */
export async function notify(text: string): Promise<Message> {
  const bot = new WebhookBot({
    serverUrl: requiredEnv('SERVER_URL'),
    webhookId: requiredEnv('WEBHOOK_ID'),
    webhookSecret: requiredEnv('WEBHOOK_SECRET'),
  })
  return bot.send(text)
}

const entry = process.argv[1]
const invokedDirectly = entry !== undefined && import.meta.url === pathToFileURL(entry).href

if (invokedDirectly) {
  const text = process.argv.slice(2).join(' ') || 'Hello from Klank!'
  try {
    const message = await notify(text)
    console.log(`posted message ${message.id} to channel ${message.channel_id}`)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
