import { useFeatureState } from 'feature-react/state';
import { FileMusic, FolderOpen, LayoutTemplate, Music, Plus } from 'lucide-react';
import React from 'react';
import { WindowHeader } from '@/components';
import { copyExampleFiles, exampleGroups, loadExample, type TExample } from './examples';
import type { StudioCx } from '@/modules/studio';

/** Welcome window modeled on Xcode: actions on the left, recent projects on the right */
export const StartScreen: React.FC<TStartScreenProps> = (props) => {
	const { cx, extraActions } = props;
	const recent = useFeatureState(cx.$recent);
	const [showAllRecent, setShowAllRecent] = React.useState(false);

	// ⌘N and ⌘O work here as in the studio
	React.useEffect(() => {
		function onKeyDown(event: KeyboardEvent): void {
			if (!event.metaKey || event.shiftKey || event.ctrlKey || event.altKey) return;
			const key = event.key.toLowerCase();
			if (key === 'n') {
				event.preventDefault();
				void cx.newProject();
			} else if (key === 'o') {
				event.preventDefault();
				void cx.openProject();
			}
		}
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [cx]);

	async function openExample(example: TExample): Promise<void> {
		const [isExampleOk, exampleErr, loaded] = await loadExample(example);
		if (!isExampleOk) {
			cx.notify(exampleErr.message, 'error');
			return;
		}
		// An example opens unsaved, like a macOS untitled document, so Recent does not fill with copies
		await cx.openTemporary(loaded.project, (packagePath) => copyExampleFiles(packagePath, loaded.files));
	}

	return (
		<div className="relative flex h-full">
			<WindowHeader floating />
			<section className="flex flex-1 flex-col items-center justify-center gap-8 bg-[var(--content)] px-10">
				<div className="flex flex-col items-center gap-2">
					<img alt="" src="/app-icon.svg" className="h-28 w-28" draggable={false} />
					<h1 className="m-0 text-[28px] font-semibold tracking-tight">MidiMarble</h1>
					<p className="m-0 text-[var(--text-secondary)]">
						Build a marble run that plays a song, then make the film
					</p>
				</div>
				<div className="flex w-[300px] flex-col gap-1">
					<StartAction
						icon={<Plus size={18} strokeWidth={1.7} />}
						title="New Project"
						detail="Start with an empty wall"
						onClick={() => void cx.newProject()}
					/>
					<StartAction
						icon={<FileMusic size={18} strokeWidth={1.7} />}
						title="Import Song…"
						detail="Start from a MIDI file or a recording"
						onClick={() => void cx.newProjectFromSong()}
					/>
					{extraActions}
					<StartAction
						icon={<FolderOpen size={18} strokeWidth={1.7} />}
						title="Open Project…"
						detail="Continue a saved project"
						onClick={() => void cx.openProject()}
					/>
				</div>
			</section>
			<aside className="flex w-[300px] flex-col overflow-y-auto bg-[var(--chrome)] pt-12 pb-4" aria-label="Recent projects and examples">
				<div className="mm-section-title">Recent</div>
				{!recent.length ? (
					<div className="mm-placeholder !h-auto pt-10">
						<span className="mm-placeholder-body">No recent projects</span>
					</div>
				) : (
					(showAllRecent ? recent : recent.slice(0, RECENT_LIMIT)).map((item) => (
						<button
							key={item.path}
							className="mm-row !h-11 w-[calc(100%-16px)] shrink-0 text-left"
							onClick={() => void cx.openProject(item.path)}
							title={item.path}
							type="button"
						>
							<FileMusic size={20} strokeWidth={1.4} className="shrink-0 text-[var(--text-secondary)]" />
							<span className="flex min-w-0 flex-col leading-tight">
								<span className="truncate font-medium">{item.name}</span>
								<span className="truncate text-[11px] text-[var(--text-secondary)]">
									{[shortenPath(item.path), formatOpened(item.openedAt)].filter(Boolean).join(' · ')}
								</span>
							</span>
						</button>
					))
				)}
				{recent.length > RECENT_LIMIT ? (
					<button
						className="mm-row !h-7 w-[calc(100%-16px)] shrink-0 text-left text-[12px] text-[var(--text-secondary)]"
						onClick={() => setShowAllRecent(!showAllRecent)}
						type="button"
					>
						{showAllRecent ? 'Show Less' : `Show All ${recent.length}`}
					</button>
				) : null}
				{exampleGroups.map((group) => (
					<React.Fragment key={group.title}>
						<div className="mm-section-title mt-4">{group.title}</div>
						{group.examples.map((example) => (
							<button
								key={example.id}
								className="mm-row !h-11 w-[calc(100%-16px)] shrink-0 text-left"
								onClick={() => void openExample(example)}
								type="button"
							>
								{group.hasSong ? (
									<Music size={18} strokeWidth={1.4} className="shrink-0 text-[var(--text-secondary)]" />
								) : (
									<LayoutTemplate size={18} strokeWidth={1.4} className="shrink-0 text-[var(--text-secondary)]" />
								)}
								<span className="flex min-w-0 flex-col leading-tight">
									<span className="truncate font-medium">{example.title}</span>
									<span className="truncate text-[11px] text-[var(--text-secondary)]">{example.detail}</span>
								</span>
							</button>
						))}
					</React.Fragment>
				))}
			</aside>
		</div>
	);
};

// Enough recent projects to resume work while the examples stay in view
const RECENT_LIMIT = 6;

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

/** Opened time like Finder's Date Last Opened column: time today, Yesterday, then a short date */
function formatOpened(openedAt: number): string {
	if (!openedAt) return '';
	const date = new Date(openedAt);
	const today = new Date();
	const days = Math.round((new Date(today.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86_400_000);
	if (days === 0) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
	if (days === 1) return 'Yesterday';
	return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
}
