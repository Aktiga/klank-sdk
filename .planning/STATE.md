# Project State — Klank SDK Refresh

*Last updated: 2026-04-07 by roadmapper agent*

---

## Project Reference

**Project**: Klank Bot SDK (`@klank/sdk`)
**Core Value**: Bots are first-class Klank citizens — including inside E2EE channels.
**Current Milestone**: v0.2 → v0.4 SDK Refresh (staged 0.2.0 migration → 0.3.0 features → 0.4.0 E2EE + Rust)
**Current Focus**: Pre-Phase 1 — roadmap approved, ready to plan Phase 1 (Workspace Bootstrap)

---

## Current Position

**Milestone**: v0.2 → v0.4 SDK Refresh
**Phase**: Pre-Phase 1 (not started)
**Plan**: —
**Status**: Roadmap created; awaiting `/gsd-plan-phase 1`
**Progress**: `[░░░░░░░░░░░░░░] 0/14 phases`

### Phase Summary

| Phase | Name | Status |
|-------|------|--------|
| 1  | Workspace Bootstrap              | Not started |
| 2  | Migration to 0.2.0               | Not started |
| 3  | Schema Pipeline                  | Not started |
| 4  | Phase A — Typed Context          | Not started |
| 5  | Phase B — HTTP Slash Receivers   | Not started |
| 6  | Phase E — MockKlank Test Kit     | Not started |
| 7  | Token Rotation                   | Not started |
| 8  | Phase C — State Backends Split   | Not started |
| 9  | Phase G — Templates & Scaffolder | Not started |
| 10 | Phase H — Docs & Typedoc         | Not started |
| 11 | Phase D — Dev CLI                | Not started |
| 12 | Phase I — MCP Server             | Not started |
| 13 | Phase F-E2EE — MLS for Bots      | Not started |
| 14 | Phase F-build — Rust Crate       | Not started |

---

## Performance Metrics

- Phases completed: 0/14
- Release markers hit: 0/3 (0.2.0, 0.3.0, 0.4.0)
- Requirements shipped: 0/93

---

## Accumulated Context

### Key Decisions (from PROJECT.md, locked 2026-04-07)

- **E2EE bots**: Option B — full MLS, bots become first-class E2EE members
- **Rust SDK**: Drop false claim now, build later as dedicated Phase 14
- **Type generation**: `utoipa` (server) + `openapi-typescript` (SDK), no hand-written drift
- **State backends**: Split across sibling packages (`@klank/sdk-redis`, `@klank/sdk-sqlite`), core stays dep-light
- **Token rotation**: Server endpoint ships before SDK 0.3 (Phase 7)
- **Self-message suppression**: Track `webhook_id` alongside `bot_id` (Phase 4 / PA-08)

### Open Todos

- Plan and execute Phase 1 (Workspace Bootstrap) — blocks all other phases
- Coordinate cross-repo work with `rust-slack` for Phases 3, 7, 13

### Blockers

None currently. Phase 13 (F-E2EE) has a planned research spike (F2EE-01) that must run before phase planning.

---

## Session Continuity

**Last session**: 2026-04-07 — `/gsd-new-project` completed, requirements captured, research synthesized, roadmap created
**Next action**: Run `/gsd-plan-phase 1` to begin Workspace Bootstrap

### Files of Record

- `.planning/PROJECT.md` — project vision and constraints
- `.planning/REQUIREMENTS.md` — 93 v1 requirements with phase traceability
- `.planning/ROADMAP.md` — 14-phase plan with success criteria
- `.planning/research/SUMMARY.md` — research synthesis and critical path
- `.planning/research/STACK.md`, `ARCHITECTURE.md`, `FEATURES.md` — research inputs
- `.planning/config.json` — granularity: standard, workflow gates on
