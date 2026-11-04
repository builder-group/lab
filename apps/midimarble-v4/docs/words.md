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
| A hit without a pitch (tapped or a beat) | **No Pitch** as a quiet value, with **Add Pitch** | None, empty field | Add Pitch starts from the marble's nearest pitched hit, else C4 |
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
| A copy of pieces | **Duplicate** (⌘D): free copies beside the originals | clone, copy | Figma and Finder |
| The two workspaces | **Compose** (song, marbles, pieces, timing) and **Film** (look, camera, titles, export) | Design, Build, Look | "Film" names what you make; camera and export belong there |
| Inspector with nothing selected | **Project** | World, Settings, Document | Figma shows the page when nothing is selected |
| How fast marbles fall | **Marble Speed** | gravity, physics scale | "Gravity" only in its tooltip |
| The output | **Film**; the action **Export Film…** | render, video, encode | Final Cut's Export File; "render" only in progress text |
| Render quality | **Draft**, **Standard**, **High**, **Best** with what sets each apart as detail: "Draft · 720p · Flat Light", "Standard · 720p", "High · 1080p", "Best · 1080p · 60 fps" | fast, balanced, Eevee, Workbench, samples | Blender names only in tooltips |
| How long a film is | minutes and seconds ("0:35"), never a frame count; frames appear only in render progress | frames, 1051 frames | |
| Where an exported film goes | **In the Project**, or the folder chosen with Choose… | Renders folder, renders/ | the package folder is an implementation detail; Show in Finder finds it |
| Blender | **Blender**: a status chip in the title bar (Ready, Starting, Rendering Preview, Not Installed, Error; a hollow dot and Blender in the browser) with Open in Blender, Restart Blender, Show Blender Log, or Install Blender… | worker, bridge, mailbox, Edit in Blender | |
| Changed in Blender | **Detached** with **Discard Blender Changes**; a camera edited there reads **Edited in Blender** with **Reset Camera** | unlinked, taken over, edited, Reset to Compose, Regenerate Camera | says what the button throws away |
| The project's outline | **Layers**: Song, Marbles, Free Pieces, Camera, Titles | tree, scene graph | Figma |
| Settings most people never need | **Advanced**, a disclosure at the end of a section | expert, more, details | Final Cut, Logic |
| How a film is lit and rendered | **Lighting**: Fast or Realistic (Eevee and Cycles in the tooltip); Draft always uses **Flat Light** (Workbench in the tooltip), so the Lighting choice is dimmed with it | renderer, engine | |
| What an agent run produces | **Result**, shown as a card with Accept and Discard | candidate, output, artifact | |
| A look preset | **Theme** (Pegboard, Brass, Neon): wall, light, marble and a default skin per piece type | style, material, preset | |
| A theme setting that changes the whole look | **Theme option** (Colour by Note) | parameter | |
| A theme the project made from another | **Theme** like any other, named "Neon Copy" by **Duplicate Theme**; its origin line reads **Based on Neon** (or **Made with Agent**). Internally a project theme | custom theme, my theme, In This Project, fork | Finder's copy names; the one-library rule keeps storage words out |
| Editing a built-in theme | **Duplicate to Edit**: built-in themes are read-only | Edit Theme, Unlock | Figma library styles, Keynote themes |
| A project theme's colours | **Wall**, **Light**, **Glow**, **Background** as colour wells; an unset well shows the base's colour and reads **From Neon** in grey, normal case (Glow: **Marble Colour**); every well is outlined and named for screen readers ("Wall colour") | override, tint, world, emission | |
| Removing a project theme | **Delete Theme**; the notice says "Neon Copy deleted; the film uses Neon again" when it was in use | Remove Theme | |
| The browser of themes, skins and pieces | **Library** | assets, My Library, In This Project | Figma's Assets panel; one place, no storage scopes |
| Making an item available in every project | **Keep in Library** (star) | save to My Library, publish | |
| An item the project uses | **In Use** badge | applied, local | |
| Where an item comes from | **Brass Theme**, **Made with Agent**, **Imported**; a theme card reads **Theme** or **Based on Neon** | scope, source | |
| A piece's appearance | **Skin** | asset, mesh, model | |
| Motion on a hit | **Reaction** (Press, Wobble, Glow) | animation, driver | |
| Text on the wall | **Title** | wall text, label | the reference films call them titles |
| How a title sits in the film | **Style**: **Wall Title** (on the wall where it was placed), **Caption** (top of the frame, 3 s from the playhead), **Song Name** (upper third of the frame over the first 3 s, reading the song's name) and **End Card** (centre of the frame, over the last 3 s) | overlay, HUD, lower third | Caption, Song Name and End Card stay in the frame while the camera moves, on a soft dark backing; their Size is a share of the frame height in %. Choosing a style sets its times while they are still the last style's own, like a title preset in Final Cut |
| When a title shows | **In** and **Out** in a Timing section, times as m:ss.cc; a Titles track of clips in Film | start/end, keyframes, duration | Final Cut's In and Out points; a Wall Title's defaults are the start and the end of the film |
| The in-app stand-in for Blender's render | **Draft Preview** with the help "Blender draws the real look. This preview follows the same camera." | proxy, fallback, mock | Final Cut's proxy playback, named for what it is |
| A camera change at a time | **Shot** (Wide, Follow, Push In, Close-Up) | marker, keyframe | film language |
| How long a shot frames before the camera eases back | **Hold**, in seconds; **To Next Shot** at 0 | length, duration | a held shot in film language; Push In and Close-Up hold 2 s by default |
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
| **Out of Reach** | an open note after the marble fell out of the run, or while it lies still on a piece; never while an earlier note of the same marble is still Open, since that note is the next step and the ones after it stay Open | "Marble 1 has fallen out of the run by 0:06.00", "Marble 1 lies still on a piece at 0:03.00" |

Too Soon and Out of Reach are drawn hollow with an amber dashed outline and count as needing attention. Their fixes are **Move Release Earlier** (Too Soon: the release moves 0.5 s before the note, never before the song starts) or **Move Release Later** (Out of Reach on the marble's first note), **Move Hit Later** (a Too Soon tapped hit whose release cannot move earlier: the hit moves to the first moment the marble can strike), and **Make Backing**; a fix that does not help is not offered. Make Backing needs a song: Backing notes show only in the Song track, so in a project without a song (tapped hits) it is not offered, and **Delete Hit** takes its place.

A summary sits in the timeline header for the whole project, read from the same problem list as the export sheet, Layers and the Camera track, like Xcode's issue count: "12 of 12 hits on time", "2 hits need attention", or "107 of 109 hits on time · 4 other problems" when extra strikes, collisions, Blocked scenery, framing or the loop need a look. Open notes count toward the total only. It reads **Checking…** (dimmed, with a spinner) until the run for the latest edit arrives, never a stale count, and **Re-placing…** while Re-place runs. A click goes to the first problem in time order (**Show First Problem**, also in ⌘K). Its menu (the chevron or a right-click) lists every problem in time order, scrolling when the list is long, then Show First Problem and the Re-place fix under its one label (**Fix 24 Hits**), then **Show Last Fix** after a Re-place and **Fit to Song** where the user set a length the song no longer matches. Framing problems also show as amber spans on the Camera track; they open Film at their time with the Camera selected.

## Fix-its

A fix sits next to the problem, like Xcode's Fix-its.

| Action | Where | Meaning |
| --- | --- | --- |
| **Undo** | in every notice that reports an edit, like Mail's and Finder's undo toasts | takes back that edit, one undo step with what folded into it (a placement with its tie and the tilt Auto place refines a moment later), while it is still the latest; ⌘Z in the tooltip |
| **Fix 24 Hits** | in the notice of an edit that left hits Blocked, Missed or Stopped (or "3 hits are now Blocked, Missed or Stopped" when the edit had no notice), and with the same label in the hit summary's menu; ⌘K lists it as Re-place Broken Platforms | runs Add Platform's Auto place again from the first broken hit onward, as one undo step (Re-place). The label is a verb and the count, like Figma's quick actions: it counts the broken hits, which are known before it runs (**Fix Hit 7 of Melody** for one). A moved release and Blocked scenery fixed along with the hits are named in the tooltip, never in the label; Blocked scenery alone takes its fix as the label: **Move Windmill 1 Clear**, **Place Rail 1 Again** or **Delete Rail 1**, as its what-if found. The tooltip is one sentence of about 15 words saying what it does: "Re-places platforms so each hit lands on time, moves the release of Melody and deletes Rail 1". The result notice is two lines at most: "Fixed 37 hits · re-placed 13 platforms · moved the release · deleted Rail 1 · 108 of 108 hits on time" · **Details** · Undo, where Details opens the full result: "Melody now starts just before its first note. Re-placed 13 platforms, placed Switchback 3 and Rail 3 again, deleted Rail 1, which the new run passes through and no longer uses, and fixed all 38 broken hits: 108 of 108 hits on time · 2 other problems". It stays until it is closed or the next edit, and the hit summary's **Show Last Fix** shows it again. Counts in the full result read "fixed the broken hit", "fixed both broken hits", "fixed all 38 broken hits", "fixed 37 of 38 broken hits"; in the notice "Fixed the hit", "Fixed 37 hits", "Fixed 37 of 38 hits" |
| **Re-place** | the wand beside a Blocked, Missed or Stopped platform's status pill in the inspector header; beside a **Hit by Bass** pill on a platform | Auto place again for that platform alone; for Hit by Bass, for Bass's platform before the hit, so Bass passes clear |
| **Move Clear**, **Place Rail 1 Again**, **Delete Rail 1** | the one Fix-it beside the Blocked or **Hit by Bass** pill of a piece that follows a marble (windmill, switchback, rail, tunnel), and inside Re-place | its what-if runs as soon as the piece shows (the button reads **Checking…**) and the button names the first fix that breaks no hit and adds no problem: a bridge of a long gap suggested again for its gap, a nudge the shortest way off the marble's earlier run and the other marbles' runs keeping what it follows, or deleting a Blocked piece, which the run leaves out and so never uses. When nothing passes, the button is dimmed with the reason as its tooltip: "Moving Windmill 1 clear would break a hit, so nothing changed. Drag it by hand or Detach it." A fix that would refuse is never offered |
| **Stop** | in the Re-place progress notice | keeps what is re-placed so far |

## Assists

| Action | Shortcut | Meaning |
| --- | --- | --- |
| **Add Platform** | click an open note's dot | places a platform tilted so the marble lands on time |
| **Place Next Platform** | N | adds the platform for the next open note |
| **Continue Pattern** | Tab | repeats the pattern of the last platforms for as many notes as fit; the button shows the count: "Continue Pattern (4)" |
| **Mirror Last Platform** | M | the last platform's tilt mirrored, for zigzags |
| **Repeat Last Platform** | R | the same tilt again |

## Piece settings

Advanced sections name what a piece looks like or does, not how it is built. A half-width field carries the short name; the tooltip says the rest.

| Piece | Field | Means | Not |
| --- | --- | --- | --- |
| Platform | **Lands At** | where along the platform the marble lands, in % | Hit Point, contact, strike |
| Hit | **Velocity** | how hard the note plays, in % | Vel |
| Windmill | **Arms**, **Arm Length**, **Arm Width** | how many arms and how long and wide they are | Blades, Blade, Thick |
| Windmill | **Centre Size** | the round centre the arms turn on | Hub |
| Windmill | **Brake** | how quickly the spin slows down | Friction, damping |
| Windmill | **Spin** | spinning on its own; 0 turns only when the marble pushes it | Motor |
| Switchback | **Runs**, **Run Height** | how many runs the zigzag has and the height between them | Legs, Drop |
| Switchback | **Turn Gap**, **Turn Curve** | the gap at each turn the marble drops through, and how round the turns are | Open, Bend |
| Switchback | **Guard** | the raised side that catches the marble | Lip |
| Rail, Switchback | **Thickness**, **Width** (rail) | how thick the rails are and how far apart | Wire, Spacing |
| Tunnel | **Wall**, **Room**, **Mouth** | wall thickness, room around the marble, mouth width | bore |

## Capitalization and punctuation

- **Title Case** for buttons, menu titles and items, tabs, segmented controls, window and sheet titles, inspector section titles, track headers and status pills: "Export Film…", "Place Next Platform", "On Time"
- **Sentence case** for tooltips, hints, empty-state lines, alert messages, progress and errors: "Play the song (Space)"
- No period on labels, tooltips or one-line hints; periods only in multi-sentence text
- An ellipsis (…, one character) only when the action asks for more before it runs: "Import Song…", "Export Film…". No ellipsis when it runs at once: "Add Marble", "Detach". A label that asks in one host and not in another follows the host: New Project… in the desktop app, New Project in the browser
- A pop-up's options show their key at the trailing edge like any menu item ("Marble 1  1", "Backing  0"), never in the label as "(1)"
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
| Progress | What is happening, how far, how long. "How far" counts against one total fixed when the task starts; "how long" appears only once the rate is steady and then counts down like Finder's copy, never rising or jumping | "Exporting film · frame 120 of 600 · about 3 min left", "Re-placing platforms · 12 of 37 broken hits fixed · about 10 s left" |
| Notice | What happened, one line (two at most), then its actions; the default action first. Longer text goes behind **Details**, like Figma's notifications. A notice with a fix or Details stays until it is used or closed, or the next edit; one with only Undo times out | "6 platforms removed: Backing needs no platform" · Re-place 45 Platforms · Undo; "Copper applied to 5 platforms; Rail 1 kept its skin" · Undo when a skin skips pieces of another type, or "Copper applied to 1 platform. It keeps Copper's colour with Colour by Note" when Colour by Note is on |
| Unreachable note | What happened. What to do, naming the fixes. | "Hit 1 is too soon for Marble 1. Move the release earlier or make it Backing." |
| Fix result | In the notice, what it fixed and changed in a few words, then how the run stands, as the hit summary says it: "Fixed 37 hits · re-placed 13 platforms · deleted Rail 1 · 108 of 108 hits on time". Behind Details, every change by name, then what the fix added | "Melody now starts just before its first note. Re-placed 15 platforms and fixed all 45 broken hits: 109 of 109 hits on time", "…: 108 of 108 hits on time · 1 new problem: Rail 1 of Melody is Blocked" |
| Problem | The thing, then its state; a hit by its number on its marble; distances in cm | "Hit 12 of Melody is Blocked", "Rail 1 of Melody is Blocked", "Melody leaves the frame at 0:10.75 (14 hits)" with "Up to 52 cm past the edge of its part of the frame until 0:15.00", "Bass hits Switchback 6 of Melody", "Melody drifts below the other marbles at 0:09.00 (4 hits)" with "Up to 95 cm below them at 0:10.50, so the camera may lose Melody" |
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

Actions: **New Project…** (it asks where to save; in the browser it opens at once as **New Project**), **Import Song…** (MIDI or recording, one picker), **Open Project…**. Examples below them: Songs and Techniques. Opening an example opens it unsaved under its own name, like an untitled document, so Recent does not fill with copies. A saved project autosaves within a second of every edit, so its title shows no edited dot; a failed save shows a red **Not Saved**. An unsaved example's title says **Not Saved** once it has changes; Save asks where to keep it, and closing it with changes asks "Save changes to Jingle Bells?" · Save… · Don't Save · Cancel.

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
