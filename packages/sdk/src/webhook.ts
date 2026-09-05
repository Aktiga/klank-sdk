import { createHmac } from 'node:crypto'
import { NetworkError, errorFromResponse, parseErrorBody } from './errors.js'
import type { Message, WebhookConfig } from './types.js'

/**
 * Compute the `X-Klank-Signature` value for an incoming-webhook request:
 * `sha256=<hex(hmac_sha256(rawSecret, body))>`.
 *
 * The server verifies against the exact bytes it received, so sign the same
 * serialization you transmit — re-encoding the JSON invalidates the signature.
 */
export function signWebhookBody(secret: string | Uint8Array, body: string | Uint8Array): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

/** Posts messages to one channel through an incoming webhook. No bot token required. */
export class WebhookBot {
  private readonly webhookId: string
  private readonly webhookSecret: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(config: WebhookConfig) {
    this.webhookId = config.webhookId
    this.webhookSecret = config.webhookSecret
    this.baseUrl = config.serverUrl.replace(/\/+$/, '')
    this.fetchImpl = config.fetch ?? fetch
  }

  /** Post a message to the webhook's channel. Resolves to the created `Message` row. */
  async send(text: string, options?: { username?: string }): Promise<Message> {
    const payload: { text: string; username?: string } = { text }
    // Send no `username` key at all when unset: the server rejects a null value.
    if (options?.username !== undefined) payload.username = options.username

    const body = JSON.stringify(payload)
    const url = `${this.baseUrl}/api/v1/webhooks/${this.webhookId}/incoming`

    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Klank-Webhook-Key': this.webhookSecret,
          'X-Klank-Signature': signWebhookBody(this.webhookSecret, body),
        },
        body,
      })
    } catch (cause) {
      throw new NetworkError(`Webhook request to ${url} failed`, { cause })
    }

    if (!res.ok) {
      throw errorFromResponse(res.status, parseErrorBody(await res.text()), 'webhook')
    }
    return (await res.json()) as Message
  }
}
