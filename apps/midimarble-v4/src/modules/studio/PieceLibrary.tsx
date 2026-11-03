import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { ComposeCx } from '@/modules/compose/ComposeCx';
import { InsertDragGhost } from '@/modules/compose/InsertLibrary';
import { armedInsertItem, insertSections } from '@/modules/compose/library';
import { PiecePreview } from '@/modules/compose/PiecePreview';
import type { StudioCx } from './StudioCx';
import { useInsertDrag } from './use-insert-drag';

/**
 * Compose's Library tab, like Figma's Assets: the Insert library's tiles in the sidebar. A click arms the
 * item's tool and a drag drops it on the wall; the tool rail's Insert popover is the quick form of the same list.
 */
export const PieceLibrary: React.FC<TPieceLibraryProps> = (props) => {
	const { cx } = props;
	const compose = useFeatureState(cx.$compose);
	if (compose == null) return null;
	return <PieceTiles compose={compose} />;
};

interface TPieceLibraryProps {
	cx: StudioCx;
}

const PieceTiles: React.FC<{ compose: ComposeCx }> = (props) => {
	const { compose } = props;
	const tool = useFeatureState(compose.$tool);
	const pathType = useFeatureState(compose.$pathType);
	const armed = armedInsertItem(tool, pathType);
	const ghost = useInsertDrag(compose);

	return (
		<div className="mm-piece-library min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-3" role="region" aria-label="Library">
			{insertSections.map((section) => (
				<section key={section.title} className="mm-library-section" aria-label={section.title}>
					<div className="mm-library-section-title">{section.title}</div>
					<div className="mm-library-grid">
						{section.entries.map((entry) => (
							<button
								key={entry.item}
								className="mm-library-tile"
								data-armed={armed === entry.item}
								aria-label={`${entry.label}: ${entry.description}`}
								title={entry.description}
								onPointerDown={(event) => ghost.start(entry.item, event)}
								onKeyDown={(event) => {
									if (event.key !== 'Enter' && event.key !== ' ') return;
									event.preventDefault();
									compose.armInsert(entry.item);
								}}
								type="button"
							>
								<span className="mm-library-preview">
									<PiecePreview item={entry.item} width={96} height={52} />
								</span>
								<span className="mm-library-label">
									<span>{entry.label}</span>
									{entry.shortcut != null ? <kbd>{entry.shortcut}</kbd> : null}
								</span>
							</button>
						))}
					</div>
				</section>
			))}
			{ghost.state != null && !ghost.state.isOnCanvas ? <InsertDragGhost item={ghost.state.item} position={ghost.state.position} /> : null}
		</div>
	);
};
