# Architecture

Yadori is one Tauri app. React owns the interface, the TypeScript domain owns project behavior, and the Rust host owns filesystem, process and credential boundaries. The shared UI and state libraries are linked from the adjacent community checkout; product modules remain inside this app.

## Ownership

| Location                                  | Responsibility                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/App.tsx`                             | Compose the workspace and connect its controllers.                                       |
| `src/modules/project/model`               | Pure types, Zod/versjon schemas, migrations, commands and derived requirements/findings. |
| `src/modules/projects`                    | Active project, undo/redo, pending edits and persistence coordination.                   |
| `src/modules/parts`                       | Capture, part documents, library application, purchasing and stock editing.              |
| `src/modules/canvas`                      | Temporary tools/selection, scene derivation, equipment and route interaction.            |
| `src/modules/library/data`                | Versioned reusable definitions and artwork metadata.                                     |
| `src/modules/electrical`                  | Pure DC voltage-drop calculation; model helpers map project inputs.                      |
| `src/modules/agents`, `pricing`, `review` | Optional research proposals, market observations and project questions.                  |
| `src/environment/desktop`                 | Typed frontend/native boundary.                                                          |
| `src-tauri/src`                           | Managed storage, portable archives, stdio MCP, CLI jobs and restricted Idealo transport. |

Keep domain code free of React, network and filesystem access. Components render and edit through their owning controller. Add shared abstractions when several owners need the same contract; keep feature-specific behavior with its module.

## One write path

Human edits and agent proposals become ordinary typed commands. A command batch executes against a detached project candidate, reconciles endpoints, validates the complete graph and advances one revision. Failure leaves the original document unchanged. `ProjectSessionCx` owns the active immutable snapshot and session-local undo history.

Editors may keep local drafts. Notes buffer while typing and register a synchronous flush with the session. Save, export, project transitions, undo/redo and native close flush pending edits first. An incoming edit to the same notes preserves the local draft for an explicit resolution. Agent application flushes drafts before checking its base revision; it never bypasses the active writer.

Canvas camera, selection and temporary drag coordinates are view state. Drag/nudge gestures commit once; a conflicting project revision cancels a move. Document indexes/findings are cached per immutable snapshot, render objects are reused for unaffected nodes/edges, and viewport consumers subscribe separately. Preserve this separation when adding tools.

## Managed projects

Development uses Application Support `group.builder.yadori.next.dev/projects/<id>/`; production uses `group.builder.yadori.next`. These stable identifiers also scope Keychain credentials and are independent of the display name.

Each project has `project.json` and immutable local assets. Native saves hold a cross-process writer lock, compare the expected revision and replace the head atomically through a flushed temporary file. The preceding head is retained as `project.json.backup`. Stale writers, malformed files and unsupported versions fail explicitly. A damaged project remains visible for recovery; loading another project must not silently replace its head.

Window close and Cmd-Q share a frontend flush handshake. Failed saves keep the app open. Accepted quit cancels running jobs. OS force termination cannot run the handshake. `modules/projects/browser-storage.ts` owns the separate browser preview store and JSON download. It validates existing documents before replacing a stored project; it is not a substitute for native persistence testing.

## Portable files

A `.yadori` / `.yadoriproject` file is a ZIP snapshot with:

```text
manifest.json
project.json
assets/<file>
```

The package manifest is `{"$schema":"yadori/package@1","projectPath":"project.json"}`. Package layout, project schema, library revision and document revision are separate versions. Keep schema migrations in the model and package-layout changes in native storage.

Exports include project facts, pinned library definitions and every referenced local asset. They exclude credentials, CLI authentication, proposals and task directories. Missing assets fail visibly. Export can rescue the current in-memory snapshot without updating the managed head. Import validates names, expanded sizes and assets, creates a new project identity, and installs the staged package atomically. Traversal, symlinks, duplicate entries and unsupported layouts are rejected. Legacy flat snapshots without a manifest remain importable under the same asset restrictions.

Generated `command-contract.json` and `library_data.rs` come from `pnpm model:contract`, which runs before UI builds. Change the TypeScript schemas/catalog and regenerate rather than editing those outputs directly.
