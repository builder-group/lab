# Assistants and pricing

Planning works offline. Research and prices are optional integrations and produce ordinary project data through the same command path as human edits.

## Local Codex CLI

The in-app assistant uses an installed, signed-in Codex CLI. The user manages CLI authentication; Yadori does not read its credential file or require an OpenAI API key.

An explicit task creates an isolated directory containing a saved project snapshot, bundled library metadata and command contract. The native runner invokes bounded `codex exec` with live web search, JSON output, a read-only sandbox, noninteractive approvals, ephemeral operation and a five-minute timeout. It ignores user configuration/rules and streams compact progress events. Cancellation, timeout and application exit terminate the controlled process group. Completed task directories are removed; an OS crash can leave snapshots for recovery.

The result is a summary and a serialized command array. Yadori parses it with the shared schema, materializes known library artwork and dry-runs the commands before offering Apply. Proposals carry project identity and base revision; intervening edits make them stale. Apply flushes pending local edits, validates the revision, executes one undoable command batch and archives the proposal only after durable save. An assistant is not a second project writer.

Keep uncertain specifications unknown and attach source URLs or questions. Task snapshots contain project data. Credentials never enter prompts, project JSON or portable files.

## External MCP

The built app executable also runs a stdio MCP server. In Local assistant → Connect an external assistant, copy the generated configuration with the actual executable, data root and project ID. For example:

```json
{
  "mcpServers": {
    "yadori": {
      "command": "/Applications/Yadori.app/Contents/MacOS/Yadori",
      "args": [
        "--mcp",
        "--data-root",
        "/Users/you/Library/Application Support/group.builder.yadori.next.dev",
        "--project",
        "PROJECT_ID"
      ]
    }
  }
}
```

The server stays bound to that project; changing the open project does not retarget an external client. Its tools are:

| Tool                   | Behavior                                                             |
| ---------------------- | -------------------------------------------------------------------- |
| `read_library`         | Read compiled definitions and artwork metadata.                      |
| `import_library_asset` | Materialize known bundled artwork without changing the project head. |
| `read_project`         | Read the latest saved project, restricted by `--project`.            |
| `command_contract`     | Read the shared command JSON Schema and guidance.                    |
| `propose_commands`     | Submit a revision-scoped batch for review; never apply it directly.  |

The protocol is newline-delimited JSON-RPC on stdin/stdout. No application logs belong on stdout. The caller explicitly grants access through `--data-root`. Proposals live in `<data-root>/projects/<id>/proposals/`, with reviewed items moved to `reviewed/`. Batches accept up to 1,000 commands. Domain validation remains in TypeScript.

For development, run `pnpm --filter @repo/yadori mcp --project <id>` from the repository root. It uses the local launcher. `YADORI_EXECUTABLE` and `YADORI_DATA_ROOT` override its defaults. Packaged integrations require neither Node nor this checkout.

## Idealo and source links

A part can retain ordinary seller/product links without an integration. Optional Idealo connection uses its own OAuth flow, restricted native HTTP and OS Keychain storage. The transport permits only the provider's fixed endpoints/methods; it is not a general network proxy. Development and production credentials are scoped to their app identifiers.

Search and quote retrieval happen on request. A chosen offer becomes a dated observation; it does not silently rewrite purchase history. Planning estimates and recorded spending remain separate. The app does not continuously synchronize prices or infer account eligibility.

## Testing

Routine unit tests use controlled processes and transports. Account sign-in, live provider calls and real assistant jobs are separate manual checks and are not required for ordinary tests or builds.
