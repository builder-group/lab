import { useFeatureState } from 'feature-react/state';
import { AudioLines, ChevronDown, ChevronUp, FileMusic, Globe, Plus } from 'lucide-react';
import React from 'react';
import { HelpTip, InspectorHeader, LinkRow, MenuButton, Panel, ReadoutField, ScrubField, SelectField, SliderField, StatusPill, TextField } from '@/components';
import type { ComposeCx } from '@/modules/compose/ComposeCx';
import { InsertPopover } from '@/modules/compose/InsertLibrary';
import { PieceIcon } from '@/modules/compose/piece-icons';
import { unreachableActions } from '@/modules/compose/unreachable-fixes';
import { PieceInspector, PlatformFields, ReplaceButton } from '@/modules/compose/PieceInspector';
import { canMakeBacking, hitReach, isUnreachable, releaseFixFor, unreachableStatus } from '@/modules/compose/reachability';
import { placeAtHit } from '@/modules/compose/step-loop';
import { timingStatus } from '@/modules/compose/timing-status';
import { ZOOM_100_SCALE } from '@/modules/compose/view';
import { fixedColorSkinLabel } from '@/modules/design/design-commands';
import { CameraInspector, FormatField, PieceSkin, ShotInspector, WallTextInspector } from '@/modules/design/DesignInspector';
import { MarbleSkin } from '@/modules/design/SkinProperties';
import { THEME_HELP } from '@/modules/design/concept-words';
import { ThemeRow } from '@/modules/design/ThemePanel';
import { DecorInspector, MadeInBlenderInspector } from '@/modules/design/DecorInspector';
import { ColorWell, KeyLightInspector, LightInspector, WallInspector } from '@/modules/design/SceneLayerInspector';
import { addedLights } from '@/modules/design/scene-layers';
import { DEFAULT_HIT_VELOCITY, findLaneConflicts, instruments, MIN_HIT_GAP, SONG_MIX_ID, songParts } from '@/modules/music';
import { BACKING_ID, laneColors, type THit, type TEntity, type TLane, type TProject, type TProjectCommand, type TVec2 } from '@/modules/project';
import { getPieceDefinition, layoutOf, soundsHit } from '@/modules/simulation';
import { commandItem } from './commands';
import { formatTime, noteName, parseNoteName, stepPitch } from './format';
import { inspectorTarget, type TInspectorTarget } from './inspector-target';
import { KEY_LIGHT_ID, parseHitKey } from './selection';
import { SONG_LAYER_LABEL } from './song-layer';
import { songSource } from './SourcesCx';
import type { StudioCx, TWorkspace } from './StudioCx';
import { auditionNote, BACKING_COLOR, handNotes } from './timeline/hand-notes';
import { parseTime } from './timeline/parse-time';
import { setPartSound } from './timeline/PartRows';
import { PartToggles } from './timeline/PartToggles';

/**
 * Properties of the selection, like Figma UI3's properties panel: the zoom at the top in Compose, then a
 * header row and sections for the selected layer, or the Scene without one. Each layer owns its settings: the
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
			<InspectorTopBar cx={cx} />
			<div className="mm-insp-scroll">
				<TargetInspector cx={cx} project={project} target={target} workspace={workspace} />
			</div>
		</aside>
	);
};

/** The inspector of the selected layer; Compose and Film differ only in what a piece shows (shape or skin) */
const TargetInspector: React.FC<{ cx: StudioCx; project: TProject; target: TInspectorTarget; workspace: TWorkspace }> = (props) => {
	const { cx, project, target, workspace } = props;
	const isFilm = workspace === 'design';
	switch (target.kind) {
		case 'pieces': {
			if (!isFilm) return <PieceInspector cx={cx} project={project} ids={target.ids} />;
			const pieces = project.entities.filter((entity) => target.ids.includes(entity.id));
			return <PieceSkin cx={cx} project={project} pieces={pieces} />;
		}
		case 'hits':
			return <HitInspector cx={cx} project={project} hitKeys={target.keys} />;
		case 'title': {
			const entity = project.entities.find((item) => item.id === target.id);
			return entity == null ? null : <WallTextInspector cx={cx} project={project} entity={entity} />;
		}
		case 'shot': {
			const shot = project.design.camera.shots.find((item) => item.id === target.id);
			return shot == null ? null : <ShotInspector cx={cx} project={project} shot={shot} />;
		}
		case 'marble': {
			const lane = project.music.lanes.find((item) => item.id === target.laneId);
			const marble = project.entities.find((item) => item.id === target.entityId);
			if (lane == null || marble == null) return null;
			return (
				<>
					<LaneInspector cx={cx} project={project} lane={lane} marble={marble} isFilm={isFilm} />
					{isFilm ? <MarbleSkin cx={cx} project={project} marble={marble} /> : null}
				</>
			);
		}
		case 'song':
			return <SongInspector cx={cx} project={project} />;
		case 'camera':
			return <CameraInspector cx={cx} project={project} />;
		// Wall, lights and Decor belong to Film; inspectorTarget shows the Scene for them in Compose
		case 'wall':
			return <WallInspector cx={cx} project={project} />;
		case 'light': {
			if (target.id === KEY_LIGHT_ID) return <KeyLightInspector cx={cx} project={project} />;
			const light = addedLights(project.design).find((item) => item.id === target.id);
			return light == null ? null : <LightInspector cx={cx} project={project} light={light} />;
		}
		case 'decor': {
			const decor = project.design.decor.find((item) => item.id === target.id);
			return decor == null ? null : <DecorInspector key={decor.id} cx={cx} project={project} decor={decor} />;
		}
		case 'madeInBlender':
			return <MadeInBlenderInspector key={target.name} cx={cx} project={project} name={target.name} />;
		case 'scene':
			return <SceneInspector cx={cx} project={project} isFilm={isFilm} />;
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
	const zoom = Math.round((camera.view.scale / ZOOM_100_SCALE) * 100);
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
				commandItem(cx, 'view.zoom100'),
				'separator',
				commandItem(cx, 'view.fitAll'),
				commandItem(cx, 'view.fitWhole'),
				commandItem(cx, 'view.fitSelection'),
				commandItem(cx, 'view.fitFrame')
			]}
		/>
	);
};

// MARK: - Marble

const LaneInspector: React.FC<{ cx: StudioCx; project: TProject; lane: TLane; marble: TEntity; isFilm: boolean }> = (props) => {
	const { cx, project, lane, marble, isFilm } = props;
	const projectItems = useFeatureState(cx.library.$projectItems);
	const globalItems = useFeatureState(cx.library.$globalItems);
	const conflicts = findLaneConflicts(lane).size;

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

	// One colour per marble: the commands keep the lane and the marble on it
	const colorCommands = (color: string): TProjectCommand[] => [{ type: 'upsertLane', lane: { ...lane, color } }];
	const fixedBy = fixedColorSkinLabel(project.design, marble.components.skin, [...projectItems, ...globalItems]);

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
				{fixedBy != null ? (
					<ReadoutField label="Colour" name="Marble colour" span={2}>
						<span className="flex items-center gap-1.5">
							<span className="h-3 w-3 shrink-0 rounded-full" style={{ background: lane.color }} aria-hidden />
							<span className="truncate">Set by {fixedBy}</span>
						</span>
					</ReadoutField>
				) : (
					<MarbleColor cx={cx} color={lane.color} commandsFor={colorCommands} />
				)}
			</Panel>
			{release != null && !isFilm ? (
				<Panel id="marble.release" title="Release" defaultCollapsed>
					<ScrubField id="release-x" label="X" name="Release X" value={round1(release.position.x * 100)} unit="cm" step={0.1} precision={1} onPreview={(value) => previewRelease({ x: value / 100 })} onCommit={(value) => commitRelease({ x: value / 100 })} onCancel={() => cx.simulation.endPreview()} />
					<ScrubField id="release-y" label="Y" name="Release Y" value={round1(release.position.y * 100)} unit="cm" step={0.1} precision={1} onPreview={(value) => previewRelease({ y: value / 100 })} onCommit={(value) => commitRelease({ y: value / 100 })} onCancel={() => cx.simulation.endPreview()} />
				</Panel>
			) : null}
		</>
	);
};

/** One colour well that opens the marble colours and a hex field in a popover, like Figma's fill */
const MarbleColor: React.FC<{ cx: StudioCx; color: string; commandsFor: (color: string) => TProjectCommand[] }> = (props) => {
	const { cx, color, commandsFor } = props;
	const [isOpen, setIsOpen] = React.useState(false);
	const wellRef = React.useRef<HTMLButtonElement>(null);
	const close = React.useCallback(() => setIsOpen(false), []);

	React.useEffect(() => {
		if (!isOpen) return undefined;
		function onKeyDown(event: KeyboardEvent): void {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			setIsOpen(false);
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [isOpen]);

	return (
		<>
			<span className="mm-ifield" data-span="2">
				<label htmlFor="marble-color-well" className="mm-ifield-label">
					Colour
				</label>
				<button ref={wellRef} id="marble-color-well" className="mm-color-well" style={{ background: color }} aria-label="Marble colour" aria-haspopup="dialog" aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)} type="button" />
				<span className="mm-ifield-value text-[11px] text-[var(--text-secondary)] uppercase">{color}</span>
			</span>
			{isOpen ? (
				<InsertPopover anchor={wellRef} onClose={close} title="Colour" side="end">
					<div className="mm-insp-swatches" role="radiogroup" aria-label="Colour">
						{laneColors.map((option) => (
							<button
								key={option}
								role="radio"
								aria-checked={option === color}
								aria-label={`Colour ${option}`}
								className="h-4 w-4 rounded-full"
								style={{
									background: option,
									boxShadow: option === color ? '0 0 0 2px var(--content), 0 0 0 3.5px var(--text-secondary)' : 'inset 0 0 0 0.5px rgb(0 0 0 / 0.2)'
								}}
								onClick={() => cx.execute(commandsFor(option))}
								type="button"
							/>
						))}
					</div>
					<ColorWell cx={cx} id="marble-color" label="Hex" name="Marble colour" own={color} shown={color} commandsFor={(value) => (value != null ? commandsFor(value) : [])} />
				</InsertPopover>
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
				/>
				<Panel id="hit.playedBy" title="Played By" accessory={<HelpTip text="Handing a note to another marble takes its platform along; handing it to Backing removes the platform." />}>
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
	// An open hit no platform can play yet says why (Too Soon, Out of Reach) and offers the fixes in Played By
	const reach = !isBacking && piece == null && hitResult?.status === 'open' ? hitReach(project, result, hitResult) : null;
	const unreachable = reach != null && hitResult != null && isUnreachable(reach) ? unreachableStatus(project, result, hitResult) : null;
	const fixes = unreachable != null && reach != null && hitResult != null ? unreachableActions(cx, hitResult, releaseFixFor(project, hitResult, reach)) : [];
	const pieceLabel = piece == null ? '' : (piece.name ?? getPieceDefinition(piece.components.piece?.type ?? '')?.label ?? 'Piece');
	const timing =
		piece == null
			? unreachable == null
				? null
				: { tone: 'warn' as const, label: unreachable.label, detail: unreachable.detail }
			: timingStatus(result?.pieces.find((item) => item.entityId === piece.id), hitResult, { marble: lane.name, piece: pieceLabel, isOffDot: piece.components.hitLink?.pinnedPosition != null });
	const openHit = hitResult?.status === 'open' && hitResult.dot != null ? hitResult : null;

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
				fix={(timing?.tone === 'bad' || timing?.tone === 'warn') && piece != null && !isBacking ? <ReplaceButton cx={cx} laneId={lane.id} hitId={hit.id} /> : null}
			/>
			<Panel
				id="hit.note"
				title={hit.pitch != null ? 'Note' : 'Hit'}
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
					max={project.end}
					onCommit={(time) => setHit({ time })}
				/>
			</Panel>
			{piece != null && !isBacking && soundsHit(piece.components.piece?.type ?? '', piece.components.hitLink) && layoutOf(piece.components.piece?.type ?? '') === 'box' ? (
				<Panel id="hit.platform" title={pieceLabel}>
					<PlatformFields cx={cx} project={project} entity={piece} />
				</Panel>
			) : null}
			<Panel id="hit.playedBy" title="Played By" accessory={<HelpTip text="Backing is heard in the film, no platform needed. Handing a note to another marble takes its platform along; handing it to Backing removes the platform." />}>
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
 * The Song layer's inspector: the file and its kind, tempo and meter, and Replace Song…, then the
 * same Parts as the expanded Song row, each with Sound, Mute and Solo, or a recording's one Mute and Solo. The layer exists only while the project has a song file or Backing notes.
 */
const SongInspector: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const song = songSource(project);
	const tempo = project.music.tempo;
	const parts = songParts(project);
	const kind = song == null ? 'Backing' : song.kind === 'audio' ? 'Recording' : 'MIDI';

	return (
		<>
			<InspectorHeader
				icon={song?.kind === 'audio' ? <AudioLines size={16} strokeWidth={1.7} /> : <FileMusic size={16} strokeWidth={1.7} />}
				title={SONG_LAYER_LABEL}
				subtitle={song != null ? `${song.name} · ${kind}` : kind}
			/>
			<Panel id="song.file" title="Song">
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
				<button className="mm-button" data-span="2" onClick={() => void (song == null ? cx.importSong() : cx.sources.replaceSong())} title="Choose another MIDI file or recording; the marbles keep their hits" type="button">
					{song == null ? 'Import Song…' : 'Replace Song…'}
				</button>
			</Panel>
			{song?.kind === 'audio' ? (
				<Panel id="song.sound" title="Sound">
					<div className="flex items-center justify-between" data-span="2">
						<span className="truncate">{song.name}</span>
						<PartToggles cx={cx} id={SONG_MIX_ID} name="Song" />
					</div>
				</Panel>
			) : parts.length > 0 ? (
				<Panel id="song.parts" title="Parts" accessory={<HelpTip text="Each marble plays a slice of the song; Backing is the notes no marble plays, heard with no platform needed. Solo a Part to hear just that slice. Muted Parts are also left out of the film's sound." />}>
					{parts.map((part) => (
						<React.Fragment key={part.id}>
							<div className="flex min-w-0 items-center gap-1.5" data-span="2">
								<span className="mm-track-chip shrink-0" style={{ background: part.color }} aria-hidden />
								<span className="min-w-0 flex-1 truncate font-medium">{part.name}</span>
								<span className="mm-insp-secondary shrink-0 text-[11px]">
									{part.noteCount} {part.noteCount === 1 ? 'note' : 'notes'}
								</span>
								<PartToggles cx={cx} id={part.id} name={part.name} />
							</div>
							<SelectField
								id={`part-sound-${part.id}`}
								label="Sound"
								value={String(part.instrument)}
								options={instruments.map((item) => ({ value: String(item.program), label: item.name }))}
								onChange={(value) => setPartSound(cx, part, Number(value))}
							/>
						</React.Fragment>
					))}
				</Panel>
			) : null}
		</>
	);
};

// MARK: - Scene

/**
 * The Scene, selected by its row in Layers or by clearing the selection, like Blender's Scene properties: only what the
 * whole film shares. Film shows the Theme row and Format. Compose shows Gravity. The length is the transport's and
 * the ruler's; each layer keeps its own settings.
 */
const SceneInspector: React.FC<{ cx: StudioCx; project: TProject; isFilm: boolean }> = (props) => {
	const { cx, project, isFilm } = props;
	const speed = project.physics.gravityScale;

	const withSpeed = (gravityScale: number): TProject => ({ ...project, physics: { ...project.physics, gravityScale } });

	return (
		<>
			<InspectorHeader icon={<Globe size={16} strokeWidth={1.7} />} title="Scene" subtitle={formatTime(project.end)} />
			{isFilm ? (
				<Panel id="scene.film" title="Film" accessory={<HelpTip text={`${THEME_HELP} Picking a theme keeps your changes on the layers. Export Pack… keeps a look as a theme. Format is the shape of the film: Portrait suits phones and Shorts; the camera frames the marbles for it.`} />}>
					<ThemeRow cx={cx} project={project} />
					<FormatField cx={cx} project={project} />
				</Panel>
			) : (
				<Panel id="scene.compose" title="Film" accessory={<HelpTip text="Gravity: how fast all marbles fall. Lower gives smaller hops and a denser track; hits stay on time." />}>
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
							cx.execute([{ type: 'setPhysics', physics: { gravityScale: value } }]);
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
