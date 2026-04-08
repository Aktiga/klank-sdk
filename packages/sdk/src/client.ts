import type { BotInfo, Channel, Message } from './types'

/** Low-level REST API client for Klank. */
export class KlankClient {
  private baseUrl: string
  private token: string

  constructor(serverUrl: string, token: string) {
    this.baseUrl = `${serverUrl}/api/v1`
    this.token = token
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      ...((options.headers as Record<string, string>) || {}),
    }
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json'
    }

    const res = await fetch(`${this.baseUrl}${path}`, { ...options, headers })

    // Rate limit handling with backoff
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '1', 10)
      await new Promise(r => setTimeout(r, retryAfter * 1000))
      return this.fetch(path, options)
    }

    return res
  }

  private async json<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await this.fetch(path, options)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error(`API error ${res.status}: ${err.message}`)
    }
    const body = await res.text()
    return body ? JSON.parse(body) : undefined
  }

  // ── Bot Info ──

  async getBotInfo(): Promise<BotInfo> {
    return this.json('/auth/bot-info')
  }

  async getWsTicket(): Promise<string> {
    const data = await this.json<{ ticket: string }>('/auth/bot-ws-ticket', { method: 'POST' })
    return data.ticket
  }

  // ── Messages ──

  async sendMessage(channelId: string, text: string, options?: { threadId?: string }): Promise<Message> {
    return this.json(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        plaintext: text,
        content_type: 'plaintext',
        sender_type: 'bot',
        thread_id: options?.threadId,
      }),
    })
  }

  async getMessages(channelId: string, limit = 50): Promise<{ items: Message[]; next_cursor: string | null }> {
    return this.json(`/channels/${channelId}/messages?limit=${limit}`)
  }

  // ── Reactions ──

  async addReaction(messageId: string, emoji: string): Promise<void> {
    await this.fetch(`/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    })
  }

  async removeReaction(messageId: string, emoji: string): Promise<void> {
    await this.fetch(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
      method: 'DELETE',
    })
  }

  // ── Channels ──

  async listChannels(workspaceId: string): Promise<Channel[]> {
    return this.json(`/workspaces/${workspaceId}/channels`)
  }

  async getChannel(channelId: string): Promise<Channel> {
    return this.json(`/channels/${channelId}`)
  }
}
