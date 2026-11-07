import { useFeatureState } from 'feature-react/state';
import { AudioLines, ChevronDown, ChevronUp, FileMusic, Globe, Sparkles, Type } from 'lucide-react';
import React from 'react';
import { HelpTip, InspectorHeader, LinkRow, Panel, ReadoutField, ScrubField, SelectField, SliderField, StatusPill, TextField } from '@/components';
import { PieceIcon } from '@/modules/canvas';
import { unreachableActions, GroupInspector, PatternRangeInspector, FixButton, PieceInspector, timingStatus, auditionNote, handNotes } from '@/modules/track';
import { canMakeBacking, hitReach, isUnreachable, releaseFixFor, unreachableStatus } from '@/modules/building';
import { CameraInspector, FormatField, PieceSkin, ShotInspector, WallTextInspector, MarbleSkin, ThemeRow, DecorInspector, MadeInBlenderInspector, ScatterPanel, KeyLightInspector, LightInspector, WallInspector } from '@/modules/film';
import { THEME_HELP } from '@/modules/scene';
import { autoLevelLabel, DEFAULT_BACKING_INSTRUMENT, DEFAULT_HIT_VELOCITY, findMarbleConflicts, formatLevel, instruments, LEVEL_CHOICES, marbleSounds, melodyMarbleId, MIN_HIT_GAP, BACKING_COLOR } from '@/modules/music';
import { BACKING_ID, type THit, type TMarble, type TMarbleSong, type TProject, type TVec2, formatSignedTime, formatTime, parseSignedTime, noteName, parseNoteName, stepPitch, KEY_LIGHT_ID, parseHitKey, parseTime, backingSong, backingOf, marbleSong, shownSongs, tiedToSong, tieLabel, tieOf } from '@/modules/project';
import { getPieceDefinition } from '@/modules/simulation';
import { inspectorTarget, type TInspectorTarget } from './inspector-target';
import { moveMarbleStart, withMarbleStart } from './marble-start';
import { SONG_LAYER_LABEL } from './song-layer';
import type { StudioCx, TWorkspace } from './StudioCx';

/**
 * Properties of the selection, like Figma UI3's properties panel: a header row and sections for the selected layer, or the Scene without one. Each layer owns its settings: the
 * Song its file and Backing, the Camera its frame and rig, a marble, a piece, a hit, a shot or a title their own.
 */
export const Inspector: React.FC<TInspectorProps> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const selection = useFeatureState(cx.$selection);
	const workspace = useFeatureState(cx.$workspace);
	const project = history?.present;
	if (project == null) return null;
	const target = inspectorTarget(project, selection, workspace);

	return (
		<aside className="mm-inspector" aria-label="Inspector" data-quick-help="inspector">
			<div className="mm-insp-scroll">
				<TargetInspector cx={cx} project={project} target={target} workspace={workspace} />
			</div>
		</aside>
	);
};

/** The inspector of the selected layer; Track and Film differ only in what a piece shows (shape or skin) */
const TargetInspector: React.FC<{ cx: StudioCx; project: TProject; target: TInspectorTarget; workspace: TWorkspace }> = (props) => {
	const { cx, project, target, workspace } = props;
	const isFilm = workspace === 'film';
	switch (target.kind) {
		case 'pieces': {
			if (!isFilm) return <PieceInspector cx={cx} project={project} ids={target.ids} />;
			const pieces = project.track.pieces.filter((piece) => target.ids.includes(piece.id));
			return <PieceSkin cx={cx} project={project} pieces={pieces} />;
		}
		case 'hits':
			return <HitInspector cx={cx} project={project} hitKeys={target.keys} />;
		case 'group':
			return <GroupInspector cx={cx} project={project} groupId={target.id} />;
		case 'patternRange':
			return <PatternRangeInspector project={project} target={target} />;
		case 'title': {
			const title = project.film.titles.find((item) => item.id === target.id);
			return title == null ? null : <WallTextInspector cx={cx} project={project} piece={title} />;
		}
		case 'titles':
			return <InspectorHeader icon={<Type size={16} strokeWidth={1.7} />} title={`${target.ids.length} titles`} subtitle="Multiple selection" />;
		case 'shot': {
			const shot = project.film.camera.shots.find((item) => item.id === target.id);
			return shot == null ? null : <ShotInspector cx={cx} project={project} shot={shot} />;
		}
		case 'marble': {
			const marble = project.marbles.find((item) => item.id === target.marbleId);
			if (marble == null) return null;
			return (
				<>
					<MarbleInspector cx={cx} project={project} marble={marble} isFilm={isFilm} />
					{isFilm ? <MarbleSkin cx={cx} project={project} marble={marble} /> : null}
				</>
			);
		}
		case 'song':
			return <SongInspector cx={cx} project={project} songId={target.id} />;
		case 'camera':
			return <CameraInspector cx={cx} project={project} />;
		// Lights and Decor belong to Film; inspectorTarget shows the Scene for them in Track
		case 'wall':
			return <WallInspector cx={cx} project={project} isFilm={isFilm} />;
		case 'light': {
			if (target.id === KEY_LIGHT_ID) return <KeyLightInspector cx={cx} project={project} />;
			const light = project.film.lights.added.find((item) => item.id === target.id);
			return light == null ? null : <LightInspector cx={cx} project={project} light={light} />;
		}
		case 'decor': {
			const decor = project.film.decor.find((item) => item.id === target.id);
			return decor == null ? null : <DecorInspector key={decor.id} cx={cx} project={project} decor={decor} />;
		}
		case 'decorItems':
			return (
				<>
					<InspectorHeader icon={<Sparkles size={16} strokeWidth={1.7} />} title={`${target.ids.length} Decor Items`} subtitle="Multiple selection" />
					<ScatterPanel cx={cx} />
				</>
			);
		case 'madeInBlender':
			return <MadeInBlenderInspector key={target.name} cx={cx} project={project} name={target.name} />;
		case 'scene':
			return <SceneInspector cx={cx} project={project} isFilm={isFilm} />;
	}
};

interface TInspectorProps {
	cx: StudioCx;
}

// MARK: - Marble

const MarbleInspector: React.FC<{ cx: StudioCx; project: TProject; marble: TMarble; isFilm: boolean }> = (props) => {
	const { cx, project, marble, isFilm } = props;
	const conflicts = findMarbleConflicts(marble).size;

	const release = marble.start;
	const releaseAt = (patch: Partial<TVec2>): TMarble['start'] => ({ ...release, position: { ...release.position, ...patch } });
	function previewRelease(patch: Partial<TVec2>): void {
		cx.simulation.startPreview({ ...project, marbles: project.marbles.map((item) => (item.id === marble.id ? { ...item, start: releaseAt(patch) } : item)) });
	}
	function commitRelease(patch: Partial<TVec2>): void {
		cx.execute([{ type: 'updateMarble', marbleId: marble.id, patch: { start: releaseAt(patch) } }]);
		cx.simulation.endPreview();
	}


	return (
		<>
			<InspectorHeader
				icon={<span className="h-3 w-3 rounded-full" style={{ background: marble.labelColor }} />}
				title={marble.name}
				subtitle={`Marble · ${marble.hits.length} ${marble.hits.length === 1 ? 'note' : 'notes'}`}
				onRename={(name) => cx.execute([{ type: 'updateMarble', marbleId: marble.id, patch: { name } }])}
				status={
					conflicts > 0 ? (
						<StatusPill tone="bad" label={`${conflicts} Too Close`} detail={`${conflicts === 1 ? 'A note is' : `${conflicts} notes are`} less than ${MIN_HIT_GAP * 1000} ms from the next one. Drag them apart or move them to another marble.`} />
					) : null
				}
			/>
			{marbleSounds(project, marble) ? (
				<Panel id="marble.sound" title="Sound">
					<SoundField
						id="marble-sound"
						value={marble.sound}
						onChange={(sound) => {
							if (cx.execute([{ type: 'updateMarble', marbleId: marble.id, patch: { sound } }])) auditionNote(cx, marble.id, firstPitch(marble.hits));
						}}
					/>
					<LevelField id="marble-level" value={marble.level} autoLabel={autoLevelLabel(marble.id, melodyMarbleId(project))} onChange={(level) => cx.execute([{ type: 'updateMarble', marbleId: marble.id, patch: { level } }])} />
				</Panel>
			) : null}
			{!isFilm ? (
				<Panel id="marble.timing" title="Timing" accessory={<HelpTip text="Notes tied to a song move with it; None keeps them where they are, on the marble's own. Start: when the marble is released." />}>
					{marble.hits.length > 0 ? (
						<SongField
							cx={cx}
							project={project}
							id="marble-song"
							value={songValue(marbleSong(marble))}
							onChange={(songId) => cx.execute([{ type: 'upsertHits', marbleId: marble.id, hits: tiedToSong(marble.hits, songId) }], { label: tieLabel(songId) })}
						/>
					) : null}
					<ScrubField
						id="marble-start"
						label="Start"
						name="Start Time"
						span={2}
						value={release.time}
						unit=""
						step={0.01}
						precision={2}
						min={0}
						max={project.length}
						format={formatTime}
						parse={parseTime}
						onPreview={(time) => cx.simulation.startPreview(withMarbleStart(project, marble.id, time))}
						onCommit={(time) => {
							moveMarbleStart(cx, marble, time);
							cx.simulation.endPreview();
						}}
						onCancel={() => cx.simulation.endPreview()}
					/>
				</Panel>
			) : null}
			{!isFilm ? (
				<Panel id="marble.release" title="Position" accessory={<HelpTip text="Start Position: where the marble is released on the wall." />}>
					<ScrubField id="release-x" label="Start X" name="Start Position X" value={round1(release.position.x * 100)} unit="cm" step={0.1} precision={1} onPreview={(value) => previewRelease({ x: value / 100 })} onCommit={(value) => commitRelease({ x: value / 100 })} onCancel={() => cx.simulation.endPreview()} />
					<ScrubField id="release-y" label="Start Y" name="Start Position Y" value={round1(release.position.y * 100)} unit="cm" step={0.1} precision={1} onPreview={(value) => previewRelease({ y: value / 100 })} onCommit={(value) => commitRelease({ y: value / 100 })} onCancel={() => cx.simulation.endPreview()} />
				</Panel>
			) : null}
		</>
	);
};

/** The General MIDI program a marble's notes or a song's Backing play with */
const SoundField: React.FC<{ id: string; value: number; onChange: (value: number) => void }> = (props) => {
	const { id, value, onChange } = props;
	return <SelectField id={id} label="Sound" value={String(value)} options={instruments.map((item) => ({ value: String(item.program), label: item.name }))} onChange={(next) => onChange(Number(next))} />;
};

/** How loud a marble or Backing plays. Auto puts the marble whose notes sit highest on top; a chosen level wins */
const LevelField: React.FC<{ id: string; value: number | undefined; autoLabel: string; onChange: (value: number | null) => void }> = (props) => {
	const { id, value, autoLabel, onChange } = props;
	const levels = value == null || (LEVEL_CHOICES as readonly number[]).includes(value) ? LEVEL_CHOICES : [...LEVEL_CHOICES, value];
	return (
		<SelectField
			id={id}
			label="Level"
			value={value == null ? AUTO_LEVEL : String(value)}
			options={[{ value: AUTO_LEVEL, label: autoLabel }, ...levels.map((level) => ({ value: String(level), label: formatLevel(level) }))]}
			onChange={(next) => onChange(next === AUTO_LEVEL ? null : Number(next))}
		/>
	);
};

const AUTO_LEVEL = 'auto';

/** The pitch of the earliest note, played when the Sound changes */
function firstPitch(hits: readonly THit[]): number | undefined {
	return hits.reduce<THit | undefined>((first, hit) => (hit.pitch != null && (first == null || hit.time < first.time) ? hit : first), undefined)?.pitch;
}

// MARK: - Hits

/** Which song the selected hits move with: None for the marble's own, like Blender's parent field */
const HitSongField: React.FC<{ cx: StudioCx; project: TProject; hits: { marble: THitOwner; hit: THit }[] }> = (props) => {
	const { cx, project, hits } = props;
	if (hits.some((item) => item.marble.id === BACKING_ID)) return null;
	const tied = new Set(hits.map((item) => item.hit.songId ?? NO_SONG));
	return (
		<SongField
			cx={cx}
			project={project}
			id="hit-song"
			value={tied.size === 1 ? ([...tied][0] ?? '') : ''}
			onChange={(songId) => {
				const marbleIds = [...new Set(hits.map((item) => item.marble.id))];
				cx.execute(
					marbleIds.map((marbleId) => ({
						type: 'upsertHits' as const,
						marbleId,
						hits: tiedToSong(hits.filter((item) => item.marble.id === marbleId).map((item) => item.hit), songId)
					})),
					{ label: tieLabel(songId) }
				);
			}}
		/>
	);
};

/** One Song field for a marble and for hits: a song, None, or Mixed. Choosing changes only the tie, as one Undo step. */
const SongField: React.FC<{ cx: StudioCx; project: TProject; id: string; value: string; onChange: (songId: string | null) => void }> = (props) => {
	const { project, id, value, onChange } = props;
	const songs = shownSongs(project);
	if (!songs.length) return null;
	return (
		<SelectField
			id={id}
			label="Song"
			value={value}
			options={[...(value === '' ? [{ value: '', label: 'Mixed' }] : []), { value: NO_SONG, label: 'None' }, ...songs.map((song) => ({ value: song.id, label: song.name === '' ? 'Backing' : song.name }))]}
			onChange={(next) => {
				if (next !== '') onChange(next === NO_SONG ? null : next);
			}}
		/>
	);
};

const NO_SONG = 'none';

function songValue(song: TMarbleSong): string {
	if (song.kind === 'song') return song.songId;
	return song.kind === 'none' ? NO_SONG : '';
}

type THitOwner = Pick<TMarble, 'id' | 'name' | 'labelColor' | 'sound' | 'hits'>;

const HitInspector: React.FC<{ cx: StudioCx; project: TProject; hitKeys: string[] }> = (props) => {
	const { cx, project, hitKeys } = props;
	const result = useFeatureState(cx.simulation.$result);
	// Backing joins the marbles so a Backing note shows like a hit without a marble
	const backing: THitOwner = { id: BACKING_ID, name: 'Backing', labelColor: BACKING_COLOR, sound: backingSong(project)?.backingSound ?? 0, hits: backingOf(project) };
	// Without a song Backing is not offered: its notes show only in the Song track (see canMakeBacking)
	const owners: THitOwner[] = canMakeBacking(project) || backingOf(project).length > 0 ? [...project.marbles, backing] : project.marbles;
	const hits = hitKeys.flatMap((key) => {
		const parsed = parseHitKey(key);
		const marble = owners.find((item) => item.id === parsed?.marbleId);
		const hit = marble?.hits.find((item) => item.id === parsed?.hitId);
		return marble == null || hit == null ? [] : [{ marble, hit }];
	});
	const single = hits.length === 1 ? hits[0] : undefined;
	const ownerIds = new Set(hits.map((item) => item.marble.id));
	const playedBy = (
		<SelectField
			id="hit-played-by"
			label="Marble"
			value={ownerIds.size === 1 ? ([...ownerIds][0] ?? '') : ''}
			options={[
				...(ownerIds.size === 1 ? [] : [{ value: '', label: 'Several' }]),
				...owners.map((owner, index) => ({
					value: owner.id,
					label: owner.id === BACKING_ID ? 'Backing' : owner.name,
					shortcut: owner.id === BACKING_ID ? '0' : index < 9 ? String(index + 1) : undefined
				}))
			]}
			onChange={(value) => {
				if (value !== '') handNotes(cx, hitKeys, value);
			}}
		/>
	);

	if (single == null) {
		return (
			<>
				<InspectorHeader
					icon={<HitGlyph />}
					title={`${hits.length} notes`}
					subtitle={[...ownerIds].map((id) => owners.find((owner) => owner.id === id)?.name).join(', ')}
				/>
				<Panel id="hit.playedBy" title="Played By">
					{playedBy}
					<HitSongField cx={cx} project={project} hits={hits} />
				</Panel>
			</>
		);
	}

	const { marble, hit } = single;
	const isBacking = marble.id === BACKING_ID;
	const index = marble.hits.indexOf(hit);
	const piece = project.track.pieces.find((piece) => tieOf(piece)?.marbleId === marble.id && tieOf(piece)?.hitId === hit.id);
	const hitResult = result?.hits.find((item) => item.marbleId === marble.id && item.hitId === hit.id);
	// An open hit no platform can play yet says why (Too Soon, Out of Reach) and offers the fixes in Played By
	const reach = !isBacking && piece == null && hitResult?.status === 'open' ? hitReach(project, result, hitResult) : null;
	const unreachable = reach != null && hitResult != null && isUnreachable(reach) ? unreachableStatus(project, result, hitResult) : null;
	const fixes = unreachable != null && reach != null && hitResult != null ? unreachableActions(cx, hitResult, releaseFixFor(project, hitResult, reach)) : [];
	const pieceLabel = piece == null ? '' : (piece.name ?? getPieceDefinition(piece.type)?.label ?? 'Piece');
	const timing =
		piece == null
			? unreachable != null
				? { tone: 'warn' as const, label: unreachable.label, detail: unreachable.detail }
				: // An open note says so, as the bar's hollow mark does
					isBacking
					? null
					: { tone: 'neutral' as const, label: 'Open', detail: 'No platform plays this note yet' }
			: timingStatus(result?.pieces.find((item) => item.pieceId === piece.id), hitResult, { marble: marble.name, piece: pieceLabel });

	function setHit(patch: Partial<THit>): void {
		cx.execute([{ type: 'upsertHits', marbleId: marble.id, hits: [{ ...hit, ...patch }] }]);
	}

	function setPitch(pitch: number | null): void {
		setHit({ pitch: pitch ?? undefined });
		if (pitch != null) auditionNote(cx, marble.id, pitch);
	}

	return (
		<>
			<InspectorHeader
				icon={<HitGlyph color={marble.labelColor} />}
				title={isBacking ? `Note ${index + 1}` : `Note ${index + 1}`}
				subtitle={`${marble.name} · ${formatTime(hit.time)}`}
				status={timing == null ? null : <StatusPill tone={timing.tone} label={timing.label} detail={timing.detail} />}
				fix={(timing?.tone === 'bad' || timing?.tone === 'warn') && piece != null && !isBacking ? <FixButton cx={cx} pieceId={piece.id} /> : null}
			/>
			<Panel
				id="hit.note"
				title={hit.pitch != null ? 'Note' : 'Note'}
			>
				{hit.pitch != null ? (
					<>
						<PitchField pitch={hit.pitch} onChange={setPitch} />
						<ScrubField
							id="hit-velocity"
							label="Velocity"
							name="Velocity: how hard the note plays"
							value={Math.round((hit.velocity ?? DEFAULT_HIT_VELOCITY) * 100)}
							unit="%"
							step={0.5}
							min={0}
							max={100}
							onCommit={(value) => setHit({ velocity: value / 100 })}
						/>
					</>
				) : null}
				<ScrubField
					id="hit-time"
					label="Time"
					name="Time: moves the note in the song"
					value={hit.time}
					unit=""
					step={0.005}
					precision={3}
					format={formatTime}
					parse={parseTime}
					min={0}
					max={project.length}
					onCommit={(time) => setHit({ time })}
				/>
			</Panel>
			<Panel id="hit.playedBy" title="Played By" accessory={<HelpTip text="Backing is heard in the film, no platform needed. Handing a note to another marble takes its platform along; handing it to Backing removes the platform." />}>
				{playedBy}
				<HitSongField cx={cx} project={project} hits={hits} />
				{isBacking ? null : piece != null ? (
					<LinkRow icon={<PieceIcon type={piece.type} size={14} />} title={`Select ${pieceLabel}`} onOpen={() => cx.reveal([piece.id])}>
						{pieceLabel}
					</LinkRow>
				) : fixes.length > 0 ? (
					fixes.map((action) => (
						<button key={action.label} className="mm-button" data-span="2" onClick={action.run} title={action.title} type="button">
							{action.label}
						</button>
					))
				) : null}
			</Panel>
		</>
	);
};

/** Note name field with a semitone stepper; Up and Down step a semitone, Shift an octave */
const PitchField: React.FC<{ pitch: number | undefined; onChange: (pitch: number | null) => void }> = (props) => {
	const { pitch, onChange } = props;
	const step = (semitones: number): void => onChange(stepPitch(pitch ?? 60, semitones));
	return (
		<TextField
			id="hit-pitch"
			label="Pitch"
			name="Pitch"
			value={pitch == null ? '' : noteName(pitch)}
			onCommit={(value) => {
				const next = parseNoteName(value);
				if (next !== undefined) onChange(next);
			}}
			onKeyDown={(event) => {
				if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
				event.preventDefault();
				step((event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 12 : 1));
			}}
		>
			<span className="mm-ifield-stepper">
				<button aria-label="Semitone Up" onClick={() => step(1)} tabIndex={-1} type="button">
					<ChevronUp size={10} strokeWidth={2.2} />
				</button>
				<button aria-label="Semitone Down" onClick={() => step(-1)} tabIndex={-1} type="button">
					<ChevronDown size={10} strokeWidth={2.2} />
				</button>
			</span>
		</TextField>
	);
};

const HitGlyph: React.FC<{ color?: string }> = (props) => {
	const { color } = props;
	return <span className="h-2.5 w-2.5 rotate-45 rounded-[1.5px]" style={{ background: color ?? 'currentColor' }} />;
};

// MARK: - Song

/**
 * The Song layer's inspector: the file and its kind, tempo and meter, and Replace Song…, then Backing with its note
 * count and Sound. The layer exists only while the project has a song file or Backing notes.
 */
const SongInspector: React.FC<{ cx: StudioCx; project: TProject; songId: string }> = (props) => {
	const { cx, project, songId } = props;
	const song = project.songs.find((item) => item.id === songId);
	if (song == null) return null;
	const tempo = song.tempo;
	const backing = song.backing;
	const kind = song.path == null ? 'Backing' : song.kind === 'audio' ? 'Recording' : 'MIDI';

	return (
		<>
			<InspectorHeader
				icon={song.path != null && song.kind === 'audio' ? <AudioLines size={16} strokeWidth={1.7} /> : <FileMusic size={16} strokeWidth={1.7} />}
				title={SONG_LAYER_LABEL}
				subtitle={song.path != null ? `${song.name} · ${kind}` : kind}
			/>
			<Panel id="song.file" title="Song">
				{song.path != null ? (
					<ReadoutField label={song.kind === 'audio' ? 'Recording' : 'MIDI'} name={song.name} span={2}>
						<span className="flex items-center gap-2">
							{song.kind === 'audio' ? <AudioLines size={13} strokeWidth={1.7} className="shrink-0 text-[var(--text-secondary)]" /> : <FileMusic size={13} strokeWidth={1.7} className="shrink-0 text-[var(--text-secondary)]" />}
							<span className="truncate">{song.name}</span>
						</span>
					</ReadoutField>
				) : null}
				<ScrubField id="song-start" label="Start" name="Start" span={2} value={song.start} unit="" step={0.01} format={formatSignedTime} parse={parseSignedTime} onCommit={(value) => cx.sources.moveSong(song.id, value)} />
				{tempo != null ? (
					<>
						<ReadoutField label="Tempo" name="Tempo">
							{Math.round(tempo.bpm * 10) / 10} <span className="mm-insp-secondary text-[11px]">BPM</span>
						</ReadoutField>
						<ReadoutField label="Meter" name="Beats per bar">
							{tempo.beatsPerBar}/4
						</ReadoutField>
					</>
				) : null}
				<button className="mm-button" data-span="2" onClick={() => void (song.path == null ? cx.importSong() : cx.sources.replaceSong(song))} title="Choose another MIDI file or recording; the marbles keep their notes" type="button">
					{song.path == null ? 'Import Song…' : 'Replace Song…'}
				</button>
			</Panel>
			{backing.length > 0 ? (
				<Panel id="song.backing" title="Backing" accessory={<HelpTip text="The notes no marble plays, heard in the film with no platform needed." />}>
					<ReadoutField label="Notes" name="Backing notes">
						{backing.length}
					</ReadoutField>
					<SoundField
						id="backing-sound"
						value={song.backingSound ?? DEFAULT_BACKING_INSTRUMENT}
						onChange={(backingSound) => {
							if (cx.execute([{ type: 'updateSong', songId: song.id, patch: { backingSound } }])) auditionNote(cx, BACKING_ID, firstPitch(backing), song.id);
						}}
					/>
					<LevelField id="backing-level" value={song.backingLevel} autoLabel={autoLevelLabel(null, melodyMarbleId(project))} onChange={(backingLevel) => cx.execute([{ type: 'updateSong', songId: song.id, patch: { backingLevel } }])} />
				</Panel>
			) : null}
		</>
	);
};

// MARK: - Scene

/**
 * The Scene, selected by its row in Layers or by clearing the selection, like Blender's Scene properties: only what the
 * whole film shares. Film shows the Theme row and Format. Track shows Gravity. The length is the transport's and
 * the ruler's; each layer keeps its own settings.
 */
const SceneInspector: React.FC<{ cx: StudioCx; project: TProject; isFilm: boolean }> = (props) => {
	const { cx, project, isFilm } = props;
	const speed = project.gravity;

	const withSpeed = (gravity: number): TProject => ({ ...project, gravity });

	return (
		<>
			<InspectorHeader icon={<Globe size={16} strokeWidth={1.7} />} title="Scene" subtitle={formatTime(project.length)} />
			{isFilm ? (
				<Panel id="scene.film" title="Film" accessory={<HelpTip text={`${THEME_HELP} Picking a theme keeps your changes on the layers. Packs… exports a look as a Pack. Format is the shape of the film: Portrait suits phones and Shorts; the camera frames the marbles for it.`} />}>
					<ThemeRow cx={cx} project={project} />
					<FormatField cx={cx} project={project} />
				</Panel>
			) : (
				<Panel id="scene.track" title="Physics" accessory={<HelpTip text="Gravity: how fast all marbles fall. Lower gives smaller hops and a denser track; notes stay on time." />}>
					<SliderField
						id="world-speed"
						label="Gravity"
						value={speed}
						min={0.05}
						max={2}
						step={0.05}
						format={(value) => value.toFixed(2)}
						unit="×"
						onPreview={(value) => cx.simulation.startPreview(withSpeed(value))}
						onCommit={(value) => {
							const trackCx = cx.$trackCx.get();
							if (trackCx != null) void cx.patterns.setGravity(value);
							else cx.execute([{ type: 'updateProject', patch: { gravity: value } }]);
							cx.simulation.endPreview();
						}}
					/>
				</Panel>
			)}
		</>
	);
};

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}
