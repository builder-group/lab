import { Search } from 'lucide-react';
import React from 'react';

/** Searchable editor operators, using the same actions as the visible menus and tools. */
export const CommandPalette: React.FC<TCommandPaletteProps> = ({ commands, onRun }) => {
	const [query, setQuery] = React.useState('');
	const [active, setActive] = React.useState(0);
	const inputRef = React.useRef<HTMLInputElement>(null);
	const listRef = React.useRef<HTMLDivElement>(null);
	const filtered = React.useMemo(
		() =>
			commands.filter((command) => {
				const text = `${command.label} ${command.group}`.toLowerCase();
				return query
					.trim()
					.toLowerCase()
					.split(/\s+/)
					.every((word) => text.includes(word));
			}),
		[commands, query]
	);
	React.useEffect(() => {
		listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
	}, [active, query]);
	React.useEffect(() => {
		const frame = requestAnimationFrame(() => inputRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, []);
	return (
		<>
			<h1 id="modal-title" className="command-heading">
				Search commands
			</h1>
			<label className="command-search">
				<Search size={16} />
				<input
					ref={inputRef}
					aria-label="Search editor commands"
					aria-controls="editor-command-list"
					aria-activedescendant={filtered[active] ? `command-${filtered[active]?.id}` : undefined}
					placeholder="Search a tool, model, or action…"
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setActive(0);
					}}
					onKeyDown={(event) => {
						if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
							event.preventDefault();
							setActive((index) =>
								Math.max(
									0,
									Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))
								)
							);
						}
						if (event.key === 'Enter' && filtered[active]) {
							event.preventDefault();
							onRun(filtered[active].id);
						}
					}}
				/>
				<kbd>F3</kbd>
			</label>
			<div
				ref={listRef}
				className="command-list"
				role="listbox"
				id="editor-command-list"
				aria-label="Editor commands"
			>
				{filtered.map((command, index) => (
					<button
						role="option"
						id={`command-${command.id}`}
						aria-selected={index === active}
						className={index === active ? 'is-active' : ''}
						key={command.id}
						onMouseEnter={() => setActive(index)}
						onClick={() => onRun(command.id)}
					>
						<span>
							<small>{command.group}</small>
							{command.label}
						</span>
						{command.shortcut && <kbd>{command.shortcut}</kbd>}
					</button>
				))}
				{!filtered.length && <p>No matching commands.</p>}
			</div>
			<p className="command-help">↑ ↓ choose · Enter run · Escape close</p>
		</>
	);
};
export interface TEditorCommand {
	id: string;
	label: string;
	group: string;
	shortcut?: string;
}
interface TCommandPaletteProps {
	commands: TEditorCommand[];
	onRun(id: string): void;
}
