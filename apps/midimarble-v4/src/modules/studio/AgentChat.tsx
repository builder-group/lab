import { useFeatureState } from 'feature-react/state';
import { ArrowUp, Check, ChevronRight, CircleAlert, Copy, Diamond, Frame, Info, LoaderCircle, Monitor, Sparkles, Square, X } from 'lucide-react';
import React from 'react';
import { Select } from '@/components';
import {
	agentChatPrompt,
	agentChatTurns,
	agentRunSteps,
	composeAgentRequest,
	describeMention,
	filterMentions,
	findMentionQuery,
	focusFromPrompt,
	mentionOptions,
	mentionTarget,
	removeMentionQuery,
	SCENE_MENTION,
	selectionMentions,
	splitMentions,
	type TAgentChatTurn,
	type TAgentCli,
	type TAgentMention,
	type TAgentRun,
	type TAgentRunPhase
} from '@/modules/agents';
import { PieceIcon } from '@/modules/compose/piece-icons';
import { agentSetupNote, cliLabel, toThreadItem, type TAgentCandidate, type TAgentSetupHint, type TAgentThemeProposal } from '@/modules/design/agent-thread';
import { themePreview, themeSwatches } from '@/modules/design/theme-preview';
import type { TProject } from '@/modules/project';
import { AgentDetails, StepLine } from './AgentDetails';
import type { StudioCx, TAgentDraft } from './StudioCx';

/**
 * One agent conversation per project, like the chat panels of Figma and Cursor, in Compose and in Film. The selection is
 * mentioned in the composer, @ mentions any layer, and each message runs the local CLI with the app's own tools.
 */
export const AgentChat: React.FC<TAgentChatProps> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const availability = useFeatureState(cx.agents.$availability);
	const clis = useFeatureState(cx.agents.$clis);
	const runs = useFeatureState(cx.agents.$runs);
	const [cli, setCli] = React.useState<TAgentCli | null>(null);
	const [isDetailsOpen, setIsDetailsOpen] = React.useState(false);
	const scrollRef = React.useRef<HTMLDivElement>(null);
	const project = history?.present ?? null;

	const turns = React.useMemo(() => agentChatTurns(runs), [runs]);
	const options = React.useMemo(() => (project != null ? mentionOptions(project) : [SCENE_MENTION]), [project]);
	const setup = agentSetupNote(availability, clis);
	const chosenCli = cli ?? clis[0]?.cli ?? null;
	// Text grows while it streams, so its length counts as well as new messages
	const lastActivity = runs.reduce((total, run) => total + run.messages.reduce((sum, message) => sum + 1 + (message.kind === 'text' ? message.text.length : 0), 0), turns.length);

	// Someone may have installed a CLI since the app started
	React.useEffect(() => {
		void cx.agents.detect();
	}, [cx]);

	// Follow the conversation like a chat while it grows
	React.useEffect(() => {
		const element = scrollRef.current;
		if (element != null) element.scrollTop = element.scrollHeight;
	}, [lastActivity]);

	return (
		<aside className="mm-agent" aria-label="Agent">
			<header className="mm-agent-header">
				<Sparkles size={14} strokeWidth={1.7} className="text-[var(--text-secondary)]" />
				<span className="font-semibold">Agent</span>
				<span className="flex-1" />
				{clis.length > 1 ? (
					<div className="w-[120px]">
						<Select id="agent-cli" value={chosenCli ?? ''} options={clis.map((item) => ({ value: item.cli, label: cliLabel(item.cli) }))} onChange={(value) => setCli(value as TAgentCli)} />
					</div>
				) : null}
				<button className="mm-icon-button !h-6 !w-6" data-active={isDetailsOpen} aria-pressed={isDetailsOpen} onClick={() => setIsDetailsOpen(!isDetailsOpen)} title={isDetailsOpen ? 'Back to Chat' : 'Agent Details'} aria-label="Agent Details" type="button">
					<Info size={14} strokeWidth={1.8} />
				</button>
				<button className="mm-icon-button !h-6 !w-6" onClick={() => cx.togglePanel('agent')} title="Hide Agent (⌘J)" aria-label="Hide Agent" type="button">
					<X size={14} strokeWidth={1.8} />
				</button>
			</header>
			{isDetailsOpen ? (
				<AgentDetails cx={cx} />
			) : (
				<>
					<div ref={scrollRef} className="mm-agent-scroll">
						{turns.length > 0 ? (
							turns.map((turn) => <ChatTurn key={turn.id} cx={cx} turn={turn} project={project} />)
						) : (
							<div className="mm-agent-empty">
								<Sparkles size={18} strokeWidth={1.5} />
								<span>Select something and say what you want</span>
							</div>
						)}
					</div>
					{setup != null ? (
						<div className="mm-agent-note" role="note">
							<Monitor size={13} strokeWidth={1.7} className="shrink-0" />
							<span className="flex-1">{setup}</span>
						</div>
					) : null}
					<Composer cx={cx} options={options} canSend={availability === 'ready'} cli={chosenCli} />
				</>
			)}
		</aside>
	);
};

interface TAgentChatProps {
	cx: StudioCx;
}

// MARK: - Conversation

const RECENT_STEPS = 3;

const ChatTurn: React.FC<{ cx: StudioCx; turn: TAgentChatTurn; project: TProject | null }> = (props) => {
	const { cx, turn, project } = props;
	return (
		<div className="flex flex-col gap-1.5">
			<div className="mm-agent-bubble">
				{splitMentions(turn.request).map((segment) =>
					segment.kind === 'mention' ? (
						<span key={`@${segment.label}`} className="mm-mention">
							@{segment.label}
						</span>
					) : (
						<span key={segment.text}>{segment.text}</span>
					)
				)}
			</div>
			{turn.runs.map((run) => (
				<RunReply key={run.id} cx={cx} run={run} label={runLabel(run, project)} marbleColors={project?.music.lanes.map((lane) => lane.color) ?? []} />
			))}
		</div>
	);
};

/** An agent reply: one status line that expands to the steps, what the agent says, then a Result's card */
const RunReply: React.FC<{ cx: StudioCx; run: TAgentRun; label: string | null; marbleColors: readonly string[] }> = (props) => {
	const { cx, run, label, marbleColors } = props;
	const [isOpen, setIsOpen] = React.useState(false);
	const [isBusy, setIsBusy] = React.useState(false);
	const item = toThreadItem(run);
	const steps = agentRunSteps(run);
	// Messages only grow at the end, so their position is a stable key
	const entries = React.useMemo(() => run.messages.map((message, index) => ({ key: message.kind === 'tool' && message.id ? message.id : `m${index}`, message })), [run.messages]);
	// While it works the latest steps show on their own, as a compact list
	const latestSteps = item.canCancel && !isOpen ? entries.filter((entry) => entry.message.kind === 'tool').slice(-RECENT_STEPS) : [];

	async function accept(): Promise<void> {
		setIsBusy(true);
		await cx.library.acceptCandidate(cx.agents, run.id);
		setIsBusy(false);
	}

	async function discard(): Promise<void> {
		setIsBusy(true);
		const [isDeclinedOk, declinedErr] = await cx.agents.decline(run.id);
		if (!isDeclinedOk) cx.notify(declinedErr.message, 'error');
		setIsBusy(false);
	}

	return (
		<div className="mm-agent-reply" data-phase={run.phase}>
			<div className="flex items-center">
				<button className="mm-agent-status" data-open={isOpen} aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)} type="button">
					<PhaseIcon phase={run.phase} />
					{label != null ? <span className="truncate font-medium text-[var(--text)]">{label}</span> : null}
					<span className="truncate">
						{label != null ? ' · ' : ''}
						{phaseLabel(run.phase)}
						{steps.total > 0 ? ` · ${steps.total} ${steps.total === 1 ? 'step' : 'steps'}` : ''}
					</span>
					<ChevronRight size={11} strokeWidth={2} className="mm-agent-chevron shrink-0" />
				</button>
			</div>
			{latestSteps.length > 0 ? (
				<ol className="mm-agent-steps">
					{latestSteps.map(({ key, message }) => (message.kind === 'tool' ? <StepLine key={key} summary={message.summary} status={message.status} /> : null))}
				</ol>
			) : null}
			{isOpen ? (
				<ol className="mm-agent-steps">
					{entries.map(({ key, message }) =>
						message.kind === 'tool' ? (
							<StepLine key={key} summary={message.summary} status={message.status} />
						) : message.kind === 'text' ? (
							<li key={key} data-kind="text">
								{message.text}
							</li>
						) : null
					)}
					{item.usage != null ? <li data-kind="usage">{item.usage}</li> : null}
					{!run.messages.length && item.usage == null ? <li data-kind="text">No steps yet</li> : null}
				</ol>
			) : null}
			{item.reply != null && !isOpen ? <p className="mm-agent-text">{item.reply}</p> : null}
			{item.error != null && item.setup == null ? (
				<p className="mm-agent-error">
					<CircleAlert size={11} strokeWidth={2} className="mt-px shrink-0" />
					<span className="line-clamp-2">{item.error}</span>
				</p>
			) : null}
			{item.setup != null ? <SetupCard hint={item.setup} /> : null}
			{item.candidate != null ? (
				<figure className="mm-candidate mm-agent-candidate" data-phase={run.phase}>
					{item.candidate.theme != null ? (
						<ThemeResultPreview theme={item.candidate.theme} skin={item.candidate} marbleColors={marbleColors} />
					) : item.candidate.previewUrl != null ? (
						<img alt={item.candidate.label} src={item.candidate.previewUrl} draggable={false} />
					) : null}
					<figcaption>
						{item.candidate.theme != null ? (
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="flex min-w-0 items-center gap-1.5">
									<span className="truncate font-medium">{item.candidate.theme.name}</span>
									<ThemeSwatches theme={item.candidate.theme} />
								</span>
								<span className="truncate text-[11px] text-[var(--text-secondary)]">Theme · with {item.candidate.label}</span>
							</span>
						) : (
							<span className="min-w-0 flex-1 truncate font-medium">{item.candidate.label}</span>
						)}
						{item.canAccept ? (
							<>
								<button className="mm-button" disabled={isBusy} onClick={() => void discard()} type="button">
									Discard
								</button>
								<button className="mm-button" data-variant="primary" disabled={isBusy} onClick={() => void accept()} type="button">
									Accept
								</button>
							</>
						) : run.phase === 'accepted' ? (
							<span className="flex items-center gap-1 text-[11px] text-[var(--good)]">
								<Check size={11} strokeWidth={2.4} />
								Accepted
							</span>
						) : null}
					</figcaption>
				</figure>
			) : null}
		</div>
	);
};

/** What keeps an agent from running and the Terminal command that fixes it */
const SetupCard: React.FC<{ hint: TAgentSetupHint }> = (props) => {
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

/**
 * A New Theme Result drawn in the theme's own colours, like the Draft Preview: its wall, three platforms and a
 * marble, with the skin the run made as a small still in the corner
 */
const ThemeResultPreview: React.FC<{ theme: TAgentThemeProposal; skin: TAgentCandidate; marbleColors: readonly string[] }> = (props) => {
	const { theme, skin, marbleColors } = props;
	const look = themePreview(theme.base, theme.overrides, marbleColors);
	const patternId = React.useId();
	const platforms = [
		{ x: 40, y: 34, angle: 14 },
		{ x: 92, y: 58, angle: -14 },
		{ x: 40, y: 82, angle: 14 }
	];
	return (
		<div className="mm-agent-theme-preview">
			<svg viewBox="0 0 160 100" role="img" aria-label={`${theme.name} theme`}>
				<defs>
					{look.holes != null ? (
						<pattern id={`${patternId}-holes`} width="8" height="8" patternUnits="userSpaceOnUse">
							<circle cx="4" cy="4" r="0.9" fill={look.holes} />
						</pattern>
					) : null}
					{look.light != null ? (
						<linearGradient id={`${patternId}-light`} x1="0" y1="0" x2="0" y2="1">
							<stop offset="0" stopColor={look.light} stopOpacity="0.45" />
							<stop offset="0.7" stopColor={look.light} stopOpacity="0" />
						</linearGradient>
					) : null}
				</defs>
				<rect width="160" height="100" fill={look.wall} />
				{look.holes != null ? <rect width="160" height="100" fill={`url(#${patternId}-holes)`} /> : null}
				{look.light != null ? <rect width="160" height="100" fill={`url(#${patternId}-light)`} /> : null}
				{platforms.map((platform, index) => {
					const colors = look.platforms[index] ?? look.platforms[0];
					return (
						<g key={`${platform.x}-${platform.y}`} transform={`translate(${platform.x} ${platform.y}) rotate(${platform.angle})`}>
							<rect x="-17" y="-2.5" width="34" height="5" rx="1.5" fill={colors?.bar} stroke={look.glow ?? 'none'} strokeWidth={look.glow != null ? 0.8 : 0} />
							<circle r="1.6" fill={colors?.nub} />
						</g>
					);
				})}
				<circle cx="66" cy="22" r="5" fill={look.marble.body} stroke={look.marble.rim ?? 'none'} strokeWidth={look.marble.rim != null ? 1.2 : 0} />
			</svg>
			{skin.previewUrl != null ? <img className="mm-agent-theme-skin" alt={skin.label} title={skin.label} src={skin.previewUrl} draggable={false} /> : null}
		</div>
	);
};

const ThemeSwatches: React.FC<{ theme: TAgentThemeProposal }> = (props) => {
	const swatches = themeSwatches(props.theme.base, props.theme.overrides);
	return (
		<span className="flex shrink-0 gap-0.5" aria-label={swatches.map((swatch) => `${swatch.label} ${swatch.color}`).join(', ')}>
			{swatches.map((swatch) => (
				<span key={swatch.label} title={`${swatch.label} ${swatch.color}`} className="h-2.5 w-2.5 rounded-full shadow-[0_0_0_0.5px_var(--control-border)]" style={{ background: swatch.color }} />
			))}
		</span>
	);
};

const PhaseIcon: React.FC<{ phase: TAgentRunPhase }> = (props) => {
	const { phase } = props;
	switch (phase) {
		case 'working':
			return <LoaderCircle size={12} strokeWidth={2} className="shrink-0 animate-spin" />;
		case 'review':
			return <span className="mm-agent-dot" data-tone="review" />;
		case 'done':
		case 'accepted':
			return <Check size={12} strokeWidth={2.2} className="shrink-0 text-[var(--good)]" />;
		case 'failed':
		case 'incomplete':
			return <CircleAlert size={12} strokeWidth={2} className="shrink-0 text-[var(--bad)]" />;
		case 'cancelled':
		case 'declined':
			return <span className="mm-agent-dot" />;
	}
};

// MARK: - Composer

const Composer: React.FC<{ cx: StudioCx; options: TAgentMention[]; canSend: boolean; cli: TAgentCli | null }> = (props) => {
	const { cx, options, canSend, cli } = props;
	const selection = useFeatureState(cx.$selection);
	const runs = useFeatureState(cx.agents.$runs);
	const isWorking = runs.some((run) => run.phase === 'working');
	const [text, setText] = React.useState('');
	const [explicit, setExplicit] = React.useState<TAgentMention[]>([]);
	// Selected layers the user removed from this message; a new selection is mentioned again
	const [removed, setRemoved] = React.useState<{ key: string; ids: string[] }>({ key: '', ids: [] });
	const selectionKey = selection.join('|');
	const dismissed = removed.key === selectionKey ? removed.ids : [];
	const [query, setQuery] = React.useState<{ start: number; query: string } | null>(null);
	const [highlight, setHighlight] = React.useState(0);
	const [isSending, setIsSending] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const inputRef = React.useRef<HTMLTextAreaElement>(null);
	const draft = useFeatureState(cx.$agentDraft);
	const [takenDraft, setTakenDraft] = React.useState<TAgentDraft | null>(null);

	// Take over a prefilled message once, then clear it and put the caret at its end
	if (draft != null && draft !== takenDraft) {
		setTakenDraft(draft);
		setText(draft.text);
		setExplicit(options.filter((option) => draft.mentionIds.includes(option.id)));
		setError(null);
	}
	React.useEffect(() => {
		if (draft == null) return;
		cx.$agentDraft.set(null);
		requestAnimationFrame(() => {
			const input = inputRef.current;
			input?.focus();
			input?.setSelectionRange(draft.text.length, draft.text.length);
		});
	}, [cx, draft]);

	const project = cx.project;
	const selected = project != null ? selectionMentions(project, selection).filter((mention) => !dismissed.includes(mention.id)) : [];
	const mentions = [...selected, ...explicit.filter((mention) => !selected.some((item) => item.id === mention.id))];
	const matches = query != null ? filterMentions(options, query.query, mentions.map((mention) => mention.id)).slice(0, 8) : [];
	const isPickerOpen = query != null && matches.length > 0;
	const isSendable = canSend && !isSending && !isWorking && text.trim().length > 0;

	// Grow with the text up to a few lines, like Messages
	React.useLayoutEffect(() => {
		const input = inputRef.current;
		if (input == null) return;
		input.style.height = 'auto';
		input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
	}, [text]);

	function updateQuery(value: string, caret: number): void {
		const next = findMentionQuery(value, caret);
		setQuery(next);
		if (next?.query !== query?.query) setHighlight(0);
	}

	function pick(mention: TAgentMention): void {
		if (query == null) return;
		const next = removeMentionQuery(text, query);
		setText(next.text);
		setExplicit((current) => [...current, mention]);
		setQuery(null);
		requestAnimationFrame(() => inputRef.current?.setSelectionRange(next.caret, next.caret));
	}

	function remove(mention: TAgentMention): void {
		if (selected.some((item) => item.id === mention.id)) setRemoved({ key: selectionKey, ids: [...dismissed, mention.id] });
		setExplicit((current) => current.filter((item) => item.id !== mention.id));
		inputRef.current?.focus();
	}

	async function send(): Promise<void> {
		if (!isSendable) return;
		if (project == null) return;
		const request = composeAgentRequest(text, mentions);
		const result = cx.simulation.$result.get();
		const prompt = agentChatPrompt(text, mentions.map((mention) => describeMention(project, result, mention)));
		setIsSending(true);
		setError(null);
		const [isStartedOk, startedErr] = await cx.agents.start({ request, prompt, target: mentionTarget(project, mentions), cli: cli ?? undefined });
		setIsSending(false);
		if (!isStartedOk) {
			setError(startedErr.message);
			return;
		}
		setText('');
		setExplicit([]);
	}

	function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
		// Keep studio shortcuts such as Space and Delete out of the text, except ⌘J to close
		event.stopPropagation();
		if (event.metaKey && event.key.toLowerCase() === 'j') {
			event.preventDefault();
			cx.togglePanel('agent');
			return;
		}
		if (isPickerOpen) {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				setHighlight((index) => (index + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
				return;
			}
			if (event.key === 'Enter' || event.key === 'Tab') {
				event.preventDefault();
				const match = matches[highlight];
				if (match != null) pick(match);
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				setQuery(null);
				return;
			}
		}
		// Return sends, Shift-Return adds a line; Return that ends a Japanese or Chinese composition only commits it
		if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			void send();
			return;
		}
		if (event.key === 'Backspace' && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0) {
			const last = mentions[mentions.length - 1];
			if (last != null) remove(last);
			return;
		}
		if (event.key === 'Escape') event.currentTarget.blur();
	}

	return (
		<div className="mm-agent-composer-wrap">
			{isPickerOpen ? (
				<div className="mm-mention-picker" role="listbox" aria-label="Mention a layer">
					{matches.map((match, index) => (
						<button
							key={match.id}
							role="option"
							aria-selected={index === highlight}
							data-highlighted={index === highlight}
							onPointerDown={(event) => {
								event.preventDefault();
								pick(match);
							}}
							onPointerEnter={() => setHighlight(index)}
							type="button"
						>
							<MentionIcon cx={cx} mention={match} />
							<span className="truncate">{match.label}</span>
						</button>
					))}
				</div>
			) : null}
			<div className="mm-agent-composer" onClick={() => inputRef.current?.focus()}>
				{mentions.length > 0 ? (
					<div className="flex flex-wrap gap-1">
						{mentions.map((mention) => (
							<span key={mention.id} className="mm-mention-chip">
								<MentionIcon cx={cx} mention={mention} />
								<span className="truncate">{mention.label}</span>
								<button
									onClick={(event) => {
										event.stopPropagation();
										remove(mention);
									}}
									title="Remove"
									aria-label={`Remove ${mention.label}`}
									type="button"
								>
									<X size={10} strokeWidth={2.2} />
								</button>
							</span>
						))}
					</div>
				) : null}
				<textarea
					ref={inputRef}
					className="mm-agent-input"
					rows={1}
					placeholder={mentions.length > 0 ? 'Describe the change…' : 'Ask about the project, or @ a layer…'}
					aria-label="Message the agent"
					value={text}
					onChange={(event) => {
						setText(event.target.value);
						updateQuery(event.target.value, event.target.selectionStart);
					}}
					onSelect={(event) => updateQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
					onBlur={() => setQuery(null)}
					onKeyDown={onKeyDown}
				/>
				<div className="flex items-center gap-2">
					<span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-tertiary)]">{cli != null ? cliLabel(cli) : ''}</span>
					{isWorking ? (
						<button className="mm-agent-send" onClick={() => void cx.stopAgent()} title="Stop. What it did stays." aria-label="Stop" type="button">
							<Square size={10} strokeWidth={0} fill="currentColor" />
						</button>
					) : (
						<button className="mm-agent-send" disabled={!isSendable} onClick={() => void send()} title="Send (↩)" aria-label="Send" type="button">
							{isSending ? <LoaderCircle size={13} strokeWidth={2.2} className="animate-spin" /> : <ArrowUp size={14} strokeWidth={2.2} />}
						</button>
					)}
				</div>
			</div>
			{error != null ? (
				<p role="alert" className="mm-agent-error px-1 pt-1.5">
					<CircleAlert size={11} strokeWidth={2} className="mt-px shrink-0" />
					<span className="line-clamp-2">{error}</span>
				</p>
			) : null}
		</div>
	);
};

const MentionIcon: React.FC<{ cx: StudioCx; mention: TAgentMention }> = (props) => {
	const { cx, mention } = props;
	if (mention.kind === 'scene' || mention.kind === 'layer') return <Frame size={12} strokeWidth={1.8} className="shrink-0 opacity-70" />;
	if (mention.kind === 'hit') return <Diamond size={11} strokeWidth={1.8} className="shrink-0 opacity-70" />;
	if (mention.kind === 'marble') {
		const laneId = cx.project?.entities.find((entity) => entity.id === mention.id)?.components.marble?.laneId;
		const color = cx.project?.music.lanes.find((lane) => lane.id === laneId)?.color;
		return <span className="mm-layer-chip !h-2 !w-2" style={{ background: color ?? 'var(--text-tertiary)' }} />;
	}
	const type = cx.project?.entities.find((entity) => entity.id === mention.id)?.components.piece?.type ?? 'platform';
	return (
		<span className="flex shrink-0 opacity-70">
			<PieceIcon type={type} size={12} />
		</span>
	);
};

/** A chat run needs no name; a run from before the chat made a Result for one target */
function runLabel(run: TAgentRun, project: TProject | null): string | null {
	if (run.isChat) return null;
	const focus = focusFromPrompt(run.prompt);
	if (focus != null) return focus;
	const target = run.target;
	if (target?.kind === 'piece') return project?.entities.find((entity) => entity.id === target.entityId)?.name ?? 'Piece';
	if (target?.kind === 'wall') return 'Wall';
	return 'Scene';
}

function phaseLabel(phase: TAgentRunPhase): string {
	switch (phase) {
		case 'working':
			return 'Working';
		case 'done':
			return 'Done';
		case 'review':
			return 'Ready';
		case 'incomplete':
			return 'No result';
		case 'failed':
			return 'Failed';
		case 'cancelled':
			return 'Stopped';
		case 'accepted':
			return 'Accepted';
		case 'declined':
			return 'Discarded';
	}
}
