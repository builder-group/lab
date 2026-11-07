import { createFileRoute } from '@tanstack/react-router';
import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { StartCx, StartScreen } from '@/modules/start';

export const Route = createFileRoute('/')({ component: RouteComponent });

function RouteComponent() {
	const [cx] = React.useState(() => new StartCx());
	const studio = useFeatureState(cx.$openStudio);

	React.useEffect(() => cx.mount(), [cx]);

	if (studio == null) return <StartScreen cx={cx} />;
	return <studio.StudioWindow cx={studio.cx} />;
}
