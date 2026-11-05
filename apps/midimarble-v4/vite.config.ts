import tailwindcss from '@tailwindcss/vite';
import tanstackRouter from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import packageJson from './package.json';

// eslint-disable-next-line turbo/no-undeclared-env-vars
const host = process.env['TAURI_DEV_HOST'];

/** The commit this build came from, for the start window; a build outside git says so */
function buildCommit(): string {
	try {
		return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
	} catch {
		return 'unknown';
	}
}

// https://vite.dev/config/
export default defineConfig({
	resolve: {
		tsconfigPaths: true
	},
	define: {
		__APP_VERSION__: JSON.stringify(packageJson.version),
		__APP_COMMIT__: JSON.stringify(buildCommit())
	},
	plugins: [
		tanstackRouter({
			routesDirectory: './src/routes',
			generatedRouteTree: './src/routeTree.gen.ts',
			routeFileIgnorePrefix: '-',
			routeFileIgnorePattern: '.*(components|hooks|lib).*',
			quoteStyle: 'single'
		}),
		react(),
		tailwindcss()
	],

	// Vite options tailored for Tauri development
	clearScreen: false,
	server: {
		port: 1436,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: 'ws',
					host,
					port: 1437
				}
			: undefined,
		watch: {
			ignored: ['**/src-tauri/**']
		}
	}
});
