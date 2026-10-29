import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { getMotionSignature } from '../modules/motion/motion-signature';
import { samplePerformance } from '../modules/motion/sample-performance';
import { getProjectMarbles } from '../modules/project/marbles';
import { parseProjectFile, serializeProjectFile } from '../modules/project/project-file';
import type { TPerformance, TProject } from '../modules/project/types';
import { composeProject } from './compose-project';

const usage = `MidiMarble studio — local project inspection and physical verification

Usage:
  pnpm studio inspect <project.marble> [--out report.json]
  pnpm studio simulate <project.marble> [--at 12,15,25] [--out report.json]
  pnpm studio compose <project.marble> --out draft.marble [--track trackId]

inspect   Validate and describe the authored project without simulating.
simulate  Run the same physical solver as the editor and report contacts,
          note timing, resolved objects, and optional camera/marble snapshots.

compose   Build a new close-wall composition from one monophonic track.
          Requires a project of at most 20 seconds and non-overlapping notes.
          --track is required when multiple tracks contain music. Only the
          selected track is copied. Physical verification must pass before saving.

Times are seconds between zero and the project duration.
All commands print JSON. inspect/simulate --out saves the report; compose --out
saves a new native project and refuses existing files. The input is never written.
`;

try {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		allowPositionals: true,
		options: {
			at: { type: 'string' },
			track: { type: 'string' },
			out: { type: 'string' },
			help: { type: 'boolean', short: 'h' }
		}
	});
	if (values.help) {
		process.stdout.write(usage);
	} else {
		const [command, filename] = positionals;
		if (
			(command !== 'inspect' && command !== 'simulate' && command !== 'compose') ||
			filename == null ||
			positionals.length !== 2
		)
			throw new Error('Choose inspect, simulate, or compose and provide one .marble project file.');
		if (command !== 'simulate' && values.at != null) throw new Error('--at requires simulate.');
		if (command !== 'compose' && values.track != null) throw new Error('--track requires compose.');
		if (command === 'compose' && values.out == null)
			throw new Error('Compose requires --out draft.marble.');
		const source = resolve(filename);
		const project = parseProjectFile(await readFile(source, 'utf8'));
		const times = parseTimes(values.at, project.duration);
		const base = {
			format: 'midimarble.studio.v1',
			command,
			source,
			documentHash: createHash('sha256').update(JSON.stringify(project)).digest('hex'),
			motionHash: createHash('sha256').update(getMotionSignature(project)).digest('hex'),
			summary: describeProject(project)
		};
		let report: unknown;
		if (command === 'compose') {
			if (values.out == null) throw new Error('Compose requires --out draft.marble.');
			report = await composeAndWrite(source, project, values.out, values.track);
		} else if (command === 'inspect') {
			report = { ...base, project };
		} else {
			const [{ compilePerformance }, { evaluateCamera }] = await Promise.all([
				import('../modules/motion/compile-performance'),
				import('../modules/scene/scene-camera')
			]);
			const performance = await compilePerformance(project);
			const aspect =
				project.aspectRatio === '9:16' ? 9 / 16 : project.aspectRatio === '16:9' ? 16 / 9 : 1;
			const rails = new Set(
				project.objects.filter((object) => object.kind === 'rail').map((object) => object.id)
			);
			report = {
				...base,
				simulation: {
					dt: performance.dt,
					sampleCount: performance.samples.length,
					additionalMarbles:
						performance.additionalMarbles?.map(({ id, samples }) => ({
							id,
							sampleCount: samples.length
						})) ?? []
				},
				objects: performance.objects,
				impacts: performance.impacts,
				noteTiming: performance.noteMarkers.map(({ noteId, objectId, time, error }) => ({
					noteId,
					objectId,
					scheduledTime: time,
					contactTime: error == null ? null : time + error,
					errorMilliseconds: error == null ? null : error * 1000
				})),
				railContacts:
					performance.surfaceContacts?.filter((contact) => rails.has(contact.objectId)) ?? [],
				bounds: performance.bounds,
				influenceBounds: performance.influenceBounds,
				warnings: performance.warnings,
				snapshots: times.map((time) => ({
					time,
					marbles: sampleMarbles(project, performance, time),
					camera: evaluateCamera(project, performance, time, aspect)
				}))
			};
		}
		const json = JSON.stringify(report, null, '\t') + '\n';
		if (values.out != null && command !== 'compose') {
			const target = resolve(values.out);
			await protectInput(source, target);
			await writeFile(target, json);
		}
		process.stdout.write(json);
	}
} catch (error) {
	process.stderr.write(
		`MidiMarble studio: ${error instanceof Error ? error.message : String(error)}\nUse pnpm studio --help for usage.\n`
	);
	process.exitCode = 1;
}

async function composeAndWrite(
	source: string,
	input: TProject,
	filename: string,
	trackId?: string
) {
	const output = resolve(filename);
	await protectInput(source, output);
	const { project, performance } = await composeProject(input, trackId);
	const document = parseProjectFile(serializeProjectFile(project));
	try {
		await writeFile(output, serializeProjectFile(document), { flag: 'wx' });
	} catch (error) {
		if (error != null && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
			throw new Error('--out already exists. Choose a new filename for the composition.', {
				cause: error
			});
		throw error;
	}
	return {
		format: 'midimarble.studio.v1',
		command: 'compose',
		source,
		output,
		selectedTrack: project.tracks[0]?.id,
		documentHash: createHash('sha256').update(JSON.stringify(document)).digest('hex'),
		motionHash: createHash('sha256').update(getMotionSignature(project)).digest('hex'),
		summary: describeProject(project),
		contacts: {
			linkedNotes: performance.noteMarkers.length,
			physicalImpacts: performance.impacts.length,
			maxErrorMilliseconds: Math.max(
				0,
				...performance.noteMarkers.map((marker) => Math.abs(marker.error ?? 0) * 1000)
			),
			warnings: performance.warnings
		}
	};
}

function describeProject(project: TProject) {
	const linked = new Set(
		project.objects.filter((object) => !object.disabled).map((object) => object.binding?.noteId)
	);
	return {
		id: project.id,
		name: project.name,
		duration: project.duration,
		bpm: project.bpm,
		aspectRatio: project.aspectRatio,
		notes: project.notes.length,
		unlinkedNotes: project.notes.filter((note) => !linked.has(note.id)).length,
		tracks: project.tracks.length,
		marbles: getProjectMarbles(project).length,
		objects: project.objects.length,
		noteLinks: project.objects.filter((object) => object.binding != null).length,
		timeAnchors: project.objects.filter((object) => object.trajectoryAnchor != null).length,
		worldObjects: project.objects.filter(
			(object) => object.binding == null && object.trajectoryAnchor == null
		).length
	};
}

function parseTimes(value: string | undefined, duration: number): number[] {
	if (value == null) return [];
	const times = value.split(',').map((part) => {
		const time = Number(part);
		if (!part.trim().length || !Number.isFinite(time) || time < 0 || time > duration)
			throw new Error(
				`Invalid snapshot time ${JSON.stringify(part)}; expected 0–${duration} seconds.`
			);
		return time;
	});
	return [...new Set(times)];
}

function sampleMarbles(project: TProject, performance: TPerformance, time: number) {
	return getProjectMarbles(project).map((marble) => {
		const samples =
			marble.id === 'main'
				? performance.samples
				: (performance.additionalMarbles?.find((track) => track.id === marble.id)?.samples ?? []);
		const sample = samples.length ? samplePerformance({ ...performance, samples }, time) : null;
		return {
			id: marble.id,
			active: time >= (marble.startTime ?? 0),
			position: sample?.position ?? marble.launch.position,
			rotation: sample?.rotation ?? [0, 0, 0, 1]
		};
	});
}

async function protectInput(source: string, target: string): Promise<void> {
	if (source === target) throw new Error('--out must not overwrite the input project.');
	const original = await stat(source);
	try {
		const output = await stat(target);
		if (original.dev === output.dev && original.ino === output.ino)
			throw new Error('--out points to the input project through a link. Choose another file.');
	} catch (error) {
		if (error != null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
			return;
		throw error;
	}
}
