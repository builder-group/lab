# Yadori

A local macOS prototype for planning portable-home builds. Capture a part from a name or link, add specifications and notes, choose what belongs in the build, then place and wire it on a measured canvas. The same project supplies the parts list, material demand, purchases and cost estimates.

Electrical planning is implemented. Plumbing and framing are future extensions. Local Codex CLI assistance and Idealo price lookups are optional; core planning works offline.

## Develop

Run from the `lab` repository root:

```sh
pnpm install
pnpm --filter @repo/yadori start:dev
```

Requires Node.js 24+, the repository's pnpm version, Rust and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Keep the `lab` and `community` checkouts beside each other: the app links the in-house `feature-state` and `feature-react` packages. Build those packages if their `dist` output is missing.

`pnpm --filter @repo/yadori ui:start:dev` serves a browser preview on port 1438. Browser projects use origin-local storage; native projects use managed files. These stores do not synchronize.

## Check and build

```sh
pnpm --filter @repo/yadori typecheck
pnpm --filter @repo/yadori lint
pnpm --filter @repo/yadori test
pnpm --filter @repo/yadori build --bundles app
cargo test --manifest-path apps/yadori/src-tauri/Cargo.toml
cargo fmt --manifest-path apps/yadori/src-tauri/Cargo.toml --check
```

Routine tests do not launch live agent jobs. `build` creates a debug app; `build:prod` creates a release build. This prototype is not a signed public distribution.

## Work on the app

- [Architecture and persistence](docs/architecture.md): module ownership, write path and portable files.
- [Project model](docs/model-contract.md): capabilities, physical units, material demand and stock.
- [Canvas](docs/canvas.md): interactions, scale and route measurement.
- [Assistants and pricing](docs/agents.md): local jobs, MCP proposals and optional account integration.
- [DC sizing](docs/dc-cable-sizing.md): equations, assumptions and limits.
- [Artwork](docs/artwork-sources.md): attribution and calibration rules.

Keep unknown specifications explicit. A 2D route is an estimate, cost totals can be incomplete, and the DC calculator covers voltage drop rather than complete installation design.
