# Words

How MidiMarble names things and talks to people. Every string in the app follows this page; when a new concept appears, it gets a row here first. Built from Apple's Human Interface Guidelines (Writing, Buttons), GarageBand, Logic Pro, Final Cut Pro, Figma, Blender and rhythm-game editors; the study notes are in `.local/ux-study.md`.

## The idea in one sentence

**A song plays; marbles play its notes; you build the track they fall through; then you make the film.** Every screen should make sense to someone who only knows that sentence. Experts get depth in the same places, never in a separate mode.

## Concepts

One word per concept, used everywhere: in labels, menus, tooltips, errors and docs.

**The five one-liners**, shown where people meet the concept, in ? tooltips and short helps (`concept-words.ts`), never as a new panel. Compose has the Track; Film has the rest.

- **Track**: what the marbles run on, made of track pieces; each has a hitbox.
- **Skin**: how one thing looks.
- **Theme**: a preset of skins and lights for the whole film; you can still change any part.
- **Decor**: extras you add to the scene; marbles pass through them.
- **Pack**: a file that brings more themes, skins and decor.

No other word stands for these in the UI: not look, preset, style or asset. **Style** stays for what a Title and a Finish do, which is another concept. **From Brass** with its reset, and **Reset to Theme**, read the same on every layer.

Every skin tile, Decor item and theme shows where it comes from as its quiet origin line, with the Pack's name: **Starter**, **Christmas Pack**, **Made by Agent**, **Based on Neon**. Everything comes from a Pack; nothing is called built-in.

| Concept | Word | Not | Why |
| --- | --- | --- | --- |
| The document, as a file | **Project**: New Project, Save, Close Project | session | GarageBand, Logic, Final Cut |
| The film as a whole, selectable | **Scene**: the first row of Layers and its inspector | Project (in the inspector), World, Settings | Blender's Scene Collection and Scene properties; Project stays for the file |
| The music | **Song**: a MIDI file or a recording | source, music, audio file, track | GarageBand calls the whole thing a song; "track" means only what the marbles run on; a MIDI file has parts, in the import sheet too |
| One musical event | **Note**, shown by name: "C4" | event, MIDI note, hit object | Logic's piano roll; keeps notes (music) apart from pieces (things on the wall) |
| An event found in a recording | **Beat**: a note without a pitch | onset, transient, marker | plain music word; "onset" is engine language |
| A hit without a pitch (tapped, placed by hand or a beat) | No Pitch row at all: the hit is timing alone and makes no sound | None, empty field, No Pitch, Add Pitch | a hit has a pitch only when it comes from a MIDI note |
| Where a marble is at a hit's time, on its run line | **Dot**: open in the marble's colour, otherwise in the hit's status colour; a click on an open one shows its platform as an **outline** | ghost (in the UI), marker, landing point | a hit is drawn as a dot on the wall and a diamond in the timeline, and "Hit 4" names it everywhere; **Note N** only for Backing |
| A hit during a rail or switchback ride | **Still Riding**: "Melody is still on Rail 2 at this hit" | | scenery never sounds a note, so no platform can play it there |
| One marble's slice of a MIDI Song, or Backing, only while it has notes | **Part**, in the Song's expanded row and inspector, each with **Sound**, Mute and Solo | track, voice, channel, Instrument | "Solo Bass" hears the slice Bass plays; a marble itself has no sound and no Instrument |
| Notes no marble plays | **Backing**: heard in the film, no piece needed | dropped, unassigned, left out | musicians know a backing track; a beginner reads it as "plays in the back" |
| The ball | **Marble** | ball, lane | |
| A thing in the project with its own row in Layers, most also in the timeline | **Layer**: the Song (only while the project has a song file or Backing notes; the row reads **Song**, its file the subtitle; notices about the file still name it), one layer per marble with its track pieces, Track Pieces (the group of those no marble plays or follows), Wall, Lights, Camera with its shots, Titles, Decor. Each layer owns its settings in the inspector; the Wall and the Lights have no timeline row | track, lane, channel | After Effects: each layer has a row in the timeline, so the sidebar outline and the timeline rows are the same objects under one word |
| The moment a marble strikes its note | **Hit** | contact, strike, collision | rhythm games; the hit has a timing status |
| Everything built for the marbles | **Track**: Insert's heading in Compose. Made of Platform, Rail, Tunnel, Switchback, Windmill and Finish | run (that is the marble's flight line), course, object, prop, asset | marble-run kits |
| One of any kind of them, in the rare case the kind doesn't matter | **Track Piece**; prose after the first mention may say piece. Internal code keeps `piece` | object, element, part | |
| The line a marble flies along | **Run**: "Melody's run", only this | path (a drawn route), trajectory (in the UI) | |
| The piece that plays a note | **Platform** | bar, pad, peg | |
| Other pieces | **Rail**, **Tunnel**, **Windmill**, **Switchback** | scenery | concrete marble-run words; "scenery" is internal |
| The piece that catches a marble after its last note, so the film ends on the catch | **Finish**, one per marble, in two styles: **Chute** (a curved chute that rolls the marble out of the frame, the default) and **Cup** (a bowl that holds it); it plays no note. Its pill reads **Catches**, **Missed**, **Bounces Out** or **Blocked**; the problem reads "Melody misses the Finish" | catcher, end piece, goal, basket | a race's finish; the reference short ends on its chute |
| What dresses the film and never collides | **Decor**: a group in Film's Layers, closed at first, one layer per item, with Position, Scale, Rotation, Depth, In and Out and no Item choice (swapping is delete and insert), and its one section in Insert, whose ? gives the one-liner | decoration (in the UI), prop, ornament, sticker | one short word; internal docs may say decoration |
| Decor in Insert | The **Starter Pack**'s items from the start, then what added Packs bring, each with its origin line, and items the project already has, then **Add Pack…** | Ornaments, Lights, Text | a Pack brings content; the app stays general |
| The Pack every project has | **Starter Pack**: always present and can't be removed; the sheet shows it as **Added**. Themes Pegboard, Brass, Neon; every skin that isn't hidden; the wall skins; **Particles**, **Red Bauble**, **Gold Bauble**, **Gold Snowflake**, **Fairy Light**, **Gift Box**, **Star**, **Handle**, **Subscribe**; origin line **Starter** | built-in, default, core | manifest entries point at what the app draws itself; Gift, Candy and the like stay hidden for a future Christmas Pack |
| Decor that belongs to the frame | **Particles** (Density, Size, Speed, Colour: specks in front of everything, always filling the frame; snow is one colour of it). A layer in the Decor group with In and Out, without Position, Overlaps or Scatter | Snowfall, overlay, effect (in the UI) | what it is; Scatter has nothing to place on the wall |
| A faint text watermark on the wall behind the track | **Handle**, reading "@yourchannel" until typed over in its inspector | Watermark, Username, Logo | what a channel calls itself |
| A small text with an arrow, asking to subscribe | **Subscribe** | CTA, Call to Action, Sticker | the word it shows |
| Filling the free wall the film camera shows | **Scatter Decor…** (Insert, ⌘K): a small panel that asks what to scatter, starting from the last choice, with **Density**, **Scatter** and then **Scatter Again**; a theme brings no Decor. It replaces only what it placed; a scattered item moved by hand is the user's | Auto Decorate, Populate, Fill | says what it does; Scatter is Illustrator's word for it |
| Decor over a marble's run | The amber **Overlaps Melody's path** ("Overlaps Melody's and Bass's paths" with several) as a tip, with **Move Clear** | Collision, Blocked, Warning | it can never change a hit, so it isn't a problem |
| An object added directly in Blender | Its Blender name in the Decor group, with the origin line **Made in Blender**; **Open in Blender** selects it there. The Draft Preview draws a faint outline, and its inspector says "Shows in the Blender preview" | External, Custom Object, Imported, Unmanaged | says where it comes from |
| A drawn route for a rail or tunnel | **Path** | spline, curve, Bézier | Figma's pen draws paths |
| Where pieces sit | **Wall** | canvas, board, pegboard (except as a theme or Skin name) | the 2.5D premise |
| The layer of the wall in Film | **Wall**: its **Skin** (Plain, Plaster, Pegboard, Grid), its **Wall** colour and **Background** colour, each reading **From Brass** until the project changes it, with a reset | Backdrop (later, with Decor), Environment, World | a layer the theme dresses, like a piece's skin |
| The theme's main light | **Key Light**: always there, a layer in the **Lights** group with Colour, Strength, Side and Height; softness, exposure and bloom are a theme's values and Blender's, not panel rows; its subtitle reads **From Brass** or **Changed from Brass**, and **Reset to Theme** gives it back. It can't be deleted | Sun, main light | film lighting's key light |
| A light added to the film | **Light** ("Light 1"), added with Insert's **Light** or **Add Light** in ⌘K: a layer with Colour, Strength, Side and Height, deleted with ⌫ or its row's menu | lamp, sun, fill | "Sun" is Blender's word, in tooltips at most |
| Where a light stands | **Side** (far left to far right of the wall) and **Height** (below to above), as % | azimuth, elevation, direction vector | two plain sliders |
| Lights in the Draft Preview | The ? says "Shows in the Blender preview" | | The Draft Preview draws no light |
| Compose's flat, free view of the wall | **Wall** (the only view in Compose; the film camera shows only in Film's Draft Preview) | Wall View, Orbit, Camera view, viewport | Figma's canvas: it stays where the user put it |
| Framing the Wall view | **Zoom to Fit** (⇧1): the run, or on a run too long to read whole the section around the playhead; **Zoom to Whole Run**: all of it, however small; **Zoom to 100%** (⌘0): physical size | Fit All, Home, Actual Size | Figma's zoom commands |
| A range of the song played again and again while editing | **Repeat Range**: the Repeat toggle in the transport (C) and in Playback. The range appears on the ruler only while it is on. A preview only, never in the film or the project | Cycle, Loop Playback, region | plain word for the Loop button of video editors |
| The Wall view keeping the marble at the playhead in sight | **Follow** (toggle in the canvas corner, F; in ⌘K **Follow Marble in View**), off by default | Catch Playhead, autoscroll, track, lock | Logic's Catch Playhead; the noun is a toggle like Snap, and the palette title says *in View* so it never reads as the piece tie **Follows** |
| Hearing the song while dragging the playhead on the ruler | **Audio Scrubbing** (toggle in the View menu and ⌘K), on by default | Skimming, Scrub, Audio Preview | Logic's Scrub and Final Cut's audio skimming; the two words say what it is without a third name |
| A platform tied to its note | **Plays** Hit 3 · C4 | linked, attached, bound | says what it does; Final Cut's connected clip is the model |
| A platform a drag left away from its dot | Still **Plays** Hit 3 · C4, with the timing it gets there (**12 ms Late**, **Missed**); the drag chip reads "Plays Hit 3 · C4" with that timing, or "Detaches Hit 3 · C4" past 25 cm from its note. **Re-place** or A puts it back on its note; a drop on its dot does too | pinned, off-note, Moved | a drag never drops the tie silently; the notice says "Platform 3 no longer plays Note 3 · C4" · Undo when one does |
| A piece tied to a moment of a marble's fall | **Follows** Marble 1 at 0:03.2 | anchored, parented | says what it does |
| A piece tied to nothing | Link state **None**, shown only as its subtitle; it sits in the **Track Pieces** group, whose ? says "Parts of the track no marble plays or follows; marbles can still hit them". Its menus offer **Play a Note…** and **Follow a Marble…** | Free, Free Pieces, unlinked, static | A piece always collides; only its link is missing |
| What a marble touches | **Hitbox**: drawn in Compose, shaped in the inspector's Hitbox panel (Arms, Run Height, Thickness…), outlined in Film for a selected piece | collider, physics shape | Unity's collider and mesh; the Skin is the mesh |
| How a piece behaves | **Physics**: the inspector's panel beside Hitbox (Bounce, Brake, Spin) | Advanced, material, restitution | Named by what it holds |
| Every piece's outline in Film | **Show Hitboxes** (View menu, ⌘K) | Show Colliders, Gizmos, Debug Physics | Unity's collider gizmos |
| Undoing those ties | **Detach** | unlink, unanchor | one verb for both |
| A copy of pieces | **Duplicate** (⌘D): copies tied to nothing, on the nearest spot clear of every marble's path and every piece. Without one nearby the notice ends ", beside the run: no free spot near it"; when every spot would break hits nothing is copied: "Every spot for a copy of Platform 1 would break 3 hits, so nothing changed" | clone, copy | Figma and Finder: a copy changes nothing else |
| The two workspaces | **Compose** ("Compose: hitboxes and timing") and **Film** ("Film: skins, camera and titles", and export) | Design, Build, Look | "Film" names what you make; camera and export belong there |
| Inspector with nothing selected | **Scene**: in Film the Theme row and **Format**; in Compose **Gravity**, each in one panel, as a one-field section has no title of its own | World, Settings, Document, Project | an empty selection is the Scene: an empty click or Esc selects it |
| How fast marbles fall | **Gravity**, in Compose's Scene, with the tooltip "How fast all marbles fall. Lower gives smaller hops and a denser track; hits stay on time."; ⌘K still finds it by "marble speed" | Marble Speed, physics scale | what it is |
| The shape of the film | **Format** in Film's Scene: 9:16 Portrait, 1:1 Square, 4:5 Portrait, 16:9 Landscape; ⌘K finds it by aspect, portrait, square | Frame, Aspect, Resolution | Blender's Output › Format |
| The camera's angles and following | **Tilt** (never Pitch, which is a note), **Distance**, **Sway**; **Look Ahead** and **Smooth** under **Advanced**; the **Automatic** or **Manual** switch alone takes the camera over | Pitch, Lead, Take Over Camera | Pitch means a note here |
| The output | **Film**; the action **Export Film…** | render, video, encode | Final Cut's Export File; "render" only in progress text |
| Render quality | **Draft**, **Standard**, **High**, **Best** with what sets each apart as detail: "Draft · 720p · Flat Light", "Standard · 720p", "High · 1080p", "Best · 1080p · 60 fps" | fast, balanced, Eevee, Workbench, samples | Blender names only in tooltips |
| How long a film is | minutes and seconds ("0:35"), never a frame count; frames appear only in render progress. The **length** is the second time in the transport: a click types it, and the ruler's end marker drags it. **Fit to Song** is on the ruler's menu and in ⌘K, dimmed while the length already fits the tail rule | frames, 1051 frames, Length row | Logic's end marker |
| Where an exported film goes | **In the Project**, or the folder chosen with Choose… | Renders folder, renders/ | the package folder is an implementation detail; Show in Finder finds it |
| Blender | **Blender**: a button in the title bar with its logo and the word Blender. The logo is Blender's orange when ready and while working, where it pulses subtly and adds the word; red on error; neutral grey when not installed; never green; the state (Ready, Starting, Rendering Preview, Not Installed, Error) is in its tooltip and menu and shows on the button only while working (Starting, Rendering Preview); the menu has Open in Blender, Restart Blender, Live Preview, Show Blender Log, or Install Blender… | worker, bridge, mailbox, Edit in Blender | |
| Changed in Blender | **Detached** with **Discard Blender Changes**; a camera edited there reads **Edited in Blender** with **Reset Camera** | unlinked, taken over, edited, Reset to Compose, Regenerate Camera | says what the button throws away |
| The project's outline | **Layers**: Song, Marbles, Track Pieces, Wall, Lights, Camera, Titles; Compose shows the Song and the marbles with their pieces, Film every layer, with the marbles and Decor closed until opened or until something in them is selected | tree, scene graph, Tracks | Figma; the timeline's column carries the same name |
| Settings most people never need | **Advanced**, a disclosure at the end of a section | expert, more, details | Final Cut, Logic |
| How a film is lit and rendered | **Lighting**: Fast or Realistic (Eevee and Cycles in the tooltip); Draft always uses **Flat Light** (Workbench in the tooltip), so the Lighting choice is dimmed with it | renderer, engine | |
| The film's one set of skins and lights | **Theme** (Pegboard, Brass, Neon): wall, light, marble and a default skin per piece type; it only restyles what is there and never adds Decor | style, material, look | |
| Colour from the note on every platform | **Colour › By Note** on a platform's skin | Colour by Note command, theme option | one place for it |
| A theme the project holds | **Theme** like any other, an item in the Theme picker; its origin line reads **Based on Neon** (or **Made by Agent**, or its Pack's name). Internally a project theme | custom theme, my theme, In This Project, fork | Finder's copy names; the one-library rule keeps storage words out |
| Colours on layers | **Wall** and **Background** on the Wall layer, **Colour** on a light, **Glow Colour** on a skin, as colour wells; an unset well shows the theme's colour and reads **From Neon** in grey, normal case, with a reset once set; every well is outlined and named for screen readers ("Wall colour"). A theme has no wells of its own | override, tint, world, emission | |
| Keeping a look | **Export Pack…** (File menu and the bottom of the Theme picker): asks for a name and always includes the current look as a theme under that name, plus any skins and decor ticked | Save as Theme, Duplicate Theme, Duplicate to Edit, Export Theme, Save Look | one action; no edit-theme concept in the UI |
| Changes on top of a theme | Made on the layer itself: **From Brass** with its reset. Picking a theme restyles everything except these. The Theme row counts them, **Brass · 3 changes**, with a small Reset that clears them as one undo step, with the notice's Undo | Edit Theme, overrides | a theme has nothing to edit |
| Removing a project theme | **Delete Theme**; the notice says "Neon Copy deleted; the film uses Neon again" when it was in use | Remove Theme | |
| What you add: the track, a marble and the song in Compose; titles, Decor with Scatter Decor…, a light, a shot, then the song and a marble in Film | **Insert**, the + of the tool rail (⇧I), the one place, with ⌘K and the menu bar's **Insert** menu listing the same; skins and themes are in the inspector's pickers | Add menu | | assets, Library tab, Show Library | Paper's insert button, Figma's Assets; one place in both workspaces |
| Decor the agent made or you imported | In Insert's Decor section, each item with its origin line; **Library** is where they are kept | My Library, In This Project | no storage scopes |
| Making an item available in every project | **Keep in Library** (star) | save to My Library, publish | |
| An item the project uses | **In Use** badge | applied, local | |
| Where an item comes from | **Starter**, **Christmas Pack**, **Made by Agent**, **Imported**; a theme tile reads **Based on Neon** | scope, source, built-in | |
| A file of more content | **Pack**, added with **Add Pack…** (a sheet of cards, with **Add**, **Remove** and **Import from File…**) and made with **Export Pack…**; adding one changes nothing visible in the project. The notice: "Christmas Pack added: 1 theme, 4 skins, 8 decor items. Nothing in your project changed." An item whose Pack isn't on this Mac reads **Christmas Pack · Not Added** | theme file, bundle, asset pack, Import Pack… | |
| Images and words for a film's look | **References**, in `agent/references` and `get_state`, with no UI; an agent stores them with `set_references` | moodboard, inspiration | what art directors call them |
| How much the camera turns and rolls on its own | **Sway**, a percentage in the Camera layer's inspector; 0 % keeps the wall upright | wobble, drift, Steady | names what you see |
| An edit an agent made | **Agent: Place Platform**, in Undo and its notice | AI, bot, MCP step | says who did it and what |
| Adding MidiMarble to an agent app with one click | **Connect Claude Code**, **Connect ChatGPT and Codex**, each reading **Disconnect …** while that app lists this copy of MidiMarble; in the Agent menu, the Help menu and ⌘K. Success: "Connected. Start a new session in Claude Code." ChatGPT and Codex are one row because they share one config | Install, Set Up, Pair, Add Server, AI Workspace | Paper's and Figma's word; it says what happens and what it undoes |
| The command for any other app | **Copy Command for Other Apps**, whose notice says to add it as a local stdio MCP server | Copy Config, Manual Setup | says what lands on the clipboard |
| The connection for AI apps | **Connect** (above), **Enable MCP**, **Show Agent Folder**, in the Agent menu | server, integration | MCP is named only in Enable MCP, its off state **MCP is off**, and the notice that describes the copied command |
| Who is connected | **Claude Code connected**, **Claude Code and Codex connected**, **No agent connected**: the Agent menu's first line, with the app's product name | client, session, online | |
| An agent at work | **Agent · Placing Platform 12** with **Stop**, at the top of the canvas; the Agent button reads **Working**; after Stop, **Agent · Stopping** | AI is thinking, running tool | says who and what, like a collaborator's name in a shared file |
| A piece's or marble's appearance | **Skin**, named by what it is, free of themes: **Gold**, **Copper**, **Silver**, **Pegboard**, **Neon**, **Chrome Rail**, **Wood Rail**, **Glow Rail**, **Frosted Tunnel**, **Gold Windmill**, **Chrome Finish**; a project's own such as **Gift**, **Candy Rail** or **Device** shows only while the project uses it, with its origin line; the theme's own reads **Theme Default** on its tile and "Skin · From Brass" in a pop-up | asset, mesh, model, Brass Copper | |
| A marble's skins | **Glass** (a play marble, Variant **Swirl** or **Cat's-Eye**), **Metal** (a chrome ball bearing), **Magic** (drifting glowing smoke in glass). **Theme Default** picks **Pearl** or **Deep**, whichever stands apart from the wall | | |
| A marble's colour | **Colour** in its inspector, in both workspaces: one colour for the timeline, Compose and skins whose Colour is **Marble**. A skin with a fixed colour declares it, in its manifest or the Starter catalog, and a marble given that skin takes it on: **Set by Green Glass**. Picking a theme never changes a marble's colour, as it tells marbles apart | lane colour, tint | never two colours that disagree |
| A skin's settings | **Colour** (**Skin**, **Marble**, **By Note**), **On Hit** (**None**, **Press**, **Wobble**, **Glow**), **Glow Colour**, **Variant**, at most about five with a skin's own such as Gift's **Ribbon Colour** | Reaction, Tint, Emission, Style | Shopify's theme settings: the same names on every skin |
| What a skin does on a hit, in prose | **Reaction** (the row reads On Hit) | animation, driver | |
| Back to the theme | **Reset to Theme**; the first tile of a skin picker is **Theme Default** | Clear Skin, Default | |
| The section of a selection's skin and properties | **Skin**: one row, the skin's small picture and name with a chevron, then the skin's properties as compact rows | Look, Appearance | one word for the concept |
| Choosing a skin or a theme | A floating **picker**, the same panel as Insert, with pictures and origin lines, inside the canvas area, scrolling inside its frame; **Theme Default** on top, a search past about 12 items, ⌥-click for all of a type, closed by a pick or Esc, **Add Pack…** at its bottom | tile grid in the inspector, drawer | Figma's fill and asset pickers |
| Text on the wall | **Title** | wall text, label | the reference films call them titles |
| How a title sits in the film | **Style**: **Wall Title** (on the wall where it was placed), **Caption** (top of the frame, 3 s from the playhead), **Song Name** (upper third of the frame over the first 3 s, reading the song's name) and **End Card** (centre of the frame, over the last 3 s) | overlay, HUD, lower third | Caption, Song Name and End Card stay in the frame while the camera moves, on a soft dark backing; their Size is a share of the frame height in %. Choosing a style sets its times while they are still the last style's own, like a title preset in Final Cut |
| When a title shows | **In** and **Out** in a Timing section, times as m:ss.cc; clips on the Titles layer's row in the timeline in Film | start/end, keyframes, duration | Final Cut's In and Out points; a Wall Title's defaults are the start and the end of the film |
| Which preview the film canvas shows | A **Draft** or **Blender** switch on the preview itself, Blender's viewport shading; Blender renders the real look at the playhead in the background and reads **Flat Light** or **Fast** beside the switch; ⌘K calls it **Blender Preview** | the ruler's **render bar** says "Blender preview rendered" and "Rendering preview…" | background render, cache, proxy frames | Final Cut's background render and render bar |
| The in-app stand-in for Blender's render | **Draft Preview** with the help "Blender draws the real look. This preview follows the same camera." | proxy, fallback, mock | Final Cut's proxy playback, named for what it is |
| A camera change at a time | **Shot** (Wide, Follow, Push In, Close-Up) | marker, keyframe | film language |
| How long a shot frames before the camera eases back | **Hold**, in seconds; **To Next Shot** at 0 | length, duration | a held shot in film language; Push In and Close-Up hold 2 s by default |
| The agent | **Agent**, for the person's own AI app (Claude Code, Codex, Claude, by name in the Agent menu) | AI, assistant, bot | |
| Ending an agent's work | **Stop**; what it did stays | Cancel, Abort | Cursor's and ChatGPT's word |

## Timing statuses

One status per hit, shown as a pill on pieces, in the inspector header and on the marble's row in the timeline. Colour is never the only signal; each status has an icon.

| Status | When | Tooltip |
| --- | --- | --- |
| **On Time** | within 5 ms of the note | "Marble 1 hits C4 on time" |
| **12 ms Early** / **12 ms Late** | 5 to 20 ms off the note; a filter or count that covers both says **Early or Late** | "Lands 12 ms after the note" |
| **Missed** | the marble does not reach the platform | "Marble 1 passes the platform without touching it" |
| **Blocked** | the marble's own run already passes through the platform's spot earlier | "Melody already passes through this spot earlier in its run" (name the marble) |
| **Stopped** | the marble comes to rest on the platform | "Marble 1 stops on this platform" |
| **Open** | the note has no platform yet | "No platform plays this note yet" |
| **Too Soon** | an open note before the marble's release, or so soon after it that the marble cannot fall its diameter and reach strike speed | "Marble 1 can't reach a platform by 0:01.00" |
| **Out of Reach** | an open note after the marble fell out of the run, or while it lies still on a piece; never while an earlier note of the same marble is still Open, since that note is the next step and the ones after it stay Open | "Marble 1 has fallen off the track by 0:06.00", "Marble 1 lies still on a piece at 0:03.00" |

Too Soon and Out of Reach are drawn hollow with an amber dashed outline and count as needing attention. Their fixes are **Move Release Earlier** (Too Soon: the release moves 0.5 s before the note, never before the song starts) or **Move Release Later** (Out of Reach on the marble's first note), **Move Hit Later** (a Too Soon tapped hit whose release cannot move earlier: the hit moves to the first moment the marble can strike), and **Make Backing**; a fix that does not help is not offered. Make Backing needs a song: Backing notes show only on the Song layer, so in a project without a song (tapped hits) it is not offered, and **Delete Hit** takes its place.

A summary sits in the timeline header for the whole project, read from the same problem list as the export sheet, Layers and the Camera layer, like Xcode's issue count: "12 of 12 hits on time", "2 hits need attention", or "107 of 109 hits on time · 4 other problems" when extra strikes, collisions, Blocked scenery, or framing need a look. Open notes count toward the total only. It reads **Checking…** (dimmed, with a spinner) until the run for the latest edit arrives, never a stale count, and **Re-placing…** while Re-place runs. A click goes to the first problem in time order (**Show First Problem**, also in ⌘K). Its menu (the chevron or a right-click) lists every problem in time order, scrolling when the list is long, then Show First Problem and the Re-place fix under its one label (**Fix 24 Hits**), then **Show Last Fix** after a Re-place and **Fit to Song** where the user set a length the song no longer matches. Framing problems also show as amber spans on the Camera layer's row; they open Film at their time with the Camera selected.

## Fix-its

A fix sits next to the problem, like Xcode's Fix-its.

| Action | Where | Meaning |
| --- | --- | --- |
| **Undo** | in every notice that reports an edit, like Mail's and Finder's undo toasts | takes back that edit, one undo step with what folded into it (a placement with its tie and the tilt Auto place refines a moment later), while it is still the latest; ⌘Z in the tooltip |
| **Fix 24 Hits** | in the notice of an edit that left hits Blocked, Missed or Stopped (or "3 hits are now Blocked, Missed or Stopped" when the edit had no notice), and with the same label in the hit summary's menu; ⌘K lists it as Re-place Broken Platforms | runs Add Platform's Auto place again from the first broken hit onward, as one undo step (Re-place). The label is a verb and the count, like Figma's quick actions: it counts the broken hits, which are known before it runs (**Fix Hit 7 of Melody** for one). A moved release and Blocked scenery fixed along with the hits are named in the tooltip, never in the label; Blocked scenery alone takes its fix as the label: **Move Windmill 1 Clear**, **Place Rail 1 Again** or **Delete Rail 1**, as its what-if found. The tooltip is one sentence of about 15 words saying what it does: "Re-places platforms so each hit lands on time, moves the release of Melody and deletes Rail 1". The result notice is two lines at most: "Fixed 37 hits · re-placed 13 platforms · moved the release · deleted Rail 1 · 108 of 108 hits on time" · **Details** · Undo, where Details opens the full result: "Melody now starts just before its first note. Re-placed 13 platforms, placed Switchback 3 and Rail 3 again, deleted Rail 1, which the new run passes through and no longer uses, and fixed all 38 broken hits: 108 of 108 hits on time · 2 other problems". It stays until it is closed or the next edit, and the hit summary's **Show Last Fix** shows it again. Counts in the full result read "fixed the broken hit", "fixed both broken hits", "fixed all 38 broken hits", "fixed 37 of 38 broken hits"; in the notice "Fixed the hit", "Fixed 37 hits", "Fixed 37 of 38 hits" |
| **Re-place** | the wand beside a Blocked, Missed or Stopped platform's status pill in the inspector header; beside a **Hit by Bass** pill on a platform | Auto place again for that platform alone; for Hit by Bass, for Bass's platform before the hit, so Bass passes clear |
| **Hit Twice**, **Touching** | the pill and the amber Layers badge of a platform its marble strikes outside its note, or of a piece closer to another than the film allows; the button beside them is **Re-place** or, when any small change moves the hits after it, **Rebuild From Here** | a shorter length, a strike further along it, a small turn, then Auto place, each kept only when it clears the piece and breaks no hit |
| **Fix 3 Platforms** | the hit summary's menu when nothing but those problems is left | that Fix for each piece, as one undo step |
| **Rebuild From Here** | the Track menu, a hit's right-click menu, a piece's right-click menu, ⌘K, `build.track {from: hitId}` | keeps everything up to that hit on every marble and builds the rest again, as one undo step, so a hand edit steers the track |
| **Add Wide Shot Here** | in the Camera panel under the framing problem at the playhead, where a jump to the problem lands, and in ⌘K | adds a Wide shot from 1.5 s before the problem to 0.5 s after it, which frames the marbles together. Its what-if bakes the camera with the shot first; it is offered only when the marble stays in frame and fewer framing problems remain. Tooltip: "Adds a Wide shot at 0:07.53 that holds 6.6 s, so Bass stays in frame." |
| **Move Clear**, **Place Rail 1 Again**, **Delete Rail 1** | the one Fix-it beside the Blocked or **Hit by Bass** pill of a piece that follows a marble (windmill, switchback, rail, tunnel), and inside Re-place | its what-if runs as soon as the piece shows (the button reads **Checking…**) and the button names the first fix that breaks no hit and adds no problem: a bridge of a long gap suggested again for its gap, a nudge the shortest way off the marble's earlier run and the other marbles' runs keeping what it follows, or deleting a Blocked piece, which the run leaves out and so never uses. When nothing passes, the button is dimmed with the reason as its tooltip: "Moving Windmill 1 clear would break a hit, so nothing changed. Drag it by hand or Detach it." A fix that would refuse is never offered |
| **Place Finish Again** | the Fix-it beside a Finish's Missed, Bounces Out or Blocked pill | Add Finish's search again for that marble, keeping the Finish's name, style and skin; its what-if runs first and the button names why when nothing catches the marble |
| **Stop** | in the Re-place progress notice | keeps what is re-placed so far |

## Assists

| Action | Shortcut | Meaning |
| --- | --- | --- |
| **Add Platform** | click an open note's dot to see it, then click again or ↩; A or N at once | places a platform tilted so the marble lands on time. Until then it is only an outline, dashed, with its hint "↩ Add platform". A long-gap dot shows its Switchback or Rail the same way and a dot no platform can reach says why, as N does; a right-click on a dot has every choice: Add Platform at Default Tilt, Add Switchback, Add Rail, Add Tunnel, Go to Note |
| **Place Next Platform** | N | adds the platform for the next open note |
| **Build Track** | ⇧N, on the build bar and in the hit summary's menu | builds every open note of every marble in time order and ends each in a Finish. Its notice reads "Building track · 42 of 115 hits · about 40 s left" with Stop, then "Built the track: 115 of 115 hits on time, 129 pieces." or "Built what fits: …" naming the hits that need attention |
| **Continue Pattern** | Tab | repeats the pattern of the last platforms for as many notes as fit; the button shows the count: "Continue Pattern (4)" |
| **Mirror Last Platform** | M | the last platform's tilt mirrored, for zigzags |
| **Repeat Last Platform** | R | the same tilt again |
| **Add Finish** | in the hit summary's menu while a marble that plays last has no Finish (**Add Finish for Bass** when several do), and in ⌘K | places a Finish on the marble's fall after its last note that what-if runs found to catch it, break no hit and touch no other marble or its pieces |

## Piece settings

The Hitbox and Physics panels name what a piece looks like or does, not how it is built. A half-width field carries the short name; the tooltip says the rest.

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
| Finish | **Style** (Chute, Cup), **Mirror** | which finish it is, and which side the backstop stands on | Type, Flip |
| Finish | **Size**, **Run-Out**, **Thickness** | the curve that catches the marble, the length of the Chute's run-out, how thick the rails are | radius, exit, length |

## Capitalization and punctuation

- **Title Case** for buttons, menu titles and items, tabs, segmented controls, window and sheet titles, inspector section titles, layer names in the timeline and status pills: "Export Film…", "Place Next Platform", "On Time"
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
| Toggle | State noun | Snap, Follow, Audio Scrubbing, Mute, Solo (on the Song and its Parts, never on a marble), Loop Playback |
| Tooltip | What it does + shortcut | "Add a platform for the next note (Return)" |
| Empty state | What is missing, one line, plus the action | "No song yet" · Import Song… |
| Error | What happened. What to do. | "Blender isn't installed. Install Blender 4.2 or later to preview and export films." |
| Progress | What is happening, how far, how long. "How far" counts against one total fixed when the task starts; "how long" appears only once the rate is steady and then counts down like Finder's copy, never rising or jumping | "Exporting film · frame 120 of 600 · about 3 min left", "Re-placing platforms · 12 of 37 broken hits fixed · about 10 s left" |
| Notice | At the bottom left of the canvas, above the transport, in both workspaces; first-run hints wait while one shows. What happened, one line (two at most), then its actions; the default action first. Longer text goes behind **Details**, like Figma's notifications. A notice with a fix or Details stays until it is used or closed, or the next edit; one with only Undo times out | "6 platforms removed: Backing needs no platform" · Re-place 45 Platforms · Undo; "Copper applied to 5 platforms; Rail 1 kept its skin" · Undo when a skin skips pieces of another type, or "Copper applied to 1 platform. It keeps Copper's colour with Colour by Note" when Colour by Note is on |
| Unreachable note | What happened. What to do, naming the fixes. | "Hit 1 is too soon for Marble 1. Move the release earlier or make it Backing." |
| Fix result | In the notice, what it fixed and changed in a few words, then how the run stands, as the hit summary says it: "Fixed 37 hits · re-placed 13 platforms · deleted Rail 1 · 108 of 108 hits on time". Behind Details, every change by name, then what the fix added | "Melody now starts just before its first note. Re-placed 15 platforms and fixed all 45 broken hits: 109 of 109 hits on time", "…: 108 of 108 hits on time · 1 new problem: Rail 1 of Melody is Blocked" |
| Problem | The thing, then its state; a hit by its number on its marble; distances in cm | "Hit 12 of Melody is Blocked", "Melody misses the Finish", "Rail 1 of Melody is Blocked", "Bass leaves the frame at 0:09.03 (9 hits)" with "Out of frame for 4.6 s while it plays, until 0:13.67. The camera follows Melody there.", "Bass hits Switchback 6 of Melody", "Melody hits Platform 12 twice" with "Hits it 2 times from 0:12.30, with one note.", as a tip "Platform 12 touches Platform 13" with "0.8 cm apart in the film, where skins reach below the hitbox." |
| Confirmation | Question naming the thing + the action as the button | "Delete Marble 2 and its 12 hits?" · Delete · Cancel |

## Structure

### Layers in the timeline

The timeline's left column is **Layers**, the timed layers of the sidebar's Layers tab in the same order, each with its row along the time (the Wall and the Lights are not timed, so they stay in the sidebar):

1. **Song** at the top, only while the project has a song file or Backing notes: the song's file name and kind ("MIDI · 120 BPM" or "Recording · 0:35"; "Song" and "Backing · 12 notes" without a file). A new project has no Song layer; **Song…** in Insert imports one. A song with notes expands to its piano roll and its **Parts**; a recording stays one row with Mute and Solo and its waveform, the hits drawn on it as ticks in their marbles' colours. Deleting the Song layer removes the song file and Backing, never the marbles' hits. A song with notes expands into a piano roll of every note, coloured by the marble that plays it, Backing in grey; notes drag there in time and in pitch. Selecting notes and pressing 1 to 9 hands them to that marble, 0 makes them Backing; the context menu says "Play With ▸ Marble 1 … · New Marble · Backing". A recording shows its waveform and its beats
2. **One layer per marble**: the marble's name and hit count, its hits in a flat row with their timing status; it has no sound, Mute or Solo of its own, it never expands, and a hit's pitch is edited in its inspector or the Song's piano roll
3. **Camera** in Film: shots
4. **Titles** in Film, when the project has titles: one clip per title from its In to its Out time

A note belongs to exactly one place: a marble, or Backing. A platform exists to play its note, so it goes with it: handed to another marble, the platform plays the note in that marble's run; handed to Backing, the platform is removed. A notice says which, and undo brings it back. (Leaving it on the wall tied to nothing would put an obstacle in every marble's path.)

### Inspector headers

"Platform 3" with the subtitle of its tie: "Plays C4 · 0:03.2", "Follows Marble 1 at 0:03.2" or "None", and the status pill on the right.

### Start screen

Actions: **New Project** (it opens at once, unsaved; the first Save asks where to keep it), **Import Song…** (MIDI or recording, one picker), **Open Project…**. Examples below them: Songs and Techniques. Opening an example opens it unsaved under its own name, like an untitled document, so Recent does not fill with copies. A saved project autosaves within a second of every edit, so its title shows no edited dot; a failed save shows a red **Not Saved**. **Save As…** (⇧⌘S) saves a copy of a saved project and keeps working on the copy; the menu bar's File menu also has **Open Recent** with **Clear Menu**, and Help has **MidiMarble Help** for Quick Help, as in every Mac app. An unsaved example's title says **Not Saved** once it has changes; Save asks where to keep it in a save panel titled "Save Jingle Bells" (File > New's panel is titled New Project), and closing it with changes asks "Save changes to Jingle Bells?" · Save… · Don't Save · Cancel.

## Beginner path

1. The start screen shows examples first-class; an example plays on Space at once
2. Quick Help (Help › MidiMarble Help, ⇧⌘/, ⌘K) labels the regions of the window in place, like GarageBand's Quick Help; it is optional and never modal
3. At most three one-line hints appear once, where the next step is, and disappear when done: "This is your song: each marble plays some of its notes" (Song layer) → "Press ⇧N to build the whole track, or click a note's dot to see its platform" (first open dot) → "Switch to Film to choose the look and export" (after the first full run)
4. The hit summary in the timeline header says when the run works: "12 of 12 hits on time"

## Progressive disclosure

- The selection decides what the inspector shows; nothing selected shows the Scene
- ⌘K finds layers and settings by name and everyday word (wall: warm; Camera: closer, sway; Format: aspect; Song: solo; Particles: snow)
- Each section shows its everyday controls; technical ones sit under the section's Advanced disclosure, which remembers its state
- Technical names (Eevee, samples, focal length, restitution) appear only in tooltips or under Advanced
- No Beginner or Expert mode; the same features in the same places, density grows on demand
- Failing hits are always visible, whatever is collapsed
