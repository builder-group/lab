import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// One file at a time: the performance budgets only hold on an otherwise idle machine
export default defineConfig({
	resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
	test: { environment: 'node', include: ['src/**/*.e2e.test.ts'], fileParallelism: false }
});
