import { useFeatureState } from 'feature-react/state';
import { createState } from 'feature-state';
import { ChevronRight } from 'lucide-react';
import React from 'react';

const STORAGE_KEY = 'midimarble-v4:collapsed-panels';

/** Collapsed inspector panels by id, remembered across sessions like Blender's panel layout */
export const $collapsedPanels = createState<string[]>(readCollapsed());
$collapsedPanels.listen(({ value }) => {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	} catch {
		// Storage can be unavailable; panels then reset to open on the next launch
	}
});

/** Collapsible inspector panel, like a panel in Blender's properties editor */
export const Panel: React.FC<TPanelProps> = (props) => {
	const { id, title, accessory, children } = props;
	const collapsed = useFeatureState($collapsedPanels).includes(id);

	function toggle(): void {
		$collapsedPanels.set((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
	}

	return (
		<section className="mm-panel" aria-label={title}>
			<div className="flex items-center pr-2">
				<button className="mm-panel-header min-w-0 flex-1" aria-expanded={!collapsed} onClick={toggle} type="button">
					<span className="mm-disclosure" data-open={!collapsed}>
						<ChevronRight size={11} strokeWidth={2.2} />
					</span>
					<span className="truncate">{title}</span>
				</button>
				{accessory}
			</div>
			{collapsed ? null : <div className="mm-panel-body">{children}</div>}
		</section>
	);
};

interface TPanelProps {
	/** Stable id for the remembered collapsed state, such as `piece.physics` */
	id: string;
	title: string;
	/** Small controls on the right of the header, such as a reset button */
	accessory?: React.ReactNode;
	children: React.ReactNode;
}

/** Label and value row in a panel, for read-only values */
export const InfoRow: React.FC<{ label: string; children: React.ReactNode }> = (props) => {
	const { label, children } = props;
	return (
		<div className="mm-field">
			<span className="mm-field-label">{label}</span>
			<span className="flex min-w-0 items-center">{children}</span>
		</div>
	);
};

/** Name of what is inspected with an icon tile, like the object row at the top of Blender's properties */
export const InspectorHeader: React.FC<{ icon: React.ReactNode; title: string; subtitle?: React.ReactNode }> = (props) => {
	const { icon, title, subtitle } = props;
	return (
		<div className="flex items-center gap-2.5 border-b border-[var(--separator)] px-3 py-2.5">
			<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[var(--hover)] text-[var(--text-secondary)]">{icon}</span>
			<span className="flex min-w-0 flex-col leading-tight">
				<span className="truncate font-semibold">{title}</span>
				{subtitle != null ? <span className="truncate text-[11px] text-[var(--text-secondary)]">{subtitle}</span> : null}
			</span>
		</div>
	);
};

function readCollapsed(): string[] {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
	} catch {
		return [];
	}
}
