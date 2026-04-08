# Klank Bot SDK

## What This Is

The Klank Bot SDK is the official bot-building toolkit for Klank (the E2EE Slack-alternative chat server). Developers install `@klank/sdk` to build bots, webhook posters, slash command handlers, and integrations that connect to Klank. TypeScript ships first; a Rust crate is planned as a dedicated follow-on milestone.

## Core Value

**Bots are first-class Klank citizens — including inside E2EE channels.** If a developer can use Klank, they must be able to build bots for it that work everywhere a user works, securely, without surprise breakage across server upgrades.

## Requirements

### Validated

<!-- Shipped and confirmed valuable in 0.1.0 — but several are actually broken or half-built. See CONCERNS.md. -->

- [x] `KlankBot` WS bot framework with `on()`, `command()`, `message()`, middleware (works but incomplete; event routing has bugs)
- [x] `KlankClient` REST client (bearer auth, sendMessage, reactions, channel list — missing many endpoints)
- [x] `WebhookBot` sender (currently 100% broken against server post-Phase 11 C-2)

### Active

<!-- Milestone v0.2 → v0.4 scope. -->

**Migration to 0.2.0 (unblock current users):**
- [ ] Fix `WebhookBot` to use `X-Klank-Webhook-Key` + `X-Klank-Signature` HMAC headers
- [ ] Throw typed `E2EEChannelError` when server rejects plaintext send to E2EE channel
- [ ] Export `verifySlashCommandSignature()` helper for HTTP receivers
- [ ] Document bot token one-shot model
- [ ] Wrap 403s as `ChannelMembershipError` + document membership precondition
- [ ] Harden 429 retry (max attempts, jitter, typed `RateLimitedError`)
- [ ] Ship migration guide 0.1 → 0.2
- [ ] Drop false "Rust support" claim from README, replace with "Rust SDK planned" note; move rust example to `examples/community/`

**Feature phases toward 0.3.0 (honest complete SDK):**
- [ ] Phase A: type-narrowed `on()` overloads, `ctx.thread/update/delete/upload/dm/unreact`, self-message suppression fix, fix reaction double-fire and missing shorthand entries in event routing table
- [ ] Phase B: `createSlashCommandReceiver()` HTTP handler (framework-agnostic)
- [ ] Phase E: `MockKlank` test kit + first real test suite (no useless mocks per CLAUDE.md testing integrity)
- [ ] Phase G: fill empty `templates/typescript/src/`, ship `create-klank-bot` scaffolder
- [ ] Phase H: docs split (Getting Started / Concepts / Recipes / API / Migration / Security) + typedoc API reference
- [ ] utoipa + openapi-typescript type generation pipeline (server annotates handlers, SDK CI regenerates `types.ts`)
- [ ] Server-side `POST /bots/:id/rotate-token` endpoint + SDK client method

**Dedicated later phases:**
- [ ] Phase C: split state backends — `@klank/sdk` in-memory core, `@klank/sdk-redis`, `@klank/sdk-sqlite`
- [ ] Phase D: `klank-bot` CLI dev loop (watch + restart + optional tunnel)
- [ ] Phase I: `mcp-klank` MCP server package built on the SDK
- [ ] Phase F-E2EE: full MLS implementation so bots become first-class E2EE members
- [ ] Phase F-build: Rust crate `@klank/sdk-rust` mirroring the stabilized TS API, consuming shared OpenAPI

### Out of Scope

- **Bots as plaintext-only / E2EE-banned forever** — rejected. E2EE is a core Klank value prop; bots must work in E2EE channels (decision #1, Option B).
- **Rust crate built in parallel with every TS feature** — rejected. Orchestrated as a dedicated future phase with subagents, not co-equal parity each release.
- **Hand-maintained `types.ts` drift** — rejected. utoipa → openapi-typescript generation is the target.
- **Ephemeral slash command responses via SDK** — currently silently dropped at `bot.ts:194-205`; fixing requires server support, out of scope for the 0.2.0 migration but in scope for Phase A.
- **Rotating bot tokens via the SDK until server endpoint exists** — requires server-side work first.

## Context

- Server lives at `/Users/stevemeisner/Sites/rust-slack` (Rust workspace). Server phases 6–11 recently landed, which silently broke `WebhookBot` (HMAC wire format changed) and made bots unable to post to E2EE channels.
- SDK currently at 2 commits, `@klank/sdk@0.1.0`, no tests, no CI, no lint. README over-promises "Rust support" that doesn't exist and ephemeral slash responses that silently no-op.
- Pristine upstream inputs live in `.planning/BASELINE-REPORT.md` (ground-truth scan) and `.planning/SDK-REFRESH-ROADMAP.md` (14-phase refresh plan). Codebase intel in `.planning/codebase/`.
- Resolved decisions (2026-04-07) captured in memory at `~/.claude/projects/-Users-stevemeisner-Sites-rust-slack-sdk/memory/klank_sdk_decisions.md`.

## Constraints

- **Tech stack**: Node 20+, TypeScript, `tsup` bundler, `ws` lib. Keep core dependency-light — adapters (Redis, SQLite) ship as separate packages.
- **Compatibility**: every SDK release must declare a tested server commit in README `Server Compatibility`.
- **Security**: no secrets in bodies, HMAC verification is constant-time, bot tokens are one-shot.
- **Testing integrity** (per `~/.claude/CLAUDE.md`): tests must exercise real behavior. No skipping for missing data, no mock-to-uselessness, no force-clicks.
- **Cross-repo**: utoipa pipeline and token rotation phases touch both `rust-slack-sdk` and `rust-slack` — coordinate commits.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| E2EE bots: Option B (full MLS) | E2EE is core Klank value prop; bots banned from E2EE is unacceptable | ✓ Locked 2026-04-07 |
| Drop Rust claim now, build later as dedicated phase | Current README lies; build properly with subagent orchestration | ✓ Locked 2026-04-07 |
| `utoipa` + `openapi-typescript` for type generation | Free, eliminates drift, compounds forever | ✓ Locked 2026-04-07 |
| Split state backends across packages | Keep core dep-light, DX identical via constructor injection | ✓ Locked 2026-04-07 |
| Add server-side token rotation before SDK 0.3 | No recovery story if token leaks today | ✓ Locked 2026-04-07 |
| Fix self-message suppression in Phase A | Bot echoes itself via own webhook (`bot_id` vs `webhook_id` mismatch) | ✓ Locked 2026-04-07 |

## Current Milestone: v0.2 → v0.4 — SDK Refresh

**Goal:** Take `@klank/sdk` from a broken, over-promising 0.1.0 to an honest, complete, E2EE-capable SDK with first-class Rust crate. Ship in staged releases (0.2.0 migration → 0.3.0 features → 0.4.0 E2EE + Rust).

**Target features:** See Active requirements above — 20 scoped deliverables grouped into Migration / 0.3.0 Features / Dedicated Later Phases.

**Key context:** Current SDK is 100% broken for webhook bots against live Klank server. Migration phase is non-negotiable and blocks the next server deploy.

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-07 after /gsd-new-project initialization*
