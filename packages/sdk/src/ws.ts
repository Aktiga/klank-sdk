import WebSocket from 'ws'
import type { ServerEvent } from './types'

export type WsEventCallback = (event: ServerEvent) => void

/** WebSocket connection manager with auto-reconnect. */
export class WsManager {
  private ws: WebSocket | null = null
  private ticketFn: () => Promise<string>
  private serverUrl: string
  private reconnect: boolean
  private reconnectDelay = 1000
  private listeners: WsEventCallback[] = []
  private stopped = false

  constructor(serverUrl: string, ticketFn: () => Promise<string>, reconnect = true) {
    this.serverUrl = serverUrl
    this.ticketFn = ticketFn
    this.reconnect = reconnect
  }

  onEvent(cb: WsEventCallback) {
    this.listeners.push(cb)
  }

  async connect(): Promise<void> {
    this.stopped = false
    const ticket = await this.ticketFn()
    const wsUrl = this.serverUrl.replace('http://', 'ws://').replace('https://', 'wss://')
    const url = `${wsUrl}/api/v1/ws?ticket=${ticket}`

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url)

      this.ws.on('open', () => {
        this.reconnectDelay = 1000
        resolve()
      })

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const event = JSON.parse(data.toString()) as ServerEvent
          for (const cb of this.listeners) {
            cb(event)
          }
        } catch { /* ignore parse errors */ }
      })

      this.ws.on('close', () => {
        this.ws = null
        if (this.reconnect && !this.stopped) {
          setTimeout(() => this.connect().catch(() => {}), this.reconnectDelay)
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
        }
      })

      this.ws.on('error', (err) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          reject(err)
        }
      })
    })
  }

  disconnect() {
    this.stopped = true
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}
