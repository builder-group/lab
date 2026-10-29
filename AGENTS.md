# Project Agent Guide

## Repository Context

- Lab contains experimental applications and product prototypes
- TypeScript workspaces use pnpm and Turbo across `apps/*` and `packages/*`
- `apps/kairos` is an Expo and React Native interval timer with local native Expo modules under `modules/`
- Kairos's `ios/` and `android/` directories are generated and gitignored
- `apps/learnlinesfaster` is a React Router web app deployed with the Vercel React Router adapter
- `apps/midimarble` is a browser studio using React, TanStack Start, Three.js, and Rapier
- Standalone Swift projects, including `apps/derive`, are outside the pnpm workspace
- `apps/_deprecated` is historical. Do not update or validate it unless explicitly requested.
- Applications are private experiments. Preserve their behavior and local conventions without assuming published-package API requirements.

## Working Model

- Treat clarification questions as requests for explanation. Edit files only when the user asks for changes.
- Follow the task's explicit constraints. More specific package or pattern guidance takes precedence over general conventions.
- Read the matching rules below and nearby implementation for the work at hand. Do not load every reference.
- For library usage, consult the relevant README sections matching the installed dependency version. For library changes, also inspect public types, the package manifest, and nearby tests.
- Follow local patterns and keep changes focused. Avoid unrelated cleanup or migrations.
- Before product behavior, native integration, or deployment changes, read the owning app README and relevant project documentation

## Git

- Read-only git commands are allowed
- Do not stage, commit, create or switch branches, push, or otherwise mutate git state unless the user explicitly asks for that specific git action

## Validation

- Choose checks from the owning `package.json` or Xcode project
- Prefer focused checks such as `pnpm --filter <package> test`, `pnpm --filter <package> lint`, or `pnpm --filter <package> typecheck`. Use workspace checks for shared tooling or changes across packages.
- Do not validate routine changes with browser-driven, Playwright/Cypress-style, or manual browser e2e testing unless explicitly asked. For UI-specific tasks, ask before starting browser-based validation.
- Report checks run and relevant checks skipped

## Rules

These references capture project conventions. API details belong in package documentation.

- TypeScript, file organization, and tuple-result usage: [.agent/rules/typescript.md](.agent/rules/typescript.md)
- React components: [.agent/rules/react.md](.agent/rules/react.md)
- Application state and forms using feature libraries: [.agent/rules/state-and-forms.md](.agent/rules/state-and-forms.md)
- HTTP clients in application code: [.agent/rules/fetch-client.md](.agent/rules/fetch-client.md)
- `Cx` ownership and lifecycle: [.agent/rules/cx-pattern.md](.agent/rules/cx-pattern.md)
- Prose and comments: [.agent/rules/writing.md](.agent/rules/writing.md)
- Package READMEs: [.agent/rules/package-readme.md](.agent/rules/package-readme.md)
- Vitest tests: [.agent/rules/vitest.md](.agent/rules/vitest.md)
- Swift and SwiftUI: [.agent/rules/swift.md](.agent/rules/swift.md)

## Architecture References

Consult these when changing app structure or module boundaries.

- [React app structure](https://github.com/builder-group/community/blob/develop/docs/conventions/project-structure-react.md)
- [Swift app structure](https://github.com/builder-group/community/blob/develop/docs/conventions/project-structure-swift.md)

## Workflows

- Staged pre-commit review: [.agent/commands/review.md](.agent/commands/review.md)
- Incremental implementation: [.agent/commands/incremental-implementation.md](.agent/commands/incremental-implementation.md)
- Maintaining or sharing this setup: [.agent/README.md](.agent/README.md)
