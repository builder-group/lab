import { useFeatureState } from 'feature-react/state';
import { ChevronsRight, FlipHorizontal2, Hand, MousePointer2, Repeat2, StepForward, WandSparkles } from 'lucide-react';
import React from 'react';
import type { ComposeCx } from './ComposeCx';
import { acceptableCount } from './ghosts';
import { pieceKeys } from './keys';

/** Floating tool bar at the bottom centre of the canvas, like Figma UI3 */
export const ComposeToolbar: React.FC<TComposeToolbarProps> = (props) => {
	const { compose } = props;
	const tool = useFeatureState(compose.$tool);
	const pieceType = useFeatureState(compose.$pieceType);
	const ghosts = useFeatureState(compose.assist.$ghosts);
	const continueCount = ghosts.ghost?.kind === 'continue' ? acceptableCount(ghosts.ghost) : 0;

	return (
		<div className="mm-floating absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 p-1" role="toolbar" aria-label="Tools">
			<ToolButton label="Select" shortcut="V" active={tool === 'select'} onClick={() => compose.$tool.set('select')}>
				<MousePointer2 size={16} strokeWidth={1.6} />
			</ToolButton>
			<ToolButton label="Hand" shortcut="H" active={tool === 'hand'} onClick={() => compose.$tool.set('hand')}>
				<Hand size={16} strokeWidth={1.6} />
			</ToolButton>
			<Divider />
			{pieceTools.map((item) => (
				<ToolButton
					key={item.type}
					label={item.label}
					detail={item.detail}
					shortcut={pieceKeys.find((key) => key.type === item.type)?.key}
					active={tool === 'piece' && pieceType === item.type}
					onClick={() => compose.runKeyAction({ type: 'pieceType', pieceType: item.type })}
				>
					{item.icon}
				</ToolButton>
			))}
			<Divider />
			<ToolButton label="Next" detail="Places the next hit" shortcut="N" onClick={() => compose.next()}>
				<StepForward size={16} strokeWidth={1.6} />
			</ToolButton>
			<ToolButton label="Repeat" shortcut="R" onClick={() => compose.step('repeat')}>
				<Repeat2 size={16} strokeWidth={1.6} />
			</ToolButton>
			<ToolButton label="Mirror" shortcut="M" onClick={() => compose.step('mirror')}>
				<FlipHorizontal2 size={16} strokeWidth={1.6} />
			</ToolButton>
			<ToolButton label="Auto place" shortcut="A" onClick={() => compose.assist.autoPlace(compose.placementType())}>
				<WandSparkles size={16} strokeWidth={1.6} />
			</ToolButton>
			<ToolButton
				label={continueCount > 0 ? `Continue ${continueCount}` : 'Continue'}
				detail={continueCount > 0 ? undefined : 'Offered when the rhythm repeats'}
				shortcut="⇥"
				disabled={continueCount === 0}
				onClick={() => compose.assist.acceptGhosts()}
			>
				<ChevronsRight size={16} strokeWidth={1.6} />
				{continueCount > 0 ? <span className="mm-tool-count">{continueCount}</span> : null}
			</ToolButton>
		</div>
	);
};

interface TComposeToolbarProps {
	compose: ComposeCx;
}

const pieceTools: { type: string; label: string; detail: string; icon: React.ReactNode }[] = [
	{ type: 'platform', label: 'Platform', detail: 'Bounce surface', icon: <PlatformIcon /> },
	{ type: 'rail', label: 'Rail', detail: 'Rolls the marble through a long gap', icon: <RailIcon /> },
	{ type: 'tunnel', label: 'Tunnel', detail: 'Hides the marble on its way', icon: <TunnelIcon /> },
	{ type: 'windmill', label: 'Windmill', detail: 'Blades that turn when struck', icon: <WindmillIcon /> }
];

const ToolButton: React.FC<TToolButtonProps> = (props) => {
	const { label, detail, shortcut, active = false, disabled = false, onClick, children } = props;
	return (
		<button
			className="mm-tool-button disabled:opacity-35"
			data-active={active}
			aria-label={label}
			aria-pressed={active}
			disabled={disabled}
			onClick={onClick}
			type="button"
		>
			{children}
			<span className="mm-tooltip">
				{label}
				{detail != null ? <span className="text-[rgb(255_255_255/0.6)]">{detail}</span> : null}
				{shortcut != null ? <kbd>{shortcut}</kbd> : null}
			</span>
		</button>
	);
};

interface TToolButtonProps {
	label: string;
	detail?: string;
	shortcut?: string;
	active?: boolean;
	disabled?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}

const Divider: React.FC = () => <div className="mx-1 h-5 w-px bg-[var(--separator)]" />;

// Piece icons are drawn to match the lucide stroke style

function PlatformIcon(): React.ReactElement {
	return (
		<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
			<rect x="3" y="10" width="18" height="5" rx="2.5" transform="rotate(-14 12 12.5)" />
			<circle cx="12" cy="12.5" r="0.9" fill="currentColor" />
		</svg>
	);
}

function RailIcon(): React.ReactElement {
	return (
		<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
			<path d="M3 8.5c5 0 9 2.5 18 7" />
			<path d="M3 12.5c5 0 9 2.5 18 7" />
			<path d="M7 8.8v3.9M12 10.2v3.9M17 12.6v3.9" strokeWidth={1.2} />
		</svg>
	);
}

function TunnelIcon(): React.ReactElement {
	return (
		<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
			<path d="M5 7.5h12a3.5 3.5 0 0 1 0 7H5" />
			<path d="M5 7.5a3.5 3.5 0 0 0 0 7" strokeDasharray="1.5 2" />
			<circle cx="12" cy="11" r="1.6" />
		</svg>
	);
}

function WindmillIcon(): React.ReactElement {
	return (
		<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
			<circle cx="12" cy="12" r="2" />
			<path d="M12 10V3.5M14 12h6.5M12 14v6.5M10 12H3.5" />
		</svg>
	);
}
