import { useFeatureState } from 'feature-react/state';
import { FlipHorizontal2, Hand, MousePointer2, Repeat2 } from 'lucide-react';
import React from 'react';
import type { ComposeCx } from './ComposeCx';

/** Floating tool bar at the bottom centre of the canvas, like Figma UI3 */
export const ComposeToolbar: React.FC<TComposeToolbarProps> = (props) => {
	const { compose } = props;
	const tool = useFeatureState(compose.$tool);
	const pieceType = useFeatureState(compose.$pieceType);

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
					shortcut={item.shortcut}
					active={tool === 'piece' && pieceType === item.type}
					onClick={() => {
						compose.$pieceType.set(item.type);
						compose.$tool.set('piece');
					}}
				>
					{item.icon}
				</ToolButton>
			))}
			<Divider />
			<ToolButton label="Repeat" shortcut="R" onClick={() => compose.step('repeat')}>
				<Repeat2 size={16} strokeWidth={1.6} />
			</ToolButton>
			<ToolButton label="Mirror" shortcut="M" onClick={() => compose.step('mirror')}>
				<FlipHorizontal2 size={16} strokeWidth={1.6} />
			</ToolButton>
		</div>
	);
};

interface TComposeToolbarProps {
	compose: ComposeCx;
}

// Rail, tunnel and windmill join this list in M3
const pieceTools: { type: string; label: string; shortcut?: string; icon: React.ReactNode }[] = [
	{ type: 'platform', label: 'Platform', icon: <PlatformIcon /> }
];

const ToolButton: React.FC<TToolButtonProps> = (props) => {
	const { label, shortcut, active = false, onClick, children } = props;
	return (
		<button className="mm-tool-button" data-active={active} aria-label={label} aria-pressed={active} onClick={onClick} type="button">
			{children}
			<span className="mm-tooltip">
				{label}
				{shortcut != null ? <kbd>{shortcut}</kbd> : null}
			</span>
		</button>
	);
};

interface TToolButtonProps {
	label: string;
	shortcut?: string;
	active?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}

const Divider: React.FC = () => <div className="mx-1 h-5 w-px bg-[var(--separator)]" />;

/** A tilted bar with its bracket nub, drawn to match the lucide stroke style */
function PlatformIcon(): React.ReactElement {
	return (
		<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
			<rect x="3" y="10" width="18" height="5" rx="2.5" transform="rotate(-14 12 12.5)" />
			<circle cx="12" cy="12.5" r="0.9" fill="currentColor" />
		</svg>
	);
}
