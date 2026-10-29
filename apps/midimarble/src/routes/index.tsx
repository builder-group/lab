import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import React from 'react';
import { BootScreen } from './components/BootScreen';

export const Route = createFileRoute('/')({ ssr: false, component: RouteComponent });

function RouteComponent() {
	// Match the prerendered SPA fallback before reading browser-only editor state.
	// The router owns this route's Suspense boundary.
	return (
		<ClientOnly fallback={<BootScreen />}>
			<Editor />
		</ClientOnly>
	);
}
const Editor = React.lazy(() =>
	import('../modules/editor/Editor').then((module) => ({ default: module.Editor }))
);
