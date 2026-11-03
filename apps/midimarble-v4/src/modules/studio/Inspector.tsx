import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { findLaneConflicts, instruments, MIN_HIT_GAP } from '@/modules/music';
import { createId, laneColors, type TLane, type TProject } from '@/modules/project';
import { parseHitKey } from './selection';
import type { StudioCx } from './StudioCx';

export const Inspector: React.FC<TInspectorProps> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const selection = useFeatureState(cx.$selection);
	const project = history?.present;
	if (project == null) return null;
	const entity = project.entities.find((item) => item.id === selection[0]);
	const hitKeys = selection.filter((key) => parseHitKey(key) != null);
	const marbleLane = project.music.lanes.find((lane) => lane.id === entity?.components.marble?.laneId);

	return (
		<aside
			className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-t border-l border-[var(--separator)] bg-[var(--content)]"
			aria-label="Inspector"
		>
			{hitKeys.length > 0 ? (
				<HitInspector cx={cx} project={project} hitKeys={hitKeys} />
			) : marbleLane != null ? (
				<LaneInspector cx={cx} project={project} lane={marbleLane} />
			) : entity == null ? (
				<ProjectInspector cx={cx} project={project} />
			) : (
				<div className="p-3">
					<div className="mb-2 text-[13px] font-semibold">{entity.name ?? 'Selection'}</div>
					<div className="text-[12px] text-[var(--text-secondary)]">
						{Object.keys(entity.components).join(', ')}
					</div>
				</div>
			)}
		</aside>
	);
};

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

	return (
		<div className="flex flex-col gap-1 py-2">
			<div className="mm-section-title">Marble</div>
			<div className="flex flex-col gap-1.5 px-3">
				<div className="mm-field">
					<label htmlFor="lane-name">Name</label>
					<CommitInput
						id="lane-name"
						value={lane.name}
						onCommit={(name) => cx.execute([{ type: 'upsertLane', lane: { ...lane, name } }])}
					/>
				</div>
				<div className="mm-field">
					<label htmlFor="lane-color">Color</label>
					<div className="flex gap-1.5">
						{laneColors.map((color) => (
							<button
								key={color}
								aria-label={`Color ${color}`}
								className="h-4 w-4 rounded-full"
								style={{
									background: color,
									boxShadow: color === lane.color ? '0 0 0 2px var(--content), 0 0 0 3.5px var(--accent)' : undefined
								}}
								onClick={() => {
									const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
									const marbleComponent = marble?.components.marble;
									cx.execute([
										{ type: 'upsertLane', lane: { ...lane, color } },
										...(marble == null || marbleComponent == null
											? []
											: [
													{
														type: 'setComponent' as const,
														entityId: marble.id,
														component: { name: 'marble' as const, value: { ...marbleComponent, color } }
													}
												])
									]);
								}}
								type="button"
							/>
						))}
					</div>
				</div>
				{audio == null ? (
					<div className="mm-field">
						<label htmlFor="lane-instrument">Sound</label>
						<select
							id="lane-instrument"
							className="mm-input"
							value={lane.instrument}
							onChange={(event) =>
								cx.execute([{ type: 'upsertLane', lane: { ...lane, instrument: Number(event.target.value) } }])
							}
						>
							{instruments.map((item) => (
								<option key={item.program} value={item.program}>
									{item.name}
								</option>
							))}
						</select>
					</div>
				) : null}
				<div className="mm-field">
					<span />
					<span className="text-[12px] text-[var(--text-secondary)]">
						{lane.hits.length} hits{conflicts > 0 ? ` · ${conflicts} closer than 180 ms` : ''}
					</span>
				</div>
			</div>
			{suggestions != null ? (
				<>
					<div className="mm-section-title">Recording</div>
					<div className="flex flex-col gap-2 px-3">
						<div className="text-[12px] leading-snug text-[var(--text-secondary)]">
							{suggestions.length} possible hits were found in “{audio?.name}”. Tap along with T while playing, or add
							them all and remove the ones you don’t want.
						</div>
						<button className="mm-button self-start" onClick={addSuggestedHits} type="button">
							Add Suggested Hits
						</button>
					</div>
				</>
			) : null}
		</div>
	);
};

const HitInspector: React.FC<{ cx: StudioCx; project: TProject; hitKeys: string[] }> = (props) => {
	const { cx, project, hitKeys } = props;
	const hits = hitKeys.flatMap((key) => {
		const parsed = parseHitKey(key);
		const lane = project.music.lanes.find((item) => item.id === parsed?.laneId);
		const hit = lane?.hits.find((item) => item.id === parsed?.hitId);
		return lane == null || hit == null ? [] : [{ lane, hit }];
	});
	const single = hits.length === 1 ? hits[0] : undefined;

	return (
		<div className="flex flex-col gap-1 py-2">
			<div className="mm-section-title">{hits.length === 1 ? 'Hit' : `${hits.length} Hits`}</div>
			{single != null ? (
				<div className="flex flex-col gap-1.5 px-3">
					<div className="mm-field">
						<label htmlFor="hit-time">Time</label>
						<CommitInput
							id="hit-time"
							value={single.hit.time.toFixed(3)}
							suffix="s"
							onCommit={(value) => {
								const time = Number(value);
								if (Number.isFinite(time) && time >= 0) {
									cx.execute([{ type: 'upsertHits', laneId: single.lane.id, hits: [{ ...single.hit, time }] }]);
								}
							}}
						/>
					</div>
					<div className="mm-field">
						<label htmlFor="hit-pitch">Pitch</label>
						<CommitInput
							id="hit-pitch"
							value={single.hit.pitch == null ? '' : noteName(single.hit.pitch)}
							onCommit={(value) => {
								const pitch = parseNoteName(value);
								if (pitch !== undefined) {
									cx.execute([
										{
											type: 'upsertHits',
											laneId: single.lane.id,
											hits: [{ ...single.hit, pitch: pitch ?? undefined }]
										}
									]);
								}
							}}
						/>
					</div>
					<div className="mm-field">
						<span />
						<span className="text-[12px] text-[var(--text-secondary)]">{single.lane.name}</span>
					</div>
				</div>
			) : (
				<div className="px-3 text-[12px] text-[var(--text-secondary)]">
					Drag to move them together. Press Delete to remove them.
				</div>
			)}
		</div>
	);
};

const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

function noteName(pitch: number): string {
	return `${noteNames[pitch % 12] ?? 'C'}${Math.floor(pitch / 12) - 1}`;
}

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

interface TInspectorProps {
	cx: StudioCx;
}

/** Shown without a selection, like page properties in Figma */
const ProjectInspector: React.FC<TProjectInspectorProps> = (props) => {
	const { cx, project } = props;
	const aspect = aspects.find((item) => item.width === project.frame.width && item.height === project.frame.height);

	return (
		<div className="flex flex-col gap-1 py-2">
			<div className="mm-section-title">Project</div>
			<div className="flex flex-col gap-1.5 px-3">
				<div className="mm-field">
					<label htmlFor="project-title">Title</label>
					<CommitInput
						id="project-title"
						value={project.title}
						onCommit={(title) => cx.execute([{ type: 'setTitle', title }])}
					/>
				</div>
				<div className="mm-field">
					<label htmlFor="project-frame">Frame</label>
					<select
						id="project-frame"
						className="mm-input"
						value={aspect?.label ?? 'custom'}
						onChange={(event) => {
							const next = aspects.find((item) => item.label === event.target.value);
							if (next != null) cx.execute([{ type: 'setFrame', width: next.width, height: next.height }]);
						}}
					>
						{aspects.map((item) => (
							<option key={item.label} value={item.label}>
								{item.label}
							</option>
						))}
						{aspect == null ? <option value="custom">Custom</option> : null}
					</select>
				</div>
				<div className="mm-field">
					<label htmlFor="project-end">Length</label>
					<CommitInput
						id="project-end"
						value={project.end.toFixed(2)}
						suffix="s"
						onCommit={(value) => {
							const end = Number(value);
							if (Number.isFinite(end) && end > 0) cx.execute([{ type: 'setEnd', end }]);
						}}
					/>
				</div>
			</div>
		</div>
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
	const { id, value, suffix, onCommit } = props;
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
				value={draft}
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
				<span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-[var(--text-tertiary)]">
					{suffix}
				</span>
			) : null}
		</div>
	);
};

interface TCommitInputProps {
	id: string;
	value: string;
	suffix?: string;
	onCommit: (value: string) => void;
}
