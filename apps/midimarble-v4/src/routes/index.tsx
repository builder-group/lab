import { createFileRoute } from '@tanstack/react-router';
import { useFeatureState } from 'feature-react/state';
import React from 'react';
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
					<div className="mm-pegboard h-full w-full" />
				) : (
					<div className="mm-placeholder bg-[var(--content)]">
						Design preview
						<small>Blender renders the current playhead here.</small>
					</div>
				)
			}
		/>
	);
}
