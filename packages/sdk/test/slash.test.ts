import { describe, expect, it } from 'vitest'
import {
  BadRequestError,
  type SlashCommandPayload,
  parseSlashCommandPayload,
  verifySlashCommandSignature,
} from '../src/index.js'

// Vector captured from the Klank dispatcher: compact serde JSON in declaration order.
const SIGNING_SECRET = 'super-secret-32-bytes-of-entropy'
const NIL_UUID = '00000000-0000-0000-0000-000000000000'
const RAW_BODY = `{"command":"/echo","text":"hi","user_id":"${NIL_UUID}","channel_id":"${NIL_UUID}","workspace_id":"${NIL_UUID}"}`
const SIGNATURE = 'sha256=a8d6ef56cbb2a3c7071ec4aada44b499347053d291580b8500bc042b24fea42c'

const PAYLOAD: SlashCommandPayload = {
  command: '/echo',
  text: 'hi',
  user_id: NIL_UUID,
  channel_id: NIL_UUID,
  workspace_id: NIL_UUID,
}

function verify(
  signatureHeader: string | null | undefined,
  rawBody: string | Uint8Array = RAW_BODY,
  signingSecret: string | Uint8Array = SIGNING_SECRET,
): boolean {
  return verifySlashCommandSignature({ rawBody, signatureHeader, signingSecret })
}

describe('verifySlashCommandSignature', () => {
  it('accepts the known server vector', () => {
    expect(verify(SIGNATURE)).toBe(true)
  })

  it('accepts an uppercase SHA256= prefix', () => {
    expect(verify(SIGNATURE.replace('sha256=', 'SHA256='))).toBe(true)
  })

  it('agrees between a Uint8Array body and the identical string body', () => {
    expect(verify(SIGNATURE, new TextEncoder().encode(RAW_BODY))).toBe(true)
  })

  it('rejects a signature made with the wrong secret', () => {
    expect(verify(SIGNATURE, RAW_BODY, 'super-secret-32-bytes-of-entropx')).toBe(false)
  })

  it('rejects a body tampered by one byte', () => {
    const tampered = RAW_BODY.replace('"text":"hi"', '"text":"hj"')
    expect(tampered).not.toBe(RAW_BODY)
    expect(tampered.length).toBe(RAW_BODY.length)
    expect(verify(SIGNATURE, tampered)).toBe(false)
  })

  const malformed: Array<[string, string | null | undefined]> = [
    ['missing sha256= prefix', SIGNATURE.slice('sha256='.length)],
    ['a different algorithm prefix', SIGNATURE.replace('sha256=', 'sha512=')],
    ['too few hex chars', `sha256=${'a'.repeat(63)}`],
    ['too many hex chars', `sha256=${'a'.repeat(65)}`],
    ['non-hex characters', `sha256=${'z'.repeat(64)}`],
    ['an empty digest', 'sha256='],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['undefined', undefined],
    ['null', null],
  ]

  it.each(malformed)('returns false without throwing for %s', (_label, header) => {
    let result: boolean | undefined
    expect(() => {
      result = verify(header)
    }).not.toThrow()
    expect(result).toBe(false)
  })
})

describe('parseSlashCommandPayload', () => {
  it('round-trips the vector body', () => {
    expect(parseSlashCommandPayload(RAW_BODY)).toEqual(PAYLOAD)
  })

  it('parses a Uint8Array body identically', () => {
    expect(parseSlashCommandPayload(new TextEncoder().encode(RAW_BODY))).toEqual(PAYLOAD)
  })

  it('returns only the known fields, dropping unrecognised keys', () => {
    const withExtra = JSON.stringify({ ...PAYLOAD, response_url: 'https://evil.example' })
    expect(Object.keys(parseSlashCommandPayload(withExtra)).sort()).toEqual([
      'channel_id',
      'command',
      'text',
      'user_id',
      'workspace_id',
    ])
  })

  it('throws BadRequestError carrying a bad_request code on invalid JSON', () => {
    let thrown: unknown
    try {
      parseSlashCommandPayload('{"command":')
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(BadRequestError)
    expect((thrown as BadRequestError).code).toBe('bad_request')
  })

  it('throws BadRequestError when a field is missing', () => {
    const { text: _text, ...rest } = PAYLOAD
    expect(() => parseSlashCommandPayload(JSON.stringify(rest))).toThrow(BadRequestError)
  })

  it('throws BadRequestError when a field has the wrong type', () => {
    const wrongType = JSON.stringify({ ...PAYLOAD, user_id: 42 })
    expect(() => parseSlashCommandPayload(wrongType)).toThrow(BadRequestError)
  })

  it('throws BadRequestError on JSON null', () => {
    expect(() => parseSlashCommandPayload('null')).toThrow(BadRequestError)
  })
})
