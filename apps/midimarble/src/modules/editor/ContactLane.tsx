import { Waves } from 'lucide-react';
import React from 'react';
import { formatTime, type TPerformance } from '../project';
import { classifyTimelineContact } from './timeline-contacts';

export const ContactLane: React.FC<TContactLaneProps> = (props) => {
	const {
		performance,
		objectNames,
		noteTimes,
		selectedObjectId,
		selectedNoteId,
		visibleStart,
		visibleEnd,
		zoom,
		fps,
		hidden,
		onSeek,
		onSelectNote,
		onSelectObject
	} = props;
	const markers = React.useMemo(
		() => new Map(performance?.noteMarkers.map((marker) => [marker.noteId, marker]) ?? []),
		[performance?.noteMarkers]
	);
	return (
		<div className="mm-timeline-row mm-contacts-row" hidden={hidden}>
			<div className="mm-channel">
				<span className="mm-channel-indent" />
				<Waves size={13} />
				<strong>Contacts</strong>
				<span className="mm-channel-meta" title="Read-only physical simulation results">
					Simulated
				</span>
			</div>
			<div className="mm-contact-lane">
				{performance?.impacts
					.filter((impact) => impact.time >= visibleStart && impact.time <= visibleEnd)
					.map((impact) => {
						const noteTime = impact.noteId == null ? undefined : noteTimes.get(impact.noteId);
						const marker = impact.noteId == null ? undefined : markers.get(impact.noteId);
						const kind = classifyTimelineContact(impact, noteTime, marker);
						const aligned =
							kind === 'primary' && noteTime != null && Math.abs(impact.time - noteTime) <= 1 / fps;
						const selected =
							selectedObjectId === impact.objectId ||
							(impact.noteId != null && selectedNoteId === impact.noteId);
						let detail = 'Unpitched surface contact';
						if (kind === 'primary' && noteTime != null)
							detail = `Primary note contact · ${Math.round((impact.time - noteTime) * 1000)} ms from MIDI`;
						else if (kind === 'recontact' || kind === 'extra') {
							detail = kind === 'recontact' ? 'Recontact' : 'Extra physical contact';
							if (noteTime != null)
								detail += ` · MIDI remains at ${formatTime(noteTime)} (pitched audio)`;
						}
						const label = `${objectNames.get(impact.objectId) ?? 'Object'} · ${formatTime(impact.time)} · ${detail}`;
						return (
							<button
								type="button"
								key={`${impact.marbleId ?? 'main'}-${impact.objectId}-${impact.time}`}
								className={`mm-contact-marker ${aligned ? 'is-aligned' : ''} ${selected ? 'is-selected' : ''}`}
								style={{ left: impact.time * zoom }}
								aria-label={label}
								title={label}
								onClick={() => {
									onSeek(impact.time);
									if (impact.noteId != null && noteTime != null) onSelectNote(impact.noteId);
									else onSelectObject?.(impact.objectId);
								}}
							/>
						);
					})}
			</div>
		</div>
	);
};

interface TContactLaneProps {
	performance: TPerformance | null;
	objectNames: ReadonlyMap<string, string>;
	noteTimes: ReadonlyMap<string, number>;
	selectedObjectId?: string | null;
	selectedNoteId: string | null;
	visibleStart: number;
	visibleEnd: number;
	zoom: number;
	fps: number;
	hidden: boolean;
	onSeek(time: number): void;
	onSelectNote(id: string): void;
	onSelectObject?(id: string): void;
}
