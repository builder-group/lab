import { useFeatureState } from 'feature-react/state';
import { createState } from 'feature-state';
import { ChevronRight } from 'lucide-react';
import React from 'react';
import './inspector.css';

const STORAGE_KEY = 'midimarble-v4:panel-state';

/** Panels the user opened or closed, by id, remembered across sessions like Blender's panel layout */
const $panelState = createState<Record<string, boolean>>(readPanelState());
$panelState.listen(({ value }) => {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	} catch {
		// Storage can be unavailable; panels then reset to their defaults on the next launch
	}
});

/**
 * Inspector section like Figma UI3's: a flush-left title with a hover chevron that collapses it, small
 * controls on the right, and the fields below on the inspector grid
 */
export const Panel: React.FC<TPanelProps> = (props) => {
	const { id, title, accessory, defaultCollapsed = false, isGrid = true, isDense = false, isEmpty = false, children } = props;
	const stored = useFeatureState($panelState)[id];
	const isCollapsed = stored == null ? defaultCollapsed : !stored;

	function toggle(): void {
		$panelState.set((current) => ({ ...current, [id]: isCollapsed }));
	}

	return (
		<section className="mm-insp-section" aria-label={title} data-collapsed={isCollapsed || isEmpty}>
			<div className="mm-insp-section-head">
				<button className="mm-insp-section-title" aria-expanded={!isCollapsed} data-collapsed={isCollapsed} onClick={toggle} type="button">
					<span className="truncate">{title}</span>
					<span className="mm-insp-chevron" data-open={!isCollapsed}>
						<ChevronRight size={11} strokeWidth={2.2} />
					</span>
				</button>
				{accessory != null && !isCollapsed ? <span className="mm-insp-accessory">{accessory}</span> : null}
			</div>
			{isCollapsed || isEmpty ? null : isGrid ? <div className="mm-insp-grid" data-dense={isDense}>{children}</div> : children}
		</section>
	);
};

interface TPanelProps {
	/** Stable id for the remembered open state, such as `piece.physics` */
	id: string;
	title: string;
	/** Small controls on the right of the title, such as a help tip or an add button */
	accessory?: React.ReactNode;
	/** Starts closed until the user opens it, for secondary sections */
	defaultCollapsed?: boolean;
	/** Lays the children on the two-column field grid; off for free-form content such as lists */
	isGrid?: boolean;
	/** Fills gaps left by full-width fields with later half-width ones, for parameter lists */
	isDense?: boolean;
	/** Shows only the title row, like Figma's Export section before anything is added */
	isEmpty?: boolean;
	children: React.ReactNode;
}

/**
 * Header row of the inspector like Figma UI3's: an icon tile, the name that renames in place, the type
 * below and a status pill on the right. A Fix-it sits under the pill, as Xcode's sits under the message, and
 * the name and subtitle wrap to a second line rather than cut off in the 260 px panel.
 */
export const InspectorHeader: React.FC<TInspectorHeaderProps> = (props) => {
	const { icon, title, subtitle, status, fix, onRename } = props;
	const [isRenaming, setIsRenaming] = React.useState(false);

	return (
		<div className="mm-insp-header">
			<span className="mm-insp-tile">{icon}</span>
			<span className="mm-insp-titles">
				{isRenaming && onRename != null ? (
					<NameInput
						value={title}
						onDone={(value) => {
							setIsRenaming(false);
							if (value != null && value !== title) onRename(value);
						}}
					/>
				) : onRename != null ? (
					<button className="mm-insp-name" onClick={() => setIsRenaming(true)} title={`Rename ${title}`} type="button">
						{title}
					</button>
				) : (
					<span className="mm-insp-name" title={title}>
						{title}
					</span>
				)}
				{subtitle != null ? (
					<span className="mm-insp-subtitle" title={typeof subtitle === 'string' ? subtitle : undefined}>
						{subtitle}
					</span>
				) : null}
			</span>
			{status != null || fix != null ? (
				<span className="mm-insp-status">
					{status}
					{fix}
				</span>
			) : null}
		</div>
	);
};

interface TInspectorHeaderProps {
	icon: React.ReactNode;
	title: string;
	subtitle?: React.ReactNode;
	/** A status pill on the right, such as the timing of a platform */
	status?: React.ReactNode;
	/** A Fix-it under the status pill, such as Place Again or Move Clear */
	fix?: React.ReactNode;
	/** Makes the name editable in place */
	onRename?: (name: string) => void;
}

const NameInput: React.FC<{ value: string; onDone: (value: string | null) => void }> = (props) => {
	const { value, onDone } = props;
	const [draft, setDraft] = React.useState(value);
	const doneRef = React.useRef(false);

	function finish(next: string | null): void {
		if (doneRef.current) return;
		doneRef.current = true;
		onDone(next?.trim() ? next.trim() : null);
	}

	return (
		<input
			autoFocus
			className="mm-insp-name"
			aria-label="Name"
			value={draft}
			onFocus={(event) => event.currentTarget.select()}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={() => finish(draft)}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === 'Enter') finish(draft);
				if (event.key === 'Escape') finish(null);
			}}
		/>
	);
};

/** Status pill for the inspector header, with the details in a tooltip; colour always comes with a label */
export const StatusPill: React.FC<TStatusPillProps> = (props) => {
	const { tone, label, detail, icon } = props;
	return (
		<span className="mm-pill" data-tone={tone} tabIndex={detail != null ? 0 : undefined} aria-label={detail != null ? `${label}. ${detail}` : label}>
			{icon ?? <span className="mm-dot" data-tone={tone === 'neutral' ? undefined : tone} />}
			{label}
			{detail != null ? (
				<span className="mm-help-bubble" role="tooltip">
					{detail}
				</span>
			) : null}
		</span>
	);
};

interface TStatusPillProps {
	tone: 'good' | 'warn' | 'bad' | 'neutral';
	label: string;
	/** Shown in a tooltip; lines break at newlines */
	detail?: string;
	icon?: React.ReactNode;
}

function readPanelState(): Record<string, boolean> {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
		if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
		return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
	} catch {
		return {};
	}
}
