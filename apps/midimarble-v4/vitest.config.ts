import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
	// Timing budgets are checked on an idle machine: `pnpm test` runs the performance tests after the rest
	test: {
		environment: 'node',
		include: process.env['MM_PERF'] === '1' ? ['src/**/performance.test.ts'] : ['src/**/*.test.ts'],
		exclude: process.env['MM_PERF'] === '1' ? [] : ['src/**/performance.test.ts', 'node_modules/**']
	}
});
