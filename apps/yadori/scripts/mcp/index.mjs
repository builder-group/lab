#!/usr/bin/env node
/* eslint-disable turbo/no-undeclared-env-vars -- Local standalone launcher, outside Turbo builds. */
// Development convenience only. Packaged clients execute the app binary directly.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const binary =
	process.env.YADORI_EXECUTABLE ??
	[
		'src-tauri/target/debug/Yadori',
		'src-tauri/target/debug/yadori',
		'src-tauri/target/release/Yadori'
	]
		.map((name) => path.join(appRoot, name))
		.find(existsSync);
if (!binary) {
	console.error('Build Yadori first, or set YADORI_EXECUTABLE to the installed app executable.');
	process.exit(1);
}
const dataRoot =
	process.env.YADORI_DATA_ROOT ??
	(process.platform === 'darwin'
		? path.join(homedir(), 'Library/Application Support/group.builder.yadori.next.dev')
		: process.platform === 'win32'
			? path.join(process.env.APPDATA ?? homedir(), 'group.builder.yadori.next.dev')
			: path.join(
					process.env.XDG_DATA_HOME ?? path.join(homedir(), '.local/share'),
					'group.builder.yadori.next.dev'
				));
const child = spawn(binary, ['--mcp', '--data-root', dataRoot, ...process.argv.slice(2)], {
	stdio: 'inherit'
});
child.on('error', () => {
	console.error('Unable to launch the Yadori MCP executable.');
	process.exitCode = 1;
});
child.on('exit', (code) => {
	process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
