# echo-bot-rust (community)

Hand-rolled against the Klank wire protocol with `reqwest` and `tokio-tungstenite` — no SDK involved.

Not a supported SDK: nothing here is published, tested in CI, or covered by the `@klank/sdk` release process. A Rust crate is planned.

Tracks no server version. It was written against an older Klank and may be wrong about routes, headers, and event shapes; check [docs/server-requirements.md](../../../docs/server-requirements.md) and the current server source before trusting it.
