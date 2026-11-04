import { useFeatureState } from 'feature-react/state';
import { ArrowUp, Check, ChevronRight, CircleAlert, Ellipsis, Frame, LoaderCircle, Monitor, Sparkles, Square, X } from 'lucide-react';
import React from 'react';
import { HelpTip, MenuButton, Select } from '@/components';
import {
	agentChatTurns,
	agentRunSteps,
	composeAgentRequest,
	filterMentions,
	findMentionQuery,
	focusFromPrompt,
	planAgentRuns,
	removeMentionQuery,
	SCENE_MENTION,
	splitMentions,
	type TAgentChatTurn,
	type TAgentCli,
	type TAgentMention,
	type TAgentRun,
	type TAgentRunPhase
} from '@/modules/agents';
import { PieceIcon } from '@/modules/compose/piece-icons';
import { agentSetupHint, cliLabel, toThreadItem, type TAgentCandidate, type TAgentThemeProposal } from '@/modules/design/agent-thread';
import { themePreview, themeSwatches } from '@/modules/design/theme-preview';
import { SetupCard } from '@/modules/design/AgentPanel';
import { createId, type TProject } from '@/modules/project';
import type { StudioCx, TAgentDraft } from './StudioCx';

/**
 * One shared agent conversation per project, like the chat panels of Figma and Cursor. The selection is
 * mentioned in the composer, @ mentions any layer, and each message starts one run per mentioned piece.
 */
export const AgentChat: React.FC<TAgentChatProps> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const availability = useFeatureState(cx.agents.$availability);
	const clis = useFeatureState(cx.agents.$clis);
	const runs = useFeatureState(cx.agents.$runs);
	const [cli, setCli] = React.useState<TAgentCli | null>(null);
	const scrollRef = React.useRef<HTMLDivElement>(null);
	const project = history?.present ?? null;

	const turns = React.useMemo(() => agentChatTurns(runs), [runs]);
	const options = React.useMemo(() => (project != null ? mentionOptions(project) : [SCENE_MENTION]), [project]);
	const setup = agentSetupHint(availability, clis);
	const chosenCli = cli ?? clis[0]?.cli ?? null;
	const lastActivity = runs.reduce((total, run) => total + run.messages.length, turns.length);

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
				<MenuButton className="mm-icon-button !h-6 !w-6" title="Agent menu" label={<Ellipsis size={14} strokeWidth={1.8} />} items={[{ label: 'Show Agent Folder', disabled: project == null, onSelect: () => void cx.showAgentFolder() }]} align="right" />
				<button className="mm-icon-button !h-6 !w-6" onClick={() => cx.togglePanel('agent')} title="Hide Agent (⌘J)" aria-label="Hide Agent" type="button">
					<X size={14} strokeWidth={1.8} />
				</button>
			</header>
			<div ref={scrollRef} className="mm-agent-scroll">
				{turns.length > 0 ? (
					turns.map((turn) => <ChatTurn key={turn.id} cx={cx} turn={turn} project={project} />)
				) : (
					<div className="mm-agent-empty">
						<Sparkles size={18} strokeWidth={1.5} />
						<span>Ask for a theme, a skin or a track piece</span>
					</div>
				)}
			</div>
			{availability === 'unavailable' ? (
				<div className="mm-agent-note" role="note">
					<Monitor size={13} strokeWidth={1.7} className="shrink-0" />
					<span className="flex-1">Agents run in the desktop app</span>
					<HelpTip text="The browser preview cannot start Claude Code or Codex. Open MidiMarble on your Mac to send this." />
				</div>
			) : setup != null ? (
				<div className="px-3 pb-2">
					<SetupCard hint={setup} />
				</div>
			) : null}
			<Composer cx={cx} options={options} canSend={availability === 'ready'} cli={chosenCli} />
		</aside>
	);
};

interface TAgentChatProps {
	cx: StudioCx;
}

// MARK: - Conversation

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

/** An agent reply: one status line that expands to the steps, then the candidate card */
const RunReply: React.FC<{ cx: StudioCx; run: TAgentRun; label: string; marbleColors: readonly string[] }> = (props) => {
	const { cx, run, label, marbleColors } = props;
	const [isOpen, setIsOpen] = React.useState(false);
	const [isBusy, setIsBusy] = React.useState(false);
	const item = toThreadItem(run);
	const steps = agentRunSteps(run);
	// Messages only grow at the end, so their position is a stable key
	const entries = React.useMemo(() => run.messages.map((message, index) => ({ key: message.kind === 'tool' && message.id ? message.id : `m${index}`, message })), [run.messages]);

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
					<span className="truncate font-medium text-[var(--text)]">{label}</span>
					<span className="truncate">
						{' · '}
						{phaseLabel(run.phase)}
						{steps.total > 0 && (run.phase === 'working' || run.phase === 'review') ? ` · ${steps.total} ${steps.total === 1 ? 'step' : 'steps'}` : ''}
					</span>
					<ChevronRight size={11} strokeWidth={2} className="mm-agent-chevron shrink-0" />
				</button>
				{item.canCancel ? (
					<button className="mm-icon-button !h-5 !w-5 shrink-0" onClick={() => void cx.agents.cancel(run.id)} title="Stop" aria-label="Stop" type="button">
						<Square size={9} strokeWidth={0} fill="currentColor" />
					</button>
				) : null}
			</div>
			{isOpen ? (
				<ol className="mm-agent-steps">
					{entries.map(({ key, message }) =>
						message.kind === 'tool' ? (
							<li key={key} data-status={message.status}>
								{message.status === 'running' ? (
									<LoaderCircle size={10} className="shrink-0 animate-spin" />
								) : message.status === 'failed' ? (
									<X size={10} strokeWidth={2.4} className="shrink-0" />
								) : (
									<Check size={10} strokeWidth={2.4} className="shrink-0" />
								)}
								<span className="truncate">{message.summary}</span>
							</li>
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
						) : item.candidate.decorSet != null ? (
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="truncate font-medium">{item.candidate.label}</span>
								<span className="truncate text-[11px] text-[var(--text-secondary)]">
									Decor {item.candidate.decorSet.index} of {item.candidate.decorSet.total} · Accept scatters it
								</span>
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

	const selected =options.filter((option) => option.kind !== 'scene' && selection.includes(option.id) && !dismissed.includes(option.id));
	const mentions = [...selected, ...explicit.filter((mention) => !selected.some((item) => item.id === mention.id))];
	const matches = query != null ? filterMentions(options, query.query, mentions.map((mention) => mention.id)).slice(0, 8) : [];
	const isPickerOpen = query != null && matches.length > 0;
	const isSendable = canSend && !isSending && text.trim().length > 0;

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
		const request = composeAgentRequest(text, mentions);
		setIsSending(true);
		setError(null);
		const failures: string[] = [];
		for (const plan of planAgentRuns(mentions, text, createId('set'))) {
			const [isStartedOk, startedErr] = await cx.agents.start({ target: plan.target, request, cli: cli ?? undefined, focus: plan.label });
			if (!isStartedOk) failures.push(startedErr.message);
		}
		setIsSending(false);
		if (failures.length > 0) {
			setError(failures[0] ?? null);
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
					<button className="mm-agent-send" disabled={!isSendable} onClick={() => void send()} title="Send (↩)" aria-label="Send" type="button">
						{isSending ? <LoaderCircle size={13} strokeWidth={2.2} className="animate-spin" /> : <ArrowUp size={14} strokeWidth={2.2} />}
					</button>
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
	if (mention.kind === 'scene') return <Frame size={12} strokeWidth={1.8} className="shrink-0 opacity-70" />;
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

/** The scene, then each marble, then the pieces in project order */
function mentionOptions(project: TProject): TAgentMention[] {
	const marbles = project.music.lanes.flatMap((lane): TAgentMention[] => {
		const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
		return marble != null ? [{ id: marble.id, kind: 'marble', label: lane.name }] : [];
	});
	const pieces = project.entities.flatMap((entity): TAgentMention[] => (entity.components.piece != null ? [{ id: entity.id, kind: 'piece', label: entity.name ?? entity.components.piece.type }] : []));
	return [SCENE_MENTION, ...marbles, ...pieces];
}

function runLabel(run: TAgentRun, project: TProject | null): string {
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
