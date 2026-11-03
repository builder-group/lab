// End-to-end agent run with the installed CLI: builds the brief for a zigzag platform, creates a temporary
// package and runs the Rust runner's ignored `agent_smoke` test against it. Spends real model usage.
//
//   pnpm exec tsx scripts/agent-smoke.ts [claude|codex]
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgentBrief } from '../src/modules/agents/agent-brief';
import { parseProject } from '../src/modules/project';
import { createSimulator } from '../src/modules/simulation/simulate';

const cli = process.argv[2] === 'codex' ? 'codex' : 'claude';
const request = 'a simple brushed brass bar with a small chrome end cap';
const appDir = new URL('..', import.meta.url).pathname;

const json = readFileSync(join(appDir, 'fixtures/zigzag.marble.json'), 'utf8');
const [isProjectOk, projectErr, project] = parseProject(json);
if (!isProjectOk) throw projectErr;
const simulator = await createSimulator();
const result = simulator.simulate(project);
simulator.dispose();
const platform = project.entities.find((entity) => entity.components.piece?.type === 'platform');
if (platform == null) throw new Error('The zigzag fixture has no platform');
const brief = buildAgentBrief({ project, result, target: { kind: 'piece', entityId: platform.id }, request });

const root = mkdtempSync(join(tmpdir(), 'midimarble-agent-smoke-'));
const packagePath = join(root, 'Smoke.marble');
for (const folder of ['audio', 'assets', 'candidates', 'renders', '.cache', '.bridge']) {
	mkdirSync(join(packagePath, folder), { recursive: true });
}
writeFileSync(join(packagePath, 'project.json'), json);
const briefPath = join(root, 'brief.json');
writeFileSync(briefPath, JSON.stringify(brief, null, '\t'));
console.log(`Package: ${packagePath}`);

const run = spawnSync(
	'cargo',
	[
		'test',
		'-p',
		'midimarble-v4',
		'--lib',
		'agents::smoke::agent_smoke',
		'--',
		'--ignored',
		'--nocapture'
	],
	{
		cwd: appDir,
		stdio: 'inherit',
		env: {
			...process.env,
			MM_SMOKE_PACKAGE: packagePath,
			MM_SMOKE_BRIEF: briefPath,
			MM_SMOKE_PROMPT: `${request}\n\nRead BRIEF.md in this folder first and follow its output contract.`,
			MM_SMOKE_CLI: cli
		}
	}
);
process.exit(run.status ?? 1);
