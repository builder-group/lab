import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import React from 'react';
import styles from '../styles.css?url';

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ name: 'theme-color', content: '#202020' },
			{ title: 'MidiMarble · A little music, in motion' },
			{
				name: 'description',
				content:
					'Build beautiful musical marble runs. A free, local-first 3D studio with MIDI, physics, and video export.'
			}
		],
		links: [
			{ rel: 'stylesheet', href: styles },
			{ rel: 'icon', href: '/marble.svg', type: 'image/svg+xml' },
			{ rel: 'manifest', href: '/manifest.json' }
		]
	}),
	shellComponent: ShellComponent
});
function ShellComponent(props: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				{props.children}
				<Scripts />
			</body>
		</html>
	);
}
