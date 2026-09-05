import { createHmac, timingSafeEqual } from 'node:crypto'
import { BadRequestError } from './errors.js'
import type { SlashCommandPayload } from './types.js'

const SIGNATURE_PREFIX = 'sha256='

/**
 * Verify the `X-Klank-Signature` header Klank sends with slash command
 * dispatches: `sha256=<hex(hmac_sha256(signingSecret, rawBody))>`.
 *
 * Pass the exact bytes received — the server signs its own serialization
 * (compact JSON, declaration order) and any re-encoding breaks the match.
 * Comparison is constant-time. Returns `false` for a missing or malformed header.
 */
export function verifySlashCommandSignature(input: {
  rawBody: string | Uint8Array
  signatureHeader: string | null | undefined
  signingSecret: string | Uint8Array
}): boolean {
  const header = input.signatureHeader?.trim()
  if (!header || !header.toLowerCase().startsWith(SIGNATURE_PREFIX)) return false
  const hex = header.slice(SIGNATURE_PREFIX.length)
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) return false
  const provided = Buffer.from(hex, 'hex')
  const expected = createHmac('sha256', input.signingSecret).update(input.rawBody).digest()
  return timingSafeEqual(provided, expected)
}

/** Parse a verified slash command body. Throws `BadRequestError` when the shape is wrong. */
export function parseSlashCommandPayload(rawBody: string | Uint8Array): SlashCommandPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody).toString())
  } catch {
    throw new BadRequestError('Slash command body is not valid JSON')
  }
  const p = parsed as Partial<SlashCommandPayload> | null
  if (
    !p ||
    typeof p.command !== 'string' ||
    typeof p.text !== 'string' ||
    typeof p.user_id !== 'string' ||
    typeof p.channel_id !== 'string' ||
    typeof p.workspace_id !== 'string'
  ) {
    throw new BadRequestError('Slash command body is missing required fields')
  }
  return {
    command: p.command,
    text: p.text,
    user_id: p.user_id,
    channel_id: p.channel_id,
    workspace_id: p.workspace_id,
  }
}
