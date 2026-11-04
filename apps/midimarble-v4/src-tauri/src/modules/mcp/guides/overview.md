# MidiMarble

A song plays; marbles play its notes; you build the run they fall through; then you make the film. You work in the person's open app: every edit shows live in the window and is one Undo step named "Agent: …", so they can step in at any time.

## The work, in order

1. `get_state`. It also tells you this project's **agent folder**: read its `AGENTS.md` for the goal and rules, and `references/` for the look. Keep what you decide in `notes/`.
2. `add_song` if there is no Song. A project is made if none is open.
3. Build the run: `run_command('build.track')` builds it all, then adjust; see the `building-a-track` guide. Read the hit summary in every reply and fix problems before going on.
4. Make it look right: see `film-look`. `set_references` stores images and words the person gave you.
5. Look with `preview_frame`, show the person with `play_range`.
6. `export_film`: draft first, then balanced or best.

## Tools

- `run_command(id, args?)` runs any command of the ⌘K palette; `list_commands(filter?)` lists them. `args.select` sets the selection first, using keys from `get_state`. A command needing a panel takes `args.path`; `list_commands` says what it needs.
- `run_command('project.execute', { commands, label? })` places pieces and sets values with parameters: see `building-a-track`.
- `add_asset` brings in a Blender model as a skin or decor: see `assets`.
- `get_guide('words')` has the names to use with the person.

## Working well

- One step at a time. A reply gives `changed`, `hits`, `problems` and `errors`; an edit that broke a hit shows there. `changed: false` means no Undo step, and `edit.undo` names what it took back in `undid`.
- If you are told the person is busy, wait a moment and try again. Don't undo their edits.
- Compose (`view.compose`) builds the run. Film (`view.design`) dresses it. Commands open their workspace themselves.
- Only the run affects hits. A skin, a theme, decor, light or a shot never changes the physics.
