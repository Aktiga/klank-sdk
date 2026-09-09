import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import { buffer } from 'node:stream/consumers'
import { pathToFileURL } from 'node:url'
import {
  type SlashCommandResponse,
  parseSlashCommandPayload,
  verifySlashCommandSignature,
} from '@klank/sdk'

export type SlashRequestListener = (req: IncomingMessage, res: ServerResponse) => void

/**
 * Verify Klank's `X-Klank-Signature` over the raw bytes received, then answer
 * with in-channel text. Re-encoding the body before verifying breaks the HMAC,
 * so the buffer is passed through untouched.
 */
export function createHandler(signingSecret: string): SlashRequestListener {
  return (req, res) => {
    void buffer(req)
      .then((rawBody) => {
        const header = req.headers['x-klank-signature']
        const verified = verifySlashCommandSignature({
          rawBody,
          signatureHeader: Array.isArray(header) ? header[0] : header,
          signingSecret,
        })
        if (!verified) {
          res.writeHead(401).end()
          return
        }

        const command = parseSlashCommandPayload(rawBody)
        const body: SlashCommandResponse = {
          response_type: 'in_channel',
          text: `echo: ${command.text}`,
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
      })
      .catch((err: unknown) => {
        // A body Klank would never send, or a socket that died mid-read:
        // answer instead of leaving the request hanging.
        console.error('[slash]', err instanceof Error ? err.message : err)
        if (res.writableEnded) return
        if (!res.headersSent) res.writeHead(400)
        res.end()
      })
  }
}

const entry = process.argv[1]
const invokedDirectly = entry !== undefined && import.meta.url === pathToFileURL(entry).href

if (invokedDirectly) {
  const signingSecret = process.env.SLASH_SIGNING_SECRET
  if (signingSecret === undefined || signingSecret === '') {
    console.error('Missing SLASH_SIGNING_SECRET. Copy .env.example to .env and fill it in.')
    process.exit(1)
  }

  const port = Number(process.env.PORT) || 8080
  const server = createServer(createHandler(signingSecret))
  server.listen(port, () => console.log(`slash receiver listening on :${port}`))
  process.on('SIGTERM', () => server.close())
}
