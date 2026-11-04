import { isTauri, convertFileSrc } from '@tauri-apps/api/core';
import { useFeatureState } from 'feature-react/state';
import { Check, FolderOpen, ImagePlus, LoaderCircle, Square, X } from 'lucide-react';
import React from 'react';
import { host } from '@/environment';
import { agentContextUse, agentRunSteps, type TAgentRun } from '@/modules/agents';
import { formatTime } from './format';
import type { StudioCx } from './StudioCx';

const MAX_UNDO_STEPS = 12;
const IMAGE_FILE = /\.(png|jpe?g|webp|gif|heic|tiff)$/i;

/** The Agent panel's details, opened from its header: References, what the agent made, its steps and its context */
export const AgentDetails: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	return (
		<div className="mm-agent-details">
			<ReferencesSection cx={cx} />
			<MadeSection cx={cx} />
			<StepsSection cx={cx} />
			<ContextSection cx={cx} />
			<button className="mm-button" onClick={() => void cx.showAgentFolder()} type="button">
				<FolderOpen size={12} strokeWidth={1.8} />
				Show Agent Folder
			</button>
		</div>
	);
};

export const StepLine: React.FC<{ summary: string; status: 'running' | 'done' | 'failed' }> = (props) => (
	<li data-status={props.status}>
		{props.status === 'running' ? <LoaderCircle size={10} className="shrink-0 animate-spin" /> : props.status === 'failed' ? <X size={10} strokeWidth={2.4} className="shrink-0" /> : <Check size={10} strokeWidth={2.4} className="shrink-0" />}
		<span className="truncate">{props.summary}</span>
	</li>
);

const Section: React.FC<{ title: string; accessory?: React.ReactNode; children: React.ReactNode }> = (props) => (
	<section className="mm-agent-section">
		<header>
			<h3>{props.title}</h3>
			{props.accessory}
		</header>
		{props.children}
	</section>
);

/** The only place References show: images and words in the project's `agent/references/` */
const ReferencesSection: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const references = useFeatureState(cx.$references);
	const [words, setWords] = React.useState(references.text);
	const [syncedText, setSyncedText] = React.useState(references.text);
	const [isDropping, setIsDropping] = React.useState(false);

	// An agent may set them while this is open
	if (references.text !== syncedText) {
		setSyncedText(references.text);
		setWords(references.text);
	}

	const add = React.useCallback(
		(paths: string[]) => {
			const images = paths.filter((path) => IMAGE_FILE.test(path));
			const current = cx.$references.get();
			if (images.length > 0) void cx.setReferences([...current.images, ...images], current.text);
		},
		[cx]
	);

	// Files from Finder reach the app as a window event with their paths
	React.useEffect(() => {
		if (!isTauri()) return undefined;
		let isMounted = true;
		let stop: (() => void) | null = null;
		void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
			const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
				if (event.payload.type === 'enter' || event.payload.type === 'over') setIsDropping(true);
				else setIsDropping(false);
				if (event.payload.type === 'drop') add(event.payload.paths);
			});
			if (isMounted) stop = unlisten;
			else unlisten();
		});
		return () => {
			isMounted = false;
			stop?.();
		};
	}, [add]);

	async function choose(): Promise<void> {
		add(await host.chooseImages());
	}

	function saveWords(): void {
		if (words !== references.text) void cx.setReferences(references.images, words);
	}

	return (
		<Section
			title="References"
			accessory={
				<button className="mm-icon-button !h-5 !w-5" onClick={() => void choose()} title="Add Images…" aria-label="Add Images" type="button">
					<ImagePlus size={13} strokeWidth={1.8} />
				</button>
			}
		>
			<div className="mm-agent-references" data-dropping={isDropping}>
				{references.images.length > 0 ? (
					<div className="mm-agent-thumbs">
						{references.images.map((path) => (
							<div key={path} className="mm-agent-thumb">
								<img alt="" src={convertFileSrc(path)} draggable={false} />
								<button onClick={() => void cx.setReferences(references.images.filter((item) => item !== path), references.text)} title="Remove" aria-label="Remove Image" type="button">
									<X size={10} strokeWidth={2.2} />
								</button>
							</div>
						))}
					</div>
				) : (
					<p className="mm-caption">Drop images here, or add them</p>
				)}
				<textarea
					className="mm-input mm-textarea"
					rows={2}
					placeholder="Words for the look"
					aria-label="References"
					value={words}
					onChange={(event) => setWords(event.target.value)}
					onBlur={saveWords}
					onKeyDown={(event) => event.stopPropagation()}
				/>
			</div>
		</Section>
	);
};

/** What this project's agent produced: assets and Pack items in the library, frames it previewed */
const MadeSection: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const items = useFeatureState(cx.library.$projectItems).filter((item) => item.manifest?.origin === 'agent');
	const frames = useFeatureState(cx.agents.$frames);
	if (!items.length && !frames.length) return null;

	function showFrame(time: number): void {
		cx.$workspace.set('design');
		cx.seek(time);
	}

	return (
		<Section title="Made">
			<div className="mm-agent-thumbs">
				{items.map((item) => {
					const label = item.manifest?.label ?? item.id;
					const pack = item.manifest?.pack?.packName;
					return (
						<button key={item.id} className="mm-agent-thumb" onClick={() => void host.revealInFinder(item.path)} title={pack != null ? `${label} · ${pack} Pack` : label} type="button">
							{item.previewUrl != null ? <img alt={label} src={item.previewUrl} draggable={false} /> : <span className="truncate">{label}</span>}
						</button>
					);
				})}
				{frames.map((frame) => (
					<button key={frame.path} className="mm-agent-thumb" onClick={() => showFrame(frame.time)} title={`Go to ${formatTime(frame.time)}`} type="button">
						<img alt={`Frame at ${formatTime(frame.time)}`} src={frame.url} draggable={false} />
					</button>
				))}
			</div>
		</Section>
	);
};

const StepsSection: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const runs = useFeatureState(cx.agents.$runs);
	useFeatureState(cx.$history);
	const working: TAgentRun | undefined = runs.find((run) => run.phase === 'working');
	const undoSteps = cx.agentUndoSteps.slice(0, MAX_UNDO_STEPS);
	if (working == null && !undoSteps.length) return null;
	const counts = working != null ? agentRunSteps(working) : null;

	return (
		<Section
			title="Steps"
			accessory={
				working != null ? (
					<button className="mm-icon-button !h-5 !w-5" onClick={() => void cx.stopAgent()} title="Stop. What it did stays." aria-label="Stop" type="button">
						<Square size={9} strokeWidth={0} fill="currentColor" />
					</button>
				) : null
			}
		>
			{working != null ? (
				<ol className="mm-agent-steps">
					{working.messages.map((message) => (message.kind === 'tool' ? <StepLine key={message.id} summary={message.summary} status={message.status} /> : null))}
					{counts?.total === 0 ? <li data-kind="usage">Starting…</li> : null}
				</ol>
			) : null}
			{undoSteps.length > 0 ? (
				<ul className="mm-agent-undo">
					{undoSteps.map((step) => (
						<li key={step.group} className="truncate">
							{step.name}
						</li>
					))}
				</ul>
			) : null}
		</Section>
	);
};

/** How full the CLI's context is, when it reports that */
const ContextSection: React.FC<{ cx: StudioCx }> = (props) => {
	const runs = useFeatureState(props.cx.agents.$runs);
	const context = agentContextUse(runs);
	if (context == null) return null;
	const percent = Math.round(context.share * 100);
	return (
		<Section title="Context">
			<div className="mm-agent-context" title={`${Math.round(context.used / 1000)}k of ${Math.round(context.size / 1000)}k tokens`}>
				<div role="meter" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Context used">
					<span style={{ width: `${percent}%` }} />
				</div>
				<span className="mm-tabular">{percent}%</span>
			</div>
		</Section>
	);
};
