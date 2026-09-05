# SDK Handoff Prompt

This file is the **starting prompt** for a fresh Claude Code session that you start with `cwd = ~/Sites/rust-slack-sdk`. Paste the section below into the new session as your first message.

---

## Locked context (do not relitigate)

You are working on the **Klank Bot SDK** at `~/Sites/rust-slack-sdk`. The Klank server lives at `~/Sites/rust-slack` (sibling repo, READ-ONLY for you — you may NOT edit it). A separate Claude session is the orchestrator and has the full picture; you are the SDK execution session.

### What just happened

The Klank server just shipped phases 6–11 of a security hardening run, currently live at `chat.aktiga.com` at commit `50df1f9`. Several of those changes affect SDK consumers; one is breaking. A baseline scan and a refresh roadmap have already been written for this SDK.

### Read these first, in order

1. **`.planning/handoff/WIRE-FORMAT-SPEC.md`** (1252 lines) — the complete wire-format specification, derived from server source, with **real computed signatures** for HMAC examples. This is your bible. You should never need to read Klank server source — everything is in here.
2. **`.planning/BASELINE-REPORT.md`** — what the SDK actually is today (TS-only despite README claims, broken `WebhookBot`, empty templates, `ephemeral` no-op).
3. **`.planning/SDK-REFRESH-ROADMAP.md`** — the full plan, phases 0 through K (migration → MCP → examples gallery).

### Locked decisions (Steve confirmed 2026-04-07, do not re-ask)

1. **Bot E2EE = Option C.** Bots will become full MLS members with their own identity keys. This is **future work** (Phase G). For Phase 0 you do NOT do crypto. When a bot tries to post to an E2EE channel, the SDK throws a clear error pointing at Phase G.
2. **TS + Rust parity is required at every phase, not "TS first then Rust later."** Every feature ships in both editions or it doesn't ship. The Rust crate (`packages/sdk-rust/`) currently does not exist — creating it is part of Phase 0. It does not need feature parity in Phase 0, just needs to compile and run a "hello world" example.
3. **Bot membership model = Option B (bots-as-users).** Bots will get a row in the `users` table with `kind = 'bot'`. This is queued as **Klank Phase 11.7** in the Klank repo's `.planning/ROADMAP.md` and will be executed by Stream A. Until that phase ships, your SDK cannot actually add a bot to a channel. **Phase 0 is allowed to design against this future contract** — write the code as if it works, document the dependency, and gate any integration test on Phase 11.7 landing.
4. **Quality bar:** Vercel-grade DX. "First reply in 5 minutes, advanced bot in a weekend." Make it fun. Make it secure. Make it both editions.
5. **Scope philosophy:** When you find related defects (same root cause + same fix shape), include them — that's not scope creep, that's keeping the codebase in great shape. Document the inclusion in commit messages.

### Known server-side issues that affect you (do not try to fix in Klank — just work around)

- **Webhook E2EE bypass** (Klank Phase 11.6, in flight) — incoming webhooks currently can post plaintext to E2EE channels. Stream A is hotfixing this in parallel. Your webhook helpers should assume the fix lands, i.e. webhooks WILL be rejected from E2EE channels with the same error code as `send_message`. Test fixtures should mirror that future behavior.
- **`Vec<u8>` ciphertext/nonce wire encoding** (Klank Phase 11.6, in flight) — currently serializes as JSON int arrays, will become base64 strings. Your SDK should expect base64.
- **Bot membership** (Klank Phase 11.7, queued) — see locked decision #3.
- **No webhook DELETE / bot DELETE / token rotation routes** — feature gap, document as "not yet supported."
- **No slash command registration endpoint** — only outbound dispatch helper exists. Document as "not yet supported."
- **No outgoing webhook dispatch** — `kind="outgoing"` is in the schema but not wired to `message.new`. Document as "not yet supported."
- **Webhook signing has no replay protection** (no timestamp/nonce). Acceptable for v1; document and queue as future work.

### Your task

Execute **Phase 0 (Migration & Baseline Fixes)** of the SDK refresh roadmap. Specific subtasks:

0.1 — Fix `WebhookBot` send-side per the new contract in WIRE-FORMAT-SPEC (`X-Klank-Webhook-Key` + `X-Klank-Signature: sha256=hex(hmac_sha256(secret, body))`). Use the **real computed signature** from the spec as a unit-test fixture.

0.2 — Add `verifyWebhookSignature(rawBody, headers, secret)` helper (constant-time compare). Unit test with the spec's fixture.

0.3 — Add `verifySlashCommandRequest(rawBody, headers, secret)` helper. Unit test with the spec's fixture.

0.4 — Resolve the `responseType: 'ephemeral'` no-op in `bot.ts:202`. Either implement properly (check spec for ephemeral routing) or throw a clear error and remove from docs. Document the choice in the code comment.

0.5 — Wrap E2EE channel send failures with a helpful message: `"Bot cannot post to E2EE channel '<name>' — bot E2EE support is planned in Phase G of the SDK roadmap (.planning/SDK-REFRESH-ROADMAP.md). Track Klank Phase 12 for the underlying X3DH work."`

0.6 — Create `packages/sdk-rust/` with `Cargo.toml`, `src/lib.rs` (KlankBot struct + new() + start() no-op), `examples/hello.rs`. Must `cargo build` and `cargo run --example hello` cleanly. Use `tokio` + `reqwest`.

0.7 — Rewrite the README. Reflect actual state. Drop unbacked claims. Add a Migration section. Link to roadmap.

0.8 — Write `MIGRATION.md` at repo root covering all the breaking changes.

0.9 — Create `.planning/STREAM-B-STATUS.md` with Phase 0 task checklist + commit hashes + blockers + next phase (A).

### Operating rules

- **Atomic commits per subtask.** Prefix `fix(sdk):` / `feat(sdk):` / `docs(sdk):`. No `--no-verify`, no force pushes, **no auto-push to remote** — leave commits local for human approval.
- **Both editions or it doesn't ship.** When you finish a TS feature, the Rust equivalent is in the same commit batch (or explicitly noted as deferred with a tracking entry).
- **Verify before committing.** TS: `npm install --legacy-peer-deps && npm test && npm run build` in the package dir. Rust: `cargo build && cargo test && cargo run --example hello`. If verification fails, fix it before committing — no broken commits.
- **No skipping tests** because the environment is awkward. If a test needs setup, write the setup. (Same rule as the main Klank project — see CLAUDE.md.)
- **Documentation is part of "done."** A feature without a doc page and an example is not done.
- **You may NOT edit anything in `~/Sites/rust-slack`.** Read freely as documentation; never write.
- **Status file:** Update `.planning/STREAM-B-STATUS.md` after every meaningful step. The orchestrator session reads this to know where you are.

### Reporting

When Phase 0 is complete (or you hit a hard blocker), report back with:
- Per-subtask status (done / blocked / skipped with reason)
- Commit hashes
- Verification results (TS + Rust)
- Top 3 surprises
- Recommended Phase A scope adjustments based on what you learned
- Anything the human should review before Phase A starts

**Start now.** First action: read `.planning/handoff/WIRE-FORMAT-SPEC.md` end-to-end. Then read `BASELINE-REPORT.md` and `SDK-REFRESH-ROADMAP.md`. Then begin Phase 0.

---

## How to use this file (instructions for Steve, not the new session)

1. Open a new terminal: `cd ~/Sites/rust-slack-sdk && claude`
2. Once Claude is running, paste the entire section above (everything between the two `---` markers).
3. Claude will read the three docs, then start executing Phase 0.
4. It will report back when Phase 0 is done. At that point, come back to the orchestrator session (the one in `~/Sites/rust-slack`) and tell it "SDK Phase 0 done" so I can dispatch Phase A work or coordinate the Klank Phase 11.7 dependency.

The wire spec was copied here from the Klank repo at `2026-04-07 18:03`. If the Klank server changes after that timestamp, the spec needs to be regenerated and re-copied — ask the orchestrator session to do that.
