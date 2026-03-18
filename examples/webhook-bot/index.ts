/**
 * Webhook Bot — simplest possible bot. Just posts messages.
 * No WebSocket, no event handling. Great for CI/CD notifications.
 *
 * Usage:
 *   WEBHOOK_ID=uuid WEBHOOK_SECRET=secret npx tsx index.ts
 */
import { WebhookBot } from '@klank/sdk'

const bot = new WebhookBot({
  webhookId: process.env.WEBHOOK_ID!,
  webhookSecret: process.env.WEBHOOK_SECRET!,
  serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
})

async function main() {
  // Post a message
  await bot.send('Hello from the webhook bot! 🤖')

  // Post with custom username
  await bot.send('Build #42 passed ✅', { username: 'CI Pipeline' })

  console.log('Messages sent!')
}

main().catch(console.error)
