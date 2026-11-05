# MidiMarble v4 Agent Guide

These rules extend the lab [AGENTS.md](../../AGENTS.md) for this app. Where they differ, these rules apply inside `apps/midimarble-v4`.

## Documents

- [docs/progress.md](docs/progress.md): current state, what's verified, known problems, next steps. Read it first.
- [docs/ux.md](docs/ux.md): product behavior
- [docs/design-language.md](docs/design-language.md): UI rules and patterns
- [docs/words.md](docs/words.md): concepts, vocabulary and copy rules every string follows
- [docs/architecture.md](docs/architecture.md): stack, data model, modules, bridges, tests and fixtures
- [docs/references.md](docs/references.md): target films, what good tracks do, measured limits
- [docs/ux-review.md](docs/ux-review.md): how a UI round is judged

The documents say how things are now, with no history; git keeps that. Update them when a decision changes. MCP guides in `src-tauri/src/modules/mcp/guides/` ship with the app and follow the same rule.

## Git

- Work only on the issue branch the user created for this app. Never commit to `develop`.
- Do not push, rebase, force or change branches unless the user asks

## Validation

- Run `pnpm --filter @lab/midimarble-v4 typecheck`, `lint` and `test` before each commit. `test` is the unit tests, under a minute: no whole songs in them, a small project of a few hits instead.
- Run `test:e2e` at milestones or when whole-song logic changes: `*.e2e.test.ts` files, with the Jingle Bells build, the fixture checks and the performance tests. It takes minutes, one file at a time.
- Test films with Draft and stills; a Final film only at milestones
- Run headless Blender checks when their code changes
- Browser and computer-use checks are allowed for this app, including the native window and Blender
- Send results in chat: checks run, checks skipped

## Media and assets

- Write temporary files to the system temp folder or the app's ignored `.local/`, never into the repository root; do not point `TMPDIR` or tool caches at the working directory
- Keep reference media, purchased assets and rendered films out of the repository. Store generated artifacts under the app's ignored `.local/`.
- Use the reference short only for the final validation
- Committed music must be original or public domain
