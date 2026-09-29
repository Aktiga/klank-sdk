# create-klank-bot

## 0.1.0

### Minor Changes

- e92073d: First release of the project scaffolder: `npm create klank-bot <dir>` writes a
  runnable TypeScript bot project. Three templates — `echo` (`KlankBot` over the
  WebSocket), `webhook-poster` (incoming webhook), `slash-receiver` (signed slash
  command endpoint) — each with a test that runs against real transports.
  `--template`, `--name` and `--yes` skip the prompt; a non-empty target
  directory is refused.
