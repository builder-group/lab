import { createFileRoute } from '@tanstack/react-router';
import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { ComposeCanvas } from '@/modules/compose';
import { DesignView } from '@/modules/design';
import { StartScreen } from '@/modules/start';
import { Studio, StudioCx } from '@/modules/studio';

export const Route = createFileRoute('/')({ component: RouteComponent });

function RouteComponent() {
	const [cx] = React.useState(() => new StudioCx());
	const history = useFeatureState(cx.$history);
	const workspace = useFeatureState(cx.$workspace);

	React.useEffect(() => cx.mount(), [cx]);

	if (history == null) return <StartScreen cx={cx} />;
	return (
		<Studio
			cx={cx}
			canvas={
				workspace === 'compose' ? (
					<ComposeCanvas cx={cx} />
				) : (
					<DesignView
						cx={cx.design}
						frame={history.present.frame}
						onPick={(id) => cx.$selection.set(id == null ? [] : [id])}
						onPlace={(u, v) => cx.placeWallText(u, v)}
						onDropAsset={(entityId, asset) => {
							const item = [...cx.library.$projectItems.get(), ...cx.library.$globalItems.get()].find((candidate) => candidate.id === asset.id && candidate.scope === asset.scope);
							if (item == null) return;
							cx.$selection.set([entityId]);
							void cx.library.applySkin(item, { kind: 'entities', entityIds: [entityId] });
						}}
					/>
				)
			}
		/>
	);
}
