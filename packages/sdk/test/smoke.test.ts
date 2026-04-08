import { KlankBot, KlankClient, WebhookBot } from '@klank/sdk'
import { describe, expect, it } from 'vitest'

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
