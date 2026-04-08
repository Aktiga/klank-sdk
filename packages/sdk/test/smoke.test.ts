import { describe, it, expect } from 'vitest'
import { KlankBot, KlankClient, WebhookBot } from '@klank/sdk'

describe('@klank/sdk public surface (built dist)', () => {
  it('exports KlankBot as a constructor', () => {
    expect(typeof KlankBot).toBe('function')
  })

  it('exports KlankClient as a constructor', () => {
    expect(typeof KlankClient).toBe('function')
  })

  it('exports WebhookBot as a constructor', () => {
    expect(typeof WebhookBot).toBe('function')
  })
})
