import { useFeatureState } from 'feature-react/state';
import { Circle, Plus } from 'lucide-react';
import React from 'react';
import { MenuButton } from '@/components';
import { createLane, createMarble } from '@/modules/project';
import type { StudioCx } from './StudioCx';

export const Sidebar: React.FC<TSidebarProps> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const selection = useFeatureState(cx.$selection);
	const workspace = useFeatureState(cx.$workspace);
	const project = history?.present;
	if (project == null) return null;

	function addMarble(): void {
		if (project == null) return;
		const lane = createLane(project.music.lanes.length);
		const offset = project.music.lanes.length * 0.12;
		cx.execute([
			{ type: 'upsertLane', lane },
			{ type: 'upsertEntity', entity: createMarble(lane, { x: offset, y: 0.6 }) }
		]);
	}

	return (
		<aside className="flex w-[232px] shrink-0 flex-col overflow-y-auto bg-[var(--chrome)] pb-3" aria-label="Sidebar">
			{workspace === 'compose' ? (
				<>
					<div className="flex items-center justify-between pr-3">
						<div className="mm-section-title">Marbles</div>
						<MenuButton
							className="mm-icon-button !h-6 !w-6"
							label={<Plus size={14} strokeWidth={1.8} />}
							title="Add"
							items={[
								{ label: 'Add Marble', onSelect: addMarble },
								'separator',
								{ label: 'Import MIDI…', shortcut: '⌘I', onSelect: () => void cx.sources.pickMidi() },
								{ label: 'Import Audio…', shortcut: '⇧⌘I', onSelect: () => void cx.sources.pickAudio() }
							]}
						/>
					</div>
					{project.music.lanes.map((lane) => {
						const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
						const pieces = project.entities.filter((entity) => entity.components.hitLink?.laneId === lane.id);
						const id = marble?.id ?? lane.id;
						return (
							<React.Fragment key={lane.id}>
								<button
									className="mm-row w-[calc(100%-16px)] text-left"
									data-selected={selection.includes(id)}
									onClick={() => cx.$selection.set([id])}
									type="button"
								>
									<Circle size={11} fill={lane.color} color={lane.color} />
									<span className="flex-1 truncate">{lane.name}</span>
									<span className="text-[11px] text-[var(--text-tertiary)]">{lane.hits.length}</span>
								</button>
								{pieces.map((piece) => (
									<button
										key={piece.id}
										className="mm-row w-[calc(100%-16px)] pl-7 text-left"
										data-selected={selection.includes(piece.id)}
										onClick={() => cx.$selection.set([piece.id])}
										type="button"
									>
										<span className="flex-1 truncate">{piece.name ?? piece.components.piece?.type ?? 'Piece'}</span>
									</button>
								))}
							</React.Fragment>
						);
					})}
				</>
			) : (
				<>
					<div className="mm-section-title">Library</div>
					<div className="px-4 py-2 text-[12px] text-[var(--text-tertiary)]">
						Themes and saved assets appear here.
					</div>
				</>
			)}
		</aside>
	);
};

interface TSidebarProps {
	cx: StudioCx;
}
