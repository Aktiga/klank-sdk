# Testing Patterns

**Analysis Date:** 2026-04-07
**Verdict:** This is a greenfield testing situation. There is **zero test code** in the repository, no CI, no lint, no pre-publish guard. Everything described under "current state" below is "what is missing." Everything under "what to build" is for the planner/executor that comes next.

## Current State: Verified Inventory

### Tests: zero

```
$ find /Users/stevemeisner/Sites/rust-slack-sdk -name "*.test.*" -o -name "*.spec.*" -not -path "*/node_modules/*"
(no results)
```

There are **no `*.test.ts`, `*.spec.ts`, `__tests__/`, `tests/`, or `test/` directories** anywhere in the repository — not in `packages/sdk-typescript/`, not in `examples/`, nowhere.

### `vitest` is in devDeps but unused

`packages/sdk-typescript/package.json:23-28`:

```json
"devDependencies": {
  "tsup": "^8.0.0",
  "typescript": "^5.0.0",
  "@types/ws": "^8.0.0",
  "vitest": "^3.0.0"
}
```

`packages/sdk-typescript/package.json:15-19`:

```json
"scripts": {
  "build": "tsup src/index.ts --format cjs,esm --dts",
  "dev": "tsup src/index.ts --format cjs,esm --dts --watch",
  "test": "vitest"
}
```

`npm test` would invoke `vitest`, which would scan for `*.test.ts` files, find none, and exit. The `test` script is a placeholder.

### No Vitest config file

```
$ ls vitest.config.* packages/sdk-typescript/vitest.config.*
(no results)
```

No `vitest.config.ts`, no `vitest.config.js`, no `vite.config.ts` with a `test:` block. Vitest would run with defaults: jsdom NOT enabled, no setup file, no coverage thresholds, no environment overrides.

### No CI

```
$ ls -la /Users/stevemeisner/Sites/rust-slack-sdk/.github
(does not exist)
```

There is no `.github/` directory. No GitHub Actions workflows. No CircleCI, no Travis, no Jenkins, no `.gitlab-ci.yml`. **Nothing runs `npm test` automatically — ever.**

### No lint or format config

```
$ ls .eslintrc* .prettierrc* eslint.config.* biome.json
(no results)
```

No ESLint, no Prettier, no Biome. The semicolon-free style observed in the source is hand-convention with nothing enforcing it.

### No `prepublishOnly` or publish guard

`packages/sdk-typescript/package.json:15-19` declares only `build`, `dev`, `test`. There is **no `prepublishOnly` script**, so `npm publish` will not build, will not test, and will not lint before pushing to the registry. The `dist/` directory it points `main`/`module`/`types` at would have to already exist on disk.

### No fixtures, no mock server, no recorded responses

```
$ find /Users/stevemeisner/Sites/rust-slack-sdk -type d \( -name "fixtures" -o -name "__fixtures__" -o -name "mocks" -o -name "__mocks__" \) -not -path "*/node_modules/*"
(no results)
```

There is no `fixtures/`, no `__mocks__/`, no recorded HTTP responses, no MSW handlers, no mock WebSocket harness. Nothing exists for any future test to consume.

### Examples cannot be installed or test-driven

`examples/echo-bot-ts/index.ts`, `examples/ci-bot-ts/index.ts`, and `examples/webhook-bot/index.ts` import `@klank/sdk`, but there is **no `package.json` in any example directory** — they cannot be `npm install`'d, cannot be run standalone, and cannot serve as integration smoke tests.

### Coverage tooling

Not configured. No `@vitest/coverage-v8`, no `@vitest/coverage-istanbul`, no thresholds in any config file. Coverage cannot be measured today.

## What This Means

The SDK has shipped two commits and zero verification. Every refactor is unsafe by definition. Every server contract change (E2EE enforcement, webhook signing, slash command HMAC) is silently broken on the SDK side because nothing exercises the wire format. The roadmap in `.planning/BASELINE-REPORT.md` already documents that `WebhookBot.send` is broken against the current server (Phase 11 C-2) — a single integration test against a fixture-recorded response would have caught this.

There is no "fix the existing tests" work. There is only "build the test apparatus from scratch" work.

## What to Build (greenfield testing plan)

Each item below is something that **does not exist today** and will need to be created from zero.

### 1. Vitest config

Create `packages/sdk-typescript/vitest.config.ts`:

- `environment: 'node'` (the SDK is Node-only — uses `ws` package, `process.on`, server-side `fetch`)
- `include: ['src/**/*.test.ts', 'tests/**/*.test.ts']`
- `coverage`: enable `@vitest/coverage-v8`, set initial threshold low (e.g. 60%) and ratchet upward
- `setupFiles`: a single `tests/setup.ts` for shared fixtures

Add `@vitest/coverage-v8` to devDependencies.

### 2. Test file location convention

Pick one. Two viable layouts:

**Co-located** (recommended for a small SDK):
```
packages/sdk-typescript/src/
├── bot.ts
├── bot.test.ts
├── client.ts
├── client.test.ts
├── ws.ts
├── ws.test.ts
└── webhook.ts
└── webhook.test.ts
```

**Separate `tests/` tree** (better for integration suites):
```
packages/sdk-typescript/
├── src/
└── tests/
    ├── unit/
    │   ├── bot.test.ts
    │   └── ...
    ├── integration/
    │   └── webhook-roundtrip.test.ts
    └── fixtures/
        └── server-events.json
```

A hybrid is fine: unit tests co-located in `src/`, integration tests in `tests/integration/`.

### 3. Unit tests required (one file per source file)

For each source file in `packages/sdk-typescript/src/`, the minimum coverage:

**`bot.test.ts`** — should cover:
- `on()` registers a handler that fires for the matching event type (both dotted and underscore forms)
- `on('message.updated', ...)` actually receives `message.updated` events (currently broken — see CONVENTIONS.md "Event routing")
- `command()` routes by name and ignores unknown commands
- `message()` regex matches `event.plaintext` and passes match groups to the handler
- `use()` middleware runs in order and `next()` is awaited
- `onError()` catches handler throws; without a handler, `console.error` is called
- Self-message suppression: a `message.new` with `sender_id === botInfo.bot_id` is dropped
- Self-message suppression does NOT fire for webhook-posted messages (regression test for the gap noted in BASELINE-REPORT §7)
- `start()` does NOT register `process.on` handlers when running under test (this is a hint that the current `bot.ts:75-77` design needs to change)
- The `reaction.added` double-fire bug (shorthand collides with generic mapper) — write it as a regression test

**`client.test.ts`** — should cover:
- `getBotInfo()`, `getWsTicket()`, `sendMessage()`, `getMessages()`, `addReaction()`, `removeReaction()`, `listChannels()`, `getChannel()` each hit the right URL with the right method, body, and `Authorization: Bearer <token>` header
- `sendMessage` with `threadId` translates to `thread_id` in the body (camelCase → snake_case boundary)
- 429 with `Retry-After` triggers a retry — and there must be a max retry count (currently absent — write the test for the **desired** capped behavior)
- 401 surfaces a typed error (currently `Error` — write the test for the **desired** `KlankAuthError` taxonomy)
- Non-2xx surfaces include status code on the error object (not just in the message string)

**`ws.test.ts`** — should cover:
- `connect()` calls `ticketFn` and opens a `wss://` URL with `?ticket=<ticket>`
- `http://` is rewritten to `ws://` and `https://` to `wss://`
- Reconnect backoff doubles on close, capped at 30s
- `disconnect()` sets `stopped` and prevents reconnect
- Parse errors are surfaced (currently swallowed at `ws.ts:46` — write the test for the desired surfacing)
- Heartbeat / ping handling (does not exist; write the test for the desired behavior)

**`webhook.test.ts`** — should cover:
- `send()` POSTs to `/api/v1/webhooks/:id/incoming`
- Body is `{ text, username }` only — NO `secret` field (regression test for the Phase 11 C-2 break)
- `X-Klank-Webhook-Key: <raw-secret>` header is set
- `X-Klank-Signature: sha256=<hex>` header is set with the correct HMAC-SHA256 of the body bytes
- Both header values use constant-time-compatible formats (lowercase hex, no whitespace)
- Non-2xx response throws with status code

**`types.test.ts`** (optional, type-level only) — `expectTypeOf` assertions that `on('message.new', handler)` infers `MessageEvent` once typed routing is added.

### 4. Mocking strategy

**HTTP** (`KlankClient`, `WebhookBot`): use `vi.stubGlobal('fetch', vi.fn())` or [MSW](https://mswjs.io/) (`msw/node`). MSW is the better long-term choice because it lets the same handlers serve unit tests AND integration tests AND example smoke runs.

**WebSocket** (`WsManager`): use `vi.mock('ws', ...)` with a fake `WebSocket` class that exposes `emit('open' | 'message' | 'close' | 'error')` for test-driven event injection. Do not use a real WebSocket server in unit tests.

**Time** (reconnect backoff, retry delays): `vi.useFakeTimers()` and `vi.advanceTimersByTimeAsync()`.

**What NOT to mock:** the discriminated union narrowing in `bot.ts`. Tests should pass real `ServerEvent` objects through `handleEvent` and assert on the side effects, not stub out the routing logic itself.

### 5. Integration tests against a real (or fake) Klank server

Two options:

**(a) Recorded fixtures.** Capture actual server responses for each endpoint into `tests/fixtures/*.json` and replay them through MSW. This catches drift between SDK assumptions and server JSON shape. Requires a one-time recording pass against a running `rust-slack` server.

**(b) Docker-compose harness.** `tests/integration/` spins up a `rust-slack` server in a container, registers a bot via the admin API, and exercises the full surface (REST + WS + webhook). Slower, runs in CI nightly rather than per-PR.

(a) should come first. (b) can come later if drift becomes a recurring problem.

### 6. CI

Create `.github/workflows/ci.yml`:

- Trigger: `push` and `pull_request`
- Matrix: Node 20 and Node 22 (pick the actual minimum supported version — currently undeclared in `package.json`; add an `engines` field)
- Steps:
  1. `npm ci` (requires committing a lockfile — there is none today)
  2. `npm run build` (catches type errors — `tsup` runs `tsc` for `.dts`)
  3. `npm test -- --coverage`
  4. Upload coverage artifact

Add a `lint` step once an ESLint or Biome config exists. Add a `format-check` step once Prettier exists.

### 7. Lockfile

There is no `package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock` in the repo. CI cannot do reproducible installs. Pick a package manager, run `install`, commit the lockfile.

### 8. Lint and format

Add either:
- **Biome** (`biome.json`) — fastest, single tool for lint + format, supports the no-semicolon single-quote style observed
- **ESLint + Prettier** — more configurable, more plugins, more config surface

Biome is recommended for a small SDK. Add the corresponding `lint` and `format` scripts to `package.json`.

### 9. `prepublishOnly`

Add to `packages/sdk-typescript/package.json` scripts:

```json
"prepublishOnly": "npm run build && npm test"
```

This guarantees nothing ships without passing tests.

### 10. Example smoke tests

Each example (`examples/echo-bot-ts`, `examples/ci-bot-ts`, `examples/webhook-bot`) needs:
- Its own `package.json` with `@klank/sdk` as a dependency (workspace link during dev)
- A `tsc --noEmit` step in CI that proves the example still compiles against the SDK's published types

This is the cheapest possible "did we break the public API" guard.

## Run Commands (after the above is built)

```bash
npm test                     # Run all tests once
npm test -- --watch          # Watch mode
npm test -- --coverage       # With coverage report
npm test -- src/bot.test.ts  # Single file
```

Today these commands invoke `vitest` against an empty test set and exit immediately.

## Priority Order for the Test Build-Out

1. **Vitest config + lockfile + CI skeleton** (so tests run somewhere automatic)
2. **`webhook.test.ts`** — the SDK is already broken against the server here; tests will turn red, forcing the fix
3. **`client.test.ts`** — REST surface, smallest, easiest, highest coverage win
4. **`bot.test.ts`** — biggest file, most logic, write the regression tests for the event-routing bugs first
5. **`ws.test.ts`** — needs fake-timer setup; do after the other three are landed
6. **Lint/format config** — once tests are green, lock the style
7. **Integration fixtures** — only after units are stable
8. **`prepublishOnly`** — last, so the gate is meaningful

---

*Testing analysis: 2026-04-07*
