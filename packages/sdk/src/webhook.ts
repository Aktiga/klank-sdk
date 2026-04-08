import type { WebhookConfig } from './types'

/** Simple webhook bot — just POST messages to a channel via incoming webhook. */
export class WebhookBot {
  private config: WebhookConfig

  constructor(config: WebhookConfig) {
    this.config = config
  }

  /** Send a message to the webhook's channel. */
  async send(text: string, options?: { username?: string }): Promise<void> {
    const res = await fetch(
      `${this.config.serverUrl}/api/v1/webhooks/${this.config.webhookId}/incoming`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          username: options?.username,
          secret: this.config.webhookSecret,
        }),
      },
    )

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: res.statusText }))) as { message?: string }
      throw new Error(`Webhook error ${res.status}: ${err.message ?? res.statusText}`)
    }
  }
}
