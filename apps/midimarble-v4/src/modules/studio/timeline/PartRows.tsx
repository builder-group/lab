import { ChevronsUpDown } from 'lucide-react';
import React from 'react';
import { MenuButton } from '@/components';
import { instruments, setPartSoundCommands, type TPart } from '@/modules/music';
import type { TProject } from '@/modules/project';
import type { StudioCx } from '../StudioCx';
import { auditionNote } from './hand-notes';
import { PartToggles } from './PartToggles';
import { TimeGutter } from './Ruler';
import { NoteOverview } from './SongTrack';
import { HEADER_WIDTH, PART_ROW_HEIGHT } from './timeline-layout';

/** Gives a Part another Sound and plays its first note with it */
export function setPartSound(cx: StudioCx, part: TPart, instrument: number): void {
	const project = cx.project;
	if (project == null) return;
	if (cx.execute(setPartSoundCommands(project, part.id, instrument))) auditionNote(cx, part.id, part.firstPitch);
}

/**
 * The expanded Song's Parts below its piano roll: one row per marble that plays notes and Backing, with its Sound,
 * Mute and Solo beside the notes it plays, which is how to listen to one marble's slice of the song
 */
export const PartRows: React.FC<TPartRowsProps> = (props) => {
	const { cx, project, parts, zoom, width, isAudible } = props;
	return (
		<>
			{parts.map((part) => (
				<div key={part.id} className="flex shrink-0" style={{ height: PART_ROW_HEIGHT }} data-part={part.id}>
					<div className="mm-track-header sticky left-0 z-20 flex shrink-0 items-center gap-1 border-r border-b border-[var(--separator)] pr-1.5 pl-5" style={{ width: HEADER_WIDTH, height: PART_ROW_HEIGHT }}>
						<span className="mm-track-chip" style={{ background: part.color }} aria-hidden />
						<span className="min-w-0 flex-1 truncate pl-0.5 text-[11px] font-medium" title={`${part.name} · ${part.noteCount} ${part.noteCount === 1 ? 'note' : 'notes'}`}>
							{part.name}
						</span>
						<MenuButton
							className="mm-part-sound"
							title={`Sound of ${part.name}`}
							label={
								<>
									<span className="truncate">{instruments.find((item) => item.program === part.instrument)?.name ?? 'Sound'}</span>
									<ChevronsUpDown size={10} strokeWidth={2} className="shrink-0" />
								</>
							}
							items={instruments.map((item) => ({ label: item.name, checked: item.program === part.instrument, onSelect: () => setPartSound(cx, part, item.program) }))}
						/>
						<PartToggles cx={cx} id={part.id} name={part.name} />
					</div>
					<TimeGutter />
					<div className="mm-song-lane relative flex-1 overflow-hidden border-b border-[var(--separator)]" style={{ minWidth: width, opacity: isAudible(part.id) ? 1 : 0.35 }} aria-label={`Notes of ${part.name}`}>
						<NoteOverview project={project} only={part.id} zoom={zoom} width={width} height={PART_ROW_HEIGHT - 1} />
					</div>
				</div>
			))}
		</>
	);
};

interface TPartRowsProps {
	cx: StudioCx;
	project: TProject;
	parts: TPart[];
	zoom: number;
	width: number;
	isAudible: (partId: string) => boolean;
}
