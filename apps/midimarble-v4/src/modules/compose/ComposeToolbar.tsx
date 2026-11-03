import { useFeatureState } from 'feature-react/state';
import { ChevronsRight, FlipHorizontal2, Hand, MousePointer2, Repeat2, StepForward, WandSparkles } from 'lucide-react';
import React from 'react';
import type { ComposeCx } from './ComposeCx';
import { acceptableCount } from './ghosts';
import { pieceKeys } from './keys';
import { PieceIcon } from './piece-icons';

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
			<ToolButton label="Auto Place" shortcut="A" onClick={() => compose.assist.autoPlace(compose.placementType())}>
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
	{ type: 'platform', label: 'Platform', detail: 'Bounce surface', icon: <PieceIcon type="platform" /> },
	{ type: 'rail', label: 'Rail', detail: 'Rolls the marble through a long gap', icon: <PieceIcon type="rail" /> },
	{ type: 'tunnel', label: 'Tunnel', detail: 'Hides the marble on its way', icon: <PieceIcon type="tunnel" /> },
	{ type: 'windmill', label: 'Windmill', detail: 'Blades that turn when struck', icon: <PieceIcon type="windmill" /> }
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
