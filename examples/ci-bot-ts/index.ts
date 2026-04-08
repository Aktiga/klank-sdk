/**
 * CI Bot — posts build notifications via webhook, responds to /status.
 *
 * Usage:
 *   BOT_TOKEN=bot_xxx WEBHOOK_ID=uuid WEBHOOK_SECRET=secret npx tsx index.ts
 */
import { KlankBot, WebhookBot } from '@klank/sdk'

const serverUrl = process.env.SERVER_URL || 'http://localhost:3000'

const webhookId = process.env.WEBHOOK_ID
const webhookSecret = process.env.WEBHOOK_SECRET
const botToken = process.env.BOT_TOKEN
if (!webhookId) throw new Error('WEBHOOK_ID is required')
if (!webhookSecret) throw new Error('WEBHOOK_SECRET is required')
if (!botToken) throw new Error('BOT_TOKEN is required')

// Webhook bot for posting CI results (no WS needed)
const webhook = new WebhookBot({
  webhookId,
  webhookSecret,
  serverUrl,
})

// Full bot for interactive commands
const bot = new KlankBot({
  token: botToken,
  serverUrl,
})

// Track build status
let lastBuild = { number: 0, status: 'unknown', timestamp: '' }

bot.command('/status', async (cmd, ctx) => {
  await ctx.respond({
    responseType: 'ephemeral',
    text: `Last build: #${lastBuild.number} — ${lastBuild.status} (${lastBuild.timestamp})`,
  })
})

bot.command('/deploy', async (cmd, ctx) => {
  const target = cmd.text || 'production'
  await ctx.respond({
    responseType: 'in_channel',
    text: `🚀 Deploying to ${target}...`,
  })
})

// Simulate CI webhook call
export async function notifyBuild(number: number, status: 'pass' | 'fail') {
  lastBuild = { number, status, timestamp: new Date().toISOString() }
  const emoji = status === 'pass' ? '✅' : '❌'
  await webhook.send(`Build #${number} ${status} ${emoji}`, { username: 'CI Bot' })
}

bot.start().then(() => {
  console.log('CI bot is running!')
})
