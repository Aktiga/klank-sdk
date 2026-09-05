# Klank SDK

Client SDKs for [Klank](https://github.com/Aktiga/klank), the self-hosted end-to-end-encrypted team chat. This is the SDK monorepo; the server lives in its own repository.

## Packages

| Package | What it is |
|---|---|
| [`@klank/sdk`](packages/sdk) | The bot SDK: webhook posting, slash command verification, typed REST client, WebSocket event bot. Published to npm from this repo — [reference](packages/sdk/README.md). |
| `@klank/create-bot` | Project scaffolder. Placeholder only: not written, not published. |

A Rust crate is planned. `examples/community/echo-bot-rust` is a hand-rolled example, not a supported SDK.

## Examples

| Example | What it shows |
|---|---|
| [`examples/webhook-bot`](examples/webhook-bot) | Post messages through an incoming webhook; error handling. The path that works against today's server. |
| [`examples/ci-bot-ts`](examples/ci-bot-ts) | Webhook build notifications plus a slash command handler, with webhook self-echo suppression. |
| [`examples/echo-bot-ts`](examples/echo-bot-ts) | `KlankBot` WebSocket events, `ctx` helpers, middleware, error handling. |
| [`examples/community/echo-bot-rust`](examples/community/echo-bot-rust) | Community Rust example, hand-rolled against the wire protocol. |

## Docs

- [Getting started](docs/getting-started.md) — register a bot, create a webhook, post a message.
- [Deploying bots](docs/deploying-bots.md) — running a bot process, env vars, shutdown.
- [Security](docs/security.md) — HMAC signing both directions, token model, what is not protected.
- [Server requirements](docs/server-requirements.md) — the server-side work the interactive bot surface still needs.

## Running Klank

Klank is open source: run the server yourself from [Aktiga/klank](https://github.com/Aktiga/klank), or have Aktiga host it for you.

## Development

```bash
pnpm install
pnpm build      # tsc -b, then bundle each package
pnpm test       # vitest, per package
pnpm lint       # biome ci .
```

pnpm 9 and Node 20+. Every user-visible change to a published package needs a changeset:

```bash
pnpm changeset
```

`pnpm changeset:status` checks the current branch against `origin/main`. On merge to `main`, the release workflow opens a "version packages" PR from the accumulated changesets; merging that PR publishes to npm.

## License

MIT — see [LICENSE](LICENSE).
