import { useFeatureState } from 'feature-react/state';
import { AudioLines, FileMusic } from 'lucide-react';
import React from 'react';
import { InfoRow, InspectorHeader, Panel, Select } from '@/components';
import { PieceInspector } from '@/modules/compose/PieceInspector';
import { badgeStatus, badgeStyles, StatusIcon } from '@/modules/compose/status';
import { findLaneConflicts, instruments, MIN_HIT_GAP } from '@/modules/music';
import { createId, laneColors, type TLane, type TProject } from '@/modules/project';
import { commandItem } from './commands';
import { formatTime, noteName, noteNames } from './format';
import { parseHitKey } from './selection';
import type { StudioCx } from './StudioCx';

/** Properties of the selection in collapsible panels, like Blender's properties editor */
export const Inspector: React.FC<TInspectorProps> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const selection = useFeatureState(cx.$selection);
	const project = history?.present;
	if (project == null) return null;
	const entity = project.entities.find((item) => item.id === selection[0]);
	const hitKeys = selection.filter((key) => parseHitKey(key) != null);
	const pieceIds = selection.filter((id) => project.entities.some((item) => item.id === id && item.components.piece != null));
	const marbleLane = project.music.lanes.find((lane) => lane.id === entity?.components.marble?.laneId);

	return (
		<aside
			className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-t border-l border-[var(--separator)] bg-[var(--content)]"
			aria-label="Inspector"
		>
			{pieceIds.length > 0 ? (
				<PieceInspector cx={cx} project={project} ids={pieceIds} />
			) : hitKeys.length > 0 ? (
				<HitInspector cx={cx} project={project} hitKeys={hitKeys} />
			) : marbleLane != null ? (
				<LaneInspector cx={cx} project={project} lane={marbleLane} />
			) : (
				<ProjectInspector cx={cx} project={project} />
			)}
		</aside>
	);
};

interface TInspectorProps {
	cx: StudioCx;
}

// MARK: - Marble

const LaneInspector: React.FC<{ cx: StudioCx; project: TProject; lane: TLane }> = (props) => {
	const { cx, project, lane } = props;
	const analysis = useFeatureState(cx.sources.$analysis);
	const audio = project.music.sources.find((source) => source.kind === 'audio');
	const suggestions = audio == null ? undefined : analysis[audio.id]?.onsets;
	const conflicts = findLaneConflicts(lane).size;

	function addSuggestedHits(): void {
		if (audio == null || suggestions == null) return;
		const existing = lane.hits.map((hit) => hit.time);
		const hits = [];
		let last = Number.NEGATIVE_INFINITY;
		for (const onset of suggestions) {
			const time = Math.round((onset + audio.offset) * 10000) / 10000;
			if (time - last < MIN_HIT_GAP) continue;
			if (existing.some((item) => Math.abs(item - time) < MIN_HIT_GAP)) continue;
			hits.push({ id: createId('hit'), time });
			last = time;
		}
		cx.execute([{ type: 'upsertHits', laneId: lane.id, hits }]);
	}

	function setColor(color: string): void {
		const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
		const marbleComponent = marble?.components.marble;
		cx.execute([
			{ type: 'upsertLane', lane: { ...lane, color } },
			...(marble == null || marbleComponent == null
				? []
				: [{ type: 'setComponent' as const, entityId: marble.id, component: { name: 'marble' as const, value: { ...marbleComponent, color } } }])
		]);
	}

	return (
		<>
			<InspectorHeader
				icon={<span className="h-3 w-3 rounded-full" style={{ background: lane.color }} />}
				title={lane.name}
				subtitle={`Marble · ${lane.hits.length} ${lane.hits.length === 1 ? 'hit' : 'hits'}`}
			/>
			<Panel id="marble.marble" title="Marble">
				<div className="mm-field">
					<label htmlFor="lane-name">Name</label>
					<CommitInput id="lane-name" value={lane.name} onCommit={(name) => cx.execute([{ type: 'upsertLane', lane: { ...lane, name } }])} />
				</div>
				<div className="mm-field">
					<span className="mm-field-label">Color</span>
					<div className="flex gap-2" role="radiogroup" aria-label="Color">
						{laneColors.map((color) => (
							<button
								key={color}
								role="radio"
								aria-checked={color === lane.color}
								aria-label={`Color ${color}`}
								className="h-4 w-4 rounded-full"
								style={{
									background: color,
									boxShadow:
										color === lane.color ? '0 0 0 2px var(--content), 0 0 0 3.5px var(--text-secondary)' : 'inset 0 0 0 0.5px rgb(0 0 0 / 0.2)'
								}}
								onClick={() => setColor(color)}
								type="button"
							/>
						))}
					</div>
				</div>
				{audio == null ? (
					<div className="mm-field">
						<label htmlFor="lane-instrument">Sound</label>
						<Select
							id="lane-instrument"
							value={String(lane.instrument)}
							options={instruments.map((item) => ({ value: String(item.program), label: item.name }))}
							onChange={(value) => cx.execute([{ type: 'upsertLane', lane: { ...lane, instrument: Number(value) } }])}
						/>
					</div>
				) : null}
			</Panel>
			<Panel id="marble.hits" title="Hits">
				<InfoRow label="Hits">
					<span className="mm-tabular">{lane.hits.length}</span>
				</InfoRow>
				{conflicts > 0 ? (
					<div className="mm-caption" style={{ color: 'var(--bad)' }}>
						{conflicts} hits are closer than {MIN_HIT_GAP * 1000} ms to a neighbor. A marble needs that long between bounces; drag them apart or
						move them to another marble.
					</div>
				) : null}
				{suggestions != null ? (
					<>
						<div className="mm-caption">
							{suggestions.length} possible hits were found in “{audio?.name}”. Tap along with T while playing, or add them all and remove the ones you
							don’t want.
						</div>
						<button className="mm-button self-start" onClick={addSuggestedHits} type="button">
							Add Suggested Hits
						</button>
					</>
				) : !lane.hits.length ? (
					<div className="mm-caption">Double-click the lane in the timeline to add a hit, or press T while playing to tap along.</div>
				) : null}
			</Panel>
		</>
	);
};

// MARK: - Hits

const HitInspector: React.FC<{ cx: StudioCx; project: TProject; hitKeys: string[] }> = (props) => {
	const { cx, project, hitKeys } = props;
	const result = useFeatureState(cx.simulation.$result);
	const hits = hitKeys.flatMap((key) => {
		const parsed = parseHitKey(key);
		const lane = project.music.lanes.find((item) => item.id === parsed?.laneId);
		const hit = lane?.hits.find((item) => item.id === parsed?.hitId);
		return lane == null || hit == null ? [] : [{ lane, hit }];
	});
	const single = hits.length === 1 ? hits[0] : undefined;

	if (single == null) {
		return (
			<>
				<InspectorHeader icon={<HitGlyph />} title={`${hits.length} Hits`} subtitle={[...new Set(hits.map((item) => item.lane.name))].join(', ')} />
				<Panel id="hit.multiple" title="Hits">
					<div className="mm-caption">Drag to move them together. Right-click to move them to another marble. Press Delete to remove them.</div>
				</Panel>
			</>
		);
	}

	const index = single.lane.hits.indexOf(single.hit);
	const piece = project.entities.find(
		(entity) => entity.components.piece != null && entity.components.hitLink?.laneId === single.lane.id && entity.components.hitLink.hitId === single.hit.id
	);
	const hitResult = result?.hits.find((item) => item.laneId === single.lane.id && item.hitId === single.hit.id);
	const status = badgeStatus(result?.pieces.find((item) => item.entityId === piece?.id)?.status, hitResult);

	return (
		<>
			<InspectorHeader icon={<HitGlyph color={single.lane.color} />} title={`Hit ${index + 1}`} subtitle={`${single.lane.name} · ${formatTime(single.hit.time)}`} />
			<Panel id="hit.hit" title="Hit">
				<div className="mm-field">
					<label htmlFor="hit-time">Time</label>
					<CommitInput
						id="hit-time"
						value={single.hit.time.toFixed(3)}
						suffix="s"
						onCommit={(value) => {
							const time = Number(value.replace(',', '.'));
							if (Number.isFinite(time) && time >= 0) cx.execute([{ type: 'upsertHits', laneId: single.lane.id, hits: [{ ...single.hit, time }] }]);
						}}
					/>
				</div>
				<div className="mm-field">
					<label htmlFor="hit-pitch">Pitch</label>
					<CommitInput
						id="hit-pitch"
						value={single.hit.pitch == null ? '' : noteName(single.hit.pitch)}
						placeholder="None"
						onCommit={(value) => {
							const pitch = parseNoteName(value);
							if (pitch !== undefined) cx.execute([{ type: 'upsertHits', laneId: single.lane.id, hits: [{ ...single.hit, pitch: pitch ?? undefined }] }]);
						}}
					/>
				</div>
			</Panel>
			<Panel id="hit.piece" title="Piece">
				{piece != null ? (
					<>
						<InfoRow label="Played by">
							<span className="truncate">{piece.name ?? 'Piece'}</span>
						</InfoRow>
						<InfoRow label="Timing">
							<StatusIcon status={status} />
							<span className="ml-1.5" style={{ color: status == null ? undefined : badgeStyles[status].color }}>
								{status == null ? 'Simulating…' : badgeStyles[status].label}
							</span>
						</InfoRow>
						<button className="mm-button self-start" onClick={() => cx.reveal([piece.id])} type="button">
							Select Piece
						</button>
					</>
				) : (
					<div className="mm-caption">No piece plays this hit yet. Click its dot on the canvas, or press N to place the next one.</div>
				)}
			</Panel>
		</>
	);
};

const HitGlyph: React.FC<{ color?: string }> = (props) => {
	const { color } = props;
	return <span className="h-2.5 w-2.5 rotate-45 rounded-[1.5px]" style={{ background: color ?? 'currentColor' }} />;
};

/** Parses names like `C5`, `F#4` or a MIDI number; empty clears the pitch, invalid returns undefined */
function parseNoteName(value: string): number | null | undefined {
	const text = value.trim().replace('#', '♯');
	if (!text.length) return null;
	if (/^\d+$/.test(text)) {
		const number = Number(text);
		return number >= 0 && number <= 127 ? number : undefined;
	}
	const match = /^([A-Ga-g]♯?)(-?\d)$/.exec(text);
	if (match == null) return undefined;
	const index = noteNames.indexOf((match[1] ?? '').toUpperCase());
	const pitch = index + (Number(match[2]) + 1) * 12;
	return index < 0 || pitch < 0 || pitch > 127 ? undefined : pitch;
}

// MARK: - Project

/** Shown without a selection, like page properties in Figma */
const ProjectInspector: React.FC<TProjectInspectorProps> = (props) => {
	const { cx, project } = props;
	const aspect = aspects.find((item) => item.width === project.frame.width && item.height === project.frame.height);
	const sources = project.music.sources;

	return (
		<>
			<InspectorHeader icon={<FileMusic size={15} strokeWidth={1.7} />} title={project.title} subtitle={`Project · ${aspect?.label ?? 'Custom frame'}`} />
			<Panel id="project.project" title="Project">
				<div className="mm-field">
					<label htmlFor="project-title">Title</label>
					<CommitInput id="project-title" value={project.title} onCommit={(title) => cx.execute([{ type: 'setTitle', title }])} />
				</div>
				<div className="mm-field">
					<label htmlFor="project-frame">Frame</label>
					<Select
						id="project-frame"
						value={aspect?.label ?? 'custom'}
						options={[...aspects.map((item) => ({ value: item.label, label: item.label })), ...(aspect == null ? [{ value: 'custom', label: 'Custom' }] : [])]}
						onChange={(value) => {
							const next = aspects.find((item) => item.label === value);
							if (next != null) cx.execute([{ type: 'setFrame', width: next.width, height: next.height }]);
						}}
					/>
				</div>
				<div className="mm-field">
					<label htmlFor="project-end">Length</label>
					<CommitInput
						id="project-end"
						value={project.end.toFixed(2)}
						suffix="s"
						onCommit={(value) => {
							const end = Number(value.replace(',', '.'));
							if (Number.isFinite(end) && end > 0) cx.execute([{ type: 'setEnd', end }]);
						}}
					/>
				</div>
			</Panel>
			<Panel id="project.music" title="Music">
				{sources.map((source) => (
					<div key={source.id} className="flex h-6 items-center gap-2">
						{source.kind === 'audio' ? (
							<AudioLines size={14} strokeWidth={1.7} className="shrink-0 text-[var(--text-secondary)]" />
						) : (
							<FileMusic size={14} strokeWidth={1.7} className="shrink-0 text-[var(--text-secondary)]" />
						)}
						<span className="min-w-0 flex-1 truncate">{source.name}</span>
						<span className="text-[11px] text-[var(--text-tertiary)]">{source.kind === 'audio' ? 'Recording' : 'MIDI'}</span>
					</div>
				))}
				{!sources.length ? <div className="mm-caption">Import a MIDI file to get marbles and hits, or a recording to tap along to.</div> : null}
				<div className="flex gap-2">
					<button className="mm-button" onClick={() => commandItem(cx, 'file.importMidi').onSelect()} title="Import MIDI (⌘I)" type="button">
						Import MIDI…
					</button>
					<button className="mm-button" onClick={() => commandItem(cx, 'file.importAudio').onSelect()} title="Import Audio (⇧⌘I)" type="button">
						Import Audio…
					</button>
				</div>
			</Panel>
		</>
	);
};

interface TProjectInspectorProps {
	cx: StudioCx;
	project: TProject;
}

const aspects = [
	{ label: '9:16 Portrait', width: 9, height: 16 },
	{ label: '1:1 Square', width: 1, height: 1 },
	{ label: '4:5 Portrait', width: 4, height: 5 },
	{ label: '16:9 Landscape', width: 16, height: 9 }
];

/** Text input that commits on Return or blur and reverts on Escape, like native inspectors */
export const CommitInput: React.FC<TCommitInputProps> = (props) => {
	const { id, value, suffix, placeholder, onCommit } = props;
	const [draft, setDraft] = React.useState(value);
	const [source, setSource] = React.useState(value);
	// Reset the draft during render when the committed value changes elsewhere, such as through undo
	if (source !== value) {
		setSource(value);
		setDraft(value);
	}

	function commit(): void {
		if (draft !== value) onCommit(draft);
	}

	return (
		<div className="relative">
			<input
				id={id}
				className="mm-input"
				style={{ paddingRight: suffix != null ? 20 : undefined }}
				value={draft}
				placeholder={placeholder}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === 'Enter') event.currentTarget.blur();
					if (event.key === 'Escape') {
						setDraft(value);
						requestAnimationFrame(() => (event.target as HTMLInputElement).blur());
					}
				}}
			/>
			{suffix != null ? (
				<span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-[var(--text-tertiary)]">{suffix}</span>
			) : null}
		</div>
	);
};

interface TCommitInputProps {
	id: string;
	value: string;
	suffix?: string;
	placeholder?: string;
	onCommit: (value: string) => void;
}
