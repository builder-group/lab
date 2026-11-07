import tanstack from '@blgc/config/eslint/tanstack';
import { Linter } from 'eslint';
import { globalIgnores } from 'eslint/config';

// The modules, lowest first. A module imports only from layers below its own, never from its own layer's other
// modules, except what `SAME_LAYER` lists. Tests sit on top of everything, so they may reach up. See docs/architecture.md.
// `simulation` is the engine: what happens if the track is this. What to place belongs in `building`, which asks it.
const LAYERS = [['project'], ['simulation', 'music'], ['scene'], ['camera'], ['building'], ['library', 'blender'], ['canvas'], ['track', 'film'], ['studio', 'mcp', 'start']];
const SAME_LAYER = { start: ['studio'], studio: ['mcp'] };
/** These take `StudioCx` as `cx`: a narrow interface would have one implementer. Everything else they need comes through `cx`. */
const TYPES_FROM_STUDIO = ['canvas', 'track', 'film', 'mcp'];
/** Layers 1 to 5 are plain logic, which runs in workers, scripts and tests: no UI, renderer, host or app state */
const PLAIN_LAYERS = 5;
const NOT_PLAIN = ['react', 'react-dom', 'three', 'three/**', '@tauri-apps/**', 'feature-state', 'feature-react', 'feature-react/**', 'lucide-react', '@/components', '@/components/**', '@/environment', '@/environment/**', '@/hooks', '@/hooks/**'];

// The shared config loads eslint-plugin-only-warn, which turns every error into a warning. The layers and unused code must fail the lint.
const LAYER_RULE = '@typescript-eslint/no-restricted-imports';
const ENGINE_RULE = 'no-restricted-syntax';
const FAILING_RULES = new Set([LAYER_RULE, ENGINE_RULE, '@typescript-eslint/no-unused-vars']);
const verify = Linter.prototype.verify;
Linter.prototype.verify = function (...args) {
	const messages = verify.apply(this, args);
	for (const message of messages) if (FAILING_RULES.has(message.ruleId)) message.severity = 2;
	return messages;
};

function moduleRegex(names) {
	return `^(@/modules/|(\\.\\./){1,2})(${names.join('|')})(/|$)`;
}

function layerRule(module, layer) {
	const above = LAYERS.slice(layer + 1).flat();
	const sameLayer = LAYERS[layer].filter((other) => other !== module && !SAME_LAYER[module]?.includes(other));
	const banned = [...above, ...sameLayer].filter((other) => !(TYPES_FROM_STUDIO.includes(module) && other === 'studio'));
	const message = `${module} is in layer ${layer + 1}: it can't import a higher layer or a neighbor. Use \`cx\` or move the code down.`;
	const patterns = [];
	if (banned.length > 0) patterns.push({ regex: moduleRegex(banned), message });
	if (TYPES_FROM_STUDIO.includes(module)) patterns.push({ regex: moduleRegex(['studio']), allowTypeImports: true, message: `${module} takes only types from the shell. Reach its menus and commands through \`cx\`.` });
	if (layer < PLAIN_LAYERS) patterns.push({ group: NOT_PLAIN, message: `${module} is plain logic: no React, Three, Tauri, feature-state or app UI. Those belong in layer 6 or above.` });
	if (patterns.length === 0) return null;
	return {
		name: `midimarble/layers/${module}`,
		files: [`src/modules/${module}/**/*.{ts,tsx}`],
		ignores: ['**/*.test.ts', '**/*.test.tsx'],
		rules: {
			'no-restricted-imports': 'off',
			[LAYER_RULE]: ['error', { patterns }]
		}
	};
}

/**
 * @see https://eslint.org/docs/latest/use/configure/configuration-files
 * @type {import("eslint").Linter.Config[]}
 */
export default [
	...tanstack,
	globalIgnores(['src-tauri/', 'target/', 'dist/', '.local/', 'blender/'], 'Ignore Tauri Rust files'),
	...LAYERS.flatMap((modules, layer) => modules.map((module) => layerRule(module, layer))).filter((rule) => rule != null),
	{
		name: 'midimarble/engine',
		files: ['src/modules/simulation/**/*.ts'],
		ignores: ['**/*.test.ts'],
		rules: {
			[ENGINE_RULE]: ['error', { selector: "NewExpression[callee.name='Worker']", message: 'The engine is called, it calls nothing: the workers that ask it are in `building`.' }]
		}
	}
];
