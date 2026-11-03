import { useFeatureState } from 'feature-react/state';
import { Minus, Plus } from 'lucide-react';
import React from 'react';
import { laneColors } from '@/modules/project';
import { previewMidiImport } from './SourcesCx';
import type { StudioCx } from './StudioCx';

/** Review step for a MIDI import, presented as a macOS sheet */
export const ImportMidiSheet: React.FC<TImportMidiSheetProps> = (props) => {
	const { cx } = props;
	const pending = useFeatureState(cx.sources.$midiImport);
	const preview = React.useMemo(() => (pending == null ? null : previewMidiImport(pending)), [pending]);

	React.useEffect(() => {
		if (pending == null) return;
		function onKeyDown(event: KeyboardEvent): void {
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				cx.sources.cancelMidiImport();
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
				void cx.sources.confirmMidiImport();
			}
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [cx, pending]);

	if (pending == null || preview == null) return null;
	const strategy = pending.options.strategy ?? 'split';
	const maxLanes = pending.options.maxLanes ?? 4;
	const hits = preview.lanes.reduce((sum, lane) => sum + lane.length, 0);
	const end = Math.max(1, ...preview.lanes.flat().map((note) => note.time + note.duration));

	function toggleTrack(id: string): void {
		if (pending == null) return;
		const trackIds = pending.trackIds.includes(id)
			? pending.trackIds.filter((item) => item !== id)
			: [...pending.trackIds, id];
		cx.sources.updateMidiImport({ trackIds });
	}

	return (
		<div className="absolute inset-0 z-40 flex justify-center bg-black/10" onPointerDown={(event) => event.stopPropagation()}>
			<div
				role="dialog"
				aria-label="Import MIDI"
				className="mt-[52px] flex h-fit w-[520px] flex-col gap-4 rounded-b-[12px] bg-[var(--content-raised)] p-5"
				style={{ boxShadow: 'var(--shadow-popover)' }}
			>
				<div>
					<div className="text-[15px] font-semibold">Import “{pending.file.name}”</div>
					<div className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
						Each marble plays one note at a time, at least 180 ms apart.
					</div>
				</div>

				<div className="flex max-h-[180px] flex-col overflow-y-auto rounded-[8px] border border-[var(--separator)]">
					{pending.midi.tracks.map((track) => (
						<label key={track.id} className="flex h-8 items-center gap-2 border-b border-[var(--separator)] px-3 last:border-b-0">
							<input type="checkbox" checked={pending.trackIds.includes(track.id)} onChange={() => toggleTrack(track.id)} />
							<span className="flex-1 truncate">{track.name}</span>
							{track.isDrums ? <span className="text-[11px] text-[var(--text-tertiary)]">Drums</span> : null}
							<span className="text-[11px] text-[var(--text-secondary)]">{track.notes.length} notes</span>
						</label>
					))}
				</div>

				<div className="flex items-center gap-3">
					<span className="w-[70px] text-right text-[var(--text-secondary)]">Chords</span>
					<div className="mm-segmented">
						<button
							data-active={strategy === 'split'}
							onClick={() => cx.sources.updateMidiImport({ options: { ...pending.options, strategy: 'split' } })}
							type="button"
						>
							Split across marbles
						</button>
						<button
							data-active={strategy === 'melody'}
							onClick={() => cx.sources.updateMidiImport({ options: { ...pending.options, strategy: 'melody' } })}
							type="button"
						>
							Keep top note
						</button>
					</div>
				</div>
				{strategy === 'split' ? (
					<div className="flex items-center gap-3">
						<span className="w-[70px] text-right text-[var(--text-secondary)]">Marbles</span>
						<div className="flex items-center gap-1">
							<button
								className="mm-icon-button !h-6 !w-6"
								disabled={maxLanes <= 1}
								onClick={() => cx.sources.updateMidiImport({ options: { ...pending.options, maxLanes: maxLanes - 1 } })}
								title="Fewer marbles"
								type="button"
							>
								<Minus size={13} />
							</button>
							<span className="mm-mono w-5 text-center">{maxLanes}</span>
							<button
								className="mm-icon-button !h-6 !w-6"
								disabled={maxLanes >= 6}
								onClick={() => cx.sources.updateMidiImport({ options: { ...pending.options, maxLanes: maxLanes + 1 } })}
								title="More marbles"
								type="button"
							>
								<Plus size={13} />
							</button>
						</div>
					</div>
				) : null}

				<div className="rounded-[8px] bg-[var(--canvas)] p-2">
					{preview.lanes.map((lane, index) => (
						<div key={`${lane[0]?.time ?? 0}-${lane[0]?.pitch ?? 0}`} className="relative h-4">
							{lane.map((note) => (
								<span
									key={`${note.time}-${note.pitch}`}
									className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
									style={{ left: `${(note.time / end) * 100}%`, background: laneColors[index % laneColors.length] }}
								/>
							))}
						</div>
					))}
					<div className="mt-1 text-[11px] text-[var(--text-secondary)]">
						{preview.lanes.length} {preview.lanes.length === 1 ? 'marble' : 'marbles'} · {hits} hits
						{preview.dropped.length > 0 ? ` · ${preview.dropped.length} notes left out` : ''}
					</div>
				</div>

				<div className="flex justify-end gap-2">
					<button className="mm-button" onClick={() => cx.sources.cancelMidiImport()} type="button">
						Cancel
					</button>
					<button
						className="mm-button"
						data-variant="primary"
						disabled={!preview.lanes.length}
						onClick={() => void cx.sources.confirmMidiImport()}
						type="button"
					>
						Import
					</button>
				</div>
			</div>
		</div>
	);
};

interface TImportMidiSheetProps {
	cx: StudioCx;
}
