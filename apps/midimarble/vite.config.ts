import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		license: { fileName: 'third-party-licenses.md' }
	},
	resolve: {
		tsconfigPaths: true
	},
	server: {
		port: 3003
	},
	plugins: [
		tanstackStart({
			srcDirectory: 'src',
			spa: { enabled: true, prerender: { outputPath: '/index.html' } },
			router: {
				routeFileIgnorePattern: '^(components|hooks|lib)$'
			}
		}),
		nitro({
			routeRules: {
				'/audio/**': {
					headers: { 'cache-control': 'public, max-age=604800, stale-while-revalidate=86400' }
				}
			}
		}),
		viteReact()
	]
});
