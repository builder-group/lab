import { useFeatureState } from 'feature-react/state';
import { Search } from 'lucide-react';
import React from 'react';
import { commands, isCommandEnabled, type TCommand } from './commands';
import type { StudioCx } from './StudioCx';

/** ⌘K command palette listing every command with its shortcut, like Linear, Raycast and Blender's F3 search */
export const CommandPalette: React.FC<TCommandPaletteProps> = (props) => {
	const { cx } = props;
	const open = useFeatureState(cx.$paletteOpen);
	if (!open) return null;
	return <PaletteDialog cx={cx} onClose={() => cx.$paletteOpen.set(false)} />;
};

interface TCommandPaletteProps {
	cx: StudioCx;
}

const PaletteDialog: React.FC<{ cx: StudioCx; onClose: () => void }> = (props) => {
	const { cx, onClose } = props;
	const [query, setQuery] = React.useState('');
	const [highlighted, setHighlighted] = React.useState(0);
	const listRef = React.useRef<HTMLDivElement>(null);
	// Enabled state is read once when the palette opens; the palette closes before anything changes it
	const results = React.useMemo(() => searchCommands(cx, query), [cx, query]);
	const active = results[Math.min(highlighted, results.length - 1)];

	React.useEffect(() => {
		listRef.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: 'nearest' });
	}, [highlighted, query]);

	function run(command: TCommand | undefined): void {
		if (command == null || !isCommandEnabled(cx, command)) return;
		onClose();
		command.run(cx);
	}

	function onKeyDown(event: React.KeyboardEvent): void {
		event.stopPropagation();
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			setHighlighted((current) => (Math.min(current, results.length - 1) + step + results.length) % Math.max(1, results.length));
		} else if (event.key === 'Enter') {
			event.preventDefault();
			run(active);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
		}
	}

	return (
		<div className="absolute inset-0 z-50 flex justify-center bg-black/10 pt-[14vh]" onPointerDown={onClose}>
			<div
				role="dialog"
				aria-label="Command palette"
				className="flex h-fit max-h-[440px] w-[560px] flex-col overflow-hidden rounded-[12px] bg-[var(--menu)]"
				style={{ boxShadow: 'var(--shadow-popover)', backdropFilter: 'blur(30px) saturate(1.6)', WebkitBackdropFilter: 'blur(30px) saturate(1.6)' }}
				onPointerDown={(event) => event.stopPropagation()}
				onKeyDown={onKeyDown}
			>
				<div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-[var(--separator)] px-4">
					<Search size={16} strokeWidth={1.8} className="shrink-0 text-[var(--text-secondary)]" />
					<input
						autoFocus
						aria-label="Search commands"
						className="h-full min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none placeholder:text-[var(--text-tertiary)]"
						placeholder="Search commands"
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setHighlighted(0);
						}}
						role="combobox"
						aria-expanded
						aria-controls="mm-palette-list"
						aria-activedescendant={active == null ? undefined : `mm-command-${active.id}`}
					/>
				</div>
				<div ref={listRef} id="mm-palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
					{!results.length ? (
						<div className="px-3 py-6 text-center text-[var(--text-secondary)]">No commands match “{query}”</div>
					) : null}
					{results.map((command, index) => {
						const showSection = !query.trim() && command.section !== results[index - 1]?.section;
						const enabled = isCommandEnabled(cx, command);
						const checked = command.isChecked?.(cx) === true;
						return (
							<React.Fragment key={command.id}>
								{showSection ? <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold text-[var(--text-secondary)]">{command.section}</div> : null}
								<div
									id={`mm-command-${command.id}`}
									role="option"
									aria-selected={index === highlighted}
									aria-disabled={!enabled}
									data-highlighted={index === highlighted}
									className="flex h-8 items-center gap-2 rounded-[6px] px-2.5 data-[highlighted=true]:bg-[var(--accent)] data-[highlighted=true]:text-[var(--on-accent)]"
									style={{ opacity: enabled ? 1 : 0.4 }}
									onPointerMove={() => setHighlighted(index)}
									onClick={() => run(command)}
								>
									<span className="w-3 shrink-0 text-center text-[11px]">{checked ? '✓' : ''}</span>
									<span className="min-w-0 flex-1 truncate">{command.title}</span>
									{query.trim() ? <span className="text-[11px] opacity-55">{command.section}</span> : null}
									{command.shortcut != null ? <Shortcut value={command.shortcut} /> : null}
								</div>
							</React.Fragment>
						);
					})}
				</div>
			</div>
		</div>
	);
};

/** Shortcut drawn as keycaps, one per key */
export const Shortcut: React.FC<{ value: string }> = (props) => {
	const { value } = props;
	return (
		<span className="flex shrink-0 gap-0.5">
			{splitShortcut(value).map((key) => (
				<kbd key={key} className="mm-keycap">
					{key}
				</kbd>
			))}
		</span>
	);
};

const MODIFIERS = ['⌃', '⌥', '⇧', '⌘'];

function splitShortcut(value: string): string[] {
	const keys: string[] = [];
	let rest = value;
	while (rest.length > 1 && MODIFIERS.includes(rest[0] ?? '')) {
		keys.push(rest[0] ?? '');
		rest = rest.slice(1);
	}
	keys.push(rest);
	return keys;
}

/** Commands matching every word of the query at a word start, title matches first, in section order */
function searchCommands(cx: StudioCx, query: string): TCommand[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	const available = commands.filter((command) => cx.$workspace.get() === 'compose' || (command.section !== 'Tools' && command.section !== 'Build'));
	if (!words.length) return available;
	const scored = available.flatMap((command) => {
		const title = command.title.toLowerCase();
		const haystack = `${title} ${command.section.toLowerCase()} ${command.keywords ?? ''}`;
		const tokens = haystack.split(/[\s.…°]+/);
		const matches = words.every((word) => tokens.some((token) => token.startsWith(word)) || haystack.includes(word));
		if (!matches) return [];
		const score = (title.startsWith(words[0] ?? '') ? 0 : 1) + (words.every((word) => title.includes(word)) ? 0 : 1);
		return [{ command, score }];
	});
	return scored.sort((a, b) => a.score - b.score).map((item) => item.command);
}
