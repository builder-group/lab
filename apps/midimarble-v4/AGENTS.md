# MidiMarble v4 Agent Guide

These rules extend the lab [AGENTS.md](../../AGENTS.md) for this app. Where they differ, these rules apply inside `apps/midimarble-v4`.

## Documents

- [docs/ux.md](docs/ux.md): product behavior
- [docs/design-language.md](docs/design-language.md): UI patterns and visual rules
- [docs/words.md](docs/words.md): concepts, vocabulary and copy rules every string follows
- [docs/architecture.md](docs/architecture.md): stack, data model, modules and bridges
- [docs/milestones.md](docs/milestones.md): milestones, fixtures and done checks
- [docs/references.md](docs/references.md): target films and scale
- [docs/progress.md](docs/progress.md): current state of the build
- [docs/ux-review.md](docs/ux-review.md): tasks, heuristics and budgets every UI round is judged by

Read `progress.md` first when resuming work. Update the documents when a decision changes; they are the source of truth. Earlier MidiMarble prototypes are references only.

## Autonomous work

The build runs autonomously through the milestones without review between steps.

- Work milestone by milestone in order. Split a milestone into small slices internally.
- Use subagents for well-scoped modules with tests and for searches or check runs. The orchestrating session runs on Opus at high effort; implementation subagents use Opus at medium effort; search and check subagents may use a smaller model. Do not use Fable.
- Give each subagent a clear brief with the files it owns and its done checks. Review its result before building on it.
- After every slice, update `docs/progress.md` with what changed, the checks run and their results, and the next step
- When a check cannot pass after reasonable attempts, record the blocker in `progress.md` and continue with work that does not depend on it. Stop and report only when no milestone can progress.

## Git

- Work only on the issue branch the user created for this app. Never commit to `develop`.
- Commit at the end of each milestone, and at safe points within long milestones, with a message describing the milestone or slice
- Do not push, rebase, force or change branches unless the user asks

## Validation

- Run `pnpm --filter @lab/midimarble-v4 typecheck`, `lint` and `test` before each commit. `test` is the unit tests, under a minute: no whole songs in them, a small project of a few hits instead.
- Run `test:e2e` for what touches whole songs: `*.e2e.test.ts` files, with the Jingle Bells build, the fixture checks and the performance tests. It takes minutes, one file at a time.
- Run headless Blender checks for the milestones that own them
- Browser and computer-use checks are allowed for this app, including the native window and Blender
- Report checks run and checks skipped in `progress.md`

## Media and assets

- Write temporary files to the system temp folder or the app's ignored `.local/`, never into the repository root; do not point `TMPDIR` or tool caches at the working directory
- Keep reference media, purchased assets and rendered films out of the repository. Store generated artifacts under the app's ignored `.local/`.
- Use the reference short only for the final validation in M6
- Committed music must be original or public domain
