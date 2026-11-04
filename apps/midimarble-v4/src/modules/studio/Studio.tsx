import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { ContextMenuHost } from '@/components';
import { ExportSheet } from '@/modules/design/ExportSheet';
import { AgentChat } from './AgentChat';
import { CommandPalette } from './CommandPalette';
import { ConfirmAlert } from './ConfirmAlert';
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
	useInspectorAutoHide(cx);
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
			<ConfirmAlert cx={cx} />
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

// Below this window width the agent chat and the inspector together leave too little canvas
const AGENT_SIDE_BY_SIDE_WIDTH = 1600;

/**
 * Hides the inspector while the agent chat is open in a window narrower than 1600 px and brings it back
 * when the chat closes, like Xcode's inspector auto-hide. Showing the inspector again while the chat is open
 * keeps it, and it then stays when the chat closes.
 */
function useInspectorAutoHide(cx: StudioCx): void {
	React.useEffect(() => {
		let isAutoHidden = false;
		let wasAgent = cx.$panels.get().agent;
		return cx.$panels.listen(({ value }) => {
			const isOpening = value.agent && !wasAgent;
			const isClosing = !value.agent && wasAgent;
			wasAgent = value.agent;
			if (isOpening && value.inspector && window.innerWidth < AGENT_SIDE_BY_SIDE_WIDTH) {
				isAutoHidden = true;
				cx.$panels.set({ ...value, inspector: false });
			} else if (isClosing && isAutoHidden) {
				isAutoHidden = false;
				if (!value.inspector) cx.$panels.set({ ...value, inspector: true });
			} else if (value.agent && value.inspector) {
				isAutoHidden = false;
			}
		});
	}, [cx]);
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
				<div className="mm-caption">A MIDI file becomes marbles. A recording plays behind the marbles.</div>
			</div>
		</div>
	</div>
);
