import { useFeatureState } from 'feature-react/state';
import { Minus, Plus } from 'lucide-react';
import React from 'react';
import { HelpTip } from '@/components';
import { marbleColors } from '@/modules/project';
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
	const maxMarbles = pending.options.maxMarbles ?? 4;
	const end = Math.max(1, ...[...preview.lanes.flat(), ...preview.backing].map((note) => note.time + note.duration));
	const rows = [
		...preview.lanes.map((notes, index) => ({ key: `marble-${index}`, name: preview.names[index] ?? `Marble ${index + 1}`, color: marbleColors[index % marbleColors.length] ?? 'var(--accent)', notes })),
		...(preview.backing.length > 0 ? [{ key: 'backing', name: 'Backing', color: BACKING_COLOR, notes: preview.backing }] : [])
	];

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
				aria-modal
				aria-label="Import MIDI"
				className="mt-[60px] flex h-fit w-[480px] flex-col gap-4 rounded-[12px] bg-[var(--content-raised)] p-5"
				style={{ boxShadow: 'var(--shadow-popover)' }}
			>
				<div className="flex items-center gap-1.5">
					<div className="flex-1 font-semibold">Import “{pending.file.name}”</div>
					<HelpTip text="Marbles play the notes of the checked parts, one note at a time and at least 180 ms apart. Every other note plays as Backing: heard in the film, no platform needed. Drum parts are left out." />
				</div>

				<div className="flex max-h-[180px] flex-col overflow-y-auto rounded-[8px] border border-[var(--separator)] bg-[var(--content)]">
					{pending.midi.tracks.map((track) => (
						<label key={track.id} className="flex h-7 items-center gap-2 border-b border-[var(--separator)] px-3 last:border-b-0">
							<input type="checkbox" className="mm-checkbox" checked={pending.trackIds.includes(track.id)} onChange={() => toggleTrack(track.id)} />
							<span className="flex-1 truncate">{track.name}</span>
							{track.isDrums ? <span className="text-[11px] text-[var(--text-tertiary)]">Drums</span> : null}
							<span className="mm-tabular text-[11px] text-[var(--text-secondary)]">{track.notes.length} notes</span>
						</label>
					))}
				</div>

				<div className="flex items-center gap-3">
					<span className="w-[64px] text-right text-[var(--text-secondary)]">Chords</span>
					<div className="mm-segmented">
						<button
							data-active={strategy === 'split'}
							onClick={() => cx.sources.updateMidiImport({ options: { ...pending.options, strategy: 'split' } })}
							type="button"
						>
							Split Across Marbles
						</button>
						<button
							data-active={strategy === 'melody'}
							onClick={() => cx.sources.updateMidiImport({ options: { ...pending.options, strategy: 'melody' } })}
							type="button"
						>
							Keep Top Note
						</button>
					</div>
				</div>
				{strategy === 'split' ? (
					<div className="flex items-center gap-3">
						<span className="w-[64px] text-right text-[var(--text-secondary)]">Marbles</span>
						<div className="flex items-center gap-1.5">
							<span className="text-[var(--text-secondary)]">Up to</span>
							<button
								className="mm-icon-button !h-6 !w-6"
								disabled={maxMarbles <= 1}
								onClick={() => cx.sources.updateMidiImport({ options: { ...pending.options, maxMarbles: maxMarbles - 1 } })}
								title="Fewer marbles"
								type="button"
							>
								<Minus size={13} />
							</button>
							<span className="mm-tabular w-5 text-center">{maxMarbles}</span>
							<button
								className="mm-icon-button !h-6 !w-6"
								disabled={maxMarbles >= 6}
								onClick={() => cx.sources.updateMidiImport({ options: { ...pending.options, maxMarbles: maxMarbles + 1 } })}
								title="More marbles"
								type="button"
							>
								<Plus size={13} />
							</button>
						</div>
					</div>
				) : null}

				<div className="flex flex-col gap-0.5 rounded-[8px] bg-[var(--canvas)] px-3 py-2" aria-label="Where the notes go">
					{rows.map((row) => (
						<div key={row.key} className="flex h-4 items-center gap-2">
							<span className="w-[64px] shrink-0 truncate text-[11px] text-[var(--text-secondary)]">{row.name}</span>
							<span className="relative h-full flex-1">
								{row.notes.map((note) => (
									<span
										key={`${note.time}-${note.pitch}-${note.duration}-${note.velocity}`}
										className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
										style={{ left: `${(note.time / end) * 100}%`, background: row.color }}
									/>
								))}
							</span>
							<span className="mm-tabular w-[64px] shrink-0 text-right text-[11px] text-[var(--text-secondary)]">
								{row.notes.length} {row.notes.length === 1 ? 'note' : 'notes'}
							</span>
						</div>
					))}
				</div>

				<div className="flex justify-end gap-2">
					<button className="mm-button" data-size="dialog" onClick={() => cx.sources.cancelMidiImport()} title="Cancel (Esc)" type="button">
						Cancel
					</button>
					<button
						className="mm-button"
						data-size="dialog"
						title="Import (↩)"
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

const BACKING_COLOR = 'var(--text-tertiary)';
