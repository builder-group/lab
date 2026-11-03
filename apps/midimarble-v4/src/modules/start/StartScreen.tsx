import { useFeatureState } from 'feature-react/state';
import { AudioLines, FileMusic, FolderOpen, Plus } from 'lucide-react';
import React from 'react';
import { WindowHeader } from '@/components';
import { host } from '@/environment';
import type { StudioCx } from '@/modules/studio';

/** Welcome window modeled on Xcode: actions on the left, recent projects on the right */
export const StartScreen: React.FC<TStartScreenProps> = (props) => {
	const { cx, extraActions } = props;
	const recent = useFeatureState(cx.$recent);

	async function startFrom(kind: 'midi' | 'audio'): Promise<void> {
		const file = await host.chooseSourceFile(kind);
		if (file == null) return;
		const title = file.name.replace(/\.[^.]+$/, '');
		if (!(await cx.newProject({ title }))) return;
		if (kind === 'midi') await cx.sources.openMidi(file);
		else await cx.sources.importAudio(file);
	}

	return (
		<div className="relative flex h-full">
			<WindowHeader floating />
			<section className="flex flex-1 flex-col items-center justify-center gap-8 bg-[var(--content)] px-10">
				<div className="flex flex-col items-center gap-2">
					<img alt="" src="/midimarble.svg" className="h-24 w-24" draggable={false} />
					<h1 className="m-0 text-[28px] font-semibold tracking-tight">MidiMarble</h1>
					<p className="m-0 text-[13px] text-[var(--text-secondary)]">
						Compose a marble run to music, then design it in Blender.
					</p>
				</div>
				<div className="flex w-[300px] flex-col gap-1">
					<StartAction
						icon={<Plus size={18} strokeWidth={1.7} />}
						title="New Project"
						detail="Start with an empty timeline"
						onClick={() => void cx.newProject()}
					/>
					<StartAction
						icon={<FileMusic size={18} strokeWidth={1.7} />}
						title="From MIDI File…"
						detail="Turn a MIDI song into marbles"
						onClick={() => void startFrom('midi')}
					/>
					<StartAction
						icon={<AudioLines size={18} strokeWidth={1.7} />}
						title="From Audio File…"
						detail="Tap along to a recording"
						onClick={() => void startFrom('audio')}
					/>
					{extraActions}
					<StartAction
						icon={<FolderOpen size={18} strokeWidth={1.7} />}
						title="Open Project…"
						detail="Continue a .marble project"
						onClick={() => void cx.openProject()}
					/>
				</div>
			</section>
			<aside className="flex w-[300px] flex-col bg-[var(--chrome)] pt-12" aria-label="Recent projects">
				<div className="mm-section-title">Recent</div>
				{!recent.length ? (
					<div className="mm-placeholder !h-auto !text-[13px]">No recent projects</div>
				) : (
					recent.map((item) => (
						<button
							key={item.path}
							className="mm-row !h-11 w-[calc(100%-16px)] text-left"
							onClick={() => void cx.openProject(item.path)}
							onDoubleClick={() => void cx.openProject(item.path)}
							title={item.path}
							type="button"
						>
							<FileMusic size={20} strokeWidth={1.4} className="shrink-0 text-[var(--text-secondary)]" />
							<span className="flex min-w-0 flex-col leading-tight">
								<span className="truncate font-medium">{item.name}</span>
								<span className="truncate text-[11px] text-[var(--text-tertiary)]">{shortenPath(item.path)}</span>
							</span>
						</button>
					))
				)}
			</aside>
		</div>
	);
};

interface TStartScreenProps {
	cx: StudioCx;
	extraActions?: React.ReactNode;
}

export const StartAction: React.FC<TStartActionProps> = (props) => {
	const { icon, title, detail, onClick } = props;
	return (
		<button className="mm-row !mx-0 !h-12 text-left" onClick={onClick} type="button">
			<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--hover)] text-[var(--text-secondary)]">
				{icon}
			</span>
			<span className="flex flex-col leading-tight">
				<span className="font-medium">{title}</span>
				<span className="text-[11px] text-[var(--text-secondary)]">{detail}</span>
			</span>
		</button>
	);
};

interface TStartActionProps {
	icon: React.ReactNode;
	title: string;
	detail: string;
	onClick: () => void;
}

function shortenPath(path: string): string {
	return path.replace(/^\/Users\/[^/]+/, '~').replace(/\/[^/]+$/, '');
}
