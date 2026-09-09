# create-klank-bot

Scaffold a [Klank](https://github.com/Aktiga/klank) bot project.

```bash
npm create klank-bot@latest my-bot
# or: pnpm create klank-bot my-bot / yarn create klank-bot my-bot
```

Node 20+. Writes a small TypeScript project that depends on
[`@klank/sdk`](https://www.npmjs.com/package/@klank/sdk), with a runnable test
and a README that says how to register it on a server.

## Usage

```
create-klank-bot <dir> [options]

  --template <name>  echo | webhook-poster | slash-receiver (default: echo)
  --name <pkg-name>  package name for the new project (default: from <dir>)
  --yes              take the defaults instead of prompting
  --help             print this message
```

Without `--template`, an interactive terminal is prompted for one; with `--yes`
or no TTY (CI, pipes) the default is used. The target directory must be empty
or absent — the CLI refuses to write into a directory with files in it and
exits 1.

## Templates

| Template | What you get |
|---|---|
| `echo` | `KlankBot` over the WebSocket: replies `echo: <text>` to every message, `onError`, `SIGTERM` shutdown. Needs a server with the bot-model work; see the generated README. |
| `webhook-poster` | `WebhookBot` posting into one channel through an incoming webhook. The path that works against today's server. |
| `slash-receiver` | `node:http` endpoint that verifies `X-Klank-Signature` and answers a slash command in-channel. |

Every template ships `package.json`, `tsconfig.json`, `.env.example`,
`README.md`, `src/index.ts` and `test/bot.test.ts`, and each test runs against
real transports — no mocking library.

## After scaffolding

```bash
cd my-bot
cp .env.example .env    # fill in the values it lists
npm install
npm start
```

