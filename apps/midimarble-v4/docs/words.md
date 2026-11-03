# Words

How MidiMarble names things and talks to people. Every string in the app follows this page; when a new concept appears, it gets a row here first. Built from Apple's Human Interface Guidelines (Writing, Buttons), GarageBand, Logic Pro, Final Cut Pro, Figma, Blender and rhythm-game editors; the study notes are in `.local/ux-study.md`.

## The idea in one sentence

**A song plays; marbles play its notes; you build the run they fall through; then you make the film.** Every screen should make sense to someone who only knows that sentence. Experts get depth in the same places, never in a separate mode.

## Concepts

One word per concept, used everywhere: in labels, menus, tooltips, errors and docs.

| Concept | Word | Not | Why |
| --- | --- | --- | --- |
| The document | **Project** | scene, session | GarageBand, Logic, Final Cut |
| The music | **Song**: a MIDI file or a recording | source, music, audio file, track | GarageBand calls the whole thing a song; "track" is taken by timeline rows |
| One musical event | **Note**, shown by name: "C4" | event, MIDI note, hit object | Logic's piano roll; keeps notes (music) apart from pieces (things on the wall) |
| An event found in a recording | **Beat**: a note without a pitch | onset, transient, marker | plain music word; "onset" is engine language |
| Notes no marble plays | **Backing**: heard in the film, no piece needed | dropped, unassigned, left out | musicians know a backing track; a beginner reads it as "plays in the back" |
| The ball | **Marble** | ball, lane | |
| A row in the timeline | **Track**: the Song track, one track per marble, later Camera | lane, row, channel | Logic and GarageBand |
| The moment a marble strikes its note | **Hit** | contact, strike, collision | rhythm games; the hit has a timing status |
| Everything placed on the wall | **Piece** | object, element, prop, asset | marble-run kits |
| The piece that plays a note | **Platform** | bar, pad, peg | |
| Other pieces | **Rail**, **Tunnel**, **Windmill**, **Switchback** | scenery | concrete marble-run words; "scenery" is internal |
| A drawn route for a rail or tunnel | **Path** | spline, curve, Bézier | Figma's pen draws paths |
| Where pieces sit | **Wall** | canvas, board, pegboard (except as a theme name) | the 2.5D premise |
| A platform tied to its note | **Plays** Note 3 · C4 | linked, attached, bound | says what it does; Final Cut's connected clip is the model |
| A piece tied to a moment of a marble's fall | **Follows** Marble 1 at 0:03.2 | anchored, parented | says what it does |
| A piece tied to nothing | **Free** | unlinked, static | |
| Undoing those ties | **Detach** | unlink, unanchor | one verb for both |
| The two workspaces | **Compose** (song, marbles, pieces, timing) and **Film** (look, camera, titles, export) | Design, Build, Look | "Film" names what you make; camera and export belong there |
| Inspector with nothing selected | **Project** | World, Settings, Document | Figma shows the page when nothing is selected |
| How fast marbles fall | **Marble Speed** | gravity, physics scale | "Gravity" only in its tooltip |
| The output | **Film**; the action **Export Film…** | render, video, encode | Final Cut's Export File; "render" only in progress text |
| Render quality | **Draft**, **Standard**, **High**, **Best** with size and frame rate as detail | fast, balanced, Eevee, Workbench, samples | Blender names only in tooltips |
| Blender | **Blender**: a status chip in the title bar (Ready, Starting, Rendering Preview, Not Installed, Error; a hollow dot and Blender in the browser) with Open in Blender, Restart Blender, Show Blender Log, or Install Blender… | worker, bridge, mailbox, Edit in Blender | |
| Changed in Blender | **Detached** with **Reset to Theme** | unlinked, taken over, edited | |
| The project's outline | **Layers**: Song, Marbles, Free Pieces, Camera, Titles | tree, scene graph | Figma |
| Settings most people never need | **Advanced**, a disclosure at the end of a section | expert, more, details | Final Cut, Logic |
| How a film is lit and rendered | **Lighting**: Fast or Realistic (Eevee and Cycles in the tooltip) | renderer, engine | |
| What an agent run produces | **Result**, shown as a card with Accept and Discard | candidate, output, artifact | |
| A look preset | **Theme** (Pegboard, Brass): wall, light, marble and a default skin per piece type | style, material, preset | |
| A theme setting that changes the whole look | **Theme option** (Colour by Note) | parameter | |
| The browser of themes, skins and pieces | **Library** | assets, My Library, In This Project | Figma's Assets panel; one place, no storage scopes |
| Making an item available in every project | **Keep in Library** (star) | save to My Library, publish | |
| An item the project uses | **In Use** badge | applied, local | |
| Where an item comes from | **Brass Theme**, **Made with Agent**, **Imported** | scope, source | |
| A piece's appearance | **Skin** | asset, mesh, model | |
| Motion on a hit | **Reaction** (Press, Wobble, Glow) | animation, driver | |
| Text on the wall | **Title** | wall text, label | the reference films call them titles |
| When a title shows | **In** and **Out** in a Timing section, times as m:ss.cc; a Titles track of clips in Film | start/end, keyframes, duration | Final Cut's In and Out points; defaults are the start and the end of the film |
| The in-app stand-in for Blender's render | **Draft Preview** with the help "Blender draws the real look. This preview follows the same camera." | proxy, fallback, mock | Final Cut's proxy playback, named for what it is |
| A camera change at a time | **Shot** (Wide, Follow, Push In, Close-Up) | marker, keyframe | film language |
| The agent | **Agent** (Claude Code, Codex as the engine name in its menu) | AI, assistant, bot | |

## Timing statuses

One status per hit, shown as a pill on pieces, in the inspector header and on the marble's track. Colour is never the only signal; each status has an icon.

| Status | When | Tooltip |
| --- | --- | --- |
| **On Time** | within 5 ms of the note | "Marble 1 hits C4 on time" |
| **12 ms Early** / **12 ms Late** | 5 to 20 ms off the note; a filter or count that covers both says **Early or Late** | "Lands 12 ms after the note" |
| **Missed** | the marble does not reach the platform | "Marble 1 passes the platform without touching it" |
| **Blocked** | the marble's own run already passes through the platform's spot earlier | "Melody already passes through this spot earlier in its run" (name the marble) |
| **Stopped** | the marble comes to rest on the platform | "Marble 1 stops on this platform" |
| **Open** | the note has no platform yet | "No platform plays this note yet" |
| **Too Soon** | an open note before the marble's release, or so soon after it that the marble cannot fall its diameter and reach strike speed | "Marble 1 can't reach a platform by 0:01.00" |
| **Out of Reach** | an open note after the marble fell out of the run, or while it lies still on a piece | "Marble 1 has fallen out of the run by 0:06.00", "Marble 1 lies still on a piece at 0:03.00" |

Too Soon and Out of Reach are drawn hollow with an amber dashed outline and count as needing attention. Their fixes are **Move Release Earlier** (Too Soon: the release moves 0.5 s before the note, never before the song starts) or **Move Release Later** (Out of Reach on the marble's first note), and **Make Backing**; a fix that does not help is not offered.

A summary sits in the timeline header for the whole project: "12 of 12 hits on time", or "2 hits need attention", which jumps to the first problem when clicked, like Xcode's issue count. Its menu (the chevron or a right-click) has Show First Problem and **Re-place Broken Platforms (24)**.

## Fix-its

A fix sits next to the problem, like Xcode's Fix-its.

| Action | Where | Meaning |
| --- | --- | --- |
| **Undo** | in every notice that reports an edit, like Mail's and Finder's undo toasts | takes back that edit while it is still the latest; ⌘Z in the tooltip |
| **Re-place 24 Platforms** | in the notice of an edit that left later hits Blocked or Missed (or "3 later hits are now Blocked or Missed" when the edit had no notice), and as Re-place Broken Platforms in the hit summary's menu | runs Add Platform's Auto place again from the first broken hit onward, as one undo step; the count is the broken hits |
| **Re-place** | the wand beside a Blocked, Missed or Stopped platform's status pill in the inspector header | Auto place again for that platform alone |
| **Stop** | in the Re-place progress notice | keeps what is re-placed so far |

## Assists

| Action | Shortcut | Meaning |
| --- | --- | --- |
| **Add Platform** | click an open note's dot | places a platform tilted so the marble lands on time |
| **Place Next Platform** | N | adds the platform for the next open note |
| **Continue Pattern** | Tab | repeats the pattern of the last platforms for as many notes as fit; the button shows the count: "Continue Pattern (4)" |
| **Mirror Last Platform** | M | the last platform's tilt mirrored, for zigzags |
| **Repeat Last Platform** | R | the same tilt again |

## Capitalization and punctuation

- **Title Case** for buttons, menu titles and items, tabs, segmented controls, window and sheet titles, inspector section titles, track headers and status pills: "Export Film…", "Place Next Platform", "On Time"
- **Sentence case** for tooltips, hints, empty-state lines, alert messages, progress and errors: "Play the song (Space)"
- No period on labels, tooltips or one-line hints; periods only in multi-sentence text
- An ellipsis (…, one character) only when the action asks for more before it runs: "Import Song…", "Export Film…". No ellipsis when it runs at once: "Add Marble", "Detach"
- Numbers with units and a space: "12 ms", "0:03.2", "120 BPM", "9 cm"; times as minutes and seconds, never frames
- Note names with sharps as ♯ in display ("F♯4") and accept "F#4" and "Gb4" when typed

## Tone

- Plain words a beginner knows; a music or film word gets a tooltip the first time it appears (BPM, bar, velocity, shot)
- Verbs first on buttons: say what happens. Never "OK" or "Yes" in a confirmation; repeat the action: "Delete Marble 2"
- No "we", no "please", no "oops", no exclamation marks
- Name the thing: "Rail 2 is in the way", not "An object is blocking"
- Errors say what happened and what to do, next to the problem: "This file isn't a MIDI file or a recording. Choose a .mid, .wav, .mp3 or .m4a file."
- Explanations live behind the question mark (HelpTip), never as grey prose under a control

## Patterns

| Kind | Pattern | Examples |
| --- | --- | --- |
| Button | Verb + object | Add Marble, Import Song…, Export Film…, Detach, Add Platform |
| Toggle | State noun | Snap, Mute, Solo, Loop Playback |
| Tooltip | What it does + shortcut | "Add a platform for the next note (Return)" |
| Empty state | What is missing, one line, plus the action | "No song yet" · Import Song… |
| Error | What happened. What to do. | "Blender isn't installed. Install Blender 4.2 or later to preview and export films." |
| Progress | What is happening, how far, how long | "Exporting film · frame 120 of 600 · about 3 min left", "Re-placing platforms · 0:12.50 of 0:31.00" |
| Notice | What happened, one line, then its actions; the default action first | "6 platforms removed: Backing needs no platform" · Re-place 45 Platforms · Undo |
| Unreachable note | What happened. What to do, naming the fixes. | "Hit 1 is too soon for Marble 1. Move the release earlier or make it Backing." |
| Fix result | What changed: how the run stands | "Melody now starts just before its first note. Re-placed 15 platforms: 109 of 109 hits on time" |
| Confirmation | Question naming the thing + the action as the button | "Delete Marble 2 and its 12 hits?" · Delete · Cancel |

## Structure

### Timeline tracks

The timeline's left column is **Tracks**:

1. **Song** at the top: the song's file name and kind ("MIDI · 120 BPM" or "Recording · 0:35"). It expands into a piano roll of every note, coloured by the marble that plays it, Backing in grey. Selecting notes and pressing 1 to 9 hands them to that marble, 0 makes them Backing; the context menu says "Play With ▸ Marble 1 … · New Marble · Backing". A recording shows its waveform and its beats
2. **One track per marble**: the marble's name and instrument, Mute and Solo, its hits in a flat row with their timing status; it expands into a piano roll of just its notes
3. **Camera** in Film: shots
4. **Titles** in Film, when the project has titles: one clip per title from its In to its Out time

A note belongs to exactly one place: a marble, or Backing. A platform exists to play its note, so it goes with it: handed to another marble, the platform plays the note in that marble's run; handed to Backing, the platform is removed. A notice says which, and undo brings it back. (Leaving it Free on the wall would put an obstacle in every marble's path.)

### Inspector headers

"Platform 3" with the subtitle of its tie: "Plays C4 · 0:03.2", "Follows Marble 1 at 0:03.2" or "Free", and the status pill on the right.

### Start screen

Actions: **New Project…** (it asks where to save), **Import Song…** (MIDI or recording, one picker), **Open Project…**. Examples below them: Songs and Techniques. Opening an example opens it unsaved under its own name, like an untitled document, so Recent does not fill with copies. The title says **Not Saved** once it has changes; Save asks where to keep it, and closing it with changes asks "Save changes to Jingle Bells?" · Save… · Don't Save · Cancel.

## Beginner path

1. The start screen shows examples first-class; an example plays on Space at once
2. Quick Help (the ? button in the title bar, ⇧⌘/) labels the regions of the window in place, like GarageBand's Quick Help; it is optional and never modal
3. At most three one-line hints appear once, where the next step is, and disappear when done: "This is your song: each marble plays some of its notes" (Song track) → "Click a note's dot to add a platform" (first open dot) → "Switch to Film to choose the look and export" (after the first full run)
4. The hit summary in the timeline header says when the run works: "12 of 12 hits on time"

## Progressive disclosure

- The selection decides what the inspector shows; nothing selected shows the Project
- Each section shows its everyday controls; technical ones sit under the section's Advanced disclosure, which remembers its state
- Technical names (Eevee, samples, focal length, restitution) appear only in tooltips or under Advanced
- No Beginner or Expert mode; the same features in the same places, density grows on demand
- Failing hits are always visible, whatever is collapsed
