import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { ContextMenuHost } from '@/components';
import { ExportSheet } from '@/modules/design/ExportSheet';
import { AgentChat } from './AgentChat';
import { CommandPalette } from './CommandPalette';
import { HintLayer } from './HintLayer';
import { ImportMidiSheet } from './ImportMidiSheet';
import { Inspector } from './Inspector';
import { Notice } from './Notice';
import { QuickHelp } from './QuickHelp';
import { SaveChangesAlert } from './SaveChangesAlert';
import { Sidebar } from './Sidebar';
import type { StudioCx } from './StudioCx';
import { TitleBar } from './TitleBar';
import { ToolRail } from './ToolRail';
import { Timeline } from './timeline';
import { useFileDrop } from './use-file-drop';
import { usePlayback } from './use-playback';
import { useStudioShortcuts } from './use-studio-shortcuts';

export const Studio: React.FC<TStudioProps> = (props) => {
	const { cx, canvas } = props;
	const workspace = useFeatureState(cx.$workspace);
	const panels = useFeatureState(cx.$panels);

	useStudioShortcuts(cx);
	usePlayback(cx);
	const isDropping = useFileDrop(cx);

	return (
		<div className="relative flex h-full flex-col">
			<TitleBar cx={cx} />
			<div className="flex min-h-0 flex-1">
				{panels.sidebar ? <Sidebar cx={cx} /> : null}
				<div className="flex min-w-0 flex-1 flex-col">
					<div className="flex min-h-0 flex-1">
						<ToolRail cx={cx} />
						<main className="relative min-w-0 flex-1" data-quick-help="wall" aria-label={workspace === 'compose' ? 'Compose wall' : 'Film preview'}>
							{canvas}
							<Notice cx={cx} />
						</main>
						{panels.inspector ? <Inspector cx={cx} /> : null}
					</div>
					{panels.timeline ? <Timeline cx={cx} /> : null}
				</div>
				{panels.agent ? <AgentChat cx={cx} /> : null}
			</div>
			<ImportMidiSheet cx={cx} />
			<ExportSheet cx={cx} />
			<CommandPalette cx={cx} />
			<SaveChangesAlert cx={cx} />
			<HintLayer cx={cx} />
			<QuickHelp cx={cx} />
			<ContextMenuHost />
			{isDropping ? <DropOverlay /> : null}
		</div>
	);
};

interface TStudioProps {
	cx: StudioCx;
	canvas: React.ReactNode;
}

/** Drop target highlight while a file is dragged over the window, like Finder and Logic */
const DropOverlay: React.FC = () => (
	<div className="pointer-events-none absolute inset-0 z-50 p-2">
		<div
			className="flex h-full items-center justify-center rounded-[10px] border-2 border-[var(--accent-strong)]"
			style={{ background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}
		>
			<div className="mm-floating px-4 py-2.5 text-center">
				<div className="font-semibold">Drop to Import Song</div>
				<div className="mm-caption">A MIDI file becomes marbles. A recording plays behind the tracks.</div>
			</div>
		</div>
	</div>
);
