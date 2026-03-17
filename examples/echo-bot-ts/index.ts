import { RustSlackBot } from '@rust-slack/sdk'

const bot = new RustSlackBot({
  token: process.env.BOT_TOKEN!,
  serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
})

// Echo every message back
bot.on('message', async (event, ctx) => {
  if (event.plaintext) {
    await ctx.say(`Echo: ${event.plaintext}`)
  }
})

// Respond to /ping command
bot.command('/ping', async (cmd, ctx) => {
  await ctx.respond({ responseType: 'in_channel', text: 'Pong! 🏓' })
})

// React with 👋 when someone says "hello"
bot.message(/hello|hi|hey/i, async (event, ctx) => {
  await ctx.react('👋')
})

// Log all events (middleware)
bot.use(async (event, ctx, next) => {
  console.log(`[${new Date().toISOString()}] ${event.type}`)
  await next()
})

// Error handler
bot.onError((err) => {
  console.error('[bot] Error:', err.message)
})

bot.start().then(() => {
  console.log('Echo bot is running!')
})
