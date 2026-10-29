import { createRouter } from '@tanstack/react-router';
import { BootScreen } from './routes/components/BootScreen';
import { routeTree } from './routeTree.gen';

export function getRouter() {
	const router = createRouter({
		routeTree,
		defaultPreload: 'intent',
		defaultPendingComponent: BootScreen,
		defaultPendingMinMs: 0,
		scrollRestoration: true
	});

	return router;
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
