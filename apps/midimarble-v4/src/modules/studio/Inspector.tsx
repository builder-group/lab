import { useFeatureState } from 'feature-react/state';
import { AudioLines, ChevronDown, ChevronUp, FileMusic, Globe, Plus, Trash2 } from 'lucide-react';
import React from 'react';
import { HelpTip, InspectorHeader, LinkRow, MenuButton, Panel, ReadoutField, ScrubField, SelectField, StatusPill, TextField } from '@/components';
import type { ComposeCx } from '@/modules/compose/ComposeCx';
import { PieceIcon } from '@/modules/compose/piece-icons';
import { unreachableActions } from '@/modules/compose/unreachable-fixes';
import { PieceInspector, ReplaceButton } from '@/modules/compose/PieceInspector';
import { canMakeBacking, hitReach, isUnreachable, releaseFixFor, unreachableStatus } from '@/modules/compose/reachability';
import { placeAtHit } from '@/modules/compose/step-loop';
import { timingStatus } from '@/modules/compose/timing-status';
import { CameraInspector, FilmLookPanel, PieceLook, ShotInspector, TitlesInspector, WallTextInspector } from '@/modules/design/DesignInspector';
import { DEFAULT_HIT_VELOCITY, findLaneConflicts, instruments, MIN_HIT_GAP, SONG_TAIL, suggestedHitTimes } from '@/modules/music';
import { BACKING_ID, createId, laneColors, type THit, type TEntity, type TLane, type TProject, type TVec2 } from '@/modules/project';
import { getPieceDefinition } from '@/modules/simulation';
import { commandItem } from './commands';
import { formatTime, noteName, parseNoteName, stepPitch } from './format';
import { inspectorTarget, type TInspectorTarget } from './inspector-target';
import { parseHitKey } from './selection';
import { deleteSongQuestion, songLayerName } from './song-layer';
import { songSource } from './SourcesCx';
import type { StudioCx, TWorkspace } from './StudioCx';
import { auditionNote, BACKING_COLOR, handNotes } from './timeline/hand-notes';
import { parseTime } from './timeline/parse-time';
import { songFitEnd } from './world';

/**
 * Properties of the selection, like Figma UI3's properties panel: the zoom at the top in Compose, then a
 * header row and sections for the selected layer, or the Project without one. Each layer owns its settings: the
 * Song its file and Backing, the Camera its frame and rig, a marble, a piece, a hit, a shot or a title their own.
 */
export const Inspector: React.FC<TInspectorProps> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const selection = useFeatureState(cx.$selection);
	const workspace = useFeatureState(cx.$workspace);
	const project = history?.present;
	if (project == null) return null;
	const target = inspectorTarget(project, selection);

	return (
		<aside className="mm-inspector" aria-label="Inspector" data-quick-help="inspector">
			<InspectorTopBar cx={cx} />
			<div className="mm-insp-scroll">
				<TargetInspector cx={cx} project={project} target={target} workspace={workspace} />
			</div>
		</aside>
	);
};

/** The inspector of the selected layer; Compose and Film differ only in what a piece shows (shape or look) */
const TargetInspector: React.FC<{ cx: StudioCx; project: TProject; target: TInspectorTarget; workspace: TWorkspace }> = (props) => {
	const { cx, project, target, workspace } = props;
	const isFilm = workspace === 'design';
	switch (target.kind) {
		case 'pieces': {
			if (!isFilm) return <PieceInspector cx={cx} project={project} ids={target.ids} />;
			const pieces = project.entities.filter((entity) => target.ids.includes(entity.id));
			return <PieceLook cx={cx} project={project} pieces={pieces} />;
		}
		case 'hits':
			return <HitInspector cx={cx} project={project} hitKeys={target.keys} />;
		case 'title': {
			const entity = project.entities.find((item) => item.id === target.id);
			return entity == null ? null : <WallTextInspector cx={cx} project={project} entity={entity} />;
		}
		case 'titles':
			return <TitlesInspector cx={cx} project={project} />;
		case 'shot': {
			const shot = project.design.camera.shots.find((item) => item.id === target.id);
			return shot == null ? null : <ShotInspector cx={cx} project={project} shot={shot} />;
		}
		case 'marble': {
			const lane = project.music.lanes.find((item) => item.id === target.laneId);
			const marble = project.entities.find((item) => item.id === target.entityId);
			return lane == null || marble == null ? null : <LaneInspector cx={cx} project={project} lane={lane} marble={marble} />;
		}
		case 'song':
			return <SongInspector cx={cx} project={project} />;
		case 'camera':
			return <CameraInspector cx={cx} project={project} />;
		case 'project':
			return <ProjectInspector cx={cx} project={project} look={isFilm ? <FilmLookPanel cx={cx} project={project} /> : null} />;
	}
};

interface TInspectorProps {
	cx: StudioCx;
}

/**
 * The wall's zoom with its menu, like the top of Figma's right panel. Blender and Export live in the title
 * bar, so Film, which has no zoom, has no top bar
 */
const InspectorTopBar: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const compose = useFeatureState(cx.$compose);
	const workspace = useFeatureState(cx.$workspace);
	if (workspace !== 'compose' || compose == null) return null;
	return (
		<div className="mm-insp-top">
			<ZoomMenu cx={cx} compose={compose} />
		</div>
	);
};

const ZoomMenu: React.FC<{ cx: StudioCx; compose: ComposeCx }> = (props) => {
	const { cx, compose } = props;
	const camera = useFeatureState(compose.$camera);
	// 100% shows the wall at physical size on a 96 dpi screen
	const zoom = Math.round((camera.view.scale / 3779.5) * 100);
	return (
		<MenuButton
			className="mm-zoom-button mm-tabular"
			title="Zoom"
			label={
				<>
					{zoom}%<ChevronDown size={11} strokeWidth={2} />
				</>
			}
			items={[
				commandItem(cx, 'view.zoomIn'),
				commandItem(cx, 'view.zoomOut'),
				'separator',
				commandItem(cx, 'view.fitAll'),
				commandItem(cx, 'view.fitSelection'),
				commandItem(cx, 'view.fitFrame'),
				'separator',
				commandItem(cx, 'view.snap'),
				commandItem(cx, 'view.follow')
			]}
		/>
	);
};

// MARK: - Marble

const LaneInspector: React.FC<{ cx: StudioCx; project: TProject; lane: TLane; marble: TEntity }> = (props) => {
	const { cx, project, lane, marble } = props;
	const analysis = useFeatureState(cx.sources.$analysis);
	const audio = project.music.sources.find((source) => source.kind === 'audio');
	const suggestions = audio == null ? undefined : analysis[audio.id]?.onsets;
	const conflicts = findLaneConflicts(lane).size;

	function addSuggestedHits(): void {
		if (audio == null || suggestions == null) return;
		const times = suggestedHitTimes(
			suggestions,
			audio.offset,
			lane.hits.map((hit) => hit.time)
		);
		const hits = times.map((time) => ({ id: createId('hit'), time }));
		cx.execute([{ type: 'upsertHits', laneId: lane.id, hits }]);
	}

	const release = marble.components.release;
	const releaseProject = (patch: Partial<TVec2>): TProject | null =>
		release == null
			? null
			: {
					...project,
					entities: project.entities.map((item) =>
						item.id === marble.id ? { ...item, components: { ...item.components, release: { ...release, position: { ...release.position, ...patch } } } } : item
					)
				};
	function previewRelease(patch: Partial<TVec2>): void {
		const next = releaseProject(patch);
		if (next != null) cx.simulation.startPreview(next);
	}
	function commitRelease(patch: Partial<TVec2>): void {
		if (release != null) cx.execute([{ type: 'setComponent', entityId: marble.id, component: { name: 'release', value: { ...release, position: { ...release.position, ...patch } } } }]);
		cx.simulation.endPreview();
	}

	function setColor(color: string): void {
		const marbleComponent = marble.components.marble;
		cx.execute([
			{ type: 'upsertLane', lane: { ...lane, color } },
			...(marbleComponent == null ? [] : [{ type: 'setComponent' as const, entityId: marble.id, component: { name: 'marble' as const, value: { ...marbleComponent, color } } }])
		]);
	}

	return (
		<>
			<InspectorHeader
				icon={<span className="h-3 w-3 rounded-full" style={{ background: lane.color }} />}
				title={lane.name}
				subtitle={`Marble · ${lane.hits.length} ${lane.hits.length === 1 ? 'hit' : 'hits'}`}
				onRename={(name) => cx.execute([{ type: 'upsertLane', lane: { ...lane, name } }])}
				status={
					conflicts > 0 ? (
						<StatusPill tone="bad" label={`${conflicts} Too Close`} detail={`${conflicts === 1 ? 'A hit is' : `${conflicts} hits are`} less than ${MIN_HIT_GAP * 1000} ms from the next one. Drag them apart or move them to another marble.`} />
					) : null
				}
			/>
			<Panel id="marble.marble" title="Marble">
				<div className="mm-insp-swatches" data-span="2" role="radiogroup" aria-label="Color">
					{laneColors.map((color) => (
						<button
							key={color}
							role="radio"
							aria-checked={color === lane.color}
							aria-label={`Color ${color}`}
							className="h-4 w-4 rounded-full"
							style={{
								background: color,
								boxShadow: color === lane.color ? '0 0 0 2px var(--content), 0 0 0 3.5px var(--text-secondary)' : 'inset 0 0 0 0.5px rgb(0 0 0 / 0.2)'
							}}
							onClick={() => setColor(color)}
							type="button"
						/>
					))}
				</div>
				{audio == null ? (
					<SelectField
						id="lane-instrument"
						label="Instrument"
						value={String(lane.instrument)}
						options={instruments.map((item) => ({ value: String(item.program), label: item.name }))}
						onChange={(value) => cx.execute([{ type: 'upsertLane', lane: { ...lane, instrument: Number(value) } }])}
					/>
				) : null}
			</Panel>
			{release != null ? (
				<Panel id="marble.release" title="Release" accessory={<HelpTip text="Where the marble starts. Drag its ring on the wall to move it." />}>
					<ScrubField id="release-x" label="X" name="Release X" value={round1(release.position.x * 100)} unit="cm" step={0.1} precision={1} onPreview={(value) => previewRelease({ x: value / 100 })} onCommit={(value) => commitRelease({ x: value / 100 })} onCancel={() => cx.simulation.endPreview()} />
					<ScrubField id="release-y" label="Y" name="Release Y" value={round1(release.position.y * 100)} unit="cm" step={0.1} precision={1} onPreview={(value) => previewRelease({ y: value / 100 })} onCommit={(value) => commitRelease({ y: value / 100 })} onCancel={() => cx.simulation.endPreview()} />
				</Panel>
			) : null}
			{suggestions != null ? (
				<Panel id="marble.hits" title="Hits" accessory={<HelpTip text="Double-click the marble's row in the timeline to add a hit, or press T while playing to tap along." />}>
					<button className="mm-button" data-span="2" onClick={addSuggestedHits} title={`Add a hit for each of the ${suggestions.length} beats found in the recording`} type="button">
						Add {suggestions.length} {suggestions.length === 1 ? 'Beat' : 'Beats'}
					</button>
				</Panel>
			) : null}
		</>
	);
};

// MARK: - Hits

const HitInspector: React.FC<{ cx: StudioCx; project: TProject; hitKeys: string[] }> = (props) => {
	const { cx, project, hitKeys } = props;
	const result = useFeatureState(cx.simulation.$result);
	const compose = useFeatureState(cx.$compose);
	// Backing joins the marbles' lanes so a Backing note shows like a hit without a marble
	const backing: TLane = { id: BACKING_ID, name: 'Backing', color: BACKING_COLOR, instrument: project.music.backingInstrument ?? 0, hits: project.music.backing };
	// Without a song Backing is not offered: its notes show only in the Song track (see canMakeBacking)
	const owners = canMakeBacking(project) || project.music.backing.length > 0 ? [...project.music.lanes, backing] : project.music.lanes;
	const hits = hitKeys.flatMap((key) => {
		const parsed = parseHitKey(key);
		const lane = owners.find((item) => item.id === parsed?.laneId);
		const hit = lane?.hits.find((item) => item.id === parsed?.hitId);
		return lane == null || hit == null ? [] : [{ lane, hit }];
	});
	const single = hits.length === 1 ? hits[0] : undefined;
	const ownerIds = new Set(hits.map((item) => item.lane.id));
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
					title={`${hits.length} ${ownerIds.has(BACKING_ID) ? 'Notes' : 'Hits'}`}
					subtitle={[...ownerIds].map((id) => owners.find((owner) => owner.id === id)?.name).join(', ')}
					status={<HelpTip text="Drag hits in the timeline to move them together. Press 1 to 9 to hand the notes to that marble, 0 to make them Backing. Press Delete to remove them." />}
				/>
				<Panel id="hit.playedBy" title="Play With" accessory={<HelpTip text="Handing a note to another marble takes its platform along; handing it to Backing removes the platform." />}>
					{playedBy}
				</Panel>
			</>
		);
	}

	const { lane, hit } = single;
	const isBacking = lane.id === BACKING_ID;
	const index = lane.hits.indexOf(hit);
	const piece = project.entities.find(
		(entity) => entity.components.piece != null && entity.components.hitLink?.laneId === lane.id && entity.components.hitLink.hitId === hit.id
	);
	const hitResult = result?.hits.find((item) => item.laneId === lane.id && item.hitId === hit.id);
	// An open hit no platform can play yet says why (Too Soon, Out of Reach) and offers the fixes in Play With
	const reach = !isBacking && piece == null && hitResult?.status === 'open' ? hitReach(project, result, hitResult) : null;
	const unreachable = reach != null && hitResult != null && isUnreachable(reach) ? unreachableStatus(project, result, hitResult) : null;
	const fixes = unreachable != null && reach != null && hitResult != null ? unreachableActions(cx, hitResult, releaseFixFor(project, hitResult, reach)) : [];
	const timing =
		piece == null
			? unreachable == null
				? null
				: { tone: 'warn' as const, label: unreachable.label, detail: unreachable.detail }
			: timingStatus(result?.pieces.find((item) => item.entityId === piece.id), hitResult);
	const openHit = hitResult?.status === 'open' && hitResult.dot != null ? hitResult : null;
	const pieceLabel = piece == null ? '' : (piece.name ?? getPieceDefinition(piece.components.piece?.type ?? '')?.label ?? 'Piece');

	function setHit(patch: Partial<THit>): void {
		cx.execute([{ type: 'upsertHits', laneId: lane.id, hits: [{ ...hit, ...patch }] }]);
	}

	function setPitch(pitch: number | null): void {
		setHit({ pitch: pitch ?? undefined });
		if (pitch != null) auditionNote(cx, lane.id, pitch);
	}

	function addPlatform(): void {
		if (openHit == null) return;
		if (compose != null) void compose.assist.place(openHit, 'platform');
		else placeAtHit(cx, openHit, 'platform');
	}

	return (
		<>
			<InspectorHeader
				icon={<HitGlyph color={lane.color} />}
				title={isBacking ? `Note ${index + 1}` : `Hit ${index + 1}`}
				subtitle={`${lane.name} · ${formatTime(hit.time)}`}
				status={timing == null ? null : <StatusPill tone={timing.tone} label={timing.label} detail={timing.detail} />}
				fix={timing?.tone === 'bad' && piece != null && !isBacking ? <ReplaceButton cx={cx} laneId={lane.id} hitId={hit.id} /> : null}
			/>
			<Panel id="hit.note" title="Note" accessory={<HelpTip text="Type a note name such as A4 or F#3. Up and Down step a semitone, Shift an octave. Changing the pitch plays it." />}>
				{hit.pitch == null ? (
					<>
						<ReadoutField label="Pitch" name="Pitch">
							<span className="text-[var(--text-tertiary)]">No Pitch</span>
						</ReadoutField>
						<button className="mm-button" onClick={() => setPitch(nearbyPitch(lane, hit))} title={`Give this hit a note, starting at ${noteName(nearbyPitch(lane, hit))}`} type="button">
							<Plus size={12} strokeWidth={2} />
							Add Pitch
						</button>
					</>
				) : (
					<PitchField pitch={hit.pitch} onChange={setPitch} />
				)}
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
				<ScrubField
					id="hit-time"
					label="Time"
					name="Time"
					value={hit.time}
					unit=""
					step={0.005}
					precision={3}
					format={formatTime}
					parse={parseTime}
					min={0}
					max={project.end}
					onCommit={(time) => setHit({ time })}
				/>
			</Panel>
			<Panel id="hit.playedBy" title="Play With" accessory={<HelpTip text="Backing is heard in the film, no piece needed. Handing a note to another marble takes its platform along; handing it to Backing removes the platform." />}>
				{playedBy}
				{isBacking ? null : piece != null ? (
					<LinkRow icon={<PieceIcon type={piece.components.piece?.type ?? 'platform'} size={14} />} title={`Select ${pieceLabel}`} onOpen={() => cx.reveal([piece.id])}>
						{pieceLabel}
					</LinkRow>
				) : fixes.length > 0 ? (
					fixes.map((action) => (
						<button key={action.label} className="mm-button" data-span="2" onClick={action.run} title={action.title} type="button">
							{action.label}
						</button>
					))
				) : (
					<button className="mm-button" data-span="2" disabled={openHit == null} onClick={addPlatform} title="Add an auto-placed platform that plays this hit (A)" type="button">
						<Plus size={12} strokeWidth={2} />
						Add Platform
					</button>
				)}
			</Panel>
		</>
	);
};

/** Pitch a tapped hit starts with: the closest earlier pitched hit of its marble, else the next one, else C4 */
function nearbyPitch(lane: TLane, hit: THit): number {
	const pitched = lane.hits.filter((item) => item.pitch != null && item.id !== hit.id);
	const earlier = pitched.filter((item) => item.time <= hit.time).at(-1);
	return earlier?.pitch ?? pitched.find((item) => item.time > hit.time)?.pitch ?? 60;
}

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
 * The Song layer's inspector: the file and its kind, tempo and meter, the instrument Backing plays with, and
 * Replace Song… and Delete Song. The layer exists only while the project has a song file or Backing notes.
 */
const SongInspector: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const song = songSource(project);
	const tempo = project.music.tempo;
	const backing = project.music.backing.length;
	const kind = song == null ? 'Backing' : song.kind === 'audio' ? 'Recording' : 'MIDI';
	const deleteQuestion = deleteSongQuestion(project);

	return (
		<>
			<InspectorHeader
				icon={song?.kind === 'audio' ? <AudioLines size={16} strokeWidth={1.7} /> : <FileMusic size={16} strokeWidth={1.7} />}
				title={songLayerName(project)}
				subtitle={`Song · ${kind}`}
			/>
			<Panel id="song.file" title="Song" accessory={<HelpTip text="The song the marbles play, heard in the film. Replace it with another file, or drop a file on the window." />}>
				{project.music.sources.map((source) => (
					<ReadoutField key={source.id} label={source.kind === 'audio' ? 'Recording' : 'MIDI'} name={source.name} span={2}>
						<span className="flex items-center gap-2">
							{source.kind === 'audio' ? <AudioLines size={13} strokeWidth={1.7} className="shrink-0 text-[var(--text-secondary)]" /> : <FileMusic size={13} strokeWidth={1.7} className="shrink-0 text-[var(--text-secondary)]" />}
							<span className="truncate">{source.name}</span>
						</span>
					</ReadoutField>
				))}
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
				<button className="mm-button" onClick={() => void (song == null ? cx.importSong() : cx.sources.replaceSong())} title="Choose another MIDI file or recording; the marbles keep their hits" type="button">
					{song == null ? 'Import Song…' : 'Replace Song…'}
				</button>
				<button
					className="mm-button"
					onClick={() => void cx.sources.deleteSong()}
					title={deleteQuestion == null ? 'Delete the song; the marbles keep their hits (⌫)' : 'Delete the song and its Backing notes; the marbles keep their hits (⌫)'}
					type="button"
				>
					<Trash2 size={12} strokeWidth={1.8} />
					Delete Song
				</button>
			</Panel>
			{backing > 0 || song?.kind === 'midi' ? (
				<Panel id="song.backing" title="Backing" accessory={<HelpTip text="Notes no marble plays, heard in the film with no piece needed. Select notes in the expanded Song row and press 0 to make them Backing." />}>
					<ReadoutField label="Notes" name="Backing notes">
						{backing}
					</ReadoutField>
					<SelectField
						id="song-backing-instrument"
						label="Sound"
						value={String(project.music.backingInstrument ?? 0)}
						options={instruments.map((item) => ({ value: String(item.program), label: item.name }))}
						onChange={(value) => cx.execute([{ type: 'setBackingInstrument', instrument: Number(value) }])}
					/>
				</Panel>
			) : null}
		</>
	);
};

// MARK: - Project

/**
 * Shown without a selection, like page properties in Figma: only what is project-wide, the length and the
 * Marble Speed every marble shares, plus the film's Look in Film. Each layer keeps its own settings.
 */
const ProjectInspector: React.FC<TProjectInspectorProps> = (props) => {
	const { cx, project, look } = props;
	const speed = project.physics.gravityScale;
	const fitEnd = songFitEnd(project);

	const withSpeed = (gravityScale: number): TProject => ({ ...project, physics: { ...project.physics, gravityScale } });

	return (
		<>
			<InspectorHeader icon={<Globe size={16} strokeWidth={1.7} />} title="Project" subtitle={formatTime(project.end)} />
			<Panel id="world.film" title="Length" accessory={<HelpTip text="How long the film runs. Fit to Song ends it shortly after the last note." />}>
				<ScrubField id="project-end" label="Length" name="Film length" value={project.end} unit="" step={0.05} precision={2} min={0.5} format={formatTime} parse={parseTime} onCommit={(end) => cx.execute([{ type: 'setEnd', end }])} />
				<button
					className="mm-button"
					disabled={fitEnd == null || Math.abs(fitEnd - project.end) < 0.005}
					onClick={() => {
						if (fitEnd != null) cx.execute([{ type: 'setEnd', end: fitEnd }]);
					}}
					title={fitEnd == null ? 'The song has no notes yet' : `End the film ${SONG_TAIL} s after the last note, while the last marble is still in view (${formatTime(fitEnd)})`}
					type="button"
				>
					Fit to Song
				</button>
			</Panel>
			<Panel
				id="world.physics"
				title="Marble Speed"
				accessory={<HelpTip text="How fast every marble falls, as a share of Earth's gravity. It changes every marble at once. Slower gives smaller hops and denser columns; platforms that play a note stay on time." />}
			>
				<SliderField
					id="world-speed"
					label="Speed"
					value={speed}
					min={0.05}
					max={2}
					step={0.05}
					format={(value) => value.toFixed(2)}
					unit="×"
					onPreview={(value) => cx.simulation.startPreview(withSpeed(value))}
					onCommit={(value) => {
						cx.execute([{ type: 'setPhysics', physics: { gravityScale: value } }]);
						cx.simulation.endPreview();
					}}
				/>
			</Panel>
			{look}
		</>
	);
};

interface TProjectInspectorProps {
	cx: StudioCx;
	project: TProject;
	/** The film's Look, shown in Film */
	look: React.ReactNode;
}

/** A slider with a typeable value field beside it, previewing while dragged and committing on release */
const SliderField: React.FC<TSliderFieldProps> = (props) => {
	const { id, label, value, min, max, step, unit, format, onPreview, onCommit } = props;
	const [draft, setDraft] = React.useState<number | null>(null);
	const shown = draft ?? value;
	function commit(): void {
		if (draft != null && draft !== value) onCommit(draft);
		setDraft(null);
	}
	return (
		<>
			<div className="mm-insp-slider">
				<input
					id={id}
					aria-label={label}
					className="mm-slider"
					type="range"
					min={min}
					max={max}
					step={step}
					value={shown}
					style={{ '--fill': `${((shown - min) / (max - min)) * 100}%` } as React.CSSProperties}
					onChange={(event) => {
						const next = Number(event.target.value);
						setDraft(next);
						onPreview(next);
					}}
					onPointerUp={commit}
					onKeyUp={commit}
					onBlur={commit}
				/>
			</div>
			{/* The value also takes typing, for exact values the short slider cannot reach */}
			<TextField
				id={`${id}-value`}
				label={label}
				name={label}
				value={format(shown)}
				unit={unit}
				allowEmpty={false}
				onCommit={(text) => {
					const typed = Number.parseFloat(text.replace(',', '.'));
					if (!Number.isFinite(typed)) return;
					const next = Math.min(max, Math.max(min, Math.round(typed / step) * step));
					if (next !== value) onCommit(Number(next.toFixed(6)));
				}}
			/>
		</>
	);
};

interface TSliderFieldProps {
	id: string;
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	unit: string;
	format: (value: number) => string;
	onPreview: (value: number) => void;
	onCommit: (value: number) => void;
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}
