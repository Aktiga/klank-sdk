# PITFALLS — Klank SDK Refresh (v0.2 → v0.4)

Pitfalls specific to this milestone. Each has a concrete prevention and maps to the phase it guards.

## Critical

### P-1. Silent behavior change in a patch/minor bump (Migration phase)
**What goes wrong:** Fixing `WebhookBot` to use headers + HMAC is a wire-format break; shipping as `0.1.1` or even `0.2.0` without a loud signal means users `npm update` and everything starts 401'ing with a generic error.
**Prevention:**
- Bump to `0.2.0` (minor, pre-1.0 signals break), not `0.1.x`.
- On 401 from the webhook endpoint, throw `WebhookAuthError` whose `.message` literally names the migration guide path and server commit.
- Add a `CHANGELOG.md` BREAKING section for every header/body change.
- README `Server Compatibility` pin updated in the same commit as the code fix (never separately).
**Phase:** M-1, M-7.

### P-2. Body re-stringification between sign and send (HMAC)
**What goes wrong:** Compute HMAC over `JSON.stringify(body)`, then pass `body` object to `fetch` which stringifies *again* with different key order / whitespace / unicode escape. Signature no longer matches the bytes on the wire. Server rejects with no useful error.
**Prevention:**
- Serialize to `Buffer`/`Uint8Array` **once**, HMAC those exact bytes, and pass **those exact bytes** as `fetch` body (`body: bodyBuffer`, not `body: obj`).
- Set `Content-Type: application/json` manually; do not let `fetch` set it from the object.
- Regression test: port the server's `verify_signature` test fixture into TS and assert the produced hex matches byte-for-byte.
**Phase:** M-1, M-3, B.

### P-3. Non-constant-time signature comparison on the receiver side
**What goes wrong:** `verifySlashCommandSignature` uses `===` or `Buffer.equals` on un-padded strings; timing-attackable. Or accepts uppercase hex from one client and rejects from another.
**Prevention:**
- Use `crypto.timingSafeEqual` on equal-length Buffers only (length-check first, then compare).
- Normalize: strip `sha256=` prefix, lowercase hex, decode to Buffer, length-check, then `timingSafeEqual`.
- Case-insensitive header name lookup (Node lowercases; Lambda/Vercel may not — iterate and lowercase keys).
- Never log the expected signature on mismatch (leaks the secret-derived value).
**Phase:** M-3, B.

### P-4. Header casing and raw-body destruction in HTTP receivers
**What goes wrong:** Express's `express.json()` middleware consumes the stream and leaves you with a parsed object — you can no longer reproduce the raw bytes the server signed. Vercel's edge runtime decodes the body differently from Node runtime. Lambda base64-encodes binary bodies depending on `isBase64Encoded`. AWS API Gateway lowercases headers in v2 but not v1.
**Prevention:**
- `createSlashCommandReceiver` MUST take `rawBody: Buffer` — never re-parse JSON internally before verifying.
- Document per-host raw-body recipes: `express.raw({ type: 'application/json' })`, Next.js `export const config = { api: { bodyParser: false } }`, Lambda `isBase64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body)`.
- Lowercase all header keys before lookup.
- Test the verifier with each runtime's actual body shape, not just a synthetic Buffer.
**Phase:** B, M-3.

## MLS / E2EE (Phase F-E2EE)

### P-5. Persisting MLS key material in a process-only store
**What goes wrong:** Bots run on ephemeral Lambda containers, Fly machines, K8s pods. If MLS key state lives in memory, restart = new keys = re-added to every group = forward-secrecy guarantees broken for past messages the bot still has plaintext of, and group churn spam.
**Prevention:**
- Key storage MUST be pluggable (`MlsStorage` interface) with first-class SQLite and Redis adapters. In-memory is dev-only and must `console.warn` loudly at startup.
- Document that bot key material is a **secret at rest** — same handling as the bot token.
- Atomic commit of MLS epoch transitions; never update in-place without write-ahead.
**Phase:** F-E2EE, C.

### P-6. Replay and epoch skew in long-lived bots
**What goes wrong:** Bot misses messages during a disconnect, comes back, processes an old epoch's commit after a newer one has landed, and either decrypts with the wrong key or corrupts its group state. Or an attacker replays a welcome message.
**Prevention:**
- Track last-processed epoch per group; reject any commit with epoch <= last-processed.
- On reconnect, fetch group state from server (not replay from WS) — WS is best-effort, state sync is authoritative.
- Nonce/message-id dedup window, persisted.
**Phase:** F-E2EE.

### P-7. Bot group-membership sync races
**What goes wrong:** Admin adds bot to E2EE channel; server sends welcome; bot hasn't booted yet. Or bot is in a group, admin removes it, but the bot's cached state still thinks it's a member and tries to decrypt, which fails silently and looks like "bot is broken."
**Prevention:**
- `on('group.welcome')` and `on('group.removed')` are first-class events bots can handle.
- On `start()`, reconcile server-side membership list with local MLS state; leave any group the server doesn't list.
- Typed `E2EEMembershipError` (distinct from `ChannelMembershipError`) when a send fails because the bot's MLS state is stale.
**Phase:** F-E2EE, A.

### P-8. Forward secrecy vs. bot observability expectations
**What goes wrong:** User expects "my CI bot kept a log of every /deploy command for 6 months" — but MLS forward secrecy means once an epoch rotates, the old keys are gone and the bot can't re-decrypt its own history from the server. Users file bugs.
**Prevention:**
- Document explicitly: "if your bot needs durable history, it must persist plaintext at receive time — the server cannot serve re-decryptable ciphertext to a bot that has rotated past that epoch."
- Provide a `bot.history` opt-in persistence helper in Phase C state store.
**Phase:** F-E2EE, H (docs).

## Monorepo / Packaging (Phase 0, C split, G, F-build)

### P-9. Build order and TS project references in a multi-package workspace
**What goes wrong:** `@klank/sdk-redis` imports types from `@klank/sdk`, but `tsup` runs them in parallel, so `sdk-redis` builds against stale or missing `.d.ts`. Or worse — resolves to the published npm version because workspace symlinks aren't set up.
**Prevention:**
- Use `pnpm` workspaces with explicit `workspace:*` protocol — lockfile is mandatory.
- Declare TS project references (`tsconfig.json` `references: [{ path: '../sdk' }]`) and build with `tsc -b` for type-check; `tsup` only for bundling.
- CI runs `tsc -b --clean && tsc -b` fresh to catch order bugs.
- Each adapter package declares `@klank/sdk` as a **peerDependency** (not dependency) — prevents two copies of the core.
**Phase:** 0, C, I, G.

### P-10. Exports map misconfiguration → type resolution failure for consumers
**What goes wrong:** You ship `"exports": { ".": "./dist/index.js" }` without a `"types"` condition, or put `"types"` after `"import"`/`"require"` (order matters — TS reads top-to-bottom). Consumers get `any` for everything. Or you ship dual CJS/ESM with `tsup` but forget `"type": "module"` and the `.mjs`/`.cjs` extensions mismatch the `exports` entries.
**Prevention:**
- Exports map template with `"types"` condition FIRST in each entry.
- Use `@arethetypeswrong/cli` (`attw --pack .`) in CI on every package — catches dual-package hazard, missing conditions, wrong extensions.
- Also set top-level `"types"` as fallback for TS <4.7.
**Phase:** 0, C, E (`@klank/sdk/testing` subpath), G.

### P-11. Circular deps between core and adapters
**What goes wrong:** `@klank/sdk` imports a type from `@klank/sdk-redis` "just for convenience," creating a cycle. Dev works via workspace; published install fails or loads twice.
**Prevention:**
- Core defines `StateBackend` interface; adapters implement it. Core **never** imports from adapters.
- Lint rule or CI check: fail if core sources import `@klank/sdk-*`.
**Phase:** C.

## Cross-Language Parity (Phase F-build)

### P-12. Rust/TS type drift from independent schema definitions
**Prevention:** OpenAPI via `utoipa` is the **single source of truth**; both `openapi-typescript` and `progenitor`/`openapi-generator` (Rust) consume it. Neither SDK hand-writes wire types — only ergonomic wrappers. Golden-file test: both SDKs serialize the same logical request and assert identical JSON bytes.
**Phase:** F-build, utoipa pipeline.

### P-13. Test parity without cross-running fixtures
**Prevention:** Shared fixture directory at repo root (`fixtures/wire/*.json`) — both language test suites load and assert against identical bytes. HMAC round-trip fixture (same body + secret → same hex) MUST be in shared fixtures.
**Phase:** F-build, E.

### P-14. Release coordination: TS ships, Rust lags
**Prevention:** Both SDKs declare their target server commit in a `COMPAT.md` that CI lints for consistency on every release. Until F-build stabilizes, Rust crate version is explicitly `0.0.x` and marked "tracks TS `0.4.x`".
**Phase:** F-build.

## OpenAPI / utoipa (Type generation pipeline)

### P-15. utoipa schema lies vs. runtime behavior
**Prevention:** Contract test on the server side: round-trip a sample response through the utoipa-declared schema and assert it validates. In TS SDK CI: fetch live `/openapi.json` from a running server and diff against the committed `openapi.json`. Fail on drift. Never hand-edit generated `types.ts`.
**Phase:** utoipa pipeline.

### P-16. openapi-typescript version pinning and CI drift
**Prevention:** Pin `openapi-typescript` to an exact version (no `^`, no `~`). Commit the generated `types.ts`; CI regenerates and fails if diff is non-empty. Upgrades to the generator are their own PR. Lockfile mandatory.
**Phase:** utoipa pipeline, 0.

### P-17. OpenAPI can't express TS-native discriminated unions cleanly
**What goes wrong:** `ServerEvent` is a discriminated union on `type`. `oneOf` in OpenAPI generates `ServerEvent = A | B | C` but without the narrowing, so `on('message.new', ...)` can't narrow.
**Prevention:** Use `oneOf` + `discriminator: { propertyName: 'type' }` in utoipa; `openapi-typescript` honors this as a proper TS discriminated union. Type-level test (`expectTypeOf`) in the SDK that proves narrowing works.
**Phase:** utoipa pipeline, A.

## Testing Integrity (Phase E)

### P-18. MockKlank that mocks so much it tests nothing
**Prevention:** MockKlank ONLY provides (a) a fake HTTP endpoint that records requests, (b) a way to push bytes into the bot's WS handler. It must **not** stub any method on `KlankBot` or `KlankClient`. Every test must assert on an observable side effect. Write one flagship test that catches a *real* bug from CONCERNS.md (H-4 self-echo via webhook) — if MockKlank can't catch it, MockKlank is wrong.
**Phase:** E.

### P-19. Fake timers hiding real async bugs
**Prevention:** Always pair `vi.advanceTimersByTimeAsync` (not sync) with fake timers so microtasks drain. At least one reconnect test uses real timers and a short (10ms) backoff.
**Phase:** E.

## npm Publishing

### P-20. Shipping source, tests, or secrets to npm
**Prevention:** `"files": ["dist", "README.md", "LICENSE"]` allowlist. `.npmignore` belt-and-suspenders. `npm pack --dry-run` in CI; fail if tarball contains `.env`, `*.test.*`, `src/`.
**Phase:** every release.

### P-21. Missing `prepublishOnly`
**Prevention:** `"prepublishOnly": "npm run build && npm test && attw --pack ."`. Do not commit `dist/` to git.
**Phase:** every release.

### P-22. Scoped package first-publish permission trap
**Prevention:** `"publishConfig": { "access": "public" }` in every scoped package. Create the `@klank` org on npm before first publish. Enable npm provenance (`--provenance` in CI with `id-token: write`). Ship provenance from day one.
**Phase:** every release, first-time especially.

### P-23. Subpath exports publishing issues
**Prevention:** `tsup` config includes subpath entries. `files` allowlist includes all built subpath files. Publish-time smoke test: `npm pack`, extract, `require('@klank/sdk/testing')`.
**Phase:** E, C, G.

## State Backends (Phase C)

### P-24. TTL semantics diverge across adapters
**Prevention:** Single `StateBackend` contract test suite runs against all three adapters. Document TTL resolution per adapter. SQLite adapter must run periodic `DELETE WHERE expires_at < now()` sweep.
**Phase:** C.

### P-25. Redis connection lifecycle
**Prevention:** Mandatory `error` handler. Reconnect with jitter. Adapter takes an **existing** ioredis client (user-owned) rather than creating one.
**Phase:** C.

### P-26. SQLite file locking in multi-process bots
**Prevention:** `better-sqlite3` with `journal_mode=WAL` by default. Document single-process limitation; multi-process requires Redis.
**Phase:** C.

## Phase-to-Pitfall Matrix

| Phase | Pre-mortem must cover |
|-------|----------------------|
| Phase 0 housekeeping | P-9, P-10, P-16 |
| M-1 Webhook fix | P-1, P-2, P-3 |
| M-2 E2EE error | P-1, P-8 |
| M-3 Slash verifier | P-2, P-3, P-4 |
| M-7 Migration guide | P-1 |
| Phase A typed events | P-17, P-7 |
| Phase B HTTP receiver | P-4, P-3, P-2 |
| Phase C state backends | P-9, P-10, P-11, P-24, P-25, P-26 |
| Phase E MockKlank | P-18, P-19, P-23 |
| Phase G templates + scaffolder | P-10, P-20 |
| Phase F-E2EE | P-5, P-6, P-7, P-8 |
| Phase F-build Rust | P-9, P-12, P-13, P-14 |
| utoipa pipeline | P-15, P-16, P-17 |
| Every npm release | P-1, P-20, P-21, P-22, P-23 |

## Top Five to Wire Into CI Immediately (Phase 0)

1. **P-2 HMAC byte-identity test** — port server fixture; fails today on `main`.
2. **P-16 openapi-typescript drift check** — regen + diff; fail on delta.
3. **P-10 `attw --pack` exports validation** — every package, every PR.
4. **P-20 tarball contents assertion** — `npm pack --dry-run`, grep for forbidden paths.
5. **P-18 MockKlank "catches H-4" regression** — flagship proof the test kit has value.
