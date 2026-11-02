# Yadori native host

Stable app identifier `group.builder.yadori.next.dev` (development), `group.builder.yadori.next` (production). UI development port 1438. Native commands expose managed multiproject persistence, portable archives/assets, installed Codex CLI jobs, packaged stdio MCP and restricted Idealo OAuth/HTTP/Keychain access.

See [agent integration](../docs/agents.md) and [storage architecture](../docs/architecture.md). The TypeScript domain remains authoritative; Rust validates storage/IPC envelopes and enforces filesystem, revision, process and network boundaries. It does not duplicate electrical/material calculations.

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```
