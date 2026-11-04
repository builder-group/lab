import { useFeatureState } from 'feature-react/state';
import { Check, CircleAlert, Copy, LoaderCircle, Sparkles, X } from 'lucide-react';
import React from 'react';
import { Panel, Select } from '@/components';
import type { TAgentCli, TAgentTarget } from '@/modules/agents';
import type { StudioCx } from '@/modules/studio';
import { agentSetupHint, agentThread, cliLabel, type TAgentSetupHint, type TAgentThreadItem } from './agent-thread';

/**
 * Agent conversation for the selection, like a comment thread: each request with the agent's condensed
 * reply and its candidate to accept or decline, then a field for the next request.
 */
export const AgentPanel: React.FC<TAgentPanelProps> = (props) => {
	const { cx, target, targetLabel, placeholder = 'Describe how this should look…' } = props;
	const availability = useFeatureState(cx.agents.$availability);
	const clis = useFeatureState(cx.agents.$clis);
	const runs = useFeatureState(cx.agents.$runs);
	const [request, setRequest] = React.useState('');
	const [cli, setCli] = React.useState<TAgentCli | null>(null);
	const [isStarting, setIsStarting] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const thread = React.useMemo(() => agentThread(runs, target), [runs, target]);
	const setup = agentSetupHint(availability, clis);
	const isWorking = thread.some((item) => item.canCancel);
	const canRun = availability === 'ready' && request.trim().length > 0 && !isStarting && !isWorking;
	const chosenCli = cli ?? clis[0]?.cli ?? null;

	async function run(): Promise<void> {
		if (!canRun) return;
		setIsStarting(true);
		setError(null);
		const [isStartedOk, startedErr] = await cx.agents.start({ target, request, cli: chosenCli ?? undefined });
		setIsStarting(false);
		if (!isStartedOk) {
			setError(startedErr.message);
			return;
		}
		setRequest('');
	}

	return (
		<Panel id="design.agent" title="Agent">
			{thread.map((item) => (
				<ThreadItem key={item.id} cx={cx} item={item} targetLabel={targetLabel} />
			))}
			{setup != null ? <SetupCard hint={setup} /> : null}
			<div className="flex flex-col gap-1.5">
				<textarea
					id="agent-prompt"
					className="mm-input mm-textarea"
					rows={3}
					placeholder={placeholder}
					aria-label={`Ask an agent about ${targetLabel}`}
					disabled={availability !== 'ready'}
					value={request}
					onChange={(event) => setRequest(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							void run();
						}
						// Keep studio shortcuts such as Space and Delete out of the text
						event.stopPropagation();
					}}
				/>
				<div className="flex items-center gap-1.5">
					{clis.length > 1 ? (
						<div className="min-w-0 flex-1">
							<Select
								id="agent-cli"
								value={chosenCli ?? ''}
								options={clis.map((item) => ({ value: item.cli, label: cliLabel(item.cli) }))}
								onChange={(value) => setCli(value as TAgentCli)}
							/>
						</div>
					) : (
						<span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-tertiary)]">
							{chosenCli != null ? `${cliLabel(chosenCli)} · ⌘↩ to run` : ''}
						</span>
					)}
					<button className="mm-button" data-variant="primary" disabled={!canRun} onClick={() => void run()} title="Run (⌘↩)" type="button">
						{isStarting ? <LoaderCircle size={12} className="animate-spin" /> : <Sparkles size={12} strokeWidth={2} />}
						Run
					</button>
				</div>
				{error != null ? (
					<p role="alert" className="mm-caption !text-[var(--bad)]">
						{error}
					</p>
				) : null}
			</div>
		</Panel>
	);
};

interface TAgentPanelProps {
	cx: StudioCx;
	target: TAgentTarget;
	/** Name of what the agent works on, such as `Platform 3` or `the scene` */
	targetLabel: string;
	placeholder?: string;
}

const ThreadItem: React.FC<{ cx: StudioCx; item: TAgentThreadItem; targetLabel: string }> = (props) => {
	const { cx, item, targetLabel } = props;
	const [isBusy, setIsBusy] = React.useState(false);
	const isClosed = item.phase === 'declined' || item.phase === 'cancelled';

	async function accept(): Promise<void> {
		setIsBusy(true);
		await cx.library.acceptCandidate(cx.agents, item.id);
		setIsBusy(false);
	}

	async function decline(): Promise<void> {
		setIsBusy(true);
		const [isDeclinedOk, declinedErr] = await cx.agents.decline(item.id);
		if (!isDeclinedOk) cx.notify(declinedErr.message, 'error');
		setIsBusy(false);
	}

	return (
		<article className="mm-thread" data-closed={isClosed} aria-label={`Request: ${item.prompt}`}>
			<div className="mm-thread-author">You</div>
			<p className="mm-thread-prompt">{item.prompt}</p>

			<div className="mm-thread-author mt-2 flex items-center gap-1.5">
				<Sparkles size={11} strokeWidth={2} />
				<span>{item.cliLabel}</span>
				<span className="mm-thread-phase" data-phase={item.phase}>
					{item.phase === 'working' ? <LoaderCircle size={10} className="animate-spin" /> : null}
					{item.phaseLabel}
				</span>
			</div>
			{item.hiddenSteps > 0 ? <div className="mm-thread-step text-[var(--text-tertiary)]">{item.hiddenSteps} earlier steps</div> : null}
			{item.lines.map((line) =>
				line.kind === 'text' ? (
					<p key={line.key} className="mm-thread-text">
						{line.text}
					</p>
				) : (
					<div key={line.key} className="mm-thread-step" data-status={line.status}>
						{line.status === 'running' ? (
							<LoaderCircle size={10} className="shrink-0 animate-spin" />
						) : line.status === 'failed' ? (
							<X size={10} strokeWidth={2.4} className="shrink-0" />
						) : (
							<Check size={10} strokeWidth={2.4} className="shrink-0" />
						)}
						<span className="truncate">{line.text}</span>
					</div>
				)
			)}

			{item.candidate != null ? (
				<figure className="mm-candidate">
					{item.candidate.previewUrl != null ? <img alt={`Candidate ${item.candidate.label}`} src={item.candidate.previewUrl} draggable={false} /> : null}
					<figcaption className="flex items-center gap-1.5 px-2 py-1.5">
						<span className="min-w-0 flex-1 truncate font-medium">{item.candidate.label}</span>
						{item.phase === 'accepted' ? <span className="text-[11px] text-[var(--good)]">Applied to {targetLabel}</span> : null}
					</figcaption>
					{item.canAccept ? (
						<div className="flex gap-1.5 px-2 pb-2">
							<button className="mm-button flex-1" disabled={isBusy} onClick={() => void decline()} type="button">
								Decline
							</button>
							<button className="mm-button flex-1" data-variant="primary" disabled={isBusy} onClick={() => void accept()} type="button">
								Accept
							</button>
						</div>
					) : null}
				</figure>
			) : null}

			{item.error != null && item.setup == null ? (
				<p className="mm-caption mt-1 flex gap-1 !text-[var(--bad)]">
					<CircleAlert size={11} strokeWidth={2} className="mt-px shrink-0" />
					<span className="line-clamp-4">{item.error}</span>
				</p>
			) : null}
			{item.setup != null ? <SetupCard hint={item.setup} /> : null}

			<div className="mt-1 flex items-center gap-2">
				{item.usage != null ? <span className="mm-tabular text-[11px] text-[var(--text-tertiary)]">{item.usage}</span> : null}
				{item.canCancel ? (
					<button className="mm-link ml-auto" onClick={() => void cx.agents.cancel(item.id)} type="button">
						Cancel
					</button>
				) : null}
			</div>
		</article>
	);
};

/** What keeps an agent from running and the Terminal command that fixes it */
export const SetupCard: React.FC<{ hint: TAgentSetupHint }> = (props) => {
	const { hint } = props;
	const [isCopied, setIsCopied] = React.useState(false);

	async function copy(command: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(command);
			setIsCopied(true);
			setTimeout(() => setIsCopied(false), 1500);
		} catch {
			// The command stays selectable when the clipboard is unavailable
		}
	}

	return (
		<div className="mm-setup-card" role="note">
			<div className="font-semibold">{hint.title}</div>
			<div className="mm-caption">{hint.body}</div>
			{hint.command != null ? (
				<div className="mm-command">
					<code className="min-w-0 flex-1 select-text break-all">{hint.command}</code>
					<button className="mm-icon-button !h-5 !w-5 shrink-0" onClick={() => void copy(hint.command ?? '')} title="Copy Command" aria-label="Copy Command" type="button">
						{isCopied ? <Check size={11} strokeWidth={2.4} /> : <Copy size={11} strokeWidth={2} />}
					</button>
				</div>
			) : null}
		</div>
	);
};
