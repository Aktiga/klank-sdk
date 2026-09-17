---
gsd_state_version: 1.0
milestone: v0.2
milestone_name: webhook-first-release
status: in_progress
last_updated: "2026-09-05"
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 0
  completed_plans: 0
  percent: 17
---

# Project State — Klank SDK

*Last updated: 2026-09-05 (stocktake + 0.2.0 release push)*

## Project Reference

**Project**: Klank Bot SDK (`@klank/sdk`) — repo `Aktiga/klank-sdk`; local dir `~/Sites/rust-slack-sdk` is a legacy name.
**Server**: `Aktiga/klank` (private; issues disabled). No local checkout as of 2026-09-05.
**Core Value**: Bots are first-class Klank citizens — including inside E2EE channels.
**Revenue model context**: Klank is open source — install yourself, or pay Aktiga to run it. The SDK is MIT and must work identically against both.

## Ground truth (verified 2026-09-05 against server `53d464a`)

- `@klank/sdk` has never been published. No users, no compat burden.
- Bot tokens are accepted only by `GET /auth/bot-info` and `POST /auth/bot-ws-ticket`. Every channel/message/reaction route is JWT-only → 401 for bots.
- Bots have no channel membership model (`channel_members.user_id` FK → `users`) → the bot WebSocket receives zero events.
- `command.invoked` does not exist; `slash_commands::dispatch` has no caller.
- Incoming webhooks: HMAC headers required; plaintext into E2EE channels rejected (400).
- `DELETE /workspaces/{wid}/bots/{bid}` exists. No token rotation, no webhook delete, no OpenAPI.

Full handoff: `docs/server-requirements.md`.

## Current Position (paused 2026-09-17)

Phase 1–2 merged (`main` is `@klank/sdk@0.2.0`, never published — `NPM_TOKEN` unset).
Phase 3 **merged server-side**: `Aktiga/klank` PR #6 (`feat/bot-model`) landed 2026-09-11 and deployed.
Phase 4 is in **open PR #3** (`feat/bot-model-sdk` @ `a7ca7a1`): `@klank/sdk/testing` (MockKlank),
`create-klank-bot` + three templates, wire-fixture drift gate, doc corrections. All six CI checks
green, HEAD == origin, two adversarial review passes closed. Awaiting a merge decision.
Next-session checklist: `.planning/ledger-2026-09-09.md` ("Open items").

## Phases (revised 2026-09-17)

| # | Phase | Status |
|---|-------|--------|
| 1 | Workspace bootstrap | Done |
| 2 | 0.2.0 webhook-first release | Merged; never published (secret) |
| 3 | Server bot model in `Aktiga/klank` | Done — PR #6 merged 2026-09-11 |
| 4 | MockKlank test kit, wire-fixture gate, `create-klank-bot` templates | PR #3 open, green, unmerged |
| 5 | Token rotation + webhook delete/rotate (server) + SDK methods | Not started |
| 6 | E2EE bots (MLS) and Rust crate | Not started |

## Open decisions

- Bot channel scoping: **settled** — explicit `bot_channel_members` (private channels stay private,
  DMs refused). Shipped in PR #6.
- Whether bots have presence: unchanged (bots flow through `hub.user_connected`); revisit if clients
  render phantom users.
- Hub is one-socket-per-principal, now load-bearing for long-lived bots (`klank-swarm/review-server.md` F7).
- Trusted Publishing: after the first npm publish, configure OIDC on npmjs.com and delete `NPM_TOKEN`.

## Publishing

`.github/workflows/release.yml` (changesets). Flow: merge to main → action pushes `changeset-release/main`
and FAILS to open the PR (Aktiga org setting "Allow GitHub Actions to create and approve pull requests"
is off; needs `admin:org` to change) → open it by hand: `gh pr create --repo Aktiga/klank-sdk --head
changeset-release/main --base main --title "chore(release): version packages"` → merge → publish.

To publish 0.2.0 now:
1. npm org `klank` must exist (npmjs.com → Add Organization; free for public packages).
2. Granular access token: Packages and scopes → Read and write → scope `@klank`; Bypass 2FA on.
3. `gh secret set NPM_TOKEN --repo Aktiga/klank-sdk` (paste the token at the prompt).
4. `gh workflow run Release --repo Aktiga/klank-sdk` (or re-run the failed job) → `npm view @klank/sdk version` → 0.2.0.

Keep Node's bundled npm 10 in the workflow: npm 11 rejects the `--git-checks` flag pnpm 9.12 forwards
(`EUNKNOWNCONFIG`). Trusted Publishing (OIDC) can replace the token after the first publish, once pnpm is bumped.
