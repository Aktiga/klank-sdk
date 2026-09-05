// Type-level contract for `bot.on()`. These assertions are erased at runtime, so
// they only bite in `pnpm --filter @klank/sdk run typecheck`, not under vitest.
// An `@ts-expect-error` that stops being an error also fails the build ("unused
// directive"), which is what keeps the negative cases honest.

import { expect, expectTypeOf, it } from 'vitest'
import { KlankBot } from '../src/index.js'
import type {
  EventOf,
  EventsMissedEvent,
  MessageNewEvent,
  PresenceUpdateEvent,
  ReactionAddedEvent,
  ResolveEvent,
} from '../src/index.js'

const bot = new KlankBot({
  token: `bot_${'0'.repeat(64)}`,
  serverUrl: 'http://127.0.0.1:1',
})

// ── Handler arguments narrow to one variant ──

bot.on('message.new', (event) => {
  expectTypeOf(event).toEqualTypeOf<MessageNewEvent>()
})

bot.on('message', (event) => {
  expectTypeOf(event).toEqualTypeOf<MessageNewEvent>()
})

bot.on('reaction_added', (event) => {
  expectTypeOf(event).toEqualTypeOf<ReactionAddedEvent>()
})

bot.on('reaction.added', (event) => {
  expectTypeOf(event).toEqualTypeOf<ReactionAddedEvent>()
})

bot.on('events.missed', (event) => {
  expectTypeOf(event).toEqualTypeOf<EventsMissedEvent>()
  expectTypeOf(event.count).toEqualTypeOf<number>()
})

bot.on('presence', (event) => {
  expectTypeOf(event).toEqualTypeOf<PresenceUpdateEvent>()
})

// `on` chains.
expectTypeOf(bot.on('message', () => undefined)).toEqualTypeOf<KlankBot>()

// ── Union helpers ──

expectTypeOf<EventOf<'keys.rotate'>['new_epoch']>().toEqualTypeOf<number>()
expectTypeOf<ResolveEvent<'presence'>>().toEqualTypeOf<PresenceUpdateEvent>()
expectTypeOf<ResolveEvent<'message'>>().toEqualTypeOf<MessageNewEvent>()

// ── Negative cases ──

// @ts-expect-error 'not.an.event' is neither a wire name nor an alias
bot.on('not.an.event', () => undefined)

bot.on('message.new', (event) => {
  // @ts-expect-error message.new carries no `emoji`; only reaction events do
  void event.emoji
})

it('constructs without connecting and reports no bot info yet', () => {
  expect(bot.getBotInfo()).toBeNull()
})
