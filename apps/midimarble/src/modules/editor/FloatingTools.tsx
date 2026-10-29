import { Plus, X } from 'lucide-react';
import React from 'react';
import type { TNote, TObjectModelId } from '../project';
import { AssetLibrary } from './AssetLibrary';
import { sceneTools } from './editor-commands';
import type { TEditorTool } from './editor-types';

export const FloatingTools: React.FC<TFloatingToolsProps> = ({
	tool,
	onTool,
	onAdd,
	addOpen,
	onAddOpen,
	disabled,
	canLink,
	canTransform,
	canMove = canTransform,
	disabledTransformHint,
	notePlacement,
	placementMarbles,
	placementMarbleId,
	onPlacementMarbleChange
}) => (
	<div className="floating-tools" role="toolbar" aria-label="Scene tools">
		{sceneTools.map(({ id, label, shortcut, Icon }) => {
			const unavailable =
				(id === 'link' && !canLink) ||
				(id === 'move' && !canMove) ||
				(['rotate', 'scale'].includes(id) && !canTransform);
			let hint = `${label} (${shortcut})`;
			if (unavailable && id === 'link') hint += ' · Select an unlocked scene object to link';
			else if (unavailable)
				hint += ` · ${disabledTransformHint ?? 'Unavailable for the current selection'}`;
			else if (id === 'link') hint += ' · Select an object, then click a note';
			return (
				<button
					key={id}
					className={tool === id ? 'active' : ''}
					aria-label={`${label} tool`}
					aria-pressed={tool === id}
					aria-keyshortcuts={shortcut}
					title={hint}
					disabled={disabled || unavailable}
					onClick={() => onTool(id)}
				>
					<Icon size={17} />
				</button>
			);
		})}
		<span className="tool-divider" />
		<button
			aria-label={notePlacement == null ? 'Add world object' : 'Choose an object for selected note'}
			aria-expanded={addOpen}
			className={addOpen ? 'active' : ''}
			disabled={disabled}
			title={
				notePlacement == null ? 'Add world object (Shift A)' : 'Choose an object for selected note'
			}
			onClick={() => onAddOpen(!addOpen)}
		>
			{addOpen ? <X size={18} /> : <Plus size={18} />}
		</button>
		{addOpen && (
			<AssetLibrary
				note={notePlacement}
				marbles={placementMarbles}
				marbleId={placementMarbleId}
				onMarbleChange={onPlacementMarbleChange}
				onClose={() => onAddOpen(false)}
				onAdd={(modelId) => {
					onAdd(modelId);
					onAddOpen(false);
				}}
			/>
		)}
	</div>
);
interface TFloatingToolsProps {
	tool: TEditorTool;
	onTool(tool: TEditorTool): void;
	onAdd(modelId: TObjectModelId): void;
	addOpen: boolean;
	onAddOpen(open: boolean): void;
	disabled: boolean;
	canLink: boolean;
	canTransform: boolean;
	canMove?: boolean;
	disabledTransformHint?: string;
	notePlacement?: TNote | null;
	placementMarbles?: Array<{ id: string; name?: string }>;
	placementMarbleId?: string;
	onPlacementMarbleChange?(id: string): void;
}
