import { useFeatureState } from 'feature-react/state';
import { Hand, Image, MousePointer2, PenTool, Type } from 'lucide-react';
import React from 'react';
import type { ComposeCx } from '@/modules/compose/ComposeCx';
import { toolKeys, type TComposeTool } from '@/modules/compose/keys';
import { PieceIcon } from '@/modules/compose/piece-icons';
import { isEditingTarget } from '@/lib';
import { getCommand } from './commands';
import type { StudioCx } from './StudioCx';

/** Narrow vertical tool rail between the sidebar and the canvas, like Paper's */
export const ToolRail: React.FC<TToolRailProps> = (props) => {
	const { cx } = props;
	const workspace = useFeatureState(cx.$workspace);
	const compose = useFeatureState(cx.$compose);
	return (
		<nav className="mm-tool-rail" aria-label="Tools">
			{workspace === 'compose' ? compose != null ? <ComposeTools compose={compose} /> : null : <DesignTools cx={cx} />}
		</nav>
	);
};

interface TToolRailProps {
	cx: StudioCx;
}

const ComposeTools: React.FC<{ compose: ComposeCx }> = (props) => {
	const { compose } = props;
	const tool = useFeatureState(compose.$tool);
	const item = (id: TComposeTool, label: string, detail: string, icon: React.ReactNode): React.ReactNode => (
		<RailButton key={id} label={label} detail={detail} shortcut={toolKeys.find((key) => key.tool === id)?.key} isActive={tool === id} onClick={() => compose.$tool.set(id)}>
			{icon}
		</RailButton>
	);
	return (
		<>
			{item('select', 'Move', 'Select, drag and turn', <MousePointer2 size={17} strokeWidth={1.6} />)}
			{item('hand', 'Hand', 'Pan the wall', <Hand size={17} strokeWidth={1.6} />)}
			<div className="mm-tool-rail-divider" />
			{item('marble', 'Marble', 'Click to release a new marble', <PieceIcon type="marble" size={18} />)}
			{item('platform', 'Platform', 'Click or drag to place, click a dot to play its note', <PieceIcon type="platform" size={18} />)}
			{item('path', 'Path', 'Draw a rail: click points, drag for curves, Return to finish', <PenTool size={17} strokeWidth={1.6} />)}
			{item('tunnel', 'Tunnel', 'Click to place, click a trajectory to anchor', <PieceIcon type="tunnel" size={18} />)}
			{item('windmill', 'Windmill', 'Click to place, click a trajectory to anchor', <PieceIcon type="windmill" size={18} />)}
		</>
	);
};

const DesignTools: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const placing = useFeatureState(cx.design.$placing);

	// V and T switch tools while Design is open; Compose keeps T for tapping hits
	React.useEffect(() => {
		function onKeyDown(event: KeyboardEvent): void {
			if (isEditingTarget(event) || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
			const key = event.key.toLowerCase();
			if (key === 'v') cx.design.$placing.set(null);
			else if (key === 't') getCommand('tool.text').run(cx);
			else return;
			event.preventDefault();
			event.stopPropagation();
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [cx]);

	return (
		<>
			<RailButton label="Move" detail="Select objects in the preview" shortcut="V" isActive={placing == null} onClick={() => cx.design.$placing.set(null)}>
				<MousePointer2 size={17} strokeWidth={1.6} />
			</RailButton>
			<div className="mm-tool-rail-divider" />
			<RailButton label="Text" detail="Click the wall to place text" shortcut="T" isActive={placing === 'text'} onClick={() => getCommand('tool.text').run(cx)}>
				<Type size={17} strokeWidth={1.6} />
			</RailButton>
			<RailButton label="Asset" detail="Skins and decorations from the library" isActive={false} onClick={() => getCommand('tool.asset').run(cx)}>
				<Image size={17} strokeWidth={1.6} />
			</RailButton>
		</>
	);
};

const RailButton: React.FC<TRailButtonProps> = (props) => {
	const { label, detail, shortcut, isActive, onClick, children } = props;
	return (
		<button className="mm-tool-button" data-active={isActive} aria-label={label} aria-pressed={isActive} onClick={onClick} type="button">
			{children}
			<span className="mm-tooltip mm-tooltip-right">
				<span className="font-medium">{label}</span>
				<span className="text-[rgb(255_255_255/0.6)]">{detail}</span>
				{shortcut != null ? <kbd>{shortcut}</kbd> : null}
			</span>
		</button>
	);
};

interface TRailButtonProps {
	label: string;
	detail: string;
	shortcut?: string;
	isActive: boolean;
	onClick: () => void;
	children: React.ReactNode;
}
