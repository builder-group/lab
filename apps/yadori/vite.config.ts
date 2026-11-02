import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [react()],
	resolve: { tsconfigPaths: true, dedupe: ['react', 'react-dom', 'feature-state', 'feature-core'] },
	clearScreen: false,
	server: {
		port: 1438,
		strictPort: true,
		host: '127.0.0.1',
		watch: { ignored: ['**/src-tauri/**', '**/.local/**'] }
	},
	test: { environment: 'node', exclude: [...configDefaults.exclude, '.local/**'] }
});
